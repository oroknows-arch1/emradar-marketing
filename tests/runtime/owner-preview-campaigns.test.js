import test from 'node:test';
import assert from 'node:assert/strict';
import {ownerPreview} from '../../runtime/owner-preview.js';

const preview=(campaign_id, overrides={})=>ownerPreview({product:'EMRADAR',campaign_id,owner_preview:true,stop_at:'PUBLICATION_REVIEW',...overrides});

test('dated campaigns share the owner preview policy',()=>{
  for(const date of ['2026_10_06','2026_10_07','2026_10_08'])assert.equal(preview('EMRADAR_'+date+'_LAUNCH'),true);
});

test('owner preview cannot authorize distribution or other products',()=>{
  assert.equal(preview('EMRADAR_2026_10_08_LAUNCH',{owner_preview:false}),false);
  assert.equal(preview('EMRADAR_2026_10_08_LAUNCH',{stop_at:'DISTRIBUTION'}),false);
  assert.equal(preview('EMRADAR_2026_10_08_LAUNCH',{product:'OTHER'}),false);
  assert.equal(preview('EMRADAR_2026_10_08_LAUNCH_EXTRA'),false);
  assert.equal(preview('UNRELATED'),false);
});
