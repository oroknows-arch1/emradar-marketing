import test from 'node:test';
import assert from 'node:assert/strict';
import {billingAudit} from '../../runtime/billing-audit.js';
const at=new Date('2026-10-08T01:00:00Z');
test('audit identifies exact unknown provider record without assuming a reservation is a charge',async()=>{
 const data={'spend:2026-10':{actual_aud:1,historical_billing:'RECONCILED',unresolved:{'old:publish':{campaign_id:'OLD',run_id:'old',category:'distribution',status:'UNKNOWN',max_cost_aud:'UNKNOWN',quote_receipt:'UNKNOWN',standing_authority:true}}},'campaign_cost:old':{timestamp:at.toISOString(),calls:[{action_id:'old:publish',provider:'X',state:'UNKNOWN',amount_aud:'UNKNOWN',reason:'BILLING_OR_VERIFIED_PRICING_AND_AUD_CONVERSION_UNAVAILABLE'}]},receipt_index:[{id:'receipt',run_id:'old'}],'receipt:receipt':{run_id:'old',platform:'X',execution_status:'PUBLISHED',external_id:'post',api_cost_usd:'UNKNOWN',access_token:'NEVER_EXPOSE'}};
 const store={get:async k=>data[k]||null,put:()=>{throw Error('NO_WRITES');}};
 const result=await billingAudit(store,{at});assert.equal(result.records[0].provider,'X');assert.equal(result.records[0].action_id,'old:publish');assert.equal(result.records[0].amount_aud,'UNKNOWN');assert.equal(result.records[0].receipts[0].external_id,'post');assert(!JSON.stringify(result).includes('NEVER_EXPOSE'));assert.equal(result.paid_calls,0);assert.equal(result.writes,0);
});
test('audit distinguishes saved zero, nonzero and unverifiable provider receipts without altering state',async()=>{
 const unresolved=Object.fromEntries(['zero','nonzero','unknown'].map(id=>[id,{run_id:id,status:'UNKNOWN',max_cost_aud:0.25}]));
 const data={'spend:2026-10':{actual_aud:0,unresolved},receipt_index:[]};
 for(const [id,billing] of [['zero',{provider:'openai',actual:true,currency:'AUD',amount:0,receipt_id:'z'}],['nonzero',{provider:'openai',actual:true,currency:'AUD',amount:0.03,receipt_id:'n'}],['unknown',{provider:'openai',currency:'USD',amount:0.01,receipt_id:'u',token:'SECRET'}]])data['harness_stage:'+id+':execute']={status:'COMPLETE',value:{billing}};
 const result=await billingAudit({get:async k=>data[k]||null},{at});assert.deepEqual(result.records.map(r=>r.stages[0].classification.state),['ZERO','ACTUAL','UNKNOWN']);assert.equal(result.records[1].stages[0].classification.amount_aud,0.03);assert(!JSON.stringify(result).includes('SECRET'));assert.equal(result.unresolved_count,3);
});
