import crypto from 'node:crypto';
import {equivalentEmailGroups} from './campaign-review-html.js';
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const lifetime=7*86400000;
const campaignPattern=/^EMRADAR_\d{4}_\d{2}_\d{2}_LAUNCH$/;

export function createOwnerReview({store,auth,secret,baseUrl,send,clock=()=>Date.now()}){
 const key=()=>typeof secret==='function'?secret():secret;
 const accessToken=(campaign,nonce)=>crypto.createHmac('sha256',key()).update('owner-review:'+campaign+':'+nonce).digest('hex');
 return {store,
  async redeem(token,res){
   if(!auth.configured()||!/^[a-f0-9]{64}$/.test(token||''))throw Error('OWNER_ACCESS_INVALID');
   const tokenKey='owner_review_access:'+hash(token);
   return store.locked(tokenKey,async()=>{
    const access=await store.get(tokenKey);
    if(!access||access.consumed_at||access.expires_at<=clock())throw Error('OWNER_ACCESS_INVALID');
    // Key rotation invalidates old links as well as old sessions.
    if(accessToken(access.campaign_id,access.nonce)!==token)throw Error('OWNER_ACCESS_INVALID');
    if(!await store.get('v2:review_package:'+access.campaign_id))throw Error('OWNER_ACCESS_INVALID');
    await store.put(tokenKey,{...access,consumed_at:clock()});
    if(!auth.establishOwnerSession(res))throw Error('OWNER_ACCESS_INVALID');
    return '/V2/CAMPAIGN_REVIEW?campaign_id='+access.campaign_id;
   });
  },
  async notify(campaign){
   if(!campaignPattern.test(campaign))throw Error('CAMPAIGN_ID_INVALID');
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
    if(!auth.configured())throw Error('OWNER_AUTH_CONFIGURATION_REQUIRED');
    if(!/^https:\/\//.test(baseUrl))throw Error('PRIVATE_REVIEW_HTTPS_REQUIRED');
    const nonce=prior?.nonce||crypto.randomBytes(32).toString('hex'),token=accessToken(campaign,nonce),tokenKey='owner_review_access:'+hash(token);
    const expires_at=prior?.expires_at||clock()+lifetime;
    if(expires_at<=clock())return {campaign_id:campaign,status:'ACCESS_EXPIRED',duplicate:true};
    if(!await store.get(tokenKey))await store.put(tokenKey,{campaign_id:campaign,nonce,expires_at});
    const date=campaign.slice(8,18).replaceAll('_','-'),groups=equivalentEmailGroups(record.proposals).filter(g=>g.email).length;
    const attempt={campaign_id:campaign,status:'SUBMITTING',nonce,expires_at,attempts:(prior?.attempts||0)+1,started_at:clock(),proposal_count:record.proposals.length,email_group_count:groups};
    await store.put(notificationKey,attempt);
    try{
     const receipt=await send({subject:'EMRADAR private campaign review — '+date,text:'Campaign '+date+' is ready for owner review.\n'+record.proposals.length+' saved proposals; '+groups+' distinct email groups.\n\nOpen your private review (single use; expires in 7 days):\n'+baseUrl+'/OWNER_REVIEW#access='+token+'\n\nNo publication is authorised until you approve its exact saved asset.',notification:{campaign_id:campaign,proposal_count:record.proposals.length,email_group_count:groups,private_review_url:baseUrl+'/OWNER_REVIEW#access='+token},idempotency_key:hash('owner-review-notification:'+campaign)});
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

export async function handleOwnerReviewAccess({req,res,service,origin,readBody,json}){
 res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');
 if(req.headers.origin!==origin||!String(req.headers['content-type']||'').startsWith('application/json'))return json(res,403,{reason:'OWNER_ACCESS_INVALID'});
 try{const {access}=JSON.parse(await readBody(req));const location=await service.redeem(access,res);return json(res,200,{location});}
 catch{return json(res,403,{reason:'OWNER_ACCESS_INVALID'});}
}
export function ownerReviewLanding(){
 return '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>Private EMRADAR review</title><p id="status" role="status">Opening your private campaign review…</p><script>\n'+
 "const access=new URLSearchParams(location.hash.slice(1)).get('access');history.replaceState(null,'','/OWNER_REVIEW');\n"+
 "fetch('/PUBLICATION_REVIEW/access',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({access})}).then(async r=>{const v=await r.json();if(!r.ok)throw Error();location.replace(v.location);}).catch(()=>{document.getElementById('status').textContent='This private link is invalid, expired or already used.';});</script></html>";
}
