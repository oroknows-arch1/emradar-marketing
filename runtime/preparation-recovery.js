import crypto from 'node:crypto';
const fingerprint=value=>crypto.createHash('sha256').update(value).digest('hex');
const campaign='EMRADAR_2026_10_08_LAUNCH';
// Recovery observes ownership stability and durable work, not Redis access-idle
// time alone: failed lock acquisitions/readers can make a dead mutex look recent.
// Provider intents, receipts, approvals and campaign artifacts are never cleared.
export async function recoverIdlePreparationLock(store,{campaign_id=campaign,now=Date.now()}={}){
 const markerKey='preparation_lock_recovery:'+campaign_id;
 const pkg=await store.get('review_package:'+campaign_id);
 if(!pkg||pkg.external_actions!==0)return {status:'PRESERVED',reason:'EXISTING_UNSENT_REVIEW_REQUIRED'};
 const key='marketing:graph:lock:engine';
 const idle=await store.client.sendCommand(['OBJECT','IDLETIME',key]);
 const token=await store.client.get(key);
 if(!token)return {status:'NO_STALE_LOCK'};
 const token_hash=fingerprint(token),prior=await store.get(markerKey);
 const first_observed_at=prior?.token_hash===token_hash?prior.first_observed_at:new Date(now).toISOString();
 const stable_seconds=Math.max(0,(now-Date.parse(first_observed_at))/1000);
 const ids=await store.get('campaign_cost_index:'+campaign_id)||[];
 const costs=await Promise.all(ids.map(id=>store.get('campaign_cost:'+id)));
 const runs=await Promise.all(ids.map(id=>store.get('run:'+id)));
 const receipts=await store.get('receipt_index')||[];
 const pending_runs=costs.filter(c=>c?.outcome==='RUNNING').map(c=>({run_id:c.run_id,started_at:c.timestamp,last_call_at:c.calls?.at(-1)?.timestamp||c.timestamp,provider_calls:c.calls?.length||0}));
 const recovery_snapshot={campaign_status:pkg.status,review_updated_at:pkg.updated_at,review_proposals:(pkg.proposals||[]).map(p=>({proposal_id:p.proposal_id,destination:p.destination,status:p.status})),runs: runs.filter(Boolean).slice(-5).map(r=>({run_id:r.run_id,status:r.status,blocker:r.blocker})),pending_runs};
 const record={status:'PRESERVED',campaign_id,token_hash,first_observed_at,idle_seconds:idle,stable_seconds,recovery_snapshot,at:new Date(now).toISOString(),external_actions:0};
 const preserve=async reason=>{record.reason=reason;await store.put(markerKey,record);return record;};
 // A tracked live process owns its heartbeat. Legacy tokens must remain unchanged
 // across observations for at least three minutes (longer than a provider request).
 const owner=await store.get('lock_owner:engine');
 if(owner?.token_hash===token_hash&&now-Date.parse(owner.heartbeat_at)<180000)return preserve('ACTIVE_ENGINE_HEARTBEAT');
 if(!(idle>=3600||stable_seconds>=180))return preserve('OBSERVING_LEGACY_LOCK_OWNER');
 const recent=r=>!r.timestamp||now-Date.parse(r.timestamp)<3600000;
 if(receipts.some(r=>r.execution_status==='IN_FLIGHT'&&recent(r)))return preserve('EXTERNAL_ACTION_RECENT');
 // All incomplete provider stages and expense records retain their exact state.
 // A recent intention is active; an old ambiguous intention remains unretryable
 // through the existing harness stage/idempotency guard after mutex recovery.
 for(const k of await store.keys('harness_stage:')){
  const stage=await store.get(k);
  if(stage?.status==='IN_FLIGHT'&&(!stage.at||now-Date.parse(stage.at)<3600000))return preserve('PROVIDER_WORK_RECENT');
 }
 for(const k of await store.keys('campaign_cost:')){
  const cost=await store.get(k);
  if(cost?.outcome==='RUNNING'&&[cost.timestamp,...(cost.calls||[]).map(c=>c.timestamp)].some(t=>!t||now-Date.parse(t)<3600000))return preserve('RUN_ACTIVITY_RECENT');
 }
 const removed=await store.client.eval("if redis.call('get',KEYS[1])==ARGV[1] then return redis.call('del',KEYS[1]) else return 0 end",{keys:[key],arguments:[token]});
 record.status=removed?'RECOVERED_IDLE_PREPARATION_LOCK':'PRESERVED';record.reason=removed?'UNCHANGED_OWNER_WITH_NO_RECENT_WORK':'ENGINE_OWNER_CHANGED';
 await store.put(markerKey,record);return record;
}
