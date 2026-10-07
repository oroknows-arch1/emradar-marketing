import test from 'node:test';
import assert from 'node:assert/strict';
import {GraphEngine,digest} from '../../runtime/graph.js';
import {fixture} from './fixture.js';
import {editorialOutreachAdapter} from '../../runtime/adapters.js';
import {editorialRouteAuthorized,reviewedMail} from '../../runtime/editorial-outreach-gmail.js';
import proposals from './approved-review-fixture.json' with {type:'json'};

async function candidate(){
 const f=await fixture();for(const d of f.p.destinations)d.platform='EXTERNAL';
 f.engine=new GraphEngine({store:f.store,products:{TEST_PRODUCT:f.p},adapters:{EXTERNAL:f.adapter}});
 const run=await f.engine.run(f.input);f.proposal=await f.store.get('publication_review:'+run.review.proposal_id);return f;
}
test('A/B/C: warning acceptance is durable, fast, and bypasses all preparation after review',async()=>{
 const f=await candidate();f.proposal.preview_only=true;f.proposal.preview_warnings=[{reason:'WORD_COUNT'}];f.proposal.expires_at='2000-01-01';await f.store.put('publication_review:'+f.proposal.proposal_id,f.proposal);
 let called=false,release;f.adapter.publish=async()=>{called=true;await new Promise(r=>release=r);return {id:'accepted',status:'SUBMITTED'};};
 f.engine.run=()=>{throw Error('NO_PREPARATION');};f.engine.products={};f.engine.harness={work:()=>{throw Error('NO_GENERATION');}};
 const ack=await f.engine.approvePublication(f.proposal);assert.equal(ack.status,'OWNER_APPROVED');assert.equal(called,false);
 assert.equal((await f.store.get('publication_approval:'+f.proposal.proposal_id)).status,'OWNER_APPROVED');assert.equal((await f.store.get('distribution_work:'+f.proposal.proposal_id)).status,'QUEUED');
 const pending=f.engine.distributeApproved();while(!release)await new Promise(r=>setTimeout(r,5));assert.equal((await f.store.get('receipt:'+f.proposal.publication_key)).execution_status,'IN_FLIGHT');release();const [out]=await pending;assert.equal(out.status,'SUBMITTED');
});
test('D/G: exact email and combined X asset reach transports unchanged',async()=>{
 const f=await candidate();let passed;f.adapter.publish=async asset=>{passed=asset;return {id:'post',status:'PUBLISHED'};};
 await f.engine.approvePublication(f.proposal);await f.engine.distributeApproved();assert.deepEqual(passed,f.proposal.asset);
 const x=await candidate();const p=x.proposal;p.platform='X';p.asset={format:'image',copy:'Exact owner-approved X text',base64:'YXBwcm92ZWQ=',sha256:'approved-visual',combined_review_artifact:true};p.review_binding.destination.platform='X';p.review_hash=digest({product_truth:p.review_binding.product_truth,signal_revision:p.signal_revision,asset:p.asset,destination:p.review_binding.destination,source_receipt:p.source_receipt||null});p.proposal_id=digest([p.publication_key,p.review_hash]);await x.store.put('publication_review:'+p.proposal_id,p);
 x.engine.adapters.X={cost:'ZERO',publish:async asset=>{assert.deepEqual(asset,p.asset);return {id:'x-post',url:'https://x.com/i/web/status/x-post',status:'PUBLISHED'};}};
 await x.engine.approvePublication(p);const [out]=await x.engine.distributeApproved();assert.equal(out.receipt.url,'https://x.com/i/web/status/x-post');assert.equal(out.receipt.delivery_hash,digest(p.asset));
});
test('E/F: only oroknows@gmail.com authorizes; all different identities are rejected',async()=>{
 const old={user:process.env.EDITORIAL_GMAIL_USER,password:process.env.EDITORIAL_GMAIL_APP_PASSWORD};
 try{process.env.EDITORIAL_GMAIL_APP_PASSWORD='fake-test-only';for(const sender of ['oroknows@gmail.com','robdanrutene34@gmail.com','other@gmail.com','oroknows+fallback@gmail.com','']){process.env.EDITORIAL_GMAIL_USER=sender;assert.equal(await editorialRouteAuthorized(),sender==='oroknows@gmail.com');if(sender!=='oroknows@gmail.com')assert.throws(()=>reviewedMail(proposals[0].asset,proposals[0].asset.delivery),/SENDER_MISMATCH/);}}
 finally{for(const [name,value] of [['EDITORIAL_GMAIL_USER',old.user],['EDITORIAL_GMAIL_APP_PASSWORD',old.password]])if(value===undefined)delete process.env[name];else process.env[name]=value;}
});
for(const state of ['PUBLISHED','SUBMITTED','IN_FLIGHT','AMBIGUOUS'])test('H/I: '+state+' receipt prevents repeat delivery',async()=>{
 const f=await candidate();let calls=0;f.adapter.publish=async()=>{calls++;throw Error('MUST_NOT_CALL');};
 const receipt={id:f.proposal.publication_key,execution_status:state,campaign_id:f.input.campaign_id};await f.store.put('receipt:'+receipt.id,receipt);
 const ack=await f.engine.approvePublication(f.proposal);assert.equal(ack.distribution_status,state);await f.engine.distributeApproved();assert.equal(calls,0);assert.deepEqual(await f.store.get('receipt:'+receipt.id),receipt);
});
test('I/L: restart after IN_FLIGHT does not blindly replay the provider',async()=>{
 const f=await candidate();await f.engine.approvePublication(f.proposal);await f.store.put('receipt:'+f.proposal.publication_key,{id:f.proposal.publication_key,execution_status:'IN_FLIGHT'});
 const restarted=new GraphEngine({store:f.store,products:{},adapters:{EXTERNAL:{publish:()=>{throw Error('DUPLICATE');}}}});const [out]=await restarted.distributeApproved();assert.equal(out.status,'IN_FLIGHT');
});
test('L: queued exact work resumes after restart without another owner approval',async()=>{
 const f=await candidate();await f.engine.approvePublication(f.proposal);
 const restarted=new GraphEngine({store:f.store,products:{},adapters:{EXTERNAL:f.adapter}});const [out]=await restarted.distributeApproved();assert.equal(out.status,'PUBLISHED');assert.equal((await f.store.get('publication_approval:'+f.proposal.proposal_id)).status,'OWNER_APPROVED');assert.deepEqual(await restarted.distributeApproved(),[]);
});
test('identity changes stop before any external execution',async()=>{
 const f=await candidate();await f.engine.approvePublication(f.proposal);f.proposal.asset.copy+=' changed';await f.store.put('publication_review:'+f.proposal.proposal_id,f.proposal);
 const [out]=await f.engine.distributeApproved();assert.equal(out.status,'FAILED');assert.match(out.error,/CHANGED/);
});
test('J/K production-shaped complete publication package: independent email delivery, unavailable forms, exact sources retained',async()=>{
 const f=await fixture();const delivered=[];
 const adapter=editorialOutreachAdapter({sendEmail:async request=>{delivered.push(request);return {id:'receipt-'+request.route.destination_id,status:'ACCEPTED',receipt:{message_id:'message-'+request.route.destination_id}};}});
 const engine=new GraphEngine({store:f.store,products:{},adapters:{OPEN_ROUTE:adapter}});
 const ps=structuredClone(proposals);for(const p of ps)await f.store.put('publication_review:'+p.proposal_id,p);
 await f.store.put('review_package:EMRADAR_2026_10_06_LAUNCH',{campaign_id:'EMRADAR_2026_10_06_LAUNCH',proposals:ps});
 const manifest={campaign_id:'EMRADAR_2026_10_06_LAUNCH',authority:'TEST_ONLY',proposals:ps.map(p=>({proposal_id:p.proposal_id,review_hash:p.review_hash}))};await engine.recoverApprovedCampaign(manifest);
 const out=await engine.distributeApproved();assert.equal(out.length,7);assert.equal(delivered.length,4);assert.equal(out.filter(r=>r.status==='TRANSPORT_UNAVAILABLE').length,3);
 for(const request of delivered){const p=ps.find(p=>p.asset.delivery.destination_id===request.route.destination_id);assert.deepEqual(request.asset,p.asset);assert.deepEqual(await f.store.get('publication_review:'+p.proposal_id),p);assert(p.evidence_binding);}
 for(const result of out){assert(await f.store.get('receipt:'+result.receipt.id));assert.equal((await f.store.get('publication_approval:'+result.proposal_id)).status,'OWNER_APPROVED');if(result.status==='TRANSPORT_UNAVAILABLE')assert.equal(result.receipt.provider_receipt,null);else assert.equal((await f.store.get('outcome_work:'+result.receipt.id)).status,'QUEUED');}
 await engine.recoverApprovedCampaign(manifest);assert.deepEqual(await engine.distributeApproved(),[]);assert.equal(delivered.length,4);
});
test('J: one authentication or provider failure does not block independent destinations',async()=>{
 const f=await fixture();const ps=structuredClone(proposals).filter(p=>p.asset.delivery.access_method.includes('email'));for(const p of ps){await f.store.put('publication_review:'+p.proposal_id,p);}
 let calls=0;const engine=new GraphEngine({store:f.store,products:{},adapters:{OPEN_ROUTE:editorialOutreachAdapter({sendEmail:async()=>{calls++;if(calls===1){const e=Error('PROVIDER_UNAVAILABLE');e.status=503;throw e;}return {id:'mail-'+calls,status:'ACCEPTED'};}})}});
 for(const p of ps)await engine.approvePublication(p);const out=await engine.distributeApproved();assert.equal(out.filter(r=>r.status==='SUBMITTED').length,3);assert.equal(out.filter(r=>r.status==='AMBIGUOUS').length,1);assert.equal(calls,4);assert.deepEqual(await engine.distributeApproved(),[]);
});
test('cost ceilings remain enforced after owner approval',async()=>{
 const f=await candidate();f.adapter.cost='UNKNOWN';await f.engine.approvePublication(f.proposal);const [out]=await f.engine.distributeApproved();assert.equal(out.status,'FAILED');assert.equal(out.receipt.error,'ACTUAL_COST_BOUND_UNKNOWN');
});
test('recovery validates whole reviewed package before approving any destination',async()=>{
 const f=await fixture();const p=proposals[0];await f.store.put('publication_review:'+p.proposal_id,p);await f.store.put('review_package:EMRADAR_2026_10_06_LAUNCH',{campaign_id:'EMRADAR_2026_10_06_LAUNCH',proposals:[p]});
 const manifest={campaign_id:'EMRADAR_2026_10_06_LAUNCH',proposals:[{proposal_id:p.proposal_id,review_hash:'changed'}]};await assert.rejects(f.engine.recoverApprovedCampaign(manifest),/CHANGED/);assert.equal(await f.store.get('publication_approval:'+p.proposal_id),null);
});
test('atomic IN_FLIGHT claim and leased worker exclusion prevent concurrent duplicates',async()=>{
 const f=await fixture();const key='receipt:concurrent';const results=await Promise.all([f.store.claimReceipt(key,{execution_status:'IN_FLIGHT'}),f.store.claimReceipt(key,{execution_status:'IN_FLIGHT'})]);assert.equal(results.filter(Boolean).length,1);
 let release,entered;const started=new Promise(r=>entered=r);const first=f.store.leased('test-worker',async()=>{entered();await new Promise(r=>release=r);return ['first'];});await started;assert.deepEqual(await f.store.leased('test-worker',()=>{throw Error('SECOND_WORKER');}),[]);release();assert.deepEqual(await first,['first']);assert.deepEqual(await f.store.leased('test-worker',async()=>['restarted']),['restarted']);
});
test('approved email transport ignores old machine warnings but preserves every reviewed byte',()=>{
 const old={user:process.env.EDITORIAL_GMAIL_USER,password:process.env.EDITORIAL_GMAIL_APP_PASSWORD};try{process.env.EDITORIAL_GMAIL_USER='oroknows@gmail.com';process.env.EDITORIAL_GMAIL_APP_PASSWORD='fake-test-only';const asset=structuredClone(proposals[0].asset);asset.capability_claim_gate={status:'WARNING'};asset.email.version='old-approved-format';const mail=reviewedMail(asset,asset.delivery);assert.equal(mail.text,asset.email.body);assert.equal(mail.subject,asset.email.subject);assert.equal(mail.to,asset.email.to);assert.equal(mail.from.address,'oroknows@gmail.com');}finally{for(const [name,value] of [['EDITORIAL_GMAIL_USER',old.user],['EDITORIAL_GMAIL_APP_PASSWORD',old.password]])if(value===undefined)delete process.env[name];else process.env[name]=value;}
});
test('approval retains durable work intent if materialized queue entry is lost before restart',async()=>{
 const f=await candidate();await f.engine.approvePublication(f.proposal);const {default:fs}=await import('node:fs/promises');const {default:path}=await import('node:path');await fs.unlink(path.join(f.store.directory,encodeURIComponent('distribution_work:'+f.proposal.proposal_id)+'.json'));
 const restarted=new GraphEngine({store:f.store,products:{},adapters:{EXTERNAL:f.adapter}});const [out]=await restarted.distributeApproved();assert.equal(out.status,'PUBLISHED');
});
