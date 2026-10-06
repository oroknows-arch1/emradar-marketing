import crypto from 'node:crypto';
const hash=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const now=()=>new Date().toISOString();
export const outcomeStates=['PREPARED','APPROVED','SUBMITTED','PROVIDER_ACCEPTED','DELIVERY_FAILED','BOUNCED','RESPONSE_RECEIVED','EDITOR_INTEREST','MORE_INFORMATION_REQUESTED','REJECTED','PUBLISHED','NO_OBSERVED_OUTCOME','UNKNOWN'];
const substantive=new Set(['DELIVERY_FAILED','BOUNCED','RESPONSE_RECEIVED','EDITOR_INTEREST','MORE_INFORMATION_REQUESTED','REJECTED','PUBLISHED']);
export async function appendOutcome(store,id,event){
  if(!outcomeStates.includes(event.state)||!event.evidence?.type||!event.evidence?.reference||!Number.isFinite(Date.parse(event.at)))throw new Error('OUTCOME_EVIDENCE_REQUIRED');
  if(event.state==='PUBLISHED'&&(event.evidence.type!=='VERIFIED_PUBLICATION_PAGE'||!event.evidence.url||!event.evidence.page_hash||!event.evidence.artifact_match||!event.evidence.publication_date))throw new Error('PUBLICATION_PAGE_EVIDENCE_REQUIRED');
  if(['EDITOR_INTEREST','MORE_INFORMATION_REQUESTED','REJECTED'].includes(event.state)&&(!event.evidence.reply_message_id||!event.evidence.explicit_statement||event.evidence.classification!=='EXPLICIT_REVIEWED_STATEMENT'))throw new Error('EXPLICIT_EDITORIAL_EVIDENCE_REQUIRED');
  if(event.state==='BOUNCED'&&(!event.evidence.matched_original_message_id||event.evidence.action!=='failed'||!/^5\./.test(event.evidence.dsn_status||'')))throw new Error('MATCHED_FAILURE_DSN_REQUIRED');
  const key='outcome_event:'+id+':'+hash(event),indexKey='outcome_history:'+id;
  const index=await store.get(indexKey)||[];
  if(!index.includes(key)){await store.put(key,event);index.push(key);await store.put(indexKey,index);}
  return index;
}
export async function outcomeHistory(store,id){return Promise.all((await store.get('outcome_history:'+id)||[]).map(k=>store.get(k)));}
export async function normalizeOutcome(store,receipt,performance){
  const proposalId=receipt.proposal_id||receipt.publication_review?.proposal_id;
  const p=proposalId?await store.get('publication_review:'+proposalId):null;
  const source=await store.get('signal_snapshot:'+receipt.product+':'+receipt.signal_id+':'+receipt.signal_revision);
  const at=performance.observed_at||now(),reference='receipt:'+receipt.id;
  const event=(state,time,evidence)=>appendOutcome(store,receipt.id,{state,at:time,evidence});
  if(p)await event('PREPARED',p.created_at,{type:'REVIEW_ARTIFACT',reference:'publication_review:'+p.proposal_id});
  if(receipt.publication_review?.decision==='APPROVED')await event('APPROVED',receipt.publication_review.approved_at,{type:'OWNER_APPROVAL',reference:'publication_approval:'+proposalId});
  if(['SUBMITTED','PUBLISHED'].includes(receipt.execution_status))await event('SUBMITTED',receipt.timestamp,{type:'SUBMISSION_RECEIPT',reference});
  const emailAccepted=receipt.execution_status==='SUBMITTED'&&receipt.delivery_status==='ACCEPTED'&&receipt.provider_receipt?.message_id&&receipt.provider_receipt.accepted?.includes(receipt.recipient);
  if(emailAccepted)await event('PROVIDER_ACCEPTED',receipt.timestamp,{type:'GMAIL_SMTP_ACCEPTANCE',reference,message_id:receipt.provider_receipt.message_id});
  if(receipt.execution_status==='FAILED')await event('DELIVERY_FAILED',receipt.timestamp,{type:'DEFINITIVE_TRANSPORT_FAILURE',reference,reason:receipt.error});
  if(receipt.platform==='X'&&receipt.execution_status==='PUBLISHED'&&receipt.external_id&&receipt.url)await event('PUBLISHED',receipt.timestamp,{type:'VERIFIED_PUBLICATION_PAGE',reference,url:receipt.url,page_hash:receipt.delivery_hash,artifact_match:true,publication_date:receipt.timestamp,provider_post_id:receipt.external_id});
  for(const e of performance.events||[]){if(['BOUNCED','RESPONSE_RECEIVED'].includes(e.state)&&e.evidence?.matched_original_message_id!==receipt.provider_receipt?.message_id)throw new Error('OUTCOME_RECEIPT_MESSAGE_MISMATCH');await appendOutcome(store,receipt.id,e);}
  let history=await outcomeHistory(store,receipt.id);
  const published=history.findLast(e=>e.state==='PUBLISHED');
  const established=published||history.filter(e=>substantive.has(e.state)).sort((a,b)=>Date.parse(a.at)-Date.parse(b.at)).at(-1);
  const fullyChecked=performance.collection?.status==='CHECKED'&&performance.collection.complete===true;
  if(!established&&fullyChecked)await event('NO_OBSERVED_OUTCOME',at,{type:'BOUNDED_MAILBOX_CHECK',reference:performance.collection.reference,checks:performance.collection.checks,elapsed_ms:Math.max(0,Date.parse(at)-Date.parse(receipt.timestamp)),meaning:'NO_OBSERVED_RESPONSE_YET_NOT_REJECTION'});
  history=await outcomeHistory(store,receipt.id);
  const measurements=performance.metrics||{};
  if(!Object.values(measurements).every(m=>Number.isFinite(m.value)&&m.value>=0&&m.unit&&m.scope))throw new Error('INVALID_MEASUREMENT');
  const outcome={version:2,receipt_id:receipt.id,campaign_id:receipt.campaign_id,source_scan_id:receipt.source_receipt?.digest||'UNKNOWN',source_scan_date:source?.signal?.source_snapshot||'UNKNOWN',formation_id:receipt.signal_id,signal_revision:receipt.signal_revision,evidence_state:receipt.signal_state,proposal_id:proposalId||null,destination:receipt.destination,destination_type:p?.asset.delivery?.destination_class||receipt.platform,route:receipt.route_key,route_key:receipt.route_key,recipient_account:receipt.recipient||p?.asset.delivery?.public_contact_point||receipt.account||'UNKNOWN',distribution_channel:receipt.platform,angle:p?.asset.delivery?.relevant_beat_topic||source?.signal?.causal_chain||'UNKNOWN',format:p?.format||receipt.format,language:p?.asset.email?.language||p?.asset.localization?.language||'UNKNOWN',location:source?.signal?.location||'UNKNOWN',industries:source?.signal?.causal_chain?.industries||[],artifact_hash:receipt.delivery_hash,approved_artifact_hash:receipt.approved_artifact_hash||receipt.publication_review?.review_hash||null,approval_state:receipt.publication_review||'UNKNOWN',idempotency_key:receipt.idempotency_key||receipt.id,attempts:receipt.attempts,attempt_history_reference:'receipt_history:'+receipt.id,recovery_reference:'delivery_recovery:'+receipt.id,approved_artifact_reference:proposalId?'publication_review:'+proposalId:null,sender_account:receipt.sender_identity||receipt.account||'UNKNOWN',submission_timestamp:receipt.timestamp,provider_id:receipt.external_id,provider_acceptance_state:emailAccepted?'PROVIDER_ACCEPTED':receipt.execution_status==='PUBLISHED'?'PROVIDER_ACCEPTED':'UNKNOWN',execution_status:receipt.execution_status,outcome_state:established?.state|| (fullyChecked?'NO_OBSERVED_OUTCOME':'UNKNOWN'),outcome_timestamp:established?.at||at,outcome_evidence:established?.evidence||history.at(-1)?.evidence||null,publication_url:history.findLast(e=>e.state==='PUBLISHED')?.evidence.url||null,publication_date:history.findLast(e=>e.state==='PUBLISHED')?.evidence.publication_date||null,measurements,engagement_rate:'UNKNOWN',reach:'UNKNOWN',conversion:'UNKNOWN',source:performance.source||'UNAVAILABLE',observed_at:at,last_checked_at:at,collection:performance.collection||{status:'UNAVAILABLE',reason:performance.reason||performance.source},distribution_cost:receipt.provider_cost||{currency:'USD',amount:receipt.api_cost_usd},infrastructure:receipt.platform==='OPEN_ROUTE'?'existing orok-studios-api Starter relay':'emradar-x-executor',cost_usd:performance.cost_usd??'UNKNOWN',provider_costs:{execution:receipt.provider_cost||'UNKNOWN',workers:receipt.worker_costs||[],observation:performance.provider_cost||'UNKNOWN'},evidence_strength:Object.keys(measurements).length?'DIRECT_MEASUREMENT':'EXECUTION_ONLY',uncertainty:established?'Only the recorded event is established; other outcomes remain unknown.':'Acceptance does not establish delivery, reading, editorial interest or publication.',failure_reason:receipt.error||null,history};
  await store.put('outcome:'+receipt.id,outcome);
  const index=await store.get('outcome_index')||[];if(!index.includes(receipt.id)){index.push(receipt.id);await store.put('outcome_index',index);}
  return outcome;
}
export async function analyseOutcomes(store){
  const outcomes=await Promise.all((await store.get('outcome_index')||[]).map(id=>store.get('outcome:'+id))),groups={};
  for(const o of outcomes.filter(Boolean)){
    const key=[o.distribution_channel,o.destination,o.evidence_state,o.format,o.language].join(':');
    const g=groups[key]||={key,destination:o.destination,platform:o.distribution_channel,evidence_state:o.evidence_state,format:o.format,language:o.language,supporting_observations:[],campaigns:[],positive_evidence:[],negative_evidence:[],neutral_evidence:[],measurements:[],costs:[]};
    g.supporting_observations.push({receipt_id:o.receipt_id,outcome_reference:'outcome:'+o.receipt_id,artifact_hash:o.artifact_hash,source_scan_id:o.source_scan_id,formation_id:o.formation_id,source_scan_date:o.source_scan_date,location:o.location,industries:o.industries,angle:o.angle,state:o.outcome_state,observed_at:o.observed_at});
    if(!g.campaigns.includes(o.campaign_id))g.campaigns.push(o.campaign_id);
    const bucket=['EDITOR_INTEREST','MORE_INFORMATION_REQUESTED','PUBLISHED'].includes(o.outcome_state)?g.positive_evidence:['REJECTED','BOUNCED','DELIVERY_FAILED'].includes(o.outcome_state)||o.execution_status==='FAILED'?g.negative_evidence:g.neutral_evidence;
    bucket.push({receipt_id:o.receipt_id,state:o.outcome_state,evidence:o.outcome_evidence,reason:bucket===g.neutral_evidence?'Silence/acceptance is not editorial success or rejection':null});
    if(Object.keys(o.measurements).length)g.measurements.push({receipt_id:o.receipt_id,metrics:o.measurements});
    g.costs.push({receipt_id:o.receipt_id,distribution:o.distribution_cost});
    const response=o.history.find(e=>['RESPONSE_RECEIVED','EDITOR_INTEREST','MORE_INFORMATION_REQUESTED','REJECTED'].includes(e.state));
    if(response)(g.response_times_ms||=[]).push({receipt_id:o.receipt_id,value:Date.parse(response.at)-Date.parse(o.submission_timestamp)});
  }
  const route_evaluations=await Promise.all((await store.get('route_evaluation_index')||[]).map(key=>store.get(key)));
  const analysis={kind:'OBSERVED_FACT',groups,route_evaluations,created_at:now(),uncertainty:'Submission acceptance is delivery evidence only; missing metrics remain unknown.'};
  for(const g of Object.values(groups))g.sample_size=g.supporting_observations.length;
  const contentHash=hash({groups,route_evaluations});await store.put('performance_analysis:'+contentHash,analysis);await store.put('performance_analysis', {...analysis,reference:'performance_analysis:'+contentHash});return {...analysis,reference:'performance_analysis:'+contentHash};
}
export async function learnRouting(store,analysis){
  const signals={};
  for(const g of Object.values(analysis.groups)){
    const n=g.positive_evidence.length+g.negative_evidence.length;
    // A minimum of three distinct formations prevents one campaign becoming a rule.
    const independent=new Set(g.supporting_observations.map(o=>o.formation_id)).size;
    const adjustment=independent>=3&&n>=3?Math.max(-0.15,Math.min(0.15,(g.positive_evidence.length-g.negative_evidence.length)/(n+5)*0.15)):0;
    signals[g.key]={kind:adjustment?'LEARNED_ROUTING_SIGNAL':'INSUFFICIENT_EVIDENCE',destination:g.destination,platform:g.platform,evidence_state:g.evidence_state,format:g.format,language:g.language,sample_size:g.sample_size,independent_formations:independent,confidence:independent>=3?Math.min(0.8,n/(n+10)):0,adjustment,positive_evidence:g.positive_evidence,negative_evidence:g.negative_evidence,neutral_evidence:g.neutral_evidence,supporting_observations:g.supporting_observations,provenance:analysis.reference,uncertainty:'Correlation is not causation. Novel destinations retain neutral historical weight.',at:now()};
  }
  const version=hash({groups:analysis.groups,route_evaluations:analysis.route_evaluations}),memory={version,signals,route_evaluations:analysis.route_evaluations,updated_at:now(),analysis_reference:analysis.reference};
  await store.put('routing_memory:'+version,memory);await store.put('routing_memory',memory);return memory;
}
export function historicalRoutingInput(memory,{destination,platform,evidence_state,format,language}){
  const signals=Object.values(memory?.signals||{}).filter(s=>s.destination===destination&&s.platform===platform&&s.evidence_state===evidence_state&&(!format||s.format===format)&&(!language||s.language===language));
  return {version:memory?.version||null,signals,adjustment:signals.length?signals.reduce((n,s)=>n+s.adjustment,0)/signals.length:0,source_truth_overridden:false,exploration_preserved:true};
}
