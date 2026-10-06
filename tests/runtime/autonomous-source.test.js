import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {FileStore} from '../../runtime/store.js';
import {ProductIntake} from '../../runtime/intake.js';
import {autonomousScanCycle,publishedSource,intakeHeld} from '../../runtime/autonomous-source.js';
import {fixture} from './fixture.js';

const scan={snapshot_date:'2026-10-06',publication_state:'PUBLISHED',records:[{id:'strongest',status:'CONFIRMED',theme:'Current source',evidence:[{fact:'An operating asset exists.',url:'https://source.test'}],chain_evolution:{unresolved_evidence:['Output remains uncertain.']}}]};
const bytes=Buffer.from(JSON.stringify(scan));
const manifest={product:'EMRADAR',snapshot_date:scan.snapshot_date,source_path:'data/checkpoints/discovery-2026-10-06.json',source_sha256:crypto.createHash('sha256').update(bytes).digest('hex'),publication_state:'PUBLISHED',downstream_release_allowed:true,native_gates:Object.fromEntries(['evidence','editorial','brand','risk','publication'].map(k=>[k,'PASS'])),campaign_authority:{campaign_id:'EMRADAR_2026_10_06_LAUNCH',external_publication_allowed:false,required_stop:'PUBLICATION_REVIEW'}};
const fetcher=(attestation=manifest)=>async url=>({ok:true,arrayBuffer:async()=>url.includes('/verification/')?Buffer.from(JSON.stringify(attestation)):bytes});
async function setup(){
  const f=await fixture(),policy={...f.p,product_identity:'EMRADAR',source_release_authority:{automatic_after_native_gates:true,required_gates:['evidence','editorial','brand','risk','publication']}};
  const intake=new ProductIntake({store:f.store,policies:{EMRADAR:policy},sourceKeys:{EMRADAR:'TEST_SIGNING_KEY'}});
  let calls=0;
  const engineFactory=async()=>({products:await intake.products(),run:async input=>{
    calls++;assert.equal(input.stop_at,'PUBLICATION_REVIEW');assert.equal(input.signal_id,'strongest');
    const products=await intake.products();const signal=products.EMRADAR.signals[0],id='test-proposal';
    await f.store.put('publication_review:'+id,{proposal_id:id,review_hash:'exact-hash',signal_revision:signal.revision,source_receipt:products.EMRADAR.source_receipt,destination:'TEST_EXTERNAL',status:'AWAITING_REVIEW',cost_receipt_id:'test-run',input});
    return {status:'AWAITING_REVIEW',review:{proposal_id:id,destination:'TEST_EXTERNAL'},nodes:[{node:'publication_review'}],selection:{options:[{id:'TEST_EXTERNAL'}]},route_plan:{candidates:[]}};
  }});
  return {...f,args:{intake,store:f.store,engineFactory,sourceKeys:{EMRADAR:'TEST_SIGNING_KEY'},fetcher:fetcher(),env:{RENDER_GIT_COMMIT:'test-runtime'},log:()=>{}},calls:()=>calls};
}
test('native publication attestation is hash-bound and all five gates are required',async()=>{
  assert.equal((await publishedSource(fetcher())).scan.snapshot_date,scan.snapshot_date);
  for(const bad of [{...manifest,source_sha256:'changed'},{...manifest,native_gates:{...manifest.native_gates,risk:'FAIL'}},{...manifest,campaign_authority:{...manifest.campaign_authority,external_publication_allowed:true}}])await assert.rejects(publishedSource(fetcher(bad)),/ATTESTATION|GATES/);
});
test('published scan automatically enters signed intake and existing graph, duplicate wake-ups reuse exact review',async()=>{
  const f=await setup(),first=await autonomousScanCycle(f.args),second=await autonomousScanCycle(f.args);
  assert.equal(first.status,'AWAITING_REVIEW');assert.equal(second.duplicate,true);assert.equal(f.calls(),1);
  assert.equal(first.external_actions,0);assert.equal(first.package.proposals[0].artifact_hash,'exact-hash');assert.equal(second.handoff.status,'DUPLICATE_INPUT');
});
test('existing source/campaign/proposal identities survive restart without regeneration',async()=>{
  const f=await setup();await autonomousScanCycle(f.args);
  const record=await f.store.get('source:EMRADAR');
  await f.store.put('receipt_index',[{product:'EMRADAR',signal_id:record.source.signals[0].id,signal_revision:record.source.signals[0].revision,campaign_id:'EMRADAR_EXISTING_IDENTITY',destination:'TEST_EXTERNAL',review:{proposal_id:'test-proposal'}}]);
  const key='autonomous_scan:'+scan.snapshot_date+':'+manifest.source_sha256;await f.store.put(key,null);
  await f.store.put('route_plan:EMRADAR:strongest:'+record.source.signals[0].revision,{candidates:[{destination_id:'TEST_EXTERNAL'}]});
  const result=await autonomousScanCycle(f.args);assert.equal(result.campaign_id,'EMRADAR_EXISTING_IDENTITY');assert.equal(f.calls(),1);assert.equal(result.package.proposals[0].proposal_id,'test-proposal');
});
test('emergency stop blocks before fetching, signing, generating or delivering',async()=>{
  const f=await setup();f.args.env.MARKETING_EMERGENCY_STOP='true';f.args.fetcher=()=>{throw new Error('MUST_NOT_FETCH');};assert.equal(intakeHeld(f.args.env),true);assert.equal((await autonomousScanCycle(f.args)).status,'HELD');assert.equal(f.calls(),0);
});
test('interrupted preparation resumes and never repeats completed artifacts',async()=>{
  const f=await setup(),make=f.args.engineFactory;let fail=true;
  f.args.engineFactory=async()=>{const engine=await make(),run=engine.run;engine.run=async input=>{if(fail){fail=false;throw new Error('TEMPORARY_FAILURE');}return run(input);};return engine;};
  await assert.rejects(autonomousScanCycle(f.args),/TEMPORARY_FAILURE/);
  const result=await autonomousScanCycle(f.args);assert.equal(result.status,'AWAITING_REVIEW');assert.equal(f.calls(),1);
});
test('runtime repair refreshes blocked route decisions without changing campaign or source identity',async()=>{
  const f=await setup();await autonomousScanCycle(f.args);
  const key='autonomous_scan:'+scan.snapshot_date+':'+manifest.source_sha256,state=await f.store.get(key);
  await f.store.put(key,{...state,status:'BLOCKED',runtime_commit:'old-runtime',attempts:3,next_due:new Date(Date.now()+300000).toISOString(),routes:{UNSELECTED:{status:'BLOCKED',blocker:'OLD_ROUTE_BLOCKER'}}});
  const result=await autonomousScanCycle(f.args);
  assert.equal(result.status,'AWAITING_REVIEW');assert.equal(result.campaign_id,state.campaign_id);assert.equal(result.handoff.status,'DUPLICATE_INPUT');assert.equal(f.calls(),2);assert.deepEqual(result.package.blockers,[]);
});
