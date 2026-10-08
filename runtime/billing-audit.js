import {calendarMonth} from './spending.js';
import {billingDetail} from './campaign-costs.js';
// Read-only accounting evidence. No credentials, email copy or raw responses.
const clean=(b,depth=0)=>{
 if(!b||depth>3)return null;
 const out={};
 for(const k of ['provider','service','model','request_id','receipt_id','currency','amount','actual'])if(b[k]!==undefined)out[k]=b[k];
 if(b.usage)out.usage=Object.fromEntries(['input_tokens','output_tokens','cached_input_tokens'].filter(k=>b.usage[k]!==undefined).map(k=>[k,b.usage[k]]));
 if(b.pricing){out.pricing=Object.fromEntries(['verified','receipt_id','currency','input_per_million','output_per_million','cached_input_per_million'].filter(k=>b.pricing[k]!==undefined).map(k=>[k,b.pricing[k]]));if(b.pricing.fx)out.pricing.fx=Object.fromEntries(['verified','receipt_id','aud_per_unit'].filter(k=>b.pricing.fx[k]!==undefined).map(k=>[k,b.pricing.fx[k]]));}
 if(Array.isArray(b.calls))out.calls=b.calls.slice(0,8).map(c=>clean(c,depth+1));
 return out;
};
export async function billingAudit(store,{at=new Date()}={}){
 const month=calendarMonth(at),key='spend:'+month,ledger=await store.get(key);
 if(!ledger)return {month,ledger_key:key,status:'NO_LEDGER',records:[],paid_calls:0,writes:0};
 const entries=Object.entries(ledger.unresolved||{}).filter(([,r])=>r.status==='UNKNOWN');
 const index=await store.get('receipt_index')||[],records=[];
 for(const [id,r] of entries.slice(0,20)){
  const costKey='campaign_cost:'+r.run_id,cost=await store.get(costKey),call=cost?.calls?.find(c=>c.action_id===id),stages=[],receipts=[];
  for(const op of ['execute','verify']){const stageKey='harness_stage:'+id+':'+op,s=await store.get(stageKey);if(s){const billing=clean(s.value?.billing||s.billing);stages.push({key:stageKey,status:s.status,reason:s.reason||null,billing,classification:billingDetail(billing)});}}
  for(const entry of index.filter(e=>e.run_id===r.run_id).slice(0,4)){const receipt=await store.get('receipt:'+entry.id)||entry;receipts.push({key:'receipt:'+entry.id,run_id:receipt.run_id,platform:receipt.platform,execution_status:receipt.execution_status,external_id:receipt.external_id||null,timestamp:receipt.timestamp,error:receipt.error||null,api_cost_usd:receipt.api_cost_usd,provider_cost:clean(receipt.provider_cost),billing:clean(receipt.billing)});}
  records.push({action_id:id,ledger_record_key:key+'.unresolved['+id+']',campaign_id:r.campaign_id,run_id:r.run_id,category:r.category,status:r.status,max_cost_aud:r.max_cost_aud,quote_receipt:r.quote_receipt,standing_authority:r.standing_authority===true,cost_record_key:costKey,provider:call?.provider||'UNKNOWN',service:call?.service||'UNKNOWN',model:call?.model||'UNKNOWN',request_id:call?.request_id||'UNKNOWN',receipt_id:call?.receipt_id||'UNKNOWN',timestamp:call?.timestamp||cost?.timestamp||null,cost_state:call?.state||'UNKNOWN',amount_aud:call?.amount_aud??'UNKNOWN',reason:call?.reason||'NO_MATCHING_CALL_RECEIPT',usage:clean(call)?.usage||null,provider_call_receipts:(call?.calls||[]).slice(0,8).map(c=>({provider:c.provider,service:c.service,model:c.model,request_id:c.request_id,receipt_id:c.receipt_id,state:c.state,amount_aud:c.amount_aud,reason:c.reason,usage:clean(c)?.usage||null})),stages,receipts});
 }
 return {month,ledger_key:key,status:entries.length?'UNRESOLVED_PROVIDER_BILLING':'NO_UNKNOWN_RECORDS',actual_aud:ledger.actual_aud,historical_billing:ledger.historical_billing,unresolved_count:entries.length,truncated:entries.length>records.length,records,paid_calls:0,writes:0};
}
