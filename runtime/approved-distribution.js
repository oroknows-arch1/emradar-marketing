import crypto from 'node:crypto';
import {beginCosts,finishCosts,costKey} from './campaign-costs.js';
const digest=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const at=()=>new Date().toISOString();
const done=new Set(['PUBLISHED','SUBMITTED','IN_FLIGHT','AMBIGUOUS']);
const fail=reason=>{throw new Error(reason);};
function identity(p,decision){
  if(!p||['REJECTED','SUPERSEDED'].includes(p.status)||p.proposal_id!==decision.proposal_id||p.review_hash!==decision.review_hash||!p.review_binding)fail('PUBLICATION_REVIEW_EXPIRED_OR_CHANGED');
  const hash=digest({product_truth:p.review_binding.product_truth,signal_revision:p.signal_revision,asset:p.asset,destination:p.review_binding.destination,source_receipt:p.source_receipt||null});
  if(hash!==p.review_hash||digest([p.publication_key,hash])!==p.proposal_id)fail('PUBLICATION_REVIEW_EXPIRED_OR_CHANGED');
}
// The work record is durable before approval is acknowledged. No provider calls here.
// The asset hash binds all bytes, copy, recipient and subject; warnings are accepted.
export async function approveExact(engine,decision,{queue=true}={}){
  const s=engine.store;
  return s.locked('approval:'+decision.proposal_id,async()=>{
    const p=await s.get('publication_review:'+decision.proposal_id);identity(p,decision);
    const prior=await s.get('receipt:'+p.publication_key);
    const old=await s.get('publication_approval:'+p.proposal_id);
    if(old&&(old.review_hash!==p.review_hash||(old.asset_hash&&old.asset_hash!==digest(p.asset))))fail('APPROVED_ARTIFACT_CHANGED');
    const approval={...old,proposal_id:p.proposal_id,review_hash:p.review_hash,asset_hash:digest(p.asset),approved_by:'OWNER',approved_at:old?.approved_at||at(),status:'OWNER_APPROVED'};
    if(approval.review_hash!==p.review_hash||approval.asset_hash!==digest(p.asset))fail('APPROVED_ARTIFACT_CHANGED');
    const key='distribution_work:'+p.proposal_id,existing=await s.get(key);
    const work=existing||{proposal_id:p.proposal_id,review_hash:p.review_hash,asset_hash:approval.asset_hash,campaign_id:p.input.campaign_id,publication_key:p.publication_key,status:done.has(prior?.execution_status)?prior.execution_status:'QUEUED',created_at:at(),receipt_id:prior?.id||null};
    if(queue)await s.approveAndQueue('publication_approval:'+p.proposal_id,approval,key,work);
    else await s.put('publication_approval:'+p.proposal_id,approval);
    return {status:'OWNER_APPROVED',proposal_id:p.proposal_id,review_hash:p.review_hash,distribution_status:existing?.status||(done.has(prior?.execution_status)?prior.execution_status:queue?'QUEUED':'NOT_QUEUED'),receipt:prior||null};
  });
}
// One-time recovery uses only the exact owner-reviewed identities recorded in authority.
// Validate the COMPLETE package first; mismatches stop before any approvals/execution.
export async function recoverApprovedCampaign(engine,manifest){
  const s=engine.store,key='distribution_recovery:'+manifest.campaign_id;
  if(await s.get(key))return;
  const pkg=await s.get('review_package:'+manifest.campaign_id);
  if(!pkg||pkg.campaign_id!==manifest.campaign_id||pkg.proposals.length!==manifest.proposals.length)fail('APPROVED_PACKAGE_IDENTITY_UNVERIFIED');
  for(const d of manifest.proposals){
    const p=await s.get('publication_review:'+d.proposal_id);identity(p,d);
    if(p.input.campaign_id!==manifest.campaign_id||!pkg.proposals.some(v=>v.proposal_id===d.proposal_id&&v.review_hash===d.review_hash))fail('APPROVED_PACKAGE_IDENTITY_UNVERIFIED');
  }
  for(const d of manifest.proposals)await approveExact(engine,d);
  await s.put(key,{status:'OWNER_APPROVED',authority:manifest.authority,at:at(),proposals:manifest.proposals});
}
export async function releaseVerifiedUnsent(engine,manifest){
 const s=engine.store;
 return s.leased('distribution',async()=>{
  const key='distribution_repair:'+manifest.campaign_id;if(await s.get(key))return;
  const records=[];
  for(const d of manifest.proposals){
   const p=await s.get('publication_review:'+d.proposal_id);identity(p,d);
   const approval=await s.get('publication_approval:'+p.proposal_id),job=await s.get('distribution_work:'+p.proposal_id),r=await s.get('receipt:'+p.publication_key);
   if(p.input.campaign_id!==manifest.campaign_id||approval?.approved_by!=='OWNER'||approval.review_hash!==p.review_hash||approval.asset_hash!==digest(p.asset)||job?.asset_hash!==digest(p.asset))fail('APPROVED_ARTIFACT_CHANGED');
   if(r?.proposal_id!==p.proposal_id||r.review_hash!==p.review_hash||r.delivery_hash!==digest(p.asset))fail('RECEIPT_ARTIFACT_BINDING_CHANGED');
   if(['SUBMITTED','PUBLISHED','IN_FLIGHT'].includes(r?.execution_status))fail('REPAIR_ALREADY_ACCEPTED_OR_IN_FLIGHT');
   if(p.platform==='X'){if(r?.execution_status!=='FAILED'||r.error!=='ACTUAL_COST_BOUND_UNKNOWN'||r.attempts!==0)fail('X_RECOVERY_STATE_CHANGED');}
   else if(r?.execution_status!=='AMBIGUOUS'||r.error!=='REVIEWED_EMAIL_ENVELOPE_REQUIRED'||r.external_id||r.provider_receipt)fail('VERIFIED_UNSENT_STATE_CHANGED');
   records.push({p,job,r});
  }
  for(const {p,job,r} of records){
   const evidence={authority:'OWNER_VERIFIED_GMAIL_SENT_ABSENT_2026_10_07',proposal_id:p.proposal_id,review_hash:p.review_hash,asset_hash:digest(p.asset),prior:r,at:at()};
   await s.put('delivery_recovery:'+p.publication_key,evidence);
   await s.put('receipt:'+p.publication_key,{...r,execution_status:'FAILED',attempts:0,verified_unsent_recovery:true});
   await s.put('distribution_work:'+p.proposal_id,{...job,status:'QUEUED',error:null,recovery_run_suffix:':verified-unsent-repair-v1',recovered_at:at()});
  }
  await s.put(key,{status:'RELEASED_ONCE',proposals:manifest.proposals,at:at()});
 });
}
export async function drainApproved(engine,workers,{limit=8,excludeCampaigns=[]}={}){
  const s=engine.store;
  return s.leased('distribution',async()=>{
    // Approval embeds its durable work intent; interrupted file materialization is recoverable.
    for(const key of await s.keys('publication_approval:')){const approval=await s.get(key);const work=approval?.distribution_work;if(work&&approval.approved_by==='OWNER'&&!await s.get('distribution_work:'+work.proposal_id))await s.put('distribution_work:'+work.proposal_id,work);}
    const results=[];
    for(const key of (await s.keys('distribution_work:')).sort()){
      if(results.length>=limit)break;
      const job=await s.get(key);if(!['QUEUED','RUNNING'].includes(job?.status)||excludeCampaigns.includes(job.campaign_id))continue;
      let c,p;
      try{
        p=await s.get('publication_review:'+job.proposal_id);identity(p,job);
        const approval=await s.get('publication_approval:'+p.proposal_id);
        if(approval?.approved_by!=='OWNER'||approval.review_hash!==job.review_hash||approval.asset_hash!==job.asset_hash||digest(p.asset)!==job.asset_hash)fail('APPROVED_ARTIFACT_CHANGED');
        const prior=await s.get('receipt:'+p.publication_key);
        const dest=structuredClone(p.review_binding.destination);
        c={approved_distribution:true,approved_proposal:p,input:structuredClone(p.input),run_id:'distribution:'+p.proposal_id+(job.recovery_run_suffix||''),publication_key:p.publication_key,asset:structuredClone(p.asset),product:{...(engine.products[p.product]||{}),source_receipt:p.source_receipt},signal:{id:p.signal_id,revision:p.signal_revision,state:p.signal_state,evidence:p.evidence_refs},route:{id:p.destination,format:p.format,destination:dest,key:[p.product,p.signal_id,p.destination,p.format].map(encodeURIComponent).join(':')},variant:{id:p.variant},max_attempts:1,review:{proposal_id:p.proposal_id,review_hash:p.review_hash,decision:'APPROVED',approved_at:approval.approved_at},state:await s.get('learning')||{version:0,routes:{},platforms:{},processed:{},history:[]}};
        c.adapter=engine.adapters[p.platform];
        if(done.has(prior?.execution_status)){c.receipt=prior;}
        else{
          if(!await s.get(costKey(c.run_id)))await beginCosts(s,{run_id:c.run_id,input:c.input,source:c.signal,kind:'APPROVED_DISTRIBUTION'});
          job.status='RUNNING';job.started_at=at();job.nodes=['approved_load','transport_selection','execute','receipt','outcome_scheduler'];await s.put(key,job);
          if(!c.adapter?.publish||(p.platform==='OPEN_ROUTE'&&!c.adapter.supportsRoute?.(p.asset.delivery)))fail('TRANSPORT_UNAVAILABLE');
          if(c.adapter.authorized&&!await c.adapter.authorized(p.product))fail('TRANSPORT_AUTHENTICATION_UNAVAILABLE');
          if(p.platform==='X'&&(!p.asset.copy||p.asset.format!=='image'||!p.asset.base64||p.asset.combined_review_artifact!==true))fail('APPROVED_X_TEXT_AND_VISUAL_REQUIRED');
          // The execution worker uses the persisted publication key and asset, no preparation nodes.
          dest.open_access_prepare_only=false;
          await workers.execute(c,engine);
        }
      }catch(error){
        if(!c){job.status='FAILED';job.error=error.message;job.completed_at=at();await s.put(key,job);results.push(job);continue;}
        const prior=await s.get('receipt:'+p.publication_key);
        c.receipt=done.has(prior?.execution_status)?prior:{id:p.publication_key,campaign_id:p.input.campaign_id,product:p.product,destination:p.destination,platform:p.platform,signal_id:p.signal_id,signal_revision:p.signal_revision,signal_state:p.signal_state,evidence_refs:p.evidence_refs,source_receipt:p.source_receipt,proposal_id:p.proposal_id,review_hash:p.review_hash,approved_artifact_hash:p.review_hash,delivery_hash:job.asset_hash,idempotency_key:p.publication_key,execution_status:error.message==='TRANSPORT_UNAVAILABLE'?'TRANSPORT_UNAVAILABLE':'FAILED',timestamp:at(),external_id:null,url:null,provider_receipt:null,api_cost_usd:0,attempts:0,error:error.message};
      }
      // Provider receipt survives even if indexing/outcome work fails or the process restarts.
      await s.locked('engine',()=>workers.receipt(c,engine));
      if(await s.get(costKey(c.run_id)))await finishCosts(s,c.run_id,{outcome:c.receipt.execution_status,blocker:c.receipt.error,proposal_id:p.proposal_id,source:c.signal});
      job.status=c.receipt.execution_status;job.receipt_id=c.receipt.id;job.error=c.receipt.error||null;job.completed_at=at();await s.put(key,job);
      await s.put('outcome_work:'+c.receipt.id,{receipt_id:c.receipt.id,status:['PUBLISHED','SUBMITTED'].includes(job.status)?'QUEUED':'EXECUTION_ONLY',at:at()});
      const campaignKey='distribution_campaign:'+job.campaign_id;
      await s.locked('engine',async()=>{const record=await s.get(campaignKey)||{campaign_id:job.campaign_id,approval_state:'OWNER_APPROVED',destinations:{}};record.destinations[p.destination]={proposal_id:p.proposal_id,status:job.status,receipt_id:c.receipt.id};record.updated_at=at();const jobs=await Promise.all((await s.keys('distribution_work:')).map(k=>s.get(k)));const campaignJobs=jobs.filter(j=>j.campaign_id===job.campaign_id);record.status=campaignJobs.some(j=>['QUEUED','RUNNING'].includes(j.status))?'DISTRIBUTING':campaignJobs.every(j=>['PUBLISHED','SUBMITTED'].includes(j.status))?'DISTRIBUTION_COMPLETE':'DISTRIBUTION_PARTIAL';await s.put(campaignKey,record);const pkg=await s.get('review_package:'+job.campaign_id);if(pkg){pkg.approval_state='OWNER_APPROVED';pkg.distribution=record;await s.put('review_package:'+job.campaign_id,pkg);}});
      results.push({proposal_id:p.proposal_id,status:job.status,receipt:c.receipt});
    }
    return results;
  });
}
