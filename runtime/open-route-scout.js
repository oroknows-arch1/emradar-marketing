const clamp=n=>Math.max(0,Math.min(1,n));
const norm=v=>String(v||'').toLowerCase();
const overlap=(xs=[],ys=[])=>xs.some(x=>ys.some(y=>norm(x).includes(norm(y))||norm(y).includes(norm(x))));
export const formationFromSignal=s=>({id:s.id,theme:s.source_title||s.id,status:s.state,location:s.location||'UNKNOWN',why_surfaced:s.why_surfaced||s.causal_chain?.formation?.[0]||'UNKNOWN',causal_chain:s.causal_chain||{},evidence:(s.source_facts||[]).map(f=>({fact:f.text,url:f.url,source:f.source})),contradictions:s.source_uncertainty||[],missing_evidence:s.chain_evolution?.unresolved_evidence||[]});
export function openRouteScout({formation,directory,learning={}}){
 if(!formation?.id||!Array.isArray(formation.evidence)||!formation.evidence.length) throw new Error('OPEN_ROUTE_SOURCE_EVIDENCE_REQUIRED');
 const industries=formation.causal_chain?.industries||[];
 const geography=[formation.location||''];
 const candidates=(directory.destinations||[]).filter(d=>d.verification_state==='VERIFIED'&&d.evidence_source_url&&(d.account_required!==true||d.destination_id==='EMRADAR-X-OROKNOWS')).map(d=>{
   const industry=d.industries?.includes('all')||overlap(industries,d.industries)?1:0;
   const geo=d.geography?.includes('global')||overlap(geography,d.geography)?1:0;
   const formationRelevance=industry?1:0;
   const audience=industry?0.9:0;
   const editorial=['named_editor','trade_publication','newsroom_tip'].includes(d.destination_class)?0.9:0.7;
   const access=d.account_required===false?1:(d.destination_id==='EMRADAR-X-OROKNOWS'?1:0);
   const history=learning[d.destination_id]?.score??0;
   const score=clamp(formationRelevance*.3+industry*.2+geo*.1+audience*.15+editorial*.1+access*.1+history*.05);
   return {...d,route_score:Number(score.toFixed(3)),score_factors:{formation_relevance:formationRelevance,industry_relevance:industry,geographic_relevance:geo,audience_relevance:audience,editorial_fit:editorial,access_feasibility:access,historical_route_performance:history||'UNKNOWN'},route_reason:industry?`Relevant to ${industries.filter(i=>overlap([i],d.industries)).join(', ')||'formation'}; verified open access; destination-specific format required.`:'No evidenced industry fit.'};
 }).filter(d=>d.route_score>=0.7).sort((a,b)=>b.route_score-a.route_score||a.destination_id.localeCompare(b.destination_id));
 return {formation_id:formation.id,signal:formation.theme,why_it_matters:formation.why_surfaced,who_cares:[...new Set(candidates.map(c=>c.organisation))],where_they_are:candidates.map(c=>c.destination_name),how_to_reach:candidates.map(c=>({destination_id:c.destination_id,access_method:c.access_method,contact:c.public_contact_point,url:c.public_submission_url})),what_to_send:candidates.map(c=>({destination_id:c.destination_id,formats:c.accepted_formats})),candidates};
}
export function commercialEvidenceBranch(formation){
 const industries=formation.causal_chain?.industries||[];
 return {formation_id:formation.id,evidence_state:formation.status,does_not_modify_formation_state:true,hypotheses:[
 {buyer_class:'Mining suppliers and contractors',decision_supported:'Where verified brownfield mine expansion is moving into procurement and execution',observed_problem:'Procurement timing and named awards are unresolved in the source evidence',potential_asset:'formation monitoring + evidence delta',supporting_evidence:formation.evidence.map(e=>e.url),confidence:'INVESTIGATE',unknowns:['willingness_to_pay','buyer_workflow_fit','procurement_lead_time'],validation_test:'Observe whether supplier/contractor audiences respond to route-specific evidence-delta coverage; do not infer payment intent from engagement.',result:'UNKNOWN',learning:'UNKNOWN'},
 {buyer_class:'Mining-sector research and market-intelligence teams',decision_supported:'Track whether project execution strengthens, weakens or breaks',observed_problem:'Construction milestones, cost, commissioning and realised output remain unresolved',potential_asset:'formation history + continuous monitoring',supporting_evidence:formation.evidence.map(e=>e.url),confidence:'INVESTIGATE',unknowns:['willingness_to_pay','preferred_delivery_format','decision_frequency'],validation_test:'Measure qualified enquiries or repeat use attributable to formation-history/evidence-delta outputs.',result:'UNKNOWN',learning:'UNKNOWN'}
 ],industry_context:industries};
}
export function prepareRouteAssets({formation,candidates}){
 const fact=formation.evidence?.[0]?.fact||'UNKNOWN';
 const uncertainty=[...(formation.contradictions||[]),...(formation.missing_evidence||[])].slice(0,2).join('; ')||'UNKNOWN';
 return candidates.map(d=>({destination_id:d.destination_id,format:d.accepted_formats[0],state:'PROPOSED_NOT_SUBMITTED',evidence_refs:formation.evidence.map(e=>e.url),copy:d.destination_class==='social'?`EMRADAR — ${formation.status}\n\n${fact}\n\nUnresolved: ${uncertainty}`:`EMRADAR is tracking ${formation.theme} as ${formation.status}. The contribution would focus on the evidence-backed move from approval into execution, the processing bottleneck, named participants, and the conditions that would strengthen or break the formation. Current evidence: ${fact} Unresolved: ${uncertainty}`}));
}
