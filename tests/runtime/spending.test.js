import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './fixture.js';
import {SpendEnvelope,calendarMonth,zeroQuote,zeroBilling} from '../../runtime/spending.js';
import {applyAuthority} from '../../runtime/authority.js';
import {ProductIntake,signSource} from '../../runtime/intake.js';

test('owner authority does not opt a product into autonomous external execution',async()=>{
  const f=await fixture();
  const p=applyAuthority({TEST_PRODUCT:f.p}).TEST_PRODUCT;
  assert.equal(p.autonomous.enabled,false);
  assert.equal(p.release_approved,true);
  assert.equal(p.spending_envelope.currency,'AUD');
});

test('signed native gate attestation releases only after every mandatory gate passes',async()=>{
  const f=await fixture();const p=applyAuthority({TEST_PRODUCT:f.p}).TEST_PRODUCT;
  const intake=new ProductIntake({store:f.store,policies:{TEST_PRODUCT:p},sourceKeys:{TEST_PRODUCT:'test-key'}});
  const envelope={product:'TEST_PRODUCT',sequence:1,source:{signals:f.p.signals,native_gates:{evidence:'PASS',editorial:'PASS',brand:'PASS',risk:'PASS',publication:'UNKNOWN'},release_approved:true,review:{evidence:true,editorial:true}}};
  await intake.receive(envelope,signSource(envelope,'test-key'));
  assert.equal((await intake.products()).TEST_PRODUCT.release_approved,false);
  envelope.sequence=2;envelope.source.native_gates.publication='PASS';
  await intake.receive(envelope,signSource(envelope,'test-key'));
  assert.equal((await intake.products()).TEST_PRODUCT.release_approved,true);
  assert.equal((await intake.products()).TEST_PRODUCT.autonomous.enabled,false);
});

test('AUD ledger rejects unknown billing, caps concurrent holds and reconciles actual receipts',async()=>{
  const f=await fixture();const spending=new SpendEnvelope(f.store);
  const quote=(max_cost_aud,receipt_id)=>({currency:'AUD',verified:true,provider_enforced:true,max_cost_aud,receipt_id});
  await assert.rejects(spending.reserve({campaign_id:'a',quote:quote(1,'q1')}),/MONTHLY_BILLING_UNKNOWN/);
  const month=calendarMonth();const key='spend:'+month;
  await f.store.put(key,{month,actual_aud:0,unresolved:{},campaigns:{},receipts:{},historical_billing:'RECONCILED'});
  const held=await spending.reserve({campaign_id:'a',quote:quote(4,'q1'),action_id:'one'});
  await assert.rejects(spending.reserve({campaign_id:'a',quote:quote(2,'q2'),action_id:'two'}),/OWNER_EXCEPTION_CAMPAIGN_AUD_5/);
  await spending.settle(held,{currency:'AUD',actual:true,amount:3,receipt_id:'b1'});
  const second=await spending.reserve({campaign_id:'a',quote:quote(2,'q2'),action_id:'two'});
  await spending.settle(second,{currency:'AUD',actual:true,amount:2,receipt_id:'b2'});
  await assert.rejects(spending.reserve({campaign_id:'a',quote:quote(.01,'q3')}),/OWNER_EXCEPTION_CAMPAIGN_AUD_5/);
  await f.store.put(key,{month,actual_aud:49,unresolved:{},campaigns:{},receipts:{},historical_billing:'RECONCILED'});
  await assert.rejects(spending.reserve({campaign_id:'b',quote:quote(2,'q4')}),/OWNER_EXCEPTION_MONTH_AUD_50/);
});

test('unresolved actual cost blocks all later paid actions; local zero remains measurable',async()=>{
  const f=await fixture();const spending=new SpendEnvelope(f.store);const month=calendarMonth();const key='spend:'+month;
  await f.store.put(key,{month,actual_aud:0,unresolved:{},campaigns:{},receipts:{},historical_billing:'RECONCILED'});
  const held=await spending.reserve({campaign_id:'a',quote:{currency:'AUD',verified:true,provider_enforced:true,max_cost_aud:1,receipt_id:'q'},action_id:'one'});
  const outcome=await spending.settle(held,undefined);assert.equal(outcome.state,'UNKNOWN');
  await assert.rejects(spending.reserve({campaign_id:'b',quote:{currency:'AUD',verified:true,provider_enforced:true,max_cost_aud:1,receipt_id:'q2'}}),/PROVIDER_BILLING_UNKNOWN/);
  const local=await spending.reserve({campaign_id:'test',quote:zeroQuote('local')});
  const receipt=await spending.settle(local,zeroBilling('local'));assert.equal(receipt.amount,0);
});
