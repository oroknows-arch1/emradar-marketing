const clamp=n=>Math.max(0,Math.min(1,n));
const norm=v=>String(v||'').toLowerCase();
const overlap=(xs=[],ys=[])=>xs.some(x=>ys.some(y=>norm(x).includes(norm(y))||norm(y).includes(norm(x))));
export const formationFromSignal=s=>({id:s.id,theme:s.source_title||s.id,status:s.state,location:s.location||'UNKNOWN',why_surfaced:s.why_surfaced||s.causal_chain?.formation?.[0]||'UNKNOWN',new_to_radar:s.new_to_radar===true,causal_chain:s.causal_chain||{},evidence:(s.source_facts||[]).map(f=>({fact:f.text,url:f.url,source:f.source})),contradictions:s.source_uncertainty||[],missing_evidence:s.chain_evolution?.unresolved_evidence||[]});
export function openRouteScout({formation,directory,learning={}}){
 if(!formation?.id||!Array.isArray(formation.evidence)||!formation.evidence.length) throw new Error('OPEN_ROUTE_SOURCE_EVIDENCE_REQUIRED');
 const industries=formation.causal_chain?.industries||[];
 const geography=[formation.location||''];
 const candidates=(directory.destinations||[]).filter(d=>d.verification_state==='VERIFIED'&&d.evidence_source_url&&(d.account_required!==true||d.destination_id==='EMRADAR-X-OROKNOWS')).map(d=>{
   const industry=d.industries?.includes('all')||overlap(industries,d.industries)?1:0;
   const geo=d.geography?.includes('global')||overlap(geography,d.geography)?1:0;
   const formationRelevance=industry?1:0;
   const audience=industry?0.9:0;
   const editorial=['named_editor','trade_publication','newsroom_tip','financial_publication'].includes(d.destination_class)?0.9:0.7;
   const novelty=formation.new_to_radar===true?1:0.7;
   const contribution=(d.destination_class==='financial_publication'&&overlap(industries,d.industries))?1:(industry?0.9:0);
   const access=d.account_required===false?1:(d.destination_id==='EMRADAR-X-OROKNOWS'?1:0);
   const history=learning[d.destination_id]?.score??0;
   const score=clamp(formationRelevance*.24+industry*.16+geo*.08+audience*.12+editorial*.1+novelty*.1+contribution*.1+access*.05+history*.05);
   return {...d,route_score:Number(score.toFixed(3)),score_factors:{formation_relevance:formationRelevance,industry_relevance:industry,geographic_relevance:geo,audience_relevance:audience,editorial_fit:editorial,novelty,contribution_value:contribution,access_feasibility:access,historical_route_performance:history||'UNKNOWN'},route_reason:industry?`Relevant to ${industries.filter(i=>overlap([i],d.industries)).join(', ')||'formation'}; verified open access; destination-specific format required.`:'No evidenced industry fit.'};
 }).filter(d=>d.route_score>=0.7).sort((a,b)=>b.route_score-a.route_score||a.destination_id.localeCompare(b.destination_id));
 return {formation_id:formation.id,signal:formation.theme,why_it_matters:formation.why_surfaced,who_cares:[...new Set(candidates.map(c=>c.organisation))],where_they_are:candidates.map(c=>c.destination_name),how_to_reach:candidates.map(c=>({destination_id:c.destination_id,access_method:c.access_method,contact:c.public_contact_point,url:c.public_submission_url})),what_to_send:candidates.map(c=>({destination_id:c.destination_id,formats:c.accepted_formats})),candidates};
}
export function commercialEvidenceBranch(formation){
 const industries=formation.causal_chain?.industries||[];
 const common={supporting_evidence:formation.evidence.map(e=>e.url),confidence:'INVESTIGATE',unknowns:['willingness_to_pay','buyer_workflow_fit','decision_frequency'],result:'UNKNOWN',learning:'UNKNOWN'};
 return {formation_id:formation.id,evidence_state:formation.status,does_not_modify_formation_state:true,hypotheses:[
 {...common,buyer_class:'Industry operators, suppliers and contractors',decision_supported:'Identify where an evidenced formation is moving from signal into physical or commercial execution',observed_problem:`Execution timing and downstream awards remain unresolved across: ${industries.join(', ')||'UNKNOWN'}`,potential_asset:'formation monitoring + evidence delta + ecosystem map',validation_test:'Measure qualified repeat use, enquiries or evidence requests from industry participants; engagement alone is not payment intent.'},
 {...common,buyer_class:'Financial-market, research and intelligence users',decision_supported:'Track how evidence changes the formation, participants, capital exposure and break conditions',observed_problem:'Decision-relevant evidence is distributed across sources and changes over time',potential_asset:'formation history + causal chain + continuous monitoring',validation_test:'Measure repeat use, citations, qualified enquiries and requests for continuing formation coverage; keep willingness-to-pay UNKNOWN until directly evidenced.'}
 ],industry_context:industries};
}
export function prepareRouteAssets({formation,candidates}){
 const fact=formation.evidence?.[0]?.fact||'UNKNOWN';
 const uncertainty=[...(formation.contradictions||[]),...(formation.missing_evidence||[])].slice(0,2).join('; ')||'UNKNOWN';
 const laneFor=d=>d.destination_class==='financial_publication'?'FINANCIAL_MARKETS':d.destination_class==='latam_trade_publication'?'CHILE_LATAM':d.destination_class==='supplier_procurement_publication'?'SUPPLIER_PROCUREMENT':d.destination_class==='analyst_research_publication'?'ANALYST_RESEARCH':d.destination_class==='capital_markets_community'?'CAPITAL_MARKETS_COMMUNITY':d.destination_class==='social'?'PUBLIC_DISCOVERY':'MINING_TRADE';
 const intents={FINANCIAL_MARKETS:'Investigate capital allocation, production/cost implications and what evidence would change the market thesis.',CHILE_LATAM:'Follow how verified investment becomes regional productive capacity, supplier activity and infrastructure consequences.',SUPPLIER_PROCUREMENT:'Monitor the move from project execution into equipment, contractor and procurement awards.',ANALYST_RESEARCH:'Track evidence deltas, break conditions and realised versus forecast outcomes.',CAPITAL_MARKETS_COMMUNITY:'Investigate the causal evidence and listed-company exposure without a buy/hold/sell recommendation.',PUBLIC_DISCOVERY:'Open the evidence trail and follow the formation as it evolves.',MINING_TRADE:'Follow execution milestones, processing constraints and the supplier/technology chain.'};
 const angles={FINANCIAL_MARKETS:'capital → capacity → costs → production → returns → break conditions',CHILE_LATAM:'investment → construction → regional capacity → suppliers/infrastructure → consequences',SUPPLIER_PROCUREMENT:'execution → equipment/contractor demand → awards → commissioning',ANALYST_RESEARCH:'evidence delta → formation state → participants → unresolved evidence → falsification',CAPITAL_MARKETS_COMMUNITY:'world change → company exposure → market relevance → uncertainty',PUBLIC_DISCOVERY:'change → evidence → formation → uncertainty',MINING_TRADE:'project execution → processing bottleneck → equipment/contractor chain → realised output'};
 return candidates.map(d=>{
   const lane=laneFor(d),angle=angles[lane];
   const copy=d.destination_class==='social'?`EMRADAR — ${formation.status}\n\n${fact}\n\nUnresolved: ${uncertainty}`:`EMRADAR is tracking ${formation.theme} as ${formation.status}. Angle: ${angle}. Current evidence: ${fact} Unresolved: ${uncertainty}`;
   return {destination_id:d.destination_id,lane,format:d.accepted_formats[0],state:'PROPOSED_NOT_SUBMITTED',intended_action:intents[lane],angle,evidence_refs:formation.evidence.map(e=>e.url),visual_brief:{type:'causal_formation_card',headline:formation.theme,chain:angle,state:formation.status,unresolved:uncertainty,rule:'visual_must_convey_intelligence_not_decoration'},copy};
 });
}
