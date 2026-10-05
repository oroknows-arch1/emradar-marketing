import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,editorialHarness,editorialBudget} from './fixture.js';
import {GraphEngine} from '../../runtime/graph.js';
import {calendarMonth} from '../../runtime/spending.js';
import {billingDetail} from '../../runtime/campaign-costs.js';
import {editorialOutreachAdapter} from '../../runtime/adapters.js';
import {HarnessBridge} from '../../runtime/harness.js';

async function setup(){
  const f=await fixture();f.p.product_identity='EMRADAR';f.p.destinations=[];f.p.budget=editorialBudget;
  f.p.signals=[{id:'another-copper-project',revision:'r1',state:'FORMING',source_snapshot:'2026-10-05',evidence:['E1'],source_title:'A new copper project',location:'Chile',source_facts:[{id:'E1',text:'The operator announced a processing expansion.',url:'https://example.test/source'}],source_uncertainty:['Commissioning has not been confirmed.'],causal_chain:{industries:['Copper mining','Mine construction','Grinding equipment']}}];
  f.engine=new GraphEngine({store:f.store,products:{EMRADAR:f.p},adapters:{OPEN_ROUTE:editorialOutreachAdapter({senderIdentity:()=>({name:'EMRADAR',address:'sender@example.test',approved:true}),sendEmail:async()=>{throw new Error('TEST_MUST_NOT_SEND');}})},harness:editorialHarness()});
  f.input={product:'EMRADAR',campaign_id:'EDITORIAL_COSTS',signal_id:f.p.signals[0].id,destination_id:'INTERNATIONAL-MINING-EDITORIAL',stop_at:'PUBLICATION_REVIEW'};return f;
}

test('future formations pass verified editorial work, preserve evidence and uncertainty, and persist review costs',async()=>{
  const f=await setup(),before=structuredClone(f.p);const r=await f.engine.run(f.input);
  assert.equal(r.status,'AWAITING_REVIEW');assert.deepEqual(f.p,before);
  assert.match(r.review.copy,/The operator announced/);assert.match(r.review.copy,/Commissioning has not been confirmed/);
  assert.doesNotMatch(r.review.copy,/FORMING|Evidence:|Unresolved:|Reader action:/);
  assert.equal(r.cost_receipt.cost_state,'ZERO');assert.equal(r.cost_receipt.categories.distribution.amount_aud,0);
  assert.equal(r.cost_receipt.calls.length,1);assert.deepEqual(await f.store.get(r.cost_receipt.location),r.cost_receipt);
  assert.equal(r.cost_receipt.formation_id,'another-copper-project');assert(!r.nodes.some(n=>n.node==='execute'));assert.equal(r.learning_after.version,0);
  await f.engine.rejectPublication({...r.review,reason:'EDITORIAL_QUALITY'});
  const cost=await f.store.get(r.cost_receipt.location);assert.equal(cost.outcome,'REJECTED');assert.equal(cost.calls.length,1);
  await assert.rejects(f.engine.approvePublication(r.review),/EXPIRED_OR_CHANGED/);
});

test('four editorial destinations receive distinct briefs and verified language',async()=>{
  const f=await setup();const copies=[];
  for(const destination_id of ['REUTERS-BREAKINGVIEWS-GUEST','INTERNATIONAL-MINING-EDITORIAL','AUSTRALIAN-MINING-REVIEW-EDITORIAL','REDIMIN-EDITORIAL']){
    const r=await f.engine.run({...f.input,destination_id});assert.equal(r.status,'AWAITING_REVIEW',r.blocker);copies.push(r.review.copy);
    const p=await f.store.get('publication_review:'+r.review.proposal_id);assert.equal(p.asset.localization.language,destination_id==='REDIMIN-EDITORIAL'?'es-CL':'en');
  }
  assert.equal(new Set(copies).size,4);
});

test('schema leakage, omitted uncertainty and unbound claims fail after charging generation',async()=>{
  for(const defect of ['schema','uncertainty','evidence','verification']){
    const f=await setup(),work=f.engine.harness.work;
    f.engine.harness.work=async(...args)=>{const r=await work(...args);if(defect==='schema')r.result.body+='\nEvidence: E1';if(defect==='uncertainty')r.result.qualifications=[];if(defect==='evidence')r.result.claims[0].evidence_refs=['OTHER'];if(defect==='verification')r.proof.editorial_checks.factual_entailment='FAIL';return r;};
    const r=await f.engine.run(f.input);assert.equal(r.status,'BLOCKED');assert.equal(r.review,null);assert.equal(r.cost_receipt.calls.length,1);assert.equal(r.cost_receipt.outcome,'BLOCKED');
  }
});

test('failed billed worker retains actual usage and unknown worker retains UNKNOWN',async()=>{
  for(const known of [true,false]){
    const f=await setup(),month=calendarMonth();await f.store.put('spend:'+month,{month,actual_aud:0,unresolved:{},campaigns:{},receipts:{},historical_billing:'RECONCILED'});
    f.engine.harness.quote=async()=>({currency:'AUD',verified:true,provider_enforced:true,max_cost_aud:1,receipt_id:'bounded'});
    f.engine.harness.work=async()=>{const e=new Error('PROVIDER_FAILED');if(known)e.billing={actual:true,currency:'AUD',amount:.2,receipt_id:'bill',provider:'TEST',model:'test-model',request_id:'request-1',usage:{input_tokens:20,output_tokens:10}};throw e;};
    const r=await f.engine.run(f.input);assert.equal(r.status,'BLOCKED');assert.equal(r.cost_receipt.total,known?.2:'UNKNOWN');assert.equal(r.cost_receipt.cost_state,known?'ACTUAL':'UNKNOWN');
    if(known)assert.equal(r.cost_receipt.calls[0].usage.output_tokens,10);else assert.equal(r.cost_receipt.calls[0].reason,'PROVIDER_BILLING_NOT_RETURNED');
  }
});

test('verified pricing is calculated; incomplete pricing is never zero',()=>{
  assert.equal(billingDetail({usage:{input_tokens:100,output_tokens:50}}).state,'UNKNOWN');
  const b={usage:{input_tokens:100,output_tokens:50},pricing:{verified:true,receipt_id:'price-version',currency:'AUD',input_per_million:2,output_per_million:4}};
  assert.equal(billingDetail(b).state,'CALCULATED');assert.equal(billingDetail(b).amount_aud,.0004);
});

test('hard traversal failure still creates a durable run cost receipt',async()=>{const f=await setup();f.engine.maxSteps=1;const r=await f.engine.run(f.input);assert.equal(r.status,'FAILED');assert.equal((await f.store.get(r.cost_receipt.location)).outcome,'FAILED');});

test('paid editorial cost survives owner rejection and forced review never consumes an approval',async()=>{
  const f=await setup(),month=calendarMonth();await f.store.put('spend:'+month,{month,actual_aud:0,unresolved:{},campaigns:{},receipts:{},historical_billing:'RECONCILED'});
  const work=f.engine.harness.work;f.engine.harness.quote=async()=>({currency:'AUD',verified:true,provider_enforced:true,max_cost_aud:1,receipt_id:'bounded'});
  f.engine.harness.work=async(...args)=>{const r=await work(...args);r.proof.billing.amount=.25;return r;};
  const r=await f.engine.run(f.input);assert.equal(r.cost_receipt.total,.25);
  await f.store.put('publication_approval:'+r.review.proposal_id,{approved_by:'OWNER',review_hash:r.review.review_hash,expires_at:r.review.expires_at});
  const repeated=await f.engine.run(f.input);assert.equal(repeated.status,'AWAITING_REVIEW');assert.equal(repeated.cost_receipt.total,0);assert(!repeated.nodes.some(n=>n.node==='execute'));
  await f.engine.rejectPublication({...r.review,reason:'EDITORIAL_QUALITY'});
  const saved=await f.store.get(r.cost_receipt.location);assert.equal(saved.outcome,'REJECTED');assert.equal(saved.total,.25);assert.equal(saved.cost_state,'ACTUAL');
});

test('all billed harness attempts are retained if retry verification fails',async()=>{
  let calls=0;const bridge=new HarnessBridge({routeWorkUnit:u=>({contractVersion:'elastic-routing-v0.1',workUnitId:u.workUnitId,lane:'standard',attemptCeiling:2}),registry:async()=>[],execute:async()=>{calls++;const e=new Error('failed');e.safe_retry=true;e.billing={actual:true,currency:'AUD',amount:.1,receipt_id:'bill-'+calls};throw e;},verify:async()=>{}});
  await assert.rejects(bridge.work({workUnitId:'test'},{}),e=>e.billing.amount===.2&&e.billing.calls.length===2);assert.equal(calls,2);
});
