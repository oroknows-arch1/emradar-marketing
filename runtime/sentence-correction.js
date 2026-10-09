import crypto from 'node:crypto';
import {approveExact} from './approved-distribution.js';
const digest=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const campaign='EMRADAR_2026_10_07_LAUNCH';
const sentence='The formation is FORMING.';
const targets=['GLOBAL-MINING-REVIEW-EDITORIAL','MINING-WEEKLY-TIP','AUSTRALIAN-MINING-REVIEW-EDITORIAL'];
const fail=reason=>{throw Error(reason);};
const reviewHash=p=>digest({product_truth:p.review_binding.product_truth,signal_revision:p.signal_revision,asset:p.asset,destination:p.review_binding.destination,source_receipt:p.source_receipt||null});
export function correctSentence(p){
 const q=structuredClone(p),email=q.asset.email;
 const remove=text=>{if(typeof text!=='string'||text.split(sentence).length!==2)fail('EXACT_SENTENCE_OCCURRENCE_REQUIRED');return text.replace(sentence+' ','').replace(sentence,'');};
 q.copy=remove(q.copy);q.asset.copy=remove(q.asset.copy);
 email.body=remove(email.body);email.proposition.body=remove(email.proposition.body);email.html=remove(email.html);
 if(email.features)email.features.email_length_words=email.body.trim().split(/\s+/).length;
 if(q.correspondence_features)q.correspondence_features.email_length_words=email.body.trim().split(/\s+/).length;
 q.review_hash=reviewHash(q);q.proposal_id=digest([q.publication_key,q.review_hash]);
 q.replaces_proposal_id=p.proposal_id;q.status='AWAITING_REVIEW';
 return q;
}
// Authority is the exact owner-approved manifest delivered by authenticated GitHub deployment.
// No public mutation endpoint, writer call, source change, or transport is involved.
export async function applySentenceCorrection(engine,manifest){
 const s=engine.store,key='sentence_correction:'+campaign+':v1';
 if(manifest.campaign_id!==campaign||manifest.sentence!==sentence||manifest.proposals.length!==3||JSON.stringify(manifest.proposals.map(p=>p.destination).sort())!==JSON.stringify([...targets].sort()))fail('SENTENCE_CORRECTION_SCOPE_INVALID');
 const complete=await s.get(key);if(complete?.status==='COMPLETE')return complete;
 const lockReviews=(i,fn)=>i===manifest.proposals.length?fn():s.locked('approval:'+manifest.proposals[i].proposal_id,()=>lockReviews(i+1,fn));
 return s.leased('distribution',()=>lockReviews(0,()=>s.locked('engine',async()=>{
  let audit=await s.get(key);if(audit?.status==='COMPLETE')return audit;
  if(!audit){
   const pkg=await s.get('review_package:'+campaign);if(!pkg||pkg.campaign_id!==campaign)fail('SAVED_CAMPAIGN_REQUIRED');
   const plans=[];
   for(const d of manifest.proposals){
    const p=await s.get('publication_review:'+d.proposal_id);
    if(!p||p.input.campaign_id!==campaign||p.destination!==d.destination||p.review_hash!==d.review_hash||reviewHash(p)!==d.review_hash||p.proposal_id!==digest([p.publication_key,p.review_hash])||p.status!=='AWAITING_REVIEW'||!pkg.proposals.some(q=>q.proposal_id===p.proposal_id&&q.review_hash===p.review_hash))fail('EXACT_REVIEW_IDENTITY_CHANGED');
    const receipt=await s.get('receipt:'+p.publication_key),approval=await s.get('publication_approval:'+p.proposal_id),work=await s.get('distribution_work:'+p.proposal_id);
    if(receipt?.external_id||receipt?.provider_receipt||['PUBLISHED','SUBMITTED','IN_FLIGHT','AMBIGUOUS'].includes(receipt?.execution_status)||['QUEUED','RUNNING'].includes(work?.status))fail('DELIVERY_STATE_PREVENTS_EDIT');
    const corrected=correctSentence(p);
    if(await s.get('publication_review:'+corrected.proposal_id)||await s.get('publication_approval:'+corrected.proposal_id)||await s.get('distribution_work:'+corrected.proposal_id))fail('CORRECTION_IDENTITY_ALREADY_EXISTS');
    plans.push({original:p,corrected,prior_approval:approval,prior_receipt:receipt,prior_distribution_work:work});
   }
   audit={status:'PREPARED',campaign_id:campaign,authority:manifest.authority,at:new Date().toISOString(),plans,external_actions:0};
   await s.put(key,audit);
  }
  // Durable prepared plan makes interrupted writes repeatable with identical bytes and identities.
  for(const {original,corrected} of audit.plans){
   await s.put('publication_review:'+corrected.proposal_id,corrected);
   await s.put('publication_review:'+original.proposal_id,{...original,status:'SUPERSEDED',replacement_proposal_id:corrected.proposal_id});
  }
  const pkg=await s.get('review_package:'+campaign),replacement=id=>audit.plans.find(p=>p.original.proposal_id===id);
  pkg.proposals=pkg.proposals.map(p=>replacement(p.proposal_id)?{...p,...replacement(p.proposal_id).corrected,artifact_hash:replacement(p.proposal_id).corrected.review_hash}:p);
  for(const d of pkg.route_dispositions||[]){const r=replacement(d.proposal_id);if(r)d.proposal_id=r.corrected.proposal_id;}
  if(pkg.discovery_routing_completion_receipt){pkg.discovery_routing_completion_receipt.dispositions_sha256=digest(pkg.route_dispositions||[]);await s.put('discovery_routing_completion:'+campaign+':'+pkg.review_contract_revision,pkg.discovery_routing_completion_receipt);}
  const results=[];
  for(const {corrected} of audit.plans){const approval=await approveExact(engine,corrected,{queue:false});results.push({...approval,destination:corrected.destination,body:corrected.asset.email.body});}
  const report={status:'COMPLETE',campaign_id:campaign,authority:audit.authority,at:audit.at,external_actions:0,results};
  pkg.sentence_correction=report;await s.put('review_package:'+campaign,pkg);
  await s.put(key,{...audit,...report});return report;
 })));
}
