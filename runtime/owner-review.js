import crypto from 'node:crypto';
import {equivalentEmailGroups} from './campaign-review-html.js';
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
import {isEditorialCampaignId} from './editorial-group-policy.js';

export function createOwnerReview({store,baseUrl,send,clock=()=>Date.now()}){
 return {store,
  async notify(campaign){
   if(!isEditorialCampaignId(campaign))throw Error('CAMPAIGN_ID_INVALID');
   return store.leased('owner_review_notification:'+campaign,async()=>{
    const notificationKey='owner_review_notification:'+campaign,prior=await store.get(notificationKey);
    if(prior?.status==='SUBMITTED')return {campaign_id:campaign,status:'SUBMITTED',duplicate:true};
    // No retry after an uncertain SMTP acceptance, including a crash during submission.
    if(prior?.status==='SUBMITTING'||prior?.status==='RECEIPT_UNVERIFIED')return {campaign_id:campaign,status:'RECEIPT_UNVERIFIED',duplicate:true};
    if(prior?.retry_at>clock()&&!(prior.reason==='OWNER_NOTIFICATION_CANONICAL_SMTP_UNAVAILABLE'&&process.env.EMRADAR_EMAIL_RELAY_URL==='https://orok-studios-api.onrender.com'&&process.env.EMRADAR_EMAIL_RELAY_TOKEN))return null;
    const record=await store.get('v2:review_package:'+campaign);
    if(!record||record.status!=='AWAITING_OWNER_REVIEW'||!record.proposals?.length||!['PREPARE','VERIFY'].every(node=>record.trace?.some(t=>t.node===node&&t.status==='PASS')))return null;
    const saved=await Promise.all(record.proposals.map(p=>store.get('v2:review:'+p.proposal_id)));
    if(saved.some((p,i)=>!p||p.review_hash!==record.proposals[i].review_hash||JSON.stringify(p.asset)!==JSON.stringify(record.proposals[i].asset)))return null;
    if(!/^https:\/\//.test(baseUrl))throw Error('REVIEW_HTTPS_REQUIRED');
    const review_url=baseUrl+'/V2/CAMPAIGN_REVIEW?campaign_id='+encodeURIComponent(campaign);
    const date=campaign.slice(8,18).replaceAll('_','-'),groups=equivalentEmailGroups(record.proposals).filter(g=>g.email).length;
    const attempt={campaign_id:campaign,status:'SUBMITTING',review_url,attempts:(prior?.attempts||0)+1,started_at:clock(),proposal_count:record.proposals.length,email_group_count:groups};
    await store.put(notificationKey,attempt);
    try{
     const receipt=await send({subject:'EMRADAR campaign review — '+date,text:'Campaign '+date+' is ready for owner review.\n'+record.proposals.length+' saved proposals; '+groups+' distinct email groups.\n\nOpen your campaign review:\n'+review_url+'\n\nNo publication is authorised until you approve its exact saved asset.',notification:{campaign_id:campaign,proposal_count:record.proposals.length,email_group_count:groups,private_review_url:review_url},idempotency_key:hash('owner-review-notification:'+campaign)});
     if(!receipt?.message_id||!receipt.accepted?.includes('oroknows@gmail.com'))throw Error('OWNER_NOTIFICATION_RECEIPT_REQUIRED');
     const completed={...attempt,status:'SUBMITTED',submitted_at:clock(),provider_receipt:receipt};await store.put(notificationKey,completed);
     return {campaign_id:campaign,status:'SUBMITTED',proposal_count:record.proposals.length,email_group_count:groups,provider_receipt:receipt};
    }catch(e){
     // Store only fixed classifications, never SMTP text that could contain the private link.
     const failure={...attempt,status:e.definitely_unsent===true?'RETRYABLE':'RECEIPT_UNVERIFIED',reason:e.message==='OWNER_NOTIFICATION_CANONICAL_SMTP_UNAVAILABLE'?'OWNER_NOTIFICATION_CANONICAL_SMTP_UNAVAILABLE':'OWNER_NOTIFICATION_SUBMISSION_FAILED',retry_at:clock()+Math.min(3600000,60000*2**Math.min(attempt.attempts-1,6))};
     await store.put(notificationKey,failure);return {campaign_id:campaign,status:failure.status,reason:failure.reason,attempts:failure.attempts};
    }
   });
  }
 };
}

