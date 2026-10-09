import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {FileStore} from '../../runtime/store.js';
import {recoverLegacyCampaignToV2} from '../../runtime/v2-campaign-recovery.js';

test('recovery preserves final records and recovers only unfinished executable assets',async t=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'emradar-v2-recovery-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const store=new FileStore(directory),campaign='EMRADAR_2026_10_09_LAUNCH';
  const proposal=(id,status,delivery)=>({proposal_id:id.repeat(64),review_hash:(id==='a'?'1':id==='b'?'2':id==='c'?'3':'4').repeat(64),input:{campaign_id:campaign},status,platform:'OPEN_ROUTE',destination:'Desk '+id,publication_key:'delivery-'+id,signal_revision:'scan-09',evidence_refs:['e-'+id],evidence_binding:{source_revision:'scan-09'},asset:{email:{to:delivery.public_contact_point,subject:'Exact '+id,body:'Saved correspondence '+id},delivery}});
  const verified={access_method:'EMAIL',verification_state:'VERIFIED',public_contact_point:'desk@example.com'};
  const records=[proposal('a','OWNER_APPROVED',verified),proposal('b','REJECTED',verified),proposal('c','AWAITING_REVIEW',verified),proposal('d','AWAITING_REVIEW',{access_method:'FORM',verification_state:'UNVERIFIED',public_contact_point:'desk@example.com'})];
  await store.put('review_package:'+campaign,{campaign_id:campaign,proposals:records.map(({proposal_id,review_hash})=>({proposal_id,review_hash}))});
  for(const record of records)await store.put('publication_review:'+record.proposal_id,record);
  await store.put('receipt:delivery-a',{id:'receipt-a',execution_status:'SUBMITTED'});
  const recovered=await recoverLegacyCampaignToV2(store,campaign);
  assert.equal(recovered.review_count,1);assert.equal(recovered.external_actions,0);assert.equal(recovered.status,'AWAITING_OWNER_REVIEW');
  assert.deepEqual(recovered.exclusions.map(v=>v.status),['PRESERVED_SUBMITTED','PRESERVED_REJECTED','UNSUPPORTED_ROUTE_EXCLUDED']);
  const active=recovered.proposals.find(v=>v.status==='AWAITING_OWNER_REVIEW');
  assert.equal(active.asset.email.body,'Saved correspondence c');assert.equal(active.asset.body,'Saved correspondence c');assert.equal(active.asset.subject,'Exact c');assert.equal(active.asset.to,'desk@example.com');assert.equal(active.delivery_key,'delivery-c');assert.equal(active.legacy_proposal_id,'c'.repeat(64));
  assert.deepEqual(await recoverLegacyCampaignToV2(store,campaign),recovered);
});
