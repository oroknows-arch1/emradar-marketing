import test from 'node:test';
import assert from 'node:assert/strict';
import {GraphEngine} from '../../runtime/graph.js';
import {editorialOutreachAdapter} from '../../runtime/adapters.js';
import {fixture,editorialHarness} from './fixture.js';

const spanish='La construcción de la cuarta línea de molienda de Sierra Gorda ha comenzado. La producción prevista todavía no se ha materializado.';

async function editorialFixture(){
  const f=await fixture();
  f.p.product_identity='EMRADAR';f.p.destinations=[];
  f.p.budget={creation_approved:true,max_worker_usd:1,max_worker_daily_usd:4,max_worker_calls:4};
  f.p.signals[0]={id:'sierra-gorda-fourth-grinding-line',revision:'r1',state:'FORMING',evidence:['E1'],source_title:'Sierra Gorda copper expansion',location:'Antofagasta Region, Chile',new_to_radar:true,source_facts:[{id:'E1',text:'Construction of a fourth grinding line has started.',url:'https://example.test/evidence'}],source_uncertainty:['Forecast output is not realised output.'],causal_chain:{industries:['Copper mining','Grinding equipment','Mine construction']}};
  let sends=0;
  const outreach=editorialOutreachAdapter({
    senderIdentity:()=>({name:'EMRADAR',address:'sender@example.test',approved:true}),
    routeSupported:route=>route.destination_id==='REDIMIN-EDITORIAL',
    sendEmail:async request=>{sends++;return {id:'mail-1',status:'DELIVERED',receipt:{idempotency_key:request.idempotency_key}};},
    collectOutcome:async()=>({source:'mailbox_followup',metrics:{response_received:1,publication_confirmed:0}})
  });
  const harness=editorialHarness();
  const engine=new GraphEngine({store:f.store,products:{EMRADAR:f.p},adapters:{OPEN_ROUTE:outreach,X:{formats:['text'],cost:'UNKNOWN',authorized:async()=>false}},harness});
  return {...f,engine,outreach,sends:()=>sends,input:{product:'EMRADAR',campaign_id:'EDITORIAL_ROUTE_TEST',signal_id:f.p.signals[0].id}};
}

test('approved REDIMIN route localizes, submits once, records outcome and learns',async()=>{
  const f=await editorialFixture();
  const candidate=await f.engine.run(f.input);
  assert.equal(candidate.status,'AWAITING_REVIEW');
  assert.equal(candidate.review.destination,'REDIMIN-EDITORIAL');
  assert.match(candidate.review.copy,/Propuesta editorial/);
  assert(candidate.nodes.some(n=>n.node==='localization'&&n.status==='PASS'));
  assert.equal(f.sends(),0);

  const submitted=await f.engine.approvePublication(candidate.review);
  assert.equal(submitted.status,'PASS',submitted.blocker);
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

test('missing email sender/executor blocks before review and is internal, not an owner-authority escalation',async()=>{
  const f=await editorialFixture();
  f.engine=new GraphEngine({store:f.store,products:{EMRADAR:f.p},adapters:{X:{formats:['text'],cost:'UNKNOWN',authorized:async()=>false}},harness:f.engine.harness});
  const candidate=await f.engine.run({...f.input,campaign_id:'NO_EXECUTOR'});
  assert.equal(candidate.review,null);
  const blocked=candidate;
  assert.equal(blocked.blocker,'APPROVED_EMAIL_SENDER_REQUIRED');
  assert.deepEqual(blocked.blocker_disposition,{scope:'INTERNAL_EXECUTION',surface_to_owner:false});
});

test('open route cannot bypass editorial work when no harness is configured',async()=>{
  const f=await editorialFixture();
  f.engine=new GraphEngine({store:f.store,products:{EMRADAR:f.p},adapters:{OPEN_ROUTE:f.outreach,X:{formats:['text'],cost:'UNKNOWN',authorized:async()=>false}}});
  const candidate=await f.engine.run({...f.input,campaign_id:'REDIMIN_EXACT_REVIEW',destination_id:'REDIMIN-EDITORIAL'});
  assert.equal(candidate.status,'BLOCKED');
  assert.equal(candidate.blocker,'HARNESS_DISPATCH_NOT_CONNECTED');
  assert.equal(candidate.review,null);
  assert.equal(candidate.cost_receipt.total,0);
  assert.equal(f.sends(),0);
});
