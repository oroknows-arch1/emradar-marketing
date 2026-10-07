import crypto from 'node:crypto';
import authority from '../config/owner-authority.json' with {type:'json'};
import {costCall,billingDetail} from './campaign-costs.js';
const valid=n=>Number.isFinite(n)&&n>=0;
export const calendarMonth=(at=new Date())=>new Intl.DateTimeFormat('en-CA',{timeZone:authority.spending.timezone,year:'numeric',month:'2-digit'}).format(at);
// Bootstrap only a proven zero-spend history. Unknown, ambiguous or nonzero
// historical calls remain blocked for reconciliation; never assume a zero balance.
export async function reconcileZeroHistory(store,ledger){
  if(!store.keys||ledger.actual_aud!==0||Object.keys(ledger.unresolved||{}).length)return false;
  const keys=await store.keys('campaign_cost:'),evidence=[];
  for(const key of keys){const r=await store.get(key);if(calendarMonth(new Date(r.timestamp))!==ledger.month)continue;
    if(!Array.isArray(r.calls)||r.calls.some(c=>c.amount_aud!==0||c.state!=='ZERO'))return false;
    if(r.calls.length&&r.total!==0)return false;
    evidence.push({key,calls:r.calls.map(c=>c.action_id),state:r.cost_state});
  }
  if(!evidence.length)return false;
  const receipts=await store.get('receipt_index')||[];
  for(const entry of receipts){const r=await store.get('receipt:'+entry.id)||entry;if(!r.timestamp||calendarMonth(new Date(r.timestamp))!==ledger.month)continue;
    if(['IN_FLIGHT','AMBIGUOUS'].includes(r.execution_status)||r.api_cost_usd!==0||(r.worker_costs||[]).length)return false;
    evidence.push({receipt:r.id,status:r.execution_status,api_cost_usd:r.api_cost_usd});
  }
  ledger.historical_billing='RECONCILED';ledger.reconciliation={method:'PERSISTED_ZERO_CALL_AND_EXECUTION_RECEIPTS',at:new Date().toISOString(),evidence,hash:crypto.createHash('sha256').update(JSON.stringify(evidence)).digest('hex')};
  await store.put('spend:'+ledger.month,ledger);return true;
}
// Called within the existing exclusive engine lock. One envelope spans all products,
// workers, attempts, publication and observation. Never infer billing from ad spend.
export class SpendEnvelope {
  constructor(store){this.store=store;}
  async reserve(args){return this.store.locked('spend_envelope',()=>this.reserveLocked(args));}
  async reserveLocked({campaign_id,quote,action_id,run_id,category='other_variable',at=new Date(),standing_authority=false}){
    if(standing_authority){
      const month=calendarMonth(at),key='spend:'+month;
      const ledger=await this.store.get(key)||{month,actual_aud:0,unresolved:{},campaigns:{},receipts:{},historical_billing:'UNKNOWN'};
      const known=quote?.currency==='AUD'&&valid(quote.max_cost_aud)?quote.max_cost_aud:null;
      const pending=Object.values(ledger.unresolved);
      const amount=x=>valid(x.max_cost_aud)?x.max_cost_aud:0;
      if((ledger.campaigns[campaign_id]||0)+pending.filter(x=>x.campaign_id===campaign_id).reduce((s,x)=>s+amount(x),0)+(known??0)>authority.spending.campaign_limit)throw new Error('OWNER_EXCEPTION_CAMPAIGN_AUD_5');
      if(ledger.actual_aud+pending.reduce((s,x)=>s+amount(x),0)+(known??0)>authority.spending.calendar_month_limit)throw new Error('OWNER_EXCEPTION_MONTH_AUD_50');
      const id=action_id||crypto.randomUUID();if(ledger.receipts[id]||ledger.unresolved[id])throw new Error('COST_ACTION_ALREADY_RESERVED');
      ledger.unresolved[id]={campaign_id,run_id,category,max_cost_aud:known??'UNKNOWN',quote_receipt:quote?.receipt_id||'UNKNOWN',status:'RESERVED',standing_authority:true};await this.store.put(key,ledger);
      await costCall(this.store,run_id,{action_id:id,category,provider:quote?.provider||'X',reserved_max_aud:known??'UNKNOWN',amount_aud:'UNKNOWN',state:'UNKNOWN',reason:'STANDING_OWNER_AUTHORITY_BILLING_PENDING'});
      return {id,key,month,campaign_id,run_id,category,max_cost_aud:known??'UNKNOWN',quote};
    }
    if(!quote||quote.currency!=='AUD'||quote.verified!==true||!quote.provider_enforced||!valid(quote.max_cost_aud)||!quote.receipt_id)throw new Error('ACTUAL_COST_BOUND_UNKNOWN');
    const month=calendarMonth(at);const key='spend:'+month;
    const ledger=await this.store.get(key)||{month,actual_aud:0,unresolved:{},campaigns:{},receipts:{},historical_billing:'UNKNOWN'};
    if(quote.max_cost_aud>0&&ledger.historical_billing!=='RECONCILED'&&!await reconcileZeroHistory(this.store,ledger))throw new Error('MONTHLY_BILLING_UNKNOWN');
    if(quote.max_cost_aud>0&&Object.values(ledger.unresolved).some(x=>x.status==='UNKNOWN'))throw new Error('PROVIDER_BILLING_UNKNOWN');
    const pending=Object.values(ledger.unresolved);const c=ledger.campaigns[campaign_id]||0;
    if(c+pending.filter(x=>x.campaign_id===campaign_id).reduce((s,x)=>s+x.max_cost_aud,0)+quote.max_cost_aud>authority.spending.campaign_limit)throw new Error('OWNER_EXCEPTION_CAMPAIGN_AUD_5');
    if(ledger.actual_aud+pending.reduce((s,x)=>s+x.max_cost_aud,0)+quote.max_cost_aud>authority.spending.calendar_month_limit)throw new Error('OWNER_EXCEPTION_MONTH_AUD_50');
    const id=action_id||crypto.randomUUID();if(ledger.receipts[id]||ledger.unresolved[id])throw new Error('COST_ACTION_ALREADY_RESERVED');
    ledger.unresolved[id]={campaign_id,run_id,category,max_cost_aud:quote.max_cost_aud,quote_receipt:quote.receipt_id,status:'RESERVED'};await this.store.put(key,ledger);
    await costCall(this.store,run_id,{action_id:id,category,provider:quote.provider||'UNKNOWN',model:quote.model||'UNKNOWN',service:quote.service||'UNKNOWN',quote_receipt:quote.receipt_id,reserved_max_aud:quote.max_cost_aud,amount_aud:'UNKNOWN',state:'UNKNOWN',reason:'CALL_RESERVED_NO_BILLING_RECEIPT'});
    return {id,key,month,campaign_id,run_id,category,max_cost_aud:quote.max_cost_aud,quote};
  }
  async settle(reservation,billing){return this.store.locked('spend_envelope',()=>this.settleLocked(reservation,billing));}
  async settleLocked(reservation,billing){
    const l=await this.store.get(reservation.key);const held=l.unresolved[reservation.id];
    if(!held)throw new Error('COST_RESERVATION_MISSING');
    const detail=billingDetail(billing);
    await costCall(this.store,reservation.run_id,{action_id:reservation.id,...detail});
    if(!valid(detail.amount_aud)||!['ZERO','ACTUAL','CALCULATED'].includes(detail.state)||!billing?.receipt_id){held.status='UNKNOWN';await this.store.put(reservation.key,l);return {state:'UNKNOWN',amount:'UNKNOWN',reservation};}
    if(valid(held.max_cost_aud)&&detail.amount_aud>held.max_cost_aud){held.status='UNKNOWN';await this.store.put(reservation.key,l);throw new Error('PROVIDER_ENFORCED_COST_BOUND_BREACH');}
    l.actual_aud+=detail.amount_aud;l.campaigns[held.campaign_id]=(l.campaigns[held.campaign_id]||0)+detail.amount_aud;
    const record={...billing,currency:'AUD',amount:detail.amount_aud,cost_state:detail.state,campaign_id:held.campaign_id,action_id:reservation.id,quote_receipt:held.quote_receipt,recorded_at:new Date().toISOString()};l.receipts[reservation.id]=record;delete l.unresolved[reservation.id];await this.store.put(reservation.key,l);return record;
  }
}
export const zeroQuote=id=>({currency:'AUD',verified:true,provider_enforced:true,max_cost_aud:0,receipt_id:id});
export const zeroBilling=id=>({currency:'AUD',actual:true,amount:0,receipt_id:id,provider:'LOCAL'});
