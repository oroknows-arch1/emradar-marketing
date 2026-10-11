import crypto from 'node:crypto';
const hash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail=reason=>{throw Error(reason);};
const now=()=>new Date().toISOString();

// Owner-authenticated actions only. Revision records a request; it never
// rewrites an artifact, reopens a rejection or runs the asset builder.
export async function reviewAction(engine,input){
 const {proposal_id,review_hash,action,reason}=input,store=engine.store;
 if(!['REQUEST_REVISION','OVERRIDE'].includes(action)||typeof reason!=='string'||!reason.trim()||reason.length>2000)fail('OWNER_REVIEW_ACTION_INVALID');
 async function proposal(){
  const p=await store.get('v2:review:'+proposal_id);
  if(!p||p.status==='SUPERSEDED'||p.review_hash!==review_hash||hash(p.binding)!==review_hash||hash(p.asset)!==hash(p.binding.asset)||hash([p.delivery_key,review_hash])!==proposal_id)fail('REVIEW_ASSET_CHANGED');
  return p;
 }
 if(action==='REQUEST_REVISION')return store.locked('v2:decision:'+proposal_id,async()=>{
  const p=await proposal(),key='v2:revision-request:'+hash([proposal_id,review_hash,reason.trim()]),prior=await store.get(key);
  if(prior){await store.put('v2:revision-latest:'+proposal_id,prior);return {...prior,duplicate:true};}
  const record={proposal_id,review_hash,campaign_id:p.campaign_id,status:'REVISION_REQUESTED',reason:reason.trim(),authority:'OWNER',requested_at:now(),original_decision:await store.get('v2:decision:'+proposal_id),external_actions:0};
  await store.put(key,record);await store.put('v2:revision-latest:'+proposal_id,record);return record;
 });
 // Share the distribution lease so a queued job cannot start while its
 // explicit owner decision is changing. Busy delivery is retriable, not bypassed.
 let acquired=false;
 const result=await store.leased('v2:distribution',async()=>{
  acquired=true;
  return store.locked('v2:decision:'+proposal_id,async()=>{
   const p=await proposal(),prior=await store.get('v2:decision:'+proposal_id);
   if(!['APPROVE','REJECT'].includes(input.decision)||!['APPROVE','REJECT'].includes(input.previous_decision))fail('OWNER_OVERRIDE_INVALID');
   if(!prior||prior.review_hash!==review_hash)fail('OWNER_PRIOR_DECISION_REQUIRED');
   if(prior.decision!==input.previous_decision){
    if(prior.decision===input.decision&&prior.override?.previous_decision===input.previous_decision&&prior.override.reason===reason.trim())return {...prior,duplicate:true};
    fail('OWNER_DECISION_CHANGED');
   }
   if(prior.decision===input.decision)fail('OWNER_OVERRIDE_MUST_CHANGE_DECISION');
   const receipt=await store.get('receipt:'+p.delivery_key)||await store.get('v2:receipt:'+p.delivery_key),work=await store.get('v2:work:'+proposal_id);
   if(receipt||['SUBMITTED','PUBLISHED','IN_FLIGHT','AMBIGUOUS'].includes(work?.status))fail('DELIVERY_RECORD_PROTECTED');
   const {history:previousHistory,...previousRecord}=prior;
   const record={proposal_id,review_hash,decision:input.decision,authority:'OWNER',decided_at:now(),history:[...(previousHistory||[]),previousRecord],override:{previous_decision:prior.decision,reason:reason.trim()}};
   // Write the new authority first: interrupted updates still cannot execute
   // under an old approval. The normal distributor recovers approved queues.
   await store.put('v2:decision:'+proposal_id,record);
   if(input.decision==='REJECT'&&work)await store.put('v2:work:'+proposal_id,{...work,status:'CANCELLED_BY_OWNER',cancelled_at:now()});
   if(input.decision==='APPROVE'&&p.delivery_capability==='VERIFIED_EXECUTABLE')await store.put('v2:work:'+proposal_id,{...work,proposal_id,review_hash,delivery_key:p.delivery_key,campaign_id:p.campaign_id,status:'QUEUED',attempts:work?.attempts||0,created_at:work?.created_at||now()});
   p.status=input.decision==='APPROVE'?'OWNER_APPROVED':'REJECTED';await store.put('v2:review:'+proposal_id,p);return record;
  });
 });
 if(!acquired)fail('DISTRIBUTION_IN_PROGRESS_RETRY_REVIEW_ACTION');
 return result;
}
