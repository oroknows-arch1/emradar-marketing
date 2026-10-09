import test from 'node:test';
import assert from 'node:assert/strict';
import {Script} from 'node:vm';
import {fixture} from './fixture.js';
import {ownerOverride} from '../../runtime/owner-override.js';
import {campaignReviewHtml} from '../../runtime/campaign-review-html.js';
import {encodeState,decodeState,compactGraphState} from '../../runtime/state-compaction.js';
const campaign_id='EMRADAR_2026_10_09_LAUNCH';
test('owner advisory persists on reopen/replay; exact artifacts and approvals unchanged',async()=>{
 const f=await fixture(),p={destination:'D',proposal_id:'P',review_hash:'H',asset:{copy:'exact'}},pkg={campaign_id,proposals:[p],route_dispositions:[{destination:'D',route_score:.1}]};
 await f.store.put('review_package:'+campaign_id,pkg);
 const input={campaign_id,destination:'D',review_hash:'H',action:'EDITORIAL_ADVISORY',reason:'Useful to this audience',confirm:true};
 const resume=()=>{throw Error('COMPLETE_ASSET_MUST_NOT_RESUME');};
 const r=await ownerOverride({store:f.store,input,resume});assert.equal(r.status,'COMPLETE');assert.equal(r.owner,'OWNER');assert.equal(r.external_actions,0);
 const {FileStore}=await import('../../runtime/store.js'),reopened=new FileStore(f.store.directory);
 const replay=await ownerOverride({store:reopened,input,resume});assert.equal(replay.duplicate,true);assert.equal(replay.timestamp,r.timestamp);
 assert.deepEqual(await reopened.get('review_package:'+campaign_id),pkg);assert.equal(await reopened.get('publication_approval:P'),null);
});
test('recovery preserves active/uncertain locks; abandoned recovery resumes only affected destination',async()=>{
 for(const reason of ['ACTIVE_ENGINE_HEARTBEAT','PROVIDER_WORK_RECENT','ENGINE_OWNER_CHANGED']){
  const f=await fixture();await f.store.put('review_package:'+campaign_id,{route_dispositions:[{destination:'D'}],proposals:[]});
  let calls=0;const r=await ownerOverride({store:f.store,input:{campaign_id,destination:'D',action:'RECOVER_PREPARATION',reason:'Resume saved work',confirm:true},recover:async()=>({status:'PRESERVED',reason}),resume:()=>{calls++;}});
  assert.equal(r.blocker,reason);assert.equal(calls,0);
 }
 const f=await fixture();await f.store.put('review_package:'+campaign_id,{route_dispositions:[{destination:'D'}],proposals:[]});
 let calls=0;const args={store:f.store,input:{campaign_id,destination:'D',action:'RECOVER_PREPARATION',reason:'Resume saved work',confirm:true},recover:async()=>({status:'RECOVERED_IDLE_PREPARATION_LOCK'}),resume:async(c,ds)=>{calls++;assert.equal(c,campaign_id);assert.deepEqual(ds,['D']);await f.store.put('review_package:'+c,{proposals:[{destination:'D',proposal_id:'P',review_hash:'H'}],route_dispositions:[{destination:'D'}]});return {status:'AWAITING_REVIEW'};}};
 assert.equal((await ownerOverride(args)).status,'COMPLETE');assert.equal(calls,1);assert.equal((await ownerOverride(args)).duplicate,true);assert.equal(calls,1);
});
test('protected actions and changed hashes cannot be overridden',async()=>{
 const f=await fixture();await f.store.put('review_package:'+campaign_id,{proposals:[{destination:'D',review_hash:'H'}],route_dispositions:[{destination:'D'}]});
 for(const action of ['EVIDENCE','COST','PERMISSION','DISTRIBUTION','UNLOCK'])await assert.rejects(ownerOverride({store:f.store,input:{campaign_id,destination:'D',action,reason:'test',confirm:true}}),/SCOPED/);
 await assert.rejects(ownerOverride({store:f.store,input:{campaign_id,destination:'D',action:'EDITORIAL_ADVISORY',review_hash:'changed',reason:'test',confirm:true}}),/ARTIFACT_CHANGED/);
});
test('all 18 mobile controls, confirmation/cancel and rendered script are valid',()=>{
 const proposals=Array.from({length:18},(_,i)=>({destination:'D'+i,proposal_id:'P'+i,review_hash:'H'+i,asset:{copy:'exact '+i}}));
 const h=campaignReviewHtml({campaign_id,proposals,route_dispositions:[]});
 assert.equal((h.match(/data-decision="APPROVED"/g)||[]).length,18);assert.equal((h.match(/data-decision="REJECTED"/g)||[]).length,18);assert.equal((h.match(/data-override=/g)||[]).length,0);
 assert(!h.includes('OWNER OVERRIDE'));assert(h.includes('/PUBLICATION_REVIEW/session'));assert(h.includes('min-height:44px'));new Script(h.split('<script>')[1].split('</script>')[0]);
});
test('lossless codec and bounded compaction preserve concurrent records and protected raw identities',async()=>{
 const value={asset:{base64:'image-data'.repeat(5000),copy:'unchanged'},review_hash:'HASH'};
 assert.deepEqual(decodeState(encodeState('publication_review:P',value)),value);assert.equal(encodeState('receipt:P',value),JSON.stringify(value));
 const data=new Map([['marketing:graph:publication_review:P',JSON.stringify(value)],['marketing:graph:receipt:P',JSON.stringify(value)]]);
 const client={async *scanIterator(){yield [...data.keys()];},get:async k=>data.get(k),eval:async(script,a)=>{assert(script.startsWith('#!lua flags=allow-oom'));const [old,packed]=a.arguments;if(data.get(a.keys[0])!==old)return 0;assert(packed.length<old.length);data.set(a.keys[0],packed);return 1;}};
 const r=await compactGraphState(client);assert.equal(r.records,1);assert(r.saved_bytes>40000);assert.deepEqual(decodeState(data.get('marketing:graph:publication_review:P')),value);assert.equal(data.get('marketing:graph:receipt:P'),JSON.stringify(value));assert.equal((await compactGraphState(client)).records,0);
});
