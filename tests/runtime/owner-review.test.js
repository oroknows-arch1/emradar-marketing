import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {FileStore} from '../../runtime/store.js';
import {createReviewAuth} from '../../runtime/review-auth.js';
import {createOwnerReview,ownerReviewLanding,handleOwnerReviewAccess} from '../../runtime/owner-review.js';
import {campaignReviewHtml} from '../../runtime/campaign-review-html.js';
import {groupedReviewFixture} from './grouped-review-fixture.js';
import {sendOwnerReviewNotification} from '../../runtime/editorial-outreach-gmail.js';
const source=await fs.readFile(new URL('../../server.js',import.meta.url),'utf8');
async function fixture(send){
 const store=new FileStore(await fs.mkdtemp(path.join(os.tmpdir(),'owner-review-'))),record=groupedReviewFixture();record.trace=[{node:'PREPARE',status:'PASS'},{node:'VERIFY',status:'PASS'}];record.status='AWAITING_OWNER_REVIEW';
 await store.put('v2:review_package:'+record.campaign_id,record);for(const p of record.proposals)await store.put('v2:review:'+p.proposal_id,p);
 let now=Date.now(),mail=[],session;
 const auth=createReviewAuth({secret:'local-owner-secret',origin:()=> 'https://review.test',clock:()=>now});
 const service=createOwnerReview({store,auth,secret:'local-owner-secret',baseUrl:'https://review.test',clock:()=>now,send:async input=>{mail.push(input);return send?send(input):{message_id:'test-provider-id',accepted:['oroknows@gmail.com']};}});
 return {store,record,auth,service,mail,advance:ms=>now+=ms,res:{setHeader:(n,v)=>{if(n==='Set-Cookie')session=v;}},cookie:()=>session,token:()=>mail.at(-1).text.match(/#access=([a-f0-9]{64})/)[1]};
}
test('ready review sends once, preserves all 69 assets and records separate notification receipt',async()=>{
 const f=await fixture(),before=JSON.stringify(f.record);const results=await Promise.all([f.service.notify(f.record.campaign_id),f.service.notify(f.record.campaign_id)]);assert.equal(f.mail.length,1);assert(results.some(r=>r.status==='SUBMITTED'));assert.match(f.mail[0].subject,/2026-10-11/);assert.match(f.mail[0].text,/69 saved proposals; 4 distinct email groups/);assert.equal(JSON.stringify(await f.store.get('v2:review_package:'+f.record.campaign_id)),before);
 const receipt=await f.store.get('owner_review_notification:'+f.record.campaign_id);assert.equal(receipt.provider_receipt.message_id,'test-provider-id');assert(!JSON.stringify(receipt).includes(f.token()));assert.equal((await f.store.keys('v2:decision:')).length,0);assert.equal((await f.store.keys('v2:work:')).length,0);await f.service.notify(f.record.campaign_id);assert.equal(f.mail.length,1);
});
test('owner link is single-use, expires, rejects invalid input and establishes existing protected session',async()=>{
 const f=await fixture();await f.service.notify(f.record.campaign_id);await assert.rejects(f.service.redeem('wrong',f.res),/OWNER_ACCESS_INVALID/);
 const location=await f.service.redeem(f.token(),f.res);assert.equal(location,'/V2/CAMPAIGN_REVIEW?campaign_id='+f.record.campaign_id);assert(!location.includes(f.token()));assert.match(f.cookie(),/HttpOnly; Secure; SameSite=Strict/);assert(!f.cookie().includes('local-owner-secret'));const cookie=f.cookie().split(';')[0];
 assert(f.auth.authorized({method:'POST',headers:{cookie,origin:'https://review.test'}}));assert(!f.auth.authorized({method:'POST',headers:{cookie,origin:'https://evil.test'}}));assert(!f.auth.authorized({method:'POST',headers:{origin:'https://review.test'}}));await assert.rejects(f.service.redeem(f.token(),f.res),/OWNER_ACCESS_INVALID/);
 const restart=createReviewAuth({secret:'local-owner-secret',origin:()=> 'https://review.test'});assert(restart.authorized({method:'GET',headers:{cookie}}));
 const expired=await fixture();await expired.service.notify(expired.record.campaign_id);expired.advance(8*86400000);await assert.rejects(expired.service.redeem(expired.token(),expired.res),/OWNER_ACCESS_INVALID/);
 const rotated=createOwnerReview({store:f.store,auth:createReviewAuth({secret:'rotated',origin:()=>''}),secret:'rotated',baseUrl:'https://review.test',send:()=>{throw Error('NO_MAIL');}});await assert.rejects(rotated.redeem(f.token(),f.res));
});
test('credential stays in fragment, is removed immediately, and only exchanged in same-origin POST body',async()=>{
 const f=await fixture();await f.service.notify(f.record.campaign_id);const events=[],landing=ownerReviewLanding(),script=landing.slice(landing.indexOf('<script>')+8,landing.indexOf('</script>'));
 assert(!landing.includes('local-owner-secret'));assert(!landing.includes('id="credential"')); const pending=vm.runInNewContext(script,{URLSearchParams,location:{hash:'#access='+f.token(),replace:v=>events.push(['redirect',v])},history:{replaceState:(a,b,v)=>events.push(['clean',v])},document:{getElementById:()=>({})},fetch:async(url,init)=>{events.push(['post',url]);assert.equal(init.credentials,'same-origin');assert.equal(JSON.parse(init.body).access,f.token());return {ok:true,json:async()=>({location:'/V2/CAMPAIGN_REVIEW?campaign_id='+f.record.campaign_id})};}});await pending;assert.deepEqual(events.map(e=>e[0]),['clean','post','redirect']);assert(events.every(e=>!e[1].includes(f.token())));
 let status;const invoke=origin=>handleOwnerReviewAccess({req:{headers:{origin,'content-type':'application/json'}},res:f.res,service:f.service,origin:'https://review.test',readBody:async()=>JSON.stringify({access:f.token()}),json:(_res,s,v)=>{status=s;return v;}});
 await invoke('https://evil.test');assert.equal(status,403);const value=await invoke('https://review.test');assert.equal(status,200);assert.equal(value.location,'/V2/CAMPAIGN_REVIEW?campaign_id='+f.record.campaign_id);await invoke('https://review.test');assert.equal(status,403);
});
test('transient confirmed-unsent retry retains link and state; uncertain acceptance never resends',async()=>{
 let count=0;const f=await fixture(()=>{if(!count++){const e=Error('private-link-text-must-not-log');e.definitely_unsent=true;throw e;}return {message_id:'retry-provider-id',accepted:['oroknows@gmail.com']};});
 let result=await f.service.notify(f.record.campaign_id);assert.equal(result.status,'RETRYABLE');assert(!JSON.stringify(result).includes('private-link'));const first=f.mail[0];await f.service.notify(f.record.campaign_id);assert.equal(f.mail.length,1);f.advance(60001);result=await f.service.notify(f.record.campaign_id);assert.equal(result.status,'SUBMITTED');assert.deepEqual(f.mail[1],first);assert.equal(f.mail.length,2);
 const lost=await fixture(()=>{throw Error('unknown acceptance');});result=await lost.service.notify(lost.record.campaign_id);assert.equal(result.status,'RECEIPT_UNVERIFIED');lost.advance(86400000);await lost.service.notify(lost.record.campaign_id);assert.equal(lost.mail.length,1);
 const crash=await fixture();await crash.store.put('owner_review_notification:'+crash.record.campaign_id,{status:'SUBMITTING'});await crash.service.notify(crash.record.campaign_id);assert.equal(crash.mail.length,0);
});
test('incomplete or changed persisted review never notifies',async()=>{
 const f=await fixture();const p=f.record.proposals[0];await f.store.put('v2:review:'+p.proposal_id,{...p,review_hash:'changed'});assert.equal(await f.service.notify(f.record.campaign_id),null);assert.equal(f.mail.length,0);
 f.record.trace=[];await f.store.put('v2:review_package:'+f.record.campaign_id,f.record);assert.equal(await f.service.notify(f.record.campaign_id),null);
});
test('all review GET routes deny anonymous before reading assets; renderer has no credential field',async()=>{
 for(const route of ['/CAMPAIGN_REVIEW','/V2/CAMPAIGN_REVIEW']){
  const start=source.indexOf("  if(req.method==='GET'&&u.pathname==='"+route+"')"),end=source.indexOf('\n  if(',start+5),handler=vm.runInNewContext('(async(req,res,u)=>{'+source.slice(start,end)+'})',{authorizedPublicationReview:()=>false,json:(_r,status,value)=>({status,value}),store:()=>{throw Error('ASSETS_READ');}});
  assert.equal((await handler({method:'GET'},{},{pathname:route})).status,403);
 }
 const start=source.indexOf("  if(u.pathname==='/PUBLICATION_REVIEW'&&"),end=source.indexOf('\n  if(',start+5),handler=vm.runInNewContext('(async(req,res,u)=>{'+source.slice(start,end)+'})',{authorizedPublicationReview:()=>false,json:(_r,status)=>({status}),store:()=>{throw Error('ASSETS_READ');}});assert.equal((await handler({method:'GET'},{},{pathname:'/PUBLICATION_REVIEW',searchParams:new URLSearchParams({package:'EMRADAR'})})).status,403);
 const html=campaignReviewHtml(groupedReviewFixture(),'EMRADAR_2026_10_11_LAUNCH',{v2:true});assert(!html.includes('id="credential"'));assert(!html.includes('Owner credential'));assert.match(html,/private review link/);
});
test('notification SMTP configuration failure never invokes publication relay or sends assets',async()=>{
 const before=process.env.EDITORIAL_SMTP_HOST;delete process.env.EDITORIAL_SMTP_HOST;try{await assert.rejects(sendOwnerReviewNotification({subject:'test',text:'test',idempotency_key:'test'}),e=>e.message==='OWNER_NOTIFICATION_CANONICAL_SMTP_UNAVAILABLE'&&e.definitely_unsent===true);}finally{if(before!==undefined)process.env.EDITORIAL_SMTP_HOST=before;}
});
test('owner notification reuses canonical SMTP identity and stores actual acceptance without publication approval',async()=>{
 const names=['EDITORIAL_SMTP_HOST','EDITORIAL_SMTP_USER','EDITORIAL_SMTP_PASSWORD','EDITORIAL_SMTP_PORT','EDITORIAL_SMTP_SECURE'],saved=Object.fromEntries(names.map(n=>[n,process.env[n]]));
 Object.assign(process.env,{EDITORIAL_SMTP_HOST:'smtp.test.invalid',EDITORIAL_SMTP_USER:'sean@emradar.net',EDITORIAL_SMTP_PASSWORD:'local-test-only',EDITORIAL_SMTP_PORT:'465',EDITORIAL_SMTP_SECURE:'true'});
 try{let mail,closed=false;const receipt=await sendOwnerReviewNotification({subject:'private review',text:'private link',idempotency_key:'a'.repeat(64)},{createTransport:()=>({sendMail:async value=>{mail=value;return {messageId:'actual-mock-provider-id',accepted:['oroknows@gmail.com'],rejected:[],response:'250 Accepted'};},close:()=>closed=true})});
 assert.equal(mail.from.address,'sean@emradar.net');assert.equal(mail.to,'oroknows@gmail.com');assert.equal(receipt.message_id,'actual-mock-provider-id');assert.equal(receipt.response,'250 Accepted');assert(!mail.binding);assert(closed);
 }finally{for(const n of names)if(saved[n]===undefined)delete process.env[n];else process.env[n]=saved[n];}
});
test('existing SMTP-unavailable notification resumes once immediately when authorised relay is enabled',async()=>{
 const f=await fixture(),url=process.env.EMRADAR_EMAIL_RELAY_URL,token=process.env.EMRADAR_EMAIL_RELAY_TOKEN;
 await f.store.put('owner_review_notification:'+f.record.campaign_id,{status:'RETRYABLE',reason:'OWNER_NOTIFICATION_CANONICAL_SMTP_UNAVAILABLE',attempts:6,retry_at:Date.now()+3600000,nonce:'persisted-nonce',expires_at:Date.now()+86400000});
 process.env.EMRADAR_EMAIL_RELAY_URL='https://orok-studios-api.onrender.com';process.env.EMRADAR_EMAIL_RELAY_TOKEN='local-test';
 try{const result=await f.service.notify(f.record.campaign_id);assert.equal(result.status,'SUBMITTED');assert.equal(f.mail.length,1);const record=await f.store.get('owner_review_notification:'+f.record.campaign_id);assert.equal(record.nonce,'persisted-nonce');assert.equal(record.attempts,7);await f.service.notify(f.record.campaign_id);assert.equal(f.mail.length,1);}finally{for(const [key,value] of [['EMRADAR_EMAIL_RELAY_URL',url],['EMRADAR_EMAIL_RELAY_TOKEN',token]])if(value===undefined)delete process.env[key];else process.env[key]=value;}
});
