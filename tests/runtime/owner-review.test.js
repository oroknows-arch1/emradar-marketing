import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {FileStore} from '../../runtime/store.js';
import {createOwnerReview} from '../../runtime/owner-review.js';
import {campaignReviewHtml} from '../../runtime/campaign-review-html.js';
import {groupedReviewFixture} from './grouped-review-fixture.js';
import {isEditorialCampaignId} from '../../runtime/editorial-group-policy.js';
const source=await fs.readFile(new URL('../../server.js',import.meta.url),'utf8');
async function fixture(send){
 const store=new FileStore(await fs.mkdtemp(path.join(os.tmpdir(),'direct-review-'))),record=groupedReviewFixture();record.campaign_id='EMRADAR_2026_10_12_LAUNCH_REPLACEMENT_1';record.trace=[{node:'PREPARE',status:'PASS'},{node:'VERIFY',status:'PASS'}];record.status='AWAITING_OWNER_REVIEW';
 await store.put('v2:review_package:'+record.campaign_id,record);for(const p of record.proposals)await store.put('v2:review:'+p.proposal_id,p);
 let now=Date.now(),mail=[];
 const service=createOwnerReview({store,baseUrl:'https://review.test',clock:()=>now,send:async input=>{mail.push(input);return send?send(input):{message_id:'fixture-acceptance',accepted:['oroknows@gmail.com']};}});
 return {store,record,service,mail,advance:ms=>now+=ms};
}
function handler(prefix,context){const start=source.indexOf(prefix),end=source.indexOf('\n  if(',start+5);assert(start>=0);return vm.runInNewContext('(async(req,res,u)=>{'+source.slice(start,end)+'})',context);}
test('direct replacement notification sends once without credentials, preserves review and stores provider acceptance',async()=>{
 const f=await fixture(),original={decisions:{kept:'REJECT'},immutable:true};await f.store.put('v2:review_package:EMRADAR_2026_10_12_LAUNCH',original);const before=JSON.stringify(f.record);
 await Promise.all([f.service.notify(f.record.campaign_id),f.service.notify(f.record.campaign_id)]);assert.equal(f.mail.length,1);
 assert.match(f.mail[0].text,/https:\/\/review.test\/V2\/CAMPAIGN_REVIEW\?campaign_id=EMRADAR_2026_10_12_LAUNCH_REPLACEMENT_1/);assert.doesNotMatch(f.mail[0].text,/#access|token|login|single use|expires/);
 assert.equal((await f.store.get('owner_review_notification:'+f.record.campaign_id)).provider_receipt.message_id,'fixture-acceptance');assert.equal(f.mail[0].notification.private_review_url,f.mail[0].text.match(/https:\/\/review.test\/V2\/CAMPAIGN_REVIEW\?campaign_id=\S+/)[0]);assert.equal((await f.store.keys('owner_review_access:')).length,0);assert.equal((await f.store.keys('v2:decision:')).length,0);assert.equal((await f.store.keys('v2:work:')).length,0);
 assert.equal(JSON.stringify(await f.store.get('v2:review_package:'+f.record.campaign_id)),before);assert.deepEqual(await f.store.get('v2:review_package:EMRADAR_2026_10_12_LAUNCH'),original);
});
test('uncertain acceptance never resends; confirmed-unsent retry keeps the same direct URL',async()=>{
 let count=0;const f=await fixture(()=>{if(!count++){const e=Error('not sent');e.definitely_unsent=true;throw e;}return {message_id:'accepted',accepted:['oroknows@gmail.com']};});assert.equal((await f.service.notify(f.record.campaign_id)).status,'RETRYABLE');const first=f.mail[0];f.advance(60001);assert.equal((await f.service.notify(f.record.campaign_id)).status,'SUBMITTED');assert.deepEqual(f.mail[1],first);
 const lost=await fixture(()=>{throw Error('unknown acceptance');});assert.equal((await lost.service.notify(lost.record.campaign_id)).status,'RECEIPT_UNVERIFIED');lost.advance(86400000);await lost.service.notify(lost.record.campaign_id);assert.equal(lost.mail.length,1);
});
test('changed persisted review cannot trigger notification',async()=>{const f=await fixture(),p=f.record.proposals[0];await f.store.put('v2:review:'+p.proposal_id,{...p,review_hash:'changed'});assert.equal(await f.service.notify(f.record.campaign_id),null);assert.equal(f.mail.length,0);});
test('review route reads replacement package without credentials and UI has no authentication calls',async()=>{
 const f=await fixture(),context={isEditorialCampaignId,RedisStore:class{constructor(){return f.store;}},store:async()=>null,html:(_r,value)=>({status:200,value}),json:(_r,status,value)=>({status,value}),campaignReviewHtml};
 const run=handler("  if(req.method==='GET'&&u.pathname==='/V2/CAMPAIGN_REVIEW')",context),response=await run({method:'GET',headers:{}},{},{pathname:'/V2/CAMPAIGN_REVIEW',searchParams:new URLSearchParams({campaign_id:f.record.campaign_id})});assert.equal(response.status,200);assert.match(response.value,/APPROVE GROUP/);assert.match(response.value,/REQUEST GROUP REVISION/);assert.doesNotMatch(response.value,/PUBLICATION_REVIEW\/session|authenticate\(|credentials:|auth-status/);
 assert.doesNotMatch(source,/reviewAuth|authorizedPublicationReview|MARKETING_PUBLICATION_REVIEW_TOKEN|handleOwnerReviewAccess|PUBLICATION_REVIEW\/session/);
});
test('public decision route preserves exact input and runtime handoff without bearer credential',async()=>{
 const input={proposal_id:'a'.repeat(64),review_hash:'b'.repeat(64),decision:'REJECT'};let call;
 const run=handler("  if(u.pathname==='/V2/PUBLICATION_REVIEW'",{v2Runtime:async()=>({decide:async(...args)=>{call=args;return {decision:'REJECT'};}}),readBody:async()=>JSON.stringify(input),json:(_r,status,value)=>({status,value})});
 assert.equal((await run({method:'POST',headers:{}},{},{pathname:'/V2/PUBLICATION_REVIEW'})).status,200);assert.equal(call.length,1);assert.deepEqual(JSON.parse(JSON.stringify(call[0])),input);
});
test('machine preparation remains protected and only prepares, saves and notifies its own campaign',async()=>{
 const calls=[],replacement='EMRADAR_2026_10_12_LAUNCH_REPLACEMENT_1';let allowed=false;
 const run=handler("  if(req.method==='POST'&&['/V2/PREPARE'",{authorizedRequest:()=>allowed,process:{env:{}},isEditorialCampaignId,readBody:async()=>JSON.stringify({campaign_id:replacement}),v2Runtime:async()=>({prepare:async input=>{calls.push(['prepare',input.campaign_id]);return {status:'AWAITING_OWNER_REVIEW'};},store:{put:async key=>calls.push(['save',key])},distribute:()=>{throw Error('FORBIDDEN_DISTRIBUTION');}}),ownerReview:async()=>({notify:async campaign=>{calls.push(['notify',campaign]);return {status:'SUBMITTED'};}}),json:(_r,status,value)=>({status,value})});
 const req={method:'POST',headers:{}},u={pathname:'/V2/PREPARE'};assert.equal((await run(req,{},u)).status,403);assert.deepEqual(calls,[]);allowed=true;assert.equal((await run(req,{},u)).status,200);assert.deepEqual(calls,[['prepare',replacement],['save','v2:review_package:'+replacement],['notify',replacement]]);
});
