const now=()=>new Date().toISOString();
const categories=['research_search_api','generation','media_assets','distribution','observation','other_variable'];
const valid=n=>Number.isFinite(n)&&n>=0;
export const costKey=id=>'campaign_cost:'+id;

export async function beginCosts(store,{run_id,input,source,kind='CAMPAIGN'}){
  const receipt={receipt_id:run_id,location:costKey(run_id),run_id,campaign_id:input.campaign_id,product:input.product,kind,timestamp:now(),source_scan:source?.source_snapshot||'UNKNOWN',formation_id:source?.id||input.signal_id||'UNKNOWN',source_revision:source?.revision||'UNKNOWN',calls:[],outcome:'RUNNING',currency:'AUD',total:'UNKNOWN',cost_state:'UNKNOWN',reason:'RUN_IN_PROGRESS'};
  await store.put(costKey(run_id),receipt);
  const key='campaign_cost_index:'+input.campaign_id,index=await store.get(key)||[];
  if(!index.includes(run_id)){index.push(run_id);await store.put(key,index);}
  return receipt;
}

// Call intent is durable before dispatch. An interrupted or unbilled call stays
// UNKNOWN even if the graph fails before it can construct a delivery receipt.
export async function costCall(store,run_id,call){
  if(!run_id)return;
  const r=await store.get(costKey(run_id));if(!r)throw new Error('CAMPAIGN_COST_RECEIPT_MISSING');
  const old=r.calls.find(x=>x.action_id===call.action_id);
  if(old)Object.assign(old,call);else r.calls.push({timestamp:now(),...call});
  await store.put(costKey(run_id),r);
}

export function billingDetail(billing){
  const detail={provider:billing?.provider||'UNKNOWN',service:billing?.service||billing?.model||'UNKNOWN',model:billing?.model||'UNKNOWN',request_id:billing?.request_id||'UNKNOWN',receipt_id:billing?.receipt_id||'UNKNOWN',usage:billing?.usage||'UNKNOWN',currency:billing?.currency||'UNKNOWN',provider_reported_amount:valid(billing?.amount)?billing.amount:'UNKNOWN',calls:billing?.calls?.map(billingDetail)||[]};
  if(billing?.actual===true&&valid(billing.amount)&&billing.currency==='AUD'&&billing.receipt_id)return {...detail,amount_aud:billing.amount,state:billing.amount===0?'ZERO':'ACTUAL',reason:'PROVIDER_BILLING_RECEIPT'};
  // Calculation is permitted only with attested pricing and an attested AUD
  // conversion, never with an estimated reservation or an assumed exchange rate.
  const p=billing?.pricing,u=billing?.usage;
  if(p?.verified===true&&p.receipt_id&&p.currency&&valid(p.input_per_million)&&valid(p.output_per_million)&&valid(u?.input_tokens)&&valid(u?.output_tokens)){
    const amount=(u.input_tokens*p.input_per_million+u.output_tokens*p.output_per_million)/1e6;
    const fx=p.currency==='AUD'?1:p.fx?.verified===true&&p.fx.receipt_id&&valid(p.fx.aud_per_unit)?p.fx.aud_per_unit:null;
    if(fx!==null)return {...detail,currency:p.currency,calculated_amount:amount,pricing:p,amount_aud:amount*fx,state:amount===0?'ZERO':'CALCULATED',reason:'VERIFIED_TOKEN_PRICING'};
  }
  return {...detail,amount_aud:'UNKNOWN',state:'UNKNOWN',reason:!billing?'PROVIDER_BILLING_NOT_RETURNED':'BILLING_OR_VERIFIED_PRICING_AND_AUD_CONVERSION_UNAVAILABLE'};
}

export async function finishCosts(store,run_id,{outcome,blocker=null,proposal_id=null,source}={}){
  const r=await store.get(costKey(run_id));if(!r)throw new Error('CAMPAIGN_COST_RECEIPT_MISSING');
  if(source){r.source_scan=source.source_snapshot||'UNKNOWN';r.formation_id=source.id;r.source_revision=source.revision;}
  r.outcome=outcome;r.blocker=blocker;r.proposal_id=proposal_id;r.updated_at=now();
  r.categories=Object.fromEntries(categories.map(category=>{
    const calls=r.calls.filter(c=>c.category===category),unknown=calls.some(c=>!valid(c.amount_aud)||c.state==='UNKNOWN');
    const amount=calls.reduce((s,c)=>s+(valid(c.amount_aud)?c.amount_aud:0),0);
    return [category,{amount_aud:unknown?'UNKNOWN':amount,state:unknown?'UNKNOWN':amount===0?'ZERO':calls.some(c=>c.state==='CALCULATED')?'CALCULATED':'ACTUAL',reason:calls.length?'SEE_CALL_RECEIPTS':'NO_PROVIDER_CALL_DISPATCHED_IN_THIS_CATEGORY'}];
  }));
  r.known_subtotal_aud=r.calls.reduce((s,c)=>s+(valid(c.amount_aud)?c.amount_aud:0),0);
  r.cost_state=r.calls.some(c=>c.state==='UNKNOWN'||!valid(c.amount_aud))?'UNKNOWN':r.known_subtotal_aud===0?'ZERO':r.calls.some(c=>c.state==='CALCULATED')?'CALCULATED':'ACTUAL';
  r.total=r.cost_state==='UNKNOWN'?'UNKNOWN':r.known_subtotal_aud;
  r.reason=r.cost_state==='UNKNOWN'?'ONE_OR_MORE_CALL_COSTS_UNDETERMINED':'ALL_ATTRIBUTABLE_CALLS_ACCOUNTED';
  r.scope='Variable calls dispatched by this graph run; pre-existing source research, fixed hosting and this maintenance session are not attributed to this run.';
  await store.put(costKey(run_id),r);return r;
}
