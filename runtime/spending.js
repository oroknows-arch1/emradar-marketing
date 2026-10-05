import crypto from 'node:crypto';
import authority from '../config/owner-authority.json' with {type:'json'};
import {costCall,billingDetail} from './campaign-costs.js';
const valid=n=>Number.isFinite(n)&&n>=0;
export const calendarMonth=(at=new Date())=>new Intl.DateTimeFormat('en-CA',{timeZone:authority.spending.timezone,year:'numeric',month:'2-digit'}).format(at);
// Called within the existing exclusive engine lock. One envelope spans all products,
// workers, attempts, publication and observation. Never infer billing from ad spend.
export class SpendEnvelope {
  constructor(store){this.store=store;}
  async reserve({campaign_id,quote,action_id,run_id,category='other_variable',at=new Date()}){
    if(!quote||quote.currency!=='AUD'||quote.verified!==true||!quote.provider_enforced||!valid(quote.max_cost_aud)||!quote.receipt_id)throw new Error('ACTUAL_COST_BOUND_UNKNOWN');
    const month=calendarMonth(at);const key='spend:'+month;
    const ledger=await this.store.get(key)||{month,actual_aud:0,unresolved:{},campaigns:{},receipts:{},historical_billing:'UNKNOWN'};
    if(quote.max_cost_aud>0&&ledger.historical_billing!=='RECONCILED')throw new Error('MONTHLY_BILLING_UNKNOWN');
    if(quote.max_cost_aud>0&&Object.values(ledger.unresolved).some(x=>x.status==='UNKNOWN'))throw new Error('PROVIDER_BILLING_UNKNOWN');
    const pending=Object.values(ledger.unresolved);const c=ledger.campaigns[campaign_id]||0;
    if(c+pending.filter(x=>x.campaign_id===campaign_id).reduce((s,x)=>s+x.max_cost_aud,0)+quote.max_cost_aud>authority.spending.campaign_limit)throw new Error('OWNER_EXCEPTION_CAMPAIGN_AUD_5');
    if(ledger.actual_aud+pending.reduce((s,x)=>s+x.max_cost_aud,0)+quote.max_cost_aud>authority.spending.calendar_month_limit)throw new Error('OWNER_EXCEPTION_MONTH_AUD_50');
    const id=action_id||crypto.randomUUID();if(ledger.receipts[id]||ledger.unresolved[id])throw new Error('COST_ACTION_ALREADY_RESERVED');
    ledger.unresolved[id]={campaign_id,run_id,category,max_cost_aud:quote.max_cost_aud,quote_receipt:quote.receipt_id,status:'RESERVED'};await this.store.put(key,ledger);
    await costCall(this.store,run_id,{action_id:id,category,provider:quote.provider||'UNKNOWN',model:quote.model||'UNKNOWN',service:quote.service||'UNKNOWN',quote_receipt:quote.receipt_id,reserved_max_aud:quote.max_cost_aud,amount_aud:'UNKNOWN',state:'UNKNOWN',reason:'CALL_RESERVED_NO_BILLING_RECEIPT'});
    return {id,key,month,campaign_id,run_id,category,max_cost_aud:quote.max_cost_aud};
  }
  async settle(reservation,billing){
    const l=await this.store.get(reservation.key);const held=l.unresolved[reservation.id];
    if(!held)throw new Error('COST_RESERVATION_MISSING');
    const detail=billingDetail(billing);
    await costCall(this.store,reservation.run_id,{action_id:reservation.id,...detail});
    if(billing?.currency!=='AUD'||billing.actual!==true||!valid(billing.amount)||!billing.receipt_id){held.status='UNKNOWN';await this.store.put(reservation.key,l);return {state:'UNKNOWN',amount:'UNKNOWN',reservation};}
    if(billing.amount>held.max_cost_aud){held.status='UNKNOWN';await this.store.put(reservation.key,l);throw new Error('PROVIDER_ENFORCED_COST_BOUND_BREACH');}
    l.actual_aud+=billing.amount;l.campaigns[held.campaign_id]=(l.campaigns[held.campaign_id]||0)+billing.amount;
    const record={...billing,campaign_id:held.campaign_id,action_id:reservation.id,quote_receipt:held.quote_receipt,recorded_at:new Date().toISOString()};l.receipts[reservation.id]=record;delete l.unresolved[reservation.id];await this.store.put(reservation.key,l);return record;
  }
}
export const zeroQuote=id=>({currency:'AUD',verified:true,provider_enforced:true,max_cost_aud:0,receipt_id:id});
export const zeroBilling=id=>({currency:'AUD',actual:true,amount:0,receipt_id:id,provider:'LOCAL'});
