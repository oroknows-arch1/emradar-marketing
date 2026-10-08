// Compatibility recovery for the pre-lease engine mutex left by an interrupted
// preparation process. No campaign, provider stage, receipt or approval is erased.
export async function recoverIdlePreparationLock(store,{campaign_id='EMRADAR_2026_10_08_LAUNCH',now=Date.now()}={}){
 const pkg=await store.get('review_package:'+campaign_id);
 if(!pkg||pkg.external_actions!==0)return {status:'PRESERVED',reason:'EXISTING_UNSENT_REVIEW_REQUIRED'};
 const key='marketing:graph:lock:engine';
 const idle=await store.client.sendCommand(['OBJECT','IDLETIME',key]);
 if(idle===null)return {status:'NO_STALE_LOCK'};
 if(idle<3600)return {status:'PRESERVED',reason:'ENGINE_LOCK_RECENT',idle_seconds:idle};
 const token=await store.client.get(key);
 const receipts=await store.get('receipt_index')||[];
 if(receipts.some(r=>r.execution_status==='IN_FLIGHT'))return {status:'PRESERVED',reason:'EXTERNAL_ACTION_IN_FLIGHT'};
 for(const k of await store.keys('harness_stage:')){
  const stage=await store.get(k);
  if(stage?.status==='IN_FLIGHT'&&(!stage.at||now-Date.parse(stage.at)<3600000))return {status:'PRESERVED',reason:'PROVIDER_WORK_RECENT'};
 }
 const removed=await store.client.eval("if redis.call('get',KEYS[1])==ARGV[1] then return redis.call('del',KEYS[1]) else return 0 end",{keys:[key],arguments:[token]});
 const record={status:removed?'RECOVERED_IDLE_PREPARATION_LOCK':'PRESERVED',campaign_id,idle_seconds:idle,checked_receipts:receipts.length,at:new Date(now).toISOString(),external_actions:0};
 await store.put('preparation_lock_recovery:'+campaign_id,record);
 return record;
}
