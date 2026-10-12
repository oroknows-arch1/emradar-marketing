import crypto from 'node:crypto';
const campaigns=['EMRADAR_2026_10_12_LAUNCH','EMRADAR_2026_10_12_LAUNCH_REPLACEMENT_1'];
const hash=v=>v===undefined?null:crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const protectedStates=new Set(['SUBMITTED','PUBLISHED','IN_FLIGHT','AMBIGUOUS']);
function receiptView(r){return r?{id:r.id||null,status:r.execution_status||null,external_id:r.external_id||null,provider_receipt:r.provider_receipt?{provider:r.provider_receipt.provider||null,message_id:r.provider_receipt.message_id||null,status:r.provider_receipt.status||null}:null,definitely_unsent:r.definitely_unsent===true||r.verified_unsent_recovery===true}:null;}
export async function october12Snapshot(store){
 const reviews=(await Promise.all((await store.keys('v2:review:')).map(k=>store.get(k)))).filter(p=>campaigns.includes(p?.campaign_id));
 const report=[];
 for(const campaign_id of campaigns){
  const pkg=await store.get('v2:review_package:'+campaign_id),ids=new Set([...(pkg?.proposals||[]).map(p=>p.proposal_id),...reviews.filter(p=>p.campaign_id===campaign_id).map(p=>p.proposal_id)]),proposals=[];
  for(const proposal_id of ids){
   const p=reviews.find(p=>p.proposal_id===proposal_id),decision=await store.get('v2:decision:'+proposal_id),work=await store.get('v2:work:'+proposal_id),receipt=p?await store.get('v2:receipt:'+p.delivery_key):null,legacy=p?await store.get('receipt:'+p.delivery_key):null;
   let reason='NO_PERSISTED_OWNER_APPROVAL',binding_valid=false;
   if(decision?.decision==='REJECT')reason='OWNER_REJECTED';
   else if(decision?.decision==='APPROVE'){
    if(!p)reason='PERSISTED_PROPOSAL_MISSING';
    else if(decision.authority!=='OWNER')reason='OWNER_AUTHORITY_INVALID';
    else if(['REJECTED','SUPERSEDED'].includes(p.status))reason='PROPOSAL_'+p.status;
    else if(p.delivery_capability!=='VERIFIED_EXECUTABLE')reason='REVIEW_ONLY';
    else{
     binding_valid=decision.proposal_id===p.proposal_id&&decision.review_hash===p.review_hash&&hash(p.binding)===p.review_hash&&hash(p.asset)===hash(p.binding?.asset)&&hash([p.delivery_key,p.review_hash])===p.proposal_id;
     if(!binding_valid)reason='APPROVAL_BINDING_INVALID';
     else if(legacy)reason='LEGACY_RECEIPT_PRESERVED';
     else if(receipt){
      if(receipt.external_id||receipt.provider_receipt)reason='PROVIDER_RECEIPT_PRESERVED';
      else if(protectedStates.has(receipt.execution_status))reason='PRIOR_SUBMISSION_NOT_VERIFIED_UNSENT';
      else if(receipt.proposal_id!==p.proposal_id||receipt.review_hash!==p.review_hash||receipt.delivery_hash!==hash(p.asset))reason='RECEIPT_BINDING_INVALID';
      else if(receipt.definitely_unsent!==true&&receipt.verified_unsent_recovery!==true)reason='PRIOR_SUBMISSION_NOT_VERIFIED_UNSENT';
      else reason='ELIGIBLE_CONFIRMED_UNSENT';
     }else reason='ELIGIBLE_APPROVED_UNDELIVERED';
    }
   }
   proposals.push({proposal_id,destination:p?.destination||null,review_hash:p?.review_hash||null,delivery_key:p?.delivery_key||null,decision:decision?.decision||'PENDING',authority:decision?.authority||null,proposal_status:p?.status||null,delivery_capability:p?.delivery_capability||null,work_status:work?.status||'ABSENT',work_error:work?.error||null,package_owner_status:pkg?.owner_decisions?.[proposal_id]?.status||null,binding_valid,reason,receipt:receiptView(receipt),legacy_receipt:receiptView(legacy)});
  }
  report.push({campaign_id,review_status:pkg?.status||'MISSING',total_proposals:proposals.length,approved:proposals.filter(p=>p.decision==='APPROVE').length,rejected:proposals.filter(p=>p.decision==='REJECT').length,pending:proposals.filter(p=>p.decision==='PENDING').length,executable:proposals.filter(p=>p.delivery_capability==='VERIFIED_EXECUTABLE').length,review_only:proposals.filter(p=>p.delivery_capability==='UNAVAILABLE_REVIEW_ONLY').length,queued:proposals.filter(p=>p.work_status==='QUEUED').length,blocked:proposals.filter(p=>p.work_status==='BLOCKED').length,submitted:proposals.filter(p=>['SUBMITTED','PUBLISHED'].includes(p.work_status)).length,eligible:proposals.filter(p=>p.reason.startsWith('ELIGIBLE_')).length,proposals});
 }
 return report;
}
export async function recoverOctober12Distribution({runtime,enabled,log=console.log}){
 const before=await october12Snapshot(runtime.store);
 for(const campaign of before){log('OCT12_DISTRIBUTION_AUDIT '+JSON.stringify({...campaign,proposals:undefined}));for(const proposal of campaign.proposals)log('OCT12_DISTRIBUTION_PROPOSAL '+JSON.stringify({campaign_id:campaign.campaign_id,...proposal}));}
 const ids=before.flatMap(c=>c.proposals.filter(p=>p.reason.startsWith('ELIGIBLE_')).map(p=>p.proposal_id));
 if(!ids.length){log('OCT12_DISTRIBUTION_RECOVERY '+JSON.stringify({status:'NO_ELIGIBLE_OWNER_APPROVED_WORK',eligible:0}));return before;}
 if(!enabled){log('OCT12_DISTRIBUTION_RECOVERY '+JSON.stringify({status:'DISTRIBUTION_PERMISSION_DISABLED',eligible:ids.length}));return before;}
 await runtime.distribute({proposal_ids:ids,campaign_ids:campaigns,limit:ids.length});
 const after=await october12Snapshot(runtime.store);
 for(const campaign of after){log('OCT12_DISTRIBUTION_RESULT '+JSON.stringify({...campaign,proposals:undefined}));for(const proposal of campaign.proposals)log('OCT12_DISTRIBUTION_RECEIPT '+JSON.stringify({campaign_id:campaign.campaign_id,...proposal}));}
 return after;
}
