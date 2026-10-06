import test from 'node:test';import assert from 'node:assert/strict';
import {fixture} from './fixture.js';import {billingDetail,beginCosts} from '../../runtime/campaign-costs.js';import {SpendEnvelope,calendarMonth,reconcileZeroHistory} from '../../runtime/spending.js';import {createRelayHarness} from '../../runtime/harness-relay.js';import {marketingWorkUnit} from '../../runtime/harness.js';
const bill={actual:false,provider:'openai',currency:'USD',receipt_id:'actual-request',usage:{input_tokens:1000,cached_input_tokens:200,output_tokens:100},pricing:{verified:true,receipt_id:'verified-price',currency:'USD',input_per_million:.4,cached_input_per_million:.1,output_per_million:1.6,fx:{verified:true,receipt_id:'verified-fx',aud_per_unit:1.5}}};
test('actual token usage plus verified pricing/FX settles as CALCULATED, including caching and checking call',async()=>{
 const f=await fixture();await beginCosts(f.store,{run_id:'work',input:f.input});
 const month=calendarMonth();const l={month,actual_aud:0,unresolved:{},campaigns:{},receipts:{},historical_billing:'UNKNOWN'};
 assert.equal(await reconcileZeroHistory(f.store,l),true);
 const spend=new SpendEnvelope(f.store),quote={currency:'AUD',verified:true,provider_enforced:true,max_cost_aud:.1,receipt_id:'quote'};
 const r=await spend.reserve({campaign_id:f.input.campaign_id,quote,run_id:'work',action_id:'work:call'});
 const billing={receipt_id:'both-requests',calls:[bill,bill]},expected=2*(800*.4+200*.1+100*1.6)/1e6*1.5;
 assert.equal(billingDetail(billing).state,'CALCULATED');assert.equal((await spend.settle(r,billing)).amount,expected);assert.equal((await f.store.get('spend:'+month)).actual_aud,expected);
});
test('unknown previous billing and missing FX are never relabelled zero or reconciled',async()=>{
 const f=await fixture(),month=calendarMonth();await f.store.put('campaign_cost:unknown',{timestamp:new Date().toISOString(),calls:[{state:'UNKNOWN',amount_aud:'UNKNOWN'}]});
 assert.equal(await reconcileZeroHistory(f.store,{month,actual_aud:0,unresolved:{}}),false);
 const bad=structuredClone(bill);delete bad.pricing.fx;assert.equal(billingDetail({calls:[bill,bad]}).state,'UNKNOWN');
});
test('durable ambiguous generation is blocked instead of repeating a paid call',async()=>{
 const f=await fixture();let paid=0;
 const harness=createRelayHarness({store:f.store,env:{EMRADAR_EMAIL_RELAY_URL:'https://orok-studios-api.onrender.com',EMRADAR_EMAIL_RELAY_TOKEN:'test'},fetcher:async url=>{
  if(url.endsWith('/registry'))return {ok:true,json:async()=>({providers:[{providerId:'openai',modelId:'terra',approved:true,connected:true}]})};paid++;throw Error('CONNECTION_LOST');
 }});
 const context={input_hash:'same',cost_reservation:{id:'saved-reservation'}};
 await assert.rejects(harness.work(marketingWorkUnit('editorial_intelligence','EMRADAR'),context),/CONNECTION_LOST/);
 await assert.rejects(harness.work(marketingWorkUnit('editorial_intelligence','EMRADAR'),context),/AMBIGUOUS/);assert.equal(paid,1);
});
test('persisted AUD owner authority enables bounded writing; missing authority and excessive quote still block',async()=>{
 const f=await fixture();await beginCosts(f.store,{run_id:'aud-work',input:{...f.input,product:'EMRADAR'}});
 const {GraphEngine}=await import('../../runtime/graph.js');let dispatched=0,amount=.1;
 const engine=new GraphEngine({store:f.store,products:{},adapters:{},harness:{quote:async()=>({currency:'AUD',verified:true,provider_enforced:true,max_cost_aud:amount,receipt_id:'approved-quote'}),work:async()=>{dispatched++;return {result:{},proof:{billing:{actual:true,currency:'AUD',amount:.03,receipt_id:'request-bill'}},decision:{lane:'standard'},attempts:1};}}});
 const c={input:{product:'EMRADAR',campaign_id:'AUD_TEST'},run_id:'aud-work',product:{budget:{creation_approved:false},provider_authority:{automatic_connected_approved_only:true},spending_envelope:{currency:'AUD',campaign_limit:5,calendar_month_limit:50}}};
 await engine.modelWork(c,'editorial_intelligence',{},'creation_approved');assert.equal(dispatched,1);assert.equal(c.node_work.authority,'PERSISTED_OWNER_AUD_ENVELOPE');
 amount=.3;await assert.rejects(engine.modelWork(c,'editorial_intelligence',{},'creation_approved'),/WORKER_DAILY_BOUND/);assert.equal(dispatched,1);
 delete c.product.provider_authority;await assert.rejects(engine.modelWork(c,'editorial_intelligence',{},'creation_approved'),/WORKER_COST_APPROVAL_REQUIRED/);assert.equal(dispatched,1);
});
