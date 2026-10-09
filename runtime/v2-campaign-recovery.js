import crypto from 'node:crypto';
const hash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const finished=new Set(['SUBMITTED','PUBLISHED','IN_FLIGHT','AMBIGUOUS']);

export async function recoverLegacyCampaignToV2(store,campaignId){
  const key='v2:review_package:'+campaignId,prior=await store.get(key);if(prior)return prior;
  const legacy=await store.get('review_package:'+campaignId);if(!legacy||!Array.isArray(legacy.proposals))throw new Error('LEGACY_REVIEW_PACKAGE_REQUIRED');
  const proposals=[],owner_decisions={},exclusions=[],route_dispositions=[];
  for(const ref of legacy.proposals){
    const p=await store.get('publication_review:'+ref.proposal_id);
    if(!p||p.input?.campaign_id!==campaignId||p.review_hash!==ref.review_hash){exclusions.push({proposal_id:ref.proposal_id,status:'INVALID_LEGACY_BINDING'});continue;}
    const receipt=await store.get('receipt:'+p.publication_key),delivery=p.asset?.delivery;
    if(finished.has(receipt?.execution_status)){proposals.push(p);owner_decisions[p.proposal_id]={status:receipt.execution_status,distribution:{status:receipt.execution_status,receipt_id:receipt.id}};exclusions.push({proposal_id:p.proposal_id,destination:p.destination,status:'PRESERVED_'+receipt.execution_status});continue;}
    if(p.status==='REJECTED'){proposals.push(p);owner_decisions[p.proposal_id]={status:'REJECTED'};exclusions.push({proposal_id:p.proposal_id,destination:p.destination,status:'PRESERVED_REJECTED'});continue;}
    const executable=p.platform==='OPEN_ROUTE'&&/email/i.test(delivery?.access_method||'')&&delivery?.verification_state==='VERIFIED'&&p.asset?.email?.to===delivery.public_contact_point;
    if(!executable){exclusions.push({proposal_id:p.proposal_id,destination:p.destination,status:'UNSUPPORTED_ROUTE_EXCLUDED'});route_dispositions.push({destination:p.destination,status:'UNSUPPORTED',reason:'Verified executable email route required'});continue;}
    const legacyAsset=structuredClone(p.asset),asset={...legacyAsset,subject:legacyAsset.email.subject,body:legacyAsset.email.body,to:legacyAsset.email.to,delivery_method:'EMAIL'},binding={campaign_id:campaignId,legacy_proposal_id:p.proposal_id,legacy_review_hash:p.review_hash,source_revision:p.signal_revision,evidence_refs:p.evidence_refs,destination:delivery,asset};
    const review_hash=hash(binding),proposal_id=hash([p.publication_key,review_hash]);
    const recovered={proposal_id,review_hash,delivery_key:p.publication_key,campaign_id:campaignId,status:'AWAITING_OWNER_REVIEW',destination:p.destination,evidence_summary:p.evidence_binding||{source_revision:p.signal_revision,evidence_refs:p.evidence_refs},asset,required_visual_or_attachment:p.asset?.visual||'NONE',route:{method:'EMAIL',recipient:delivery.public_contact_point,verification:delivery.verification_state},delivery_capability:'VERIFIED_EXECUTABLE',uncertainty:p.evidence_binding?.source_uncertainty||[],binding,legacy_proposal_id:p.proposal_id,recovered_at:new Date().toISOString()};
    await store.put('v2:review:'+proposal_id,recovered);proposals.push(recovered);owner_decisions[proposal_id]={status:'AWAITING_OWNER_REVIEW'};route_dispositions.push({destination:p.destination,status:'EXECUTABLE_RECOVERED'});
  }
  const review_count=Object.values(owner_decisions).filter(v=>v.status==='AWAITING_OWNER_REVIEW').length;
  const record={engine:'EMRADAR_MARKETING_ENGINE_V2',campaign_id:campaignId,status:review_count?'AWAITING_OWNER_REVIEW':'COMPLETE',proposals,owner_decisions,route_dispositions,exclusions,review_count,external_actions:0,recovered_at:new Date().toISOString()};
  await store.put(key,record);return record;
}
export async function recoverOctoberCampaignsToV2(store){const records=[];for(const campaign of ['EMRADAR_2026_10_08_LAUNCH','EMRADAR_2026_10_09_LAUNCH'])records.push(await recoverLegacyCampaignToV2(store,campaign));return records;}
