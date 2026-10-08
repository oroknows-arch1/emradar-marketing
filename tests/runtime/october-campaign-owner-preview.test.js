import test from 'node:test';
import assert from 'node:assert/strict';
import {ownerPreview,previewWarning} from '../../runtime/owner-preview.js';
for(const day of ['06','07','08'])test('owner preview allows October '+day+' only at publication review',()=>{
 const input={product:'EMRADAR',campaign_id:'EMRADAR_2026_10_'+day+'_LAUNCH',owner_preview:true,stop_at:'PUBLICATION_REVIEW'};
 assert.equal(ownerPreview(input),true);
 assert.equal(ownerPreview({...input,stop_at:'DISTRIBUTE'}),false);
 assert.equal(ownerPreview({...input,owner_preview:false}),false);
});
test('schema leak is an owner preview warning, not publication approval',()=>{
 assert.equal(previewWarning('EXTERNAL_EDITORIAL_SCHEMA_LEAK'),true);
 assert.equal(ownerPreview({product:'EMRADAR',campaign_id:'EMRADAR_2026_10_09_LAUNCH',owner_preview:true,stop_at:'PUBLICATION_REVIEW'}),false);
});
