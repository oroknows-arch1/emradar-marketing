import test from 'node:test';
import assert from 'node:assert/strict';
import {GraphEngine} from '../../runtime/graph.js';
import {editorialOutreachAdapter} from '../../runtime/adapters.js';
import {fixture} from './fixture.js';

const spanish='EMRADAR sigue esta formación como FORMING. Evidencia verificada para la audiencia minera chilena. Incertidumbre: el resultado previsto aún no se ha realizado.';

async function editorialFixture(){
  const f=await fixture();
  f.p.product_identity='EMRADAR';f.p.destinations=[];
  f.p.budget={creation_approved:true,max_worker_usd:1,max_worker_daily_usd:4,max_worker_calls:4};
  f.p.signals[0]={id:'sierra-gorda-fourth-grinding-line',revision:'r1',state:'FORMING',evidence:['E1'],source_title:'Sierra Gorda copper expansion',location:'Antofagasta Region, Chile',new_to_radar:true,source_facts:[{id:'E1',text:'Construction of a fourth grinding line has started.',url:'https://example.test/evidence'}],source_uncertainty:['Forecast output is not realised output.'],causal_chain:{industries:['Copper mining','Grinding equipment','Mine construction']}};
  let sends=0;
  const outreach=editorialOutreachAdapter({
    routeSupported:route=>route.destination_id==='REDIMIN-EDITORIAL',
    sendEmail:async request=>{sends++;return {id:'mail-1',status:'DELIVERED',receipt:{idempotency_key:request.idempotency_key}};},
    collectOutcome:async()=>({source:'mailbox_followup',metrics:{response_received:1,publication_confirmed:0}})
  });
  const harness={
    quote:async()=>({currency:'AUD',verified:true,provider_enforced:true,max_cost_aud:0,receipt_id:'localization-quote'}),
    work:async(_unit,context)=>({result:{language:'es-CL',copy:spanish,signal_state:'FORMING'},proof:{billing:{currency:'AUD',actual:true,amount:0,receipt_id:'localization-billing'},evidence_refs:['E1']},decision:{lane:'model'},attempts:1})
  };
  const engine=new GraphEngine({store:f.store,products:{EMRADAR:f.p},adapters:{OPEN_ROUTE:outreach,X:{formats:['text'],cost:'UNKNOWN',authorized:async()=>false}},harness});
  return {...f,engine,outreach,sends:()=>sends,input:{product:'EMRADAR',campaign_id:'EDITORIAL_ROUTE_TEST',signal_id:f.p.signals[0].id}};
}

test('approved REDIMIN route localizes, submits once, records outcome and learns',async()=>{
  const f=await editorialFixture();
  const candidate=await f.engine.run(f.input);
  assert.equal(candidate.status,'AWAITING_REVIEW');
  assert.equal(candidate.review.destination,'REDIMIN-EDITORIAL');
  assert.equal(candidate.review.copy,spanish);
  assert(candidate.nodes.some(n=>n.node==='localization'&&n.status==='PASS'));
  assert.equal(f.sends(),0);

  const submitted=await f.engine.approvePublication(candidate.review);
  assert.equal(submitted.status,'PASS');
  assert.equal(submitted.receipt.execution_status,'SUBMITTED');
  assert.equal(submitted.receipt.delivery_status,'DELIVERED');
  assert.equal(submitted.outcome.measurements.response_received.value,1);
  assert.equal(submitted.outcome.measurements.publication_confirmed.value,0);
  assert.equal(submitted.learning_after.version,1);
  assert.equal(f.sends(),1);

  const duplicate=await f.engine.run({...f.input,campaign_id:'EDITORIAL_ROUTE_TEST_RETRY'});
  assert.equal(duplicate.receipt.id,submitted.receipt.id);
  assert.equal(f.sends(),1);
});

test('missing open-route executor is internal, not an owner-authority escalation',async()=>{
  const f=await editorialFixture();
  f.engine=new GraphEngine({store:f.store,products:{EMRADAR:f.p},adapters:{X:{formats:['text'],cost:'UNKNOWN',authorized:async()=>false}},harness:f.engine.harness});
  const candidate=await f.engine.run({...f.input,campaign_id:'NO_EXECUTOR'});
  const blocked=await f.engine.approvePublication(candidate.review);
  assert.equal(blocked.blocker,'OPEN_ROUTE_EXECUTOR_NOT_IMPLEMENTED');
  assert.deepEqual(blocked.blocker_disposition,{scope:'INTERNAL_EXECUTION',surface_to_owner:false});
});
