import crypto from 'node:crypto';
import {verifyEmailGroupLimit,editorialEvidence} from './editorial-group-policy.js';
const digest=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
export async function prepareReplacement({original,store,runtime,publishedSource,scanFromPublished,notify,validateAsset}){
 if(!/^EMRADAR_\d{4}_\d{2}_\d{2}_LAUNCH$/.test(original||''))throw Error('ORIGINAL_CAMPAIGN_ID_INVALID');
 return store.locked('v2:replacement-preparation:'+original,async()=>{
  const key='v2:replacement:'+original,prior=await store.get(key);
  const existing=(await store.keys('v2:campaign:'+original+'_REPLACEMENT')).map(k=>k.slice('v2:campaign:'.length));
  if(existing.length>1)throw Error('MULTIPLE_REPLACEMENTS_REQUIRE_OWNER_SELECTION');
  const campaign_id=prior?.campaign_id||existing[0]||original+'_REPLACEMENT_1';
  const originalRecord=await store.get('v2:review_package:'+original);if(!originalRecord)throw Error('ORIGINAL_REVIEW_PACKAGE_REQUIRED');
  const before=digest(originalRecord),saved=await store.get('v2:review_package:'+campaign_id);
  if(saved?.status==='AWAITING_OWNER_REVIEW')return {...prior,campaign_id,status:'AWAITING_OWNER_REVIEW',duplicate:true,owner_notification:await notify(campaign_id),external_actions:0};
  if(prior?.status==='PREPARING'||prior?.status==='BLOCKED')throw Error('REPLACEMENT_PREPARATION_REQUIRES_EXPLICIT_RECOVERY');
  const published=await publishedSource(original.slice(8,18).replaceAll('_','-'));
  if(published.attestation.campaign_authority.campaign_id!==original)throw Error('CAMPAIGN_SOURCE_CHANGED');
  const scan=scanFromPublished(published);
  await store.put(key,{campaign_id,original,status:'PREPARING',source_revision:scan.source_revision,original_package_hash:before,external_actions:0});
  try{
   // Rebind only validated, unchanged editorial assets to new proposal IDs.
   // Original proposals and owner decisions are never changed or copied.
   const build=runtime.engine.assetBuilder;
   runtime.engine.assetBuilder=async input=>{
    const binding=editorialEvidence(input.scan),candidate=originalRecord.proposals.find(p=>p.destination===input.route.id&&(p.binding?.evidence||p.evidence_binding)&&digest(p.binding?.evidence||p.evidence_binding)===digest(binding)&&p.asset?.editorial_version==='human-correspondence-v2');
    if(input.route.id==='EMRADAR-X-OROKNOWS'){
     const existing=originalRecord.proposals.find(p=>p.destination===input.route.id),a=existing?.asset,lineage=a?.lineage,formations=input.scan.formations||[input.scan.formation];
     if(a?.consolidated_scan&&a.copy&&a.mime==='image/png'&&a.base64&&lineage?.source_revision===input.scan.source_revision&&digest(lineage.formation_ids)===digest(formations.map(f=>f.id))&&digest(lineage.evidence_refs)===digest(formations.flatMap(f=>f.evidence.map(e=>e.id)))&&crypto.createHash('sha256').update(Buffer.from(a.base64,'base64')).digest('hex')===a.sha256)return structuredClone(a);
    }
    if(candidate&&validateAsset){try{validateAsset({asset:candidate.asset,...input});return structuredClone(candidate.asset);}catch{}}
    return build(input);
   };
   const record=await runtime.prepare({campaign_id,scan});
   const groups=verifyEmailGroupLimit(record.proposals),external=new Set(record.proposals.filter(p=>p.destination!=='EMRADAR-X-OROKNOWS').map(p=>p.destination));
   const x=record.proposals.filter(p=>p.destination==='EMRADAR-X-OROKNOWS');
   if(record.status!=='AWAITING_OWNER_REVIEW'||record.external_actions!==0||external.size>30||x.length!==1||!x[0].asset.copy||x[0].asset.mime!=='image/png'||!x[0].asset.base64)throw Error('REPLACEMENT_FINAL_INVARIANTS_REQUIRED');
   if(record.destination_selection.selected.some(s=>!record.proposals.some(p=>p.destination===s.destination_id)))throw Error('SELECTED_RECIPIENT_NOT_REPRESENTED');
   if(digest(await store.get('v2:review_package:'+original))!==before)throw Error('ORIGINAL_CAMPAIGN_CHANGED');
   await store.put('v2:review_package:'+campaign_id,record);
   const result={campaign_id,original,status:'AWAITING_OWNER_REVIEW',email_groups:groups,destinations:external.size,external_actions:0,original_package_hash:before};
   await store.put(key,result);return {...result,owner_notification:await notify(campaign_id)};
  }catch(error){await store.put(key,{campaign_id,original,status:'BLOCKED',reason:error.message,external_actions:0});throw error;}
 });
}
