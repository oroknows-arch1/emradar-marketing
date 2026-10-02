import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {fixture} from './fixture.js';
import {GraphEngine} from '../../runtime/graph.js';
import {xAdapter} from '../../runtime/adapters.js';

test('A–J: actual local delivery, measurement, learning and next graph consumption',async()=>{
 const f=await fixture();const r=await f.engine.run(f.input);
 assert.equal(r.status,'PASS');assert.equal(r.receipt.execution_status,'PUBLISHED');
 for(const node of ['ingest','signal_extraction','signal_library','priority','campaign','scout','baseline','delta','novelty_gate','route','editorial_intelligence','editorial_quality_gate','variant_factory','format','adapt','evidence_gate','brand_gate','permission_gate','execute','receipt','observe','normalize','learn','distribution_map'])assert(r.nodes.some(n=>n.node===node&&n.status==='PASS'),node);
 assert.equal((await f.store.get('receipt:'+r.receipt.id)).external_id,r.receipt.external_id);
 assert.equal(r.outcome.measurements.content_verified.value,1);assert(r.outcome.measurements.delivered_bytes.value>0);assert.equal(r.outcome.engagement_rate,'UNKNOWN');
 assert.equal(r.learning_before.version,0);assert.equal(r.learning_after.version,1);
 const repeat=await f.engine.run({...f.input,campaign_id:'SAFE_TEST_2'});
 assert.equal(repeat.selection.learning_version,1);assert(repeat.selection.options[0].learned>r.selection.options[0].learned);
 assert.equal(repeat.receipt.id,r.receipt.id);assert.equal(repeat.learning_after.version,1);assert.equal((await fs.readdir(f.dir+'/destination')).length,1);
 // New source revision uses the learned route, preserving independently reviewed truth.
 f.p.signals[0].revision='r2';for(const d of f.p.destinations){d.delta.signal_revision='r2';d.permission.signal_revision='r2';}
 const next=await f.engine.run({...f.input,campaign_id:'SAFE_TEST_3'});assert.equal(next.selection.learning_version,1);assert.equal(next.learning_after.version,2);assert.notEqual(next.receipt.id,r.receipt.id);
 assert.equal(f.p.signals[0].state,'FORMING');
});

test('K: concurrent duplicate requests cannot double-publish',async()=>{
 const f=await fixture();const results=await Promise.allSettled([f.engine.run(f.input),f.engine.run(f.input)]);assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal((await fs.readdir(f.dir+'/destination')).length,1);
});

test('L: repeated definitive failure is bounded and opens circuit',async()=>{
 const f=await fixture();let calls=0;f.adapter.publish=async()=>{calls++;const e=new Error('rejected');e.status=403;throw e;};
 for(let i=0;i<8;i++)await f.engine.run(f.input);
 assert.equal(calls,3); // Shared platform breaker blocks alternative routes after three failures.
 const more=await f.engine.run(f.input);assert.equal(calls,3);assert(more.nodes.length<=40);
});

test('ambiguous timeout cannot retry publication',async()=>{
 const f=await fixture();let calls=0;f.adapter.publish=async()=>{calls++;throw new Error('timeout after send');};
 await f.engine.run(f.input);await f.engine.run(f.input);assert.equal(calls,1);
});

test('429 records cooldown without waiting or unbounded retry',async()=>{
 const f=await fixture();let calls=0;f.adapter.publish=async()=>{calls++;const e=new Error('rate limit');e.status=429;e.retry_at=Date.now()+3600000;throw e;};
 const r=await f.engine.run(f.input);assert.equal(r.receipt.execution_status,'RATE_LIMITED');assert(r.receipt.retry_at);await f.engine.run(f.input);assert.equal(calls,1); // shared platform cooldown blocks alternative route/format too
});

test('blocked gate gets a durable receipt and no side effect',async()=>{
 const f=await fixture();f.p.release_approved=false;const r=await f.engine.run(f.input);assert.equal(r.status,'BLOCKED');assert.equal(r.receipt.execution_status,'BLOCKED');assert(await f.store.get('receipt:'+r.receipt.id));assert.equal(r.learning_after.version,0);
});

test('body PASS claims cannot authorize an unreviewed source',async()=>{
 const f=await fixture();f.p.review.editorial=false;const r=await f.engine.run({...f.input,editorial_quality_gate:'PASS',novelty_gate:'PASS'});assert.equal(r.status,'BLOCKED');
});

test('permission is per revision and expires',async()=>{
 const f=await fixture();for(const d of f.p.destinations)d.permission.valid_until='2000-01-01';const r=await f.engine.run(f.input);assert.equal(r.blocker,'DESTINATION_PERMISSION_REQUIRED');
});

test('UNKNOWN-cost platform is blocked before publishing or measuring',async()=>{
 const f=await fixture();f.adapter.cost='UNKNOWN';let calls=0;f.adapter.publish=()=>calls++;const r=await f.engine.run(f.input);assert.equal(r.blocker,'API_COST_APPROVAL_REQUIRED');assert.equal(calls,0);
});

test('measurement failure preserves UNKNOWN; does not manufacture engagement',async()=>{
 const f=await fixture();f.adapter.collect=async()=>{throw new Error('unsupported metrics');};const r=await f.engine.run(f.input);assert.equal(r.performance.status,'UNKNOWN');assert.equal(r.outcome.reach,'UNKNOWN');assert.deepEqual(r.outcome.measurements,{});
});

test('later observed data updates learning once without counting execution twice',async()=>{
 const f=await fixture();const collect=f.adapter.collect;f.adapter.collect=async()=>({status:'UNKNOWN',metrics:{},source:'UNAVAILABLE'});const r=await f.engine.run(f.input);f.adapter.collect=collect;
 const feedback=await f.engine.feedback(r.receipt.id);assert.equal(feedback.learning.version,2);assert.equal(feedback.learning.routes[r.receipt.route_key].successes,1);
 const again=await f.engine.feedback(r.receipt.id);assert.equal(again.learning.version,2);
});

test('corrupt measurement is rejected',async()=>{
 const f=await fixture();f.adapter.collect=async()=>({status:'AVAILABLE',metrics:{bad:{value:-1,unit:'count',scope:'local'}}});const r=await f.engine.run(f.input);assert.equal(r.status,'BLOCKED');assert.equal(r.blocker,'INVALID_MEASUREMENT');assert.equal(r.learning_after.version,0);
});

test('X collector carries product identity and preserves channel-native metrics',async()=>{
 let selected;const a=xAdapter({publish:async()=>{},authorized:async()=>true,fetchMetrics:async(id,product)=>{selected=[id,product];return {data:{public_metrics:{like_count:7,impression_count:200}}};}});
 const r=await a.collect({external_id:'123',product:'Atlasoquence'});assert.deepEqual(selected,['123','Atlasoquence']);assert.equal(r.metrics.like_count.scope,'x_public_metrics');assert.equal(r.cost_usd,'UNKNOWN');
});

test('state survives fresh engine instance',async()=>{
 const f=await fixture();await f.engine.run(f.input);const engine=new GraphEngine({store:f.store,products:{TEST_PRODUCT:f.p},adapters:{LOCAL:f.adapter}});const r=await engine.run(f.input);assert.equal(r.selection.learning_version,1);assert.equal(r.learning_after.version,1);
});

test('missing baseline and missing delta block',async()=>{
 for(const what of ['baseline','delta']){const f=await fixture();for(const d of f.p.destinations)delete d[what];const r=await f.engine.run(f.input);assert.equal(r.status,'BLOCKED');assert.equal(r.receipt.execution_status,'BLOCKED');}
});

test('hard traversal ceiling terminates graph',async()=>{
 const f=await fixture({maxSteps:2});const r=await f.engine.run(f.input);assert.equal(r.status,'FAILED');assert.equal(r.blocker,'STEP_BOUND');assert.equal(r.nodes.length,2);
});

test('autonomous scheduler admits new revisions and never republishes a seen revision',async()=>{
 const f=await fixture();f.p.autonomous={enabled:true};const a=await f.engine.tick();assert.equal(a.result.status,'PASS');const b=await f.engine.tick();assert.equal(b.result,null);
 f.p.signals[0].revision='r2';for(const d of f.p.destinations){d.delta.signal_revision='r2';d.permission.signal_revision='r2';}
 const c=await f.engine.tick();assert.equal(c.result.selection.learning_version,1);assert.equal(c.result.status,'PASS');
});

test('scheduler requires explicit per-product opt in',async()=>{
 const f=await fixture();const a=await f.engine.tick();assert.equal(a.result,null);assert.equal(a.feedback,null);
});

test('paid publication reserves bounded daily budget before action',async()=>{
 const f=await fixture();f.adapter.cost='UNKNOWN';f.p.budget={approved:true,max_action_usd:1,max_cycle_usd:1,max_daily_usd:1,max_daily_api_calls:1};for(const d of f.p.destinations){d.max_api_calls=1;d.max_action_usd=1;}
 const r=await f.engine.run(f.input);assert.equal(r.status,'PASS');assert.equal(r.receipt.reserved_cost_usd,1);
 f.p.signals[0].revision='r2';for(const d of f.p.destinations){d.delta.signal_revision='r2';d.permission.signal_revision='r2';}
 const blocked=await f.engine.run(f.input);assert.equal(blocked.blocker,'DAILY_COST_OR_CALL_BOUND');
});

test('retry bound applies independently of global breaker',async()=>{
 const f=await fixture();f.p.destinations=f.p.destinations.slice(0,1);f.p.destinations[0].formats=['text'];let calls=0;f.adapter.publish=async()=>{calls++;const e=new Error('failed');e.status=403;throw e;};for(let i=0;i<5;i++)await f.engine.run(f.input);assert.equal(calls,2);
});

test('cost-bound rejection creates BLOCKED receipt, never phantom IN_FLIGHT',async()=>{
 const f=await fixture();f.adapter.cost='UNKNOWN';f.p.budget={approved:true,max_action_usd:1,max_cycle_usd:1,max_daily_usd:0,max_daily_api_calls:0};for(const d of f.p.destinations){d.max_api_calls=1;d.max_action_usd=1;}
 const r=await f.engine.run(f.input);assert.equal(r.receipt.execution_status,'BLOCKED');assert.equal(r.blocker,'DAILY_COST_OR_CALL_BOUND');
});

test('X image API-call budget must cover four calls before publishing',async()=>{
 const f=await fixture();f.adapter.cost='UNKNOWN';f.adapter.publishCalls=()=>4;f.p.budget={approved:true,max_action_usd:1,max_cycle_usd:1,max_daily_usd:10,max_daily_api_calls:10};for(const d of f.p.destinations){d.max_api_calls=1;d.max_action_usd=1;}
 const r=await f.engine.run(f.input);assert.equal(r.blocker,'API_CALL_BOUND_TOO_LOW');
});

test('metrics 429 propagates shared cooldown into later graph routing',async()=>{
 const f=await fixture();const r=await f.engine.run(f.input);f.adapter.collect=async()=>{const error=new Error('metrics rate limit');error.status=429;error.retry_at=Date.now()+3600000;throw error;};
 const feedback=await f.engine.feedback(r.receipt.id);assert(feedback.learning.platforms['TEST_PRODUCT:LOCAL'].retry_at);
 const next=await f.engine.run(f.input);assert.equal(next.blocker,'CIRCUIT_OPEN_OR_RATE_LIMITED');
});
