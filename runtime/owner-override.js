import crypto from 'node:crypto';
import {recoverIdlePreparationLock} from './preparation-recovery.js';
const hash=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const actions=new Set(['EDITORIAL_ADVISORY','RECOVER_PREPARATION']);
export async function ownerOverride({store,input,resume,recover=recoverIdlePreparationLock}){
 if(!actions.has(input.action)||!/^EMRADAR_\d{4}_\d{2}_\d{2}_LAUNCH$/.test(input.campaign_id||'')||typeof input.reason!=='string'||!input.reason.trim()||input.reason.length>1000||input.confirm!==true)throw Error('CONFIRMED_SCOPED_OWNER_OVERRIDE_REQUIRED');
 const pkg=await store.get('review_package:'+input.campaign_id);if(!pkg)throw Error('PERSISTED_CAMPAIGN_REVIEW_REQUIRED');
 const disposition=(pkg.route_dispositions||[]).find(d=>d.destination===input.destination);
 if(!disposition)throw Error('REGISTERED_REVIEW_DESTINATION_REQUIRED');
 const proposal=(pkg.proposals||[]).find(p=>p.destination===input.destination);
 const id=hash([input.action,input.campaign_id,input.destination,input.review_hash||null,input.reason.trim()]);
 return store.locked('owner_override:'+id,async()=>{
  const old=await store.get('owner_override:'+id);
  if(old?.status==='COMPLETE'){if(proposal&&old.affected_proposals.some(p=>p.proposal_id===proposal.proposal_id&&p.review_hash===proposal.review_hash))return {...old,duplicate:true};throw Error('REVIEW_ARTIFACT_CHANGED');}
  if((proposal?.review_hash||null)!==(input.review_hash||null))throw Error('REVIEW_ARTIFACT_CHANGED');
  const record=old||{id,owner:'OWNER',reason:input.reason.trim(),timestamp:new Date().toISOString(),campaign_id:input.campaign_id,destination:input.destination,action:input.action,affected_proposals:proposal?[{proposal_id:proposal.proposal_id,review_hash:proposal.review_hash}]:[],effect:input.action==='EDITORIAL_ADVISORY'?'Editorial suitability recorded by owner; evidence and execution gates unchanged.':'Inspect existing lock recovery and resume only this unfinished destination.',external_actions:0};
  record.status='REQUESTED';await store.put('owner_override:'+id,record);
  try{
   if(input.action==='RECOVER_PREPARATION'){
    record.recovery=await recover(store,{campaign_id:input.campaign_id});
    if(!['NO_STALE_LOCK','RECOVERED_IDLE_PREPARATION_LOCK'].includes(record.recovery.status))throw Error(record.recovery.reason||'ACTIVE_OR_UNCERTAIN_LOCK');
   }
   if(!proposal){
    const result=await resume(input.campaign_id,[input.destination]);
    record.result={status:result.status,blocker:result.blocker||null};
    const current=await store.get('review_package:'+input.campaign_id);
    const p=current?.proposals?.find(p=>p.destination===input.destination);
    if(!p)throw Error(current?.incomplete_preparation?.find(d=>d.destination===input.destination)?.reason||result.blocker||'PREPARATION_INCOMPLETE');
    record.affected_proposals=[{proposal_id:p.proposal_id,review_hash:p.review_hash}];
   }
   record.status='COMPLETE';record.resulting_state='AVAILABLE_FOR_OWNER_REVIEW';
  }catch(e){record.status='BLOCKED';record.blocker=e.message;}
  record.updated_at=new Date().toISOString();await store.put('owner_override:'+id,record);return record;
 });
}
