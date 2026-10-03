import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {fixture} from './fixture.js';
import {GraphEngine} from '../../runtime/graph.js';
import {xDiscoveryConnector} from '../../runtime/x-discovery.js';
import {discoveryTestId,organicWorkers} from '../../runtime/organic-discovery.js';

const input={product:'EMRADAR',test_id:discoveryTestId,max_usd:1};
const post={id:'12345',author_id:'8',text:'Middle Corridor funding and freight delivery',created_at:new Date().toISOString(),conversation_id:'12345'};
async function setup(read){const f=await fixture();f.engine=new GraphEngine({store:f.store,products:{},adapters:{X:{discovery:{read},publish(){throw Error('ENGAGEMENT_FORBIDDEN');}}}});return f;}
const response=(data)=>({data,rate:{remaining:'290'},observed_at:new Date().toISOString()});
const fakeRead=async(path,params)=>path==='/2/tweets'?response({data:[post]}):params.query.startsWith('conversation_id:')?response({meta:{result_count:0}}):response({data:[post],includes:{users:[{id:'8',name:'Fixture only',username:'fixture'}]},meta:{result_count:1}});

test('native connector only GETs allowlisted X endpoints with existing authorization',async()=>{
  const calls=[];const connector=xDiscoveryConnector({currentAuth:async()=>({access_token:'fixture-secret'}),fetchImpl:async(url,options)=>{calls.push({url,options});return new Response(JSON.stringify({data:[]}),{status:200,headers:{'x-rate-limit-remaining':'298'}});}});
  const result=await connector.read('/2/tweets/search/recent',{query:'Middle Corridor',max_results:10});
  assert.equal(calls[0].url.origin,'https://api.x.com');assert.equal(calls[0].options.method,'GET');assert.equal(calls[0].options.redirect,'error');assert.equal(result.rate.remaining,'298');
  await assert.rejects(connector.read('/2/tweets/123/likes',{}),/ENDPOINT_NOT_ALLOWED/);assert.equal(calls.length,1);
});
test('native auth invalid and API denial stop without reconnect or hidden retry',async()=>{
  let calls=0;
  await assert.rejects(xDiscoveryConnector({currentAuth:async()=>null,fetchImpl:()=>calls++}).read('/2/tweets',{}),/AUTHORIZATION_REQUIRED/);assert.equal(calls,0);
  const connector=xDiscoveryConnector({currentAuth:async()=>({access_token:'fixture'}),fetchImpl:async()=>{calls++;return new Response(JSON.stringify({title:'Forbidden',detail:'No access'}),{status:403});}});
  await assert.rejects(connector.read('/2/tweets/search/recent',{}),e=>e.details.http_status===403&&e.details.detail==='No access');assert.equal(calls,1);
});
test('executes existing graph to HUMAN_PREVIEW; no campaign, receipts, learning or publishing',async()=>{
  const f=await setup(fakeRead);await f.store.put('learning',{version:7});const r=await f.engine.previewDiscovery(input);
  assert.equal(r.status,'HUMAN_PREVIEW');assert.equal(r.source.blob,'0bc26fe071ede84f389c0ae345afac945d6f951a');assert.equal(r.candidates[0].finding.status,'CONFIRMED');
  assert.equal(r.candidates[0].decision,'REPLY');assert.equal(r.candidates[0].reason,'SOURCE_BOUND_INFORMATION_DELTA_REVIEW');assert(r.no_engagement&&r.learning_unchanged);
  assert.equal(r.cost.requests,4);assert.equal(r.cost.reserved_micro_usd,355000);assert.equal(r.cost.actual_billed_usd,'UNKNOWN');
  assert.deepEqual(r.nodes.map(n=>n.node),['emradar_finding','x_discovery','conversation_baseline','discovery_relevance_gate','information_delta_gate','reply_draft','discovery_evidence_gate','human_preview','discovery_stop']);
  for(const key of ['latest','latest_receipt','receipt_index','scheduler_seen'])assert.equal(await f.store.get(key),null);
  const files=await fs.readdir(f.dir+'/state');assert(!files.some(n=>n.startsWith('receipt')||n.startsWith('campaign')));
});
test('saved preview prevents additional requests and spend across engine restarts',async()=>{
  let count=0;const f=await setup(async(...args)=>{count++;return fakeRead(...args);});const r=await f.engine.previewDiscovery(input);await f.engine.previewDiscovery(input);assert.equal(count,4);assert.equal(r.cost.requests,4);
});
test('failed/ambiguous request keeps reservation and returns a saved blocked preview',async()=>{
  let count=0;const f=await setup(async()=>{count++;throw Error('NETWORK_TIMEOUT');});const r=await f.engine.previewDiscovery(input);assert.equal(r.status,'BLOCKED');assert.equal(r.blocker,'NETWORK_TIMEOUT');assert.equal(r.cost.reserved_micro_usd,150000);assert(r.no_engagement);await f.engine.previewDiscovery(input);assert.equal(count,1);
});
test('crashed test with a persistent reservation cannot retry spending',async()=>{
  const f=await setup(()=>{throw Error('MUST_NOT_CALL');});await f.store.put('x_discovery:budget:'+discoveryTestId,{reserved_micro_usd:150000});const r=await f.engine.previewDiscovery(input);assert.equal(r.blocker,'X_DISCOVERY_TEST_ALREADY_RESERVED_USE_SAVED_PREVIEW');
});
test('truncated conversations cannot pass information delta gate',async()=>{
  const f=await setup(async(path,params)=>params.query?.startsWith('conversation_id:')?response({meta:{next_token:'more'}}):fakeRead(path,params));const r=await f.engine.previewDiscovery(input);assert.equal(r.candidates[0].decision,'DO_NOT_REPLY');assert.equal(r.candidates[0].reason,'CONVERSATION_TRUNCATED');
});
test('post lookup detects deletion or changed text before human preview',async()=>{
  const f=await setup(async(path,params)=>path==='/2/tweets'?response({data:[{...post,text:'Changed'}]}):fakeRead(path,params));const r=await f.engine.previewDiscovery(input);assert.equal(r.blocker,'X_DISCOVERY_POST_DELETED_OR_CHANGED');assert(!r.nodes.some(n=>n.node==='human_preview'));
});
test('maximum five candidates and twelve requests reserve at most $0.575',async()=>{
  const posts=Array.from({length:10},(_,i)=>({...post,id:String(12345+i),conversation_id:String(12345+i),author_id:String(i)}));
  const f=await setup(async(path,params)=>path==='/2/tweets'?response({data:posts.filter(p=>p.id===params.ids)}):params.query.startsWith('conversation_id:')?response({data:posts}):response({data:posts,includes:{users:posts.map(p=>({id:p.author_id,username:'fixture'+p.author_id}))}}));
  const r=await f.engine.previewDiscovery(input);assert.equal(r.candidates.length,5);assert.equal(r.cost.requests,12);assert.equal(r.cost.reserved_micro_usd,575000);assert(r.cost.reserved_micro_usd<=750000);
});
test('rate exhaustion stops before another request',async()=>{
  let count=0;const f=await setup(async()=>{count++;return {...response({data:[]}),rate:{remaining:'0'}};});const r=await f.engine.previewDiscovery(input);assert.equal(r.blocker,'X_DISCOVERY_RATE_LIMIT_EXHAUSTED');assert.equal(count,1);
});
test('unbound, generic or excess cost authorization is rejected before X access',async()=>{
  const f=await setup(()=>{throw Error('MUST_NOT_CALL');});await assert.rejects(f.engine.previewDiscovery({...input,test_id:'OTHER'}),/NOT_AUTHORIZED/);const r=await f.engine.previewDiscovery({...input,max_usd:2});assert.equal(r.blocker,'X_DISCOVERY_SPECIFIC_OWNER_AUTHORITY_REQUIRED');
});
test('semantic delta binds exact baseline, evidence index and state before drafting',async()=>{
  const finding={status:'FORMING',evidence:[{fact:'The World Bank approved $372 million for a rail infrastructure project.',source:'World Bank',url:'https://example.test/evidence'}],contradictions:['Outcomes remain unproven.'],missing_evidence:['Delivery']};
  const baseline={root:'The corridor faces freight bottlenecks.',recent_replies:[],complete:true,scope:'Limited'};baseline.hash=(await import('node:crypto')).default.createHash('sha256').update(JSON.stringify(baseline)).digest('hex');
  const c={candidates:[{finding,post:{id:'12345',text:baseline.root,baseline}}]};
  await organicWorkers.information_delta_gate(c);await organicWorkers.reply_draft(c);const row=c.candidates[0];
  assert.equal(row.decision,'REPLY');assert.equal(row.semantic_assessment.baseline_hash,baseline.hash);assert.equal(row.semantic_assessment.source_evidence_index,0);assert.equal(row.semantic_assessment.evidence_state,'FORMING');assert.match(row.proposed_reply,/FORMING.*\$372 million.*Caveat: Outcomes remain unproven/);
});
test('semantic delta rejects evidence already represented in the conversation',async()=>{
  const fact='The World Bank approved $372 million for a rail infrastructure project.';
  const finding={status:'CONFIRMED',evidence:[{fact,source:'World Bank',url:'https://example.test/evidence'}],contradictions:[],missing_evidence:[]};
  const baseline={root:fact,recent_replies:[],complete:true,scope:'Limited'};baseline.hash=(await import('node:crypto')).default.createHash('sha256').update(JSON.stringify(baseline)).digest('hex');
  const c={candidates:[{finding,post:{id:'12345',text:fact,baseline}}]};await organicWorkers.information_delta_gate(c);assert.equal(c.candidates[0].decision,'DO_NOT_REPLY');assert.equal(c.candidates[0].reason,'NO_SUPPORTED_SEMANTIC_INFORMATION_DELTA');
});
