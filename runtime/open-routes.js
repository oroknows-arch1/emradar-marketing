import fs from 'node:fs/promises';
const directory=JSON.parse(await fs.readFile(new URL('../state/open-route-directory.json',import.meta.url),'utf8'));
const norm=v=>String(v||'').toLowerCase();
const terms=s=>new Set(norm(s).split(/[^a-z0-9]+/).filter(x=>x.length>2));
const overlap=(a,b)=>{const A=terms(a),B=terms(b);let n=0;for(const x of A)if(B.has(x))n++;return n;};
const signalText=s=>JSON.stringify({title:s.source_title,chain:s.causal_chain||{},facts:s.source_facts||[]});
export function openRouteCandidates(signal){
 const text=signalText(signal); const industries=signal.causal_chain?.industries||[];
 return directory.destinations.map(d=>{
   const industry_hits=d.industries.filter(i=>industries.some(x=>overlap(i,x)>0)).length;
   const topic_hits=d.relevant_beat_topic.filter(t=>overlap(t,text)>0).length;
   const geo_hits=d.geography.filter(g=>overlap(g,text)>0).length;
   const evidence_backed=d.verification_state.startsWith('VERIFIED_')&&!!d.evidence_source_url&&!!d.public_submission_url;
   const factors={formation_relevance:Math.min(1,(industry_hits+topic_hits)/3),industry_relevance:Math.min(1,industry_hits/2),geographic_relevance:Math.min(1,geo_hits),audience_relevance:Math.min(1,(industry_hits+topic_hits)/3),editorial_fit:Math.min(1,topic_hits/2),novelty:signal.chain_evolution?.new_links?.length?1:0.5,contribution_value:(signal.evidence||[]).length>=2?1:0.5,access_feasibility:d.account_required===false&&evidence_backed?1:0,historical_route_performance:0};
   const score=Object.values(factors).reduce((a,b)=>a+b,0)/Object.keys(factors).length;
   return {...d,score:Number(score.toFixed(3)),factors,selected:evidence_backed&&score>=0.45,rejection_reason:evidence_backed?(score>=0.45?null:'WEAK_RELEVANCE'):'UNVERIFIED_ROUTE'};
 }).sort((a,b)=>b.score-a.score||a.destination_id.localeCompare(b.destination_id));
}
export function routePackages(signal,candidates){
 const fact=signal.source_facts?.[0]?.text||signal.source_title;
 const uncertainty=signal.source_uncertainty?.[0]||'UNKNOWN';
 return candidates.filter(x=>x.selected).map(d=>{
   const local=d.geography.some(g=>['Chile','South America','Latin America'].includes(g));
   const angle=local?`${signal.source_title}: local industry consequences, participants and unresolved execution risk`:`${signal.source_title}: formation mechanism, bottlenecks, participants and remaining execution risk`;
   const format=d.accepted_formats.includes('newsroom_tip')?'newsroom_tip':d.accepted_formats.includes('editor_pitch')?'editor_pitch':d.accepted_formats[0];
   return {destination_id:d.destination_id,format,contribution_angle:angle,asset:{state:signal.state,headline:angle,evidence_anchor:fact,uncertainty,falsification:signal.chain_evolution?.break_conditions||[],source_evidence:[...(signal.evidence||[])]},publication_state:'PROPOSED_NOT_SUBMITTED'};
 });
}
export function commercialEvidence(signal){
 const chain=signal.causal_chain||{};const industries=chain.industries||[];const hasCompany=(chain.connected_companies_and_tickers||[]).length>0;
 const hypotheses=[];
 if(industries.length)hypotheses.push({buyer_class:'sector research and intelligence teams',decision_supported:'monitor whether a formation is strengthening, weakening or breaking',observed_problem:'Evidence is distributed across project, company and government sources over time.',potential_asset:'formation history + evidence delta + continuous monitoring',supporting_evidence:[...(signal.evidence||[])],confidence:'HYPOTHESIS',unknowns:['workflow frequency','existing substitute','willingness to pay'],validation_test:'Track repeat readership, enquiries, requests for updates, and acceptance by specialist destinations.',result:'UNTESTED',learning:'UNKNOWN'});
 if(hasCompany)hypotheses.push({buyer_class:'company and supply-chain monitoring teams',decision_supported:'track exposure to project execution and bottlenecks',observed_problem:'Project milestones can change supplier, capacity and execution exposure before realised output appears.',potential_asset:'company exposure monitoring + alert',supporting_evidence:[...(signal.evidence||[])],confidence:'HYPOTHESIS',unknowns:['buyer role','decision frequency','willingness to pay'],validation_test:'Record downstream enquiries or explicit requests for company/project monitoring after evidence-qualified distribution.',result:'UNTESTED',learning:'UNKNOWN'});
 return hypotheses;
}
export const openRouteDirectory=directory;
