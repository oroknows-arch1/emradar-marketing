import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './fixture.js';
import {ProductIntake,signSource,emradarSource} from '../../runtime/intake.js';
import {GraphEngine} from '../../runtime/graph.js';
import {HarnessBridge} from '../../runtime/harness.js';

async function intakeFixture(){const f=await fixture();const intake=new ProductIntake({store:f.store,policies:{TEST_PRODUCT:f.p},sourceKeys:{TEST_PRODUCT:'unit-test-only-secret'}});return {...f,intake,envelope:{product:'TEST_PRODUCT',sequence:1,source:{signals:f.p.signals,release_approved:true,review:{evidence:true,editorial:true},budget:{approved:true},destinations:[]}}};}

test('signed product handoff persists and enters actual closed-loop graph',async()=>{
 const f=await intakeFixture();await f.intake.receive(f.envelope,signSource(f.envelope,'unit-test-only-secret'));const products=await f.intake.products();const engine=new GraphEngine({store:f.store,products,adapters:{LOCAL:f.adapter}});const r=await engine.run(f.input);assert.equal(r.status,'PASS');assert.equal(r.learning_after.version,1);assert.equal(products.TEST_PRODUCT.budget,undefined);assert.equal(products.TEST_PRODUCT.destinations.length,2);
});
test('source input cannot change marketing permission, spend or brand policy',async()=>{
 const f=await intakeFixture();f.envelope.source.brand_system='malicious replacement';f.envelope.source.autonomous={enabled:true};await f.intake.receive(f.envelope,signSource(f.envelope,'unit-test-only-secret'));const p=(await f.intake.products()).TEST_PRODUCT;assert.equal(p.brand_system,f.p.brand_system);assert.equal(p.autonomous,undefined);assert.equal(p.destinations.length,2);
});
test('unsigned and changed source input is rejected',async()=>{const f=await intakeFixture();await assert.rejects(f.intake.receive(f.envelope,'wrong'),/INVALID_SOURCE_SIGNATURE/);});
test('source replay is idempotent; rollback and sequence conflict rejected',async()=>{
 const f=await intakeFixture();const sig=signSource(f.envelope,'unit-test-only-secret');await f.intake.receive(f.envelope,sig);assert.equal((await f.intake.receive(f.envelope,sig)).status,'DUPLICATE_INPUT');f.envelope.source.release_approved=false;await assert.rejects(f.intake.receive(f.envelope,signSource(f.envelope,'unit-test-only-secret')),/STALE_OR_CONFLICTING_SOURCE/);
});
test('native scan maps states/evidence without inventing release approval',()=>{
 const s=emradarSource({snapshot_date:'2026-09-30',records:[{id:'s1',status:'UNKNOWN',theme:'uncertain',evidence:[{fact:'Test fact',source:'Test source'}],contradictions:['Uncertain'],chain_evolution:{unresolved_evidence:['Missing evidence']}}]});assert.equal(s.release_approved,false);assert.equal(s.signals[0].state,'UNKNOWN');assert.equal(s.signals[0].source_facts[0].text,'Test fact');assert.deepEqual(s.signals[0].source_uncertainty,['Uncertain','Missing evidence']);
});
test('native weakening and broken states retain their source classification',()=>{
 const scan={snapshot_date:'2026-10-02',records:['WEAKENING','BROKEN'].map((status,i)=>({id:'s'+i,status,evidence:[{fact:'Verified change '+i,source:'Source'}]}))};
 assert.deepEqual(emradarSource(scan).signals.map(s=>s.state),['WEAKENING','BROKEN']);
});
test('graph produces copy from source facts under approved deterministic template',async()=>{
 const f=await fixture();f.p.copy_policy={extractive_template_approved:true};f.p.signals[0].approved_copy=[];f.p.signals[0].source_facts=[{id:'E1',text:'A verified source fact.'}];f.p.signals[0].source_uncertainty=['Utilisation remains UNKNOWN'];const r=await f.engine.run(f.input);assert.equal(r.status,'PASS');const delivery=JSON.parse(await (await import('node:fs/promises')).readFile(new URL(r.receipt.url),'utf8'));assert(delivery.copy.includes('A verified source fact.'));assert(delivery.copy.includes('FORMING'));assert(delivery.copy.includes('UNKNOWN'));
});
test('new template cannot bypass template approval',async()=>{
 const f=await fixture();f.p.signals[0].approved_copy=[];f.p.signals[0].source_facts=[{id:'E1',text:'Source fact'}];const r=await f.engine.run(f.input);assert.equal(r.blocker,'COPY_TEMPLATE_APPROVAL_REQUIRED');
});
test('feedback follows declared graph edges with traced handoffs',async()=>{
 const f=await fixture();const r=await f.engine.run(f.input);const b=await f.engine.feedback(r.receipt.id);assert.deepEqual(b.trace.map(n=>n.node),['observe','normalize','learn','distribution_map']);assert(b.trace.every(n=>n.input_hash&&n.output_hash));
});
test('Harness bridge respects bounded attempts and verifier input binding',async()=>{
 let calls=0;const bridge=new HarnessBridge({routeWorkUnit:u=>({contractVersion:'elastic-routing-v0.1',workUnitId:u.workUnitId,lane:'standard',humanApprovalRequired:false,attemptCeiling:99}),registry:async()=>[],execute:async()=>{calls++;return {};},verify:async()=>({status:'VERIFIED',input_hash:'different',evidence_refs:['E1']})});await assert.rejects(bridge.work({workUnitId:'u1'},{input_hash:'correct'}),/HARNESS_OUTPUT_NOT_VERIFIED/);assert.equal(calls,1);
});
test('Harness-required human gate prevents dispatch',async()=>{
 let called=false;const bridge=new HarnessBridge({routeWorkUnit:u=>({contractVersion:'elastic-routing-v0.1',workUnitId:u.workUnitId,lane:'human-gate',humanApprovalRequired:true}),registry:async()=>[],execute:async()=>{called=true;},verify:async()=>({})});await assert.rejects(bridge.work({workUnitId:'u1'},{}),/HARNESS_REQUIRED_APPROVAL_OR_CAPABILITY/);assert.equal(called,false);
});
test('missing deployed Harness is an explicit blocker without model spend',async()=>{
 const f=await fixture();f.p.destinations=[];const r=await f.engine.run(f.input);assert.equal(r.blocker,'HARNESS_DISPATCH_NOT_CONNECTED');assert.equal(r.receipt.api_cost_usd,0);
});

test('UNKNOWN source review is blocked and retains the original blocker',async()=>{
 const f=await fixture();f.p.review.evidence='UNKNOWN';const r=await f.engine.run(f.input);assert.equal(r.blocker,'SOURCE_REVIEW_OR_RELEASE_REQUIRED');assert.equal(r.receipt.signal_state,'FORMING');
});
