import fs from 'node:fs/promises';
import crypto from 'node:crypto';

export const digest=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const graph=JSON.parse(await fs.readFile(new URL('../graph/marketing-graph-v1.json',import.meta.url),'utf8'));
const now=()=>new Date().toISOString();
const fail=(reason)=>{throw new Error(reason);};
const initial=()=>({version:0,routes:{},platforms:{},processed:{},history:[]});
const keyOf=(p,s,d,f)=>[p,s,d,f].map(encodeURIComponent).join(':');
const score=(state,key)=>{const r=state.routes[key];return r?Math.max(-1,Math.min(1,(r.successes-r.failures)/(r.successes+r.failures+2)+(r.measurement_adjustment||0))):0;};
function approved(p,s) {
  if(!p || !s || !p.product_identity || !p.release_approved || !p.review?.evidence || !p.review?.brand || !p.review?.editorial || !p.review?.risk)fail('SOURCE_REVIEW_OR_RELEASE_REQUIRED');
  if(!p.uncertainty_state_model.includes(s.state)||!s.id||!s.revision||!s.evidence?.length||!s.approved_copy?.length)fail('SOURCE_CONTRACT_INCOMPLETE');
  if(!s.approved_copy.every(c=>typeof c==='string'&&c.includes(s.state)))fail('STATE_NOT_VISIBLE_IN_APPROVED_COPY');
}

export class GraphEngine {
  constructor({store,products,adapters,maxSteps=40}) {this.store=store;this.products=products;this.adapters=adapters;this.maxSteps=maxSteps;}
  async tick() {
    // Bounded autonomous scheduler node: one product revision, then at most one
    // due performance observation. State is persistent across restarts.
    const plan=await this.store.locked('engine',async()=>{
      const index=await this.store.get('receipt_index')||[];
      const seen=await this.store.get('scheduler_seen')||{};
      let selected=null;
      for(const [product,p] of Object.entries(this.products)) {
        if(!p.autonomous?.enabled)continue;
        for(const signal of p.signals||[]) {
          const key=digest([product,signal.id,signal.revision]);const fingerprint=digest(p);
          const old=seen[key];
          if(old?.fingerprint===fingerprint&&!(old.retryable&&old.attempts<3&&Date.parse(old.next_due)<=Date.now()))continue;
          selected={product,signal_id:signal.id,campaign_id:'AUTO_'+key.slice(0,16)};
          seen[key]={fingerprint,at:now(),attempts:(old?.attempts||0)+1,retryable:false};break;
        }
        if(selected)break;
      }
      await this.store.put('scheduler_seen',seen);
      const due=index.find(r=>r.execution_status==='PUBLISHED'&&this.products[r.product]?.autonomous?.enabled&&Date.now()-Date.parse(r.last_collection||r.timestamp)>=300000);
      if(due){due.last_collection=now();await this.store.put('receipt_index',index);}
      const trace={node:'autonomous_scheduler',status:'PASS',input:'trusted_product_revisions_and_receipt_index',output:{next_input:selected,feedback_receipt:due?.id||null},at:now()};
      await this.store.put('scheduler_latest',trace);return trace;
    });
    const result=plan.output.next_input?await this.run(plan.output.next_input):null;
    if(result)await this.store.locked('engine',async()=>{const seen=await this.store.get('scheduler_seen');const input=plan.output.next_input;const key=digest([input.product,input.signal_id,result.receipt?.signal_revision]);if(seen[key]){seen[key].retryable=['FAILED','RATE_LIMITED'].includes(result.receipt?.execution_status);seen[key].next_due=result.receipt?.retry_at||new Date(Date.now()+60000).toISOString();seen[key].last_run=result.run_id;await this.store.put('scheduler_seen',seen);}});
    const feedback=plan.output.feedback_receipt?await this.feedback(plan.output.feedback_receipt):null;
    return {scheduler:plan,result,feedback};
  }
  async run(input) {
    if(!input.product||!input.campaign_id)fail('PRODUCT_AND_CAMPAIGN_REQUIRED');
    return this.store.locked('engine',async()=>{
      const c={input,trace:[],state:await this.store.get('learning')||initial(),run_id:crypto.randomUUID(),status:'RUNNING'};
      c.learning_before=structuredClone(c.state);let id='ingest';let count=0;
      while(id) {
        if(++count>this.maxSteps){c.status='FAILED';c.blocker='STEP_BOUND';await workers.receipt(c,this);break;}
        const node=graph.nodes.find(n=>n.id===id);if(!node||!workers[id])fail('UNBOUND_GRAPH_NODE:'+id);
        const entry={node:id,lane:'deterministic',at:now(),status:'RUNNING',input_hash:digest({product:input.product,campaign:input.campaign_id,learning:c.state.version})};
        try {await workers[id](c,this);entry.status='PASS';}catch(e){entry.status='BLOCKED';entry.reason=e.message;c.blocker=e.message;c.status='BLOCKED';}
        entry.output_hash=digest({asset:c.asset,receipt:c.receipt,outcome:c.outcome,version:c.state.version,route:c.route?.id});c.trace.push(entry);
        const edges=graph.edges.filter(e=>e.from===id);
        const event=entry.status==='BLOCKED'?'blocked':c.duplicate&&id==='execute'?'duplicate':'success';
        const edge=edges.find(e=>e.event===event);id=edge?.to||null;
      }
      if(c.status==='RUNNING')c.status=c.receipt?.execution_status==='PUBLISHED'?'PASS':c.receipt?.execution_status||'BLOCKED';
      const result={run_id:c.run_id,product:input.product,campaign_id:input.campaign_id,status:c.status,blocker:c.blocker||null,nodes:c.trace,selection:c.selection,receipt:c.receipt||null,performance:c.performance||null,outcome:c.outcome||null,learning_before:c.learning_before,learning_after:c.state};
      await this.store.put('run:'+c.run_id,result);await this.store.put('latest',result);return result;
    });
  }
  async feedback(receiptId) {
    return this.store.locked('engine',async()=>{
      const r=await this.store.get('receipt:'+receiptId);if(!r)fail('RECEIPT_NOT_FOUND');
      const c={input:{product:r.product,campaign_id:r.campaign_id},receipt:r,state:await this.store.get('learning')||initial(),trace:[]};
      for(const id of ['observe','normalize','learn','distribution_map']){try{await workers[id](c,this);c.trace.push({node:id,status:'PASS'});}catch(e){c.trace.push({node:id,status:'BLOCKED',reason:e.message});break;}}
      await this.store.put('feedback:'+r.id,{trace:c.trace,outcome:c.outcome||null,learning:c.state});return {trace:c.trace,outcome:c.outcome,learning:c.state};
    });
  }
}

const workers={
  async ingest(c,e) {
    c.product=structuredClone(e.products[c.input.product]);c.signal=c.product?.signals?.find(s=>!c.input.signal_id||s.id===c.input.signal_id);
    approved(c.product,c.signal);c.truth_hash=digest(c.product);
    c.max_attempts=Math.min(3,Math.max(1,c.product.max_attempts||2));
  },
  async signal_extraction(c) {c.signals=c.product.signals.filter(s=>s.evidence?.length);},
  async signal_library(c,e) {await e.store.put('signals:'+c.input.product,{truth_hash:c.truth_hash,signals:c.signals});},
  async priority(c) {
    const priority=s=>{const observations=Object.entries(c.state.routes).filter(([key])=>key.startsWith(encodeURIComponent(c.input.product)+':'+encodeURIComponent(s.id)+':')).map(([key])=>score(c.state,key));return Math.min(1,Math.max(0,s.priority||0))+(observations.length?observations.reduce((a,b)=>a+b,0)/observations.length:0);};
    c.signal=c.input.signal_id?c.signals.find(s=>s.id===c.input.signal_id):[...c.signals].sort((a,b)=>priority(b)-priority(a)||a.id.localeCompare(b.id))[0];approved(c.product,c.signal);
  },
  async campaign(c) {c.campaign={id:c.input.campaign_id,signal:c.signal.id,revision:c.signal.revision};},
  async relevance(c) {c.relevant=c.product.destinations.filter(d=>d.signal_ids.includes(c.signal.id));c.relevant.sort((a,b)=>Math.max(...b.formats.map(f=>score(c.state,keyOf(c.input.product,c.signal.id,b.id,f))))-Math.max(...a.formats.map(f=>score(c.state,keyOf(c.input.product,c.signal.id,a.id,f)))));},
  async scout(c,e) {
    // Persistent product-scoped map first. No broad discovery or invented destination.
    const hold=await e.store.get('pending:'+c.input.product+':'+c.signal.id+':'+c.signal.revision);if(hold)fail('AMBIGUOUS_PUBLICATION_RECOVERY_REQUIRED');
    c.candidates=c.relevant;
    if(!c.candidates.length)fail('NO_VERIFIED_DESTINATION_HARNESS_DISCOVERY_REQUIRED');
  },
  async baseline(c) {c.candidates=c.candidates.filter(d=>d.baseline?.id&&d.baseline?.valid_until&&Date.parse(d.baseline.valid_until)>Date.now());if(!c.candidates.length)fail('DESTINATION_BASELINE_REQUIRED');},
  async delta(c) {c.candidates=c.candidates.filter(d=>d.delta?.signal_revision===c.signal.revision&&d.delta?.meaningful===true&&d.delta?.evidence_ids?.every(id=>c.signal.evidence.includes(id))&&d.delta.evidence_ids.length);},
  async novelty_gate(c) {if(!c.candidates.length)fail('NO_MEANINGFUL_DELTA');},
  async route(c) {
    const options=[];
    for(const d of c.candidates)for(const f of d.formats){const key=keyOf(c.input.product,c.signal.id,d.id,f);const l=c.state.routes[key];const health=c.state.platforms?.[c.input.product+':'+d.platform];options.push({id:d.id,destination:d,format:f,key,score:(d.relevance||0)+score(c.state,key),learned:score(c.state,key),breaker:l?.failures>=3||health?.failures>=3,cooldown:Date.parse(l?.retry_at||0)>Date.now()||Date.parse(health?.retry_at||0)>Date.now()});}
    options.sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id)||a.format.localeCompare(b.format));
    c.route=options.find(o=>!o.breaker&&!o.cooldown);
    c.selection={learning_version:c.state.version,options:options.map(({destination,...o})=>o),selected:c.route?.key||null};
    if(!c.route)fail('CIRCUIT_OPEN_OR_RATE_LIMITED');
  },
  async editorial_intelligence(c) {
    // Extract approved source wording. New reasoning/creative copy goes to the existing
    // Harness contract; it cannot be replaced by unverified local model calls.
    c.copy=c.signal.approved_copy[0];if(!c.copy)fail('HARNESS_CREATION_REQUIRED');
  },
  async editorial_quality_gate(c) {
    if(!c.signal.approved_copy.includes(c.copy)||!c.copy.includes(c.signal.state)||!c.product.review.editorial)fail('EDITORIAL_REVIEW_REQUIRED');
    if(/\b(buy now|guaranteed return|risk.free investment)\b/i.test(c.copy))fail('UNSUPPORTED_FINANCIAL_CLAIM');
  },
  async variant_factory(c) {
    c.state.variants ||= {};
    c.copy=[...c.signal.approved_copy].sort((a,b)=>(c.state.variants[digest([c.input.product,c.signal.id,c.route.id,c.route.format,b])]?.score||0)-(c.state.variants[digest([c.input.product,c.signal.id,c.route.id,c.route.format,a])]?.score||0))[0];
    if(!c.copy.includes(c.signal.state)||/\b(buy now|guaranteed return|risk.free investment)\b/i.test(c.copy))fail('VARIANT_EVIDENCE_OR_EDITORIAL_BOUND');
    c.variant_key=digest([c.input.product,c.signal.id,c.route.id,c.route.format,c.copy]);
    c.variant={id:digest([c.signal.id,c.signal.revision,c.copy]).slice(0,16),copy:c.copy,source_state:c.signal.state,evidence:[...c.signal.evidence],voice:c.product.brand_system||'UNDEFINED'};},
  async format(c) {
    if(c.route.format==='svg'){
      const escape=s=>s.replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[ch]));
      const rows=c.copy.match(/.{1,65}(?:\s|$)|.{1,65}/g)||[];
      c.asset={format:'svg',copy:c.copy,svg:`<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="${Math.max(240,rows.length*32+110)}"><rect width="100%" height="100%" fill="#101820"/><text fill="white" font-size="24" font-family="sans-serif">${rows.map((s,i)=>`<tspan x="35" y="${65+i*32}">${escape(s)}</tspan>`).join('')}</text></svg>`};
    }else if(c.route.format==='image'){
      const a=c.signal.approved_asset;if(!a?.base64||!a.sha256||!a.reviewed||!['image/png','image/jpeg'].includes(a.mime))fail('APPROVED_IMAGE_REQUIRED');
      if(crypto.createHash('sha256').update(Buffer.from(a.base64,'base64')).digest('hex')!==a.sha256)fail('ASSET_HASH_MISMATCH');
      c.asset={format:'image',copy:c.copy,...a};
    }else if(c.route.format==='text')c.asset={format:'text',copy:c.copy};else fail('FORMAT_WORKER_UNAVAILABLE');
  },
  async adapt(c,e) {c.adapter=e.adapters[c.route.destination.platform];if(!c.adapter?.formats.includes(c.asset.format))fail('DESTINATION_ADAPTER_UNAVAILABLE');if(c.route.destination.platform==='X'&&c.copy.length>280)fail('X_COPY_LENGTH_REQUIRES_APPROVED_VARIANT');},
  async evidence_gate(c) {approved(c.product,c.signal);if(digest(c.product)!==c.truth_hash||c.variant.source_state!==c.signal.state||!c.signal.approved_copy.includes(c.asset.copy))fail('EVIDENCE_TRUTH_CHANGED');},
  async brand_gate(c) {if(!c.product.review.brand||!c.product.review.risk)fail('BRAND_OR_RISK_REVIEW_REQUIRED');},
  async permission_gate(c) {
    const d=c.route.destination;
    if(!d.permission?.approved||Date.parse(d.permission.valid_until)<=Date.now()||!d.permission.valid_until||d.permission.signal_revision!==c.signal.revision)fail('DESTINATION_PERMISSION_REQUIRED');
    if(c.adapter.authorized&&!await c.adapter.authorized(c.input.product))fail('ACCOUNT_AUTHORIZATION_REQUIRED');
    // UNKNOWN-cost APIs are blocked until a bounded owner budget exists.
    if(c.adapter.cost!=='ZERO'){
      const budget=c.product.budget;
      if(!budget?.approved||!Number.isFinite(budget.max_action_usd)||budget.max_action_usd<=0||!Number.isFinite(budget.max_cycle_usd)||budget.max_cycle_usd<budget.max_action_usd||!Number.isFinite(d.max_api_calls)||d.max_api_calls<1)fail('API_COST_APPROVAL_REQUIRED');
      if(c.adapter.publishCalls&&d.max_api_calls<c.adapter.publishCalls(c.asset))fail('API_CALL_BOUND_TOO_LOW');
      if(!Number.isFinite(d.max_action_usd)||d.max_action_usd>budget.max_action_usd)fail('API_COST_BOUND_REQUIRED');
    }
  },
  async execute(c,e) {
    c.publication_key=digest([c.input.product,c.signal.id,c.signal.revision,c.route.id,c.route.format,c.variant.id]);
    const prior=await e.store.get('receipt:'+c.publication_key);
    if(prior?.execution_status==='PUBLISHED'){c.receipt=prior;c.duplicate=true;return;}
    if(prior?.execution_status==='IN_FLIGHT'||prior?.execution_status==='AMBIGUOUS')fail('AMBIGUOUS_PUBLICATION_RECOVERY_REQUIRED');
    if(prior?.attempts>=c.max_attempts)fail('RETRY_BOUND');
    if(Date.parse(prior?.retry_at||0)>Date.now())fail('RETRY_NOT_DUE');
    if(c.adapter.cost!=='ZERO'){
      const ledgerKey='cost:'+c.input.product+':'+now().slice(0,10);const ledger=await e.store.get(ledgerKey)||{reserved_usd:0,calls:0};const b=c.product.budget;
      if(!Number.isFinite(b.max_daily_usd)||!Number.isFinite(b.max_daily_api_calls)||ledger.reserved_usd+c.route.destination.max_action_usd>b.max_daily_usd||ledger.calls+c.route.destination.max_api_calls>b.max_daily_api_calls)fail('DAILY_COST_OR_CALL_BOUND');
      ledger.reserved_usd+=c.route.destination.max_action_usd;ledger.calls+=c.route.destination.max_api_calls;await e.store.put(ledgerKey,ledger);c.reserved_cost_usd=c.route.destination.max_action_usd;
    }
    c.receipt={id:c.publication_key,destination:c.route.id,platform:c.route.destination.platform,variant:c.variant.id,variant_key:c.variant_key,format:c.route.format,timestamp:now(),execution_status:'IN_FLIGHT',external_id:null,url:null,campaign_id:c.input.campaign_id,product:c.input.product,signal_id:c.signal.id,signal_revision:c.signal.revision,route_key:c.route.key,attempts:(prior?.attempts||0)+1,max_attempts:c.max_attempts,retry_at:null,error:null,api_cost_usd:c.adapter.cost==='ZERO'?0:'UNKNOWN',ad_spend_usd:0,delivery_hash:digest(c.asset),reserved_cost_usd:c.reserved_cost_usd||0};
    await e.store.put('receipt:'+c.publication_key,c.receipt);
    const pendingKey='pending:'+c.input.product+':'+c.signal.id+':'+c.signal.revision;
    await e.store.put(pendingKey,{receipt_id:c.publication_key,status:'IN_FLIGHT'});
    try {
      const result=await c.adapter.publish(c.asset,c.publication_key,c.input.product);
      if(!result?.id||result.status!=='PUBLISHED')fail('PUBLICATION_RECEIPT_MISSING');
      Object.assign(c.receipt,{execution_status:'PUBLISHED',external_id:String(result.id),url:result.url||null,timestamp:now(),api_cost_usd:result.cost_usd??'UNKNOWN'});
    }catch(error){
      const status=error.status;
      // A timeout/5xx after POST might already have published. Never repeat it blindly.
      Object.assign(c.receipt,{execution_status:status===429?'RATE_LIMITED':status&&status>=400&&status<500?'FAILED':'AMBIGUOUS',error:String(error.message).slice(0,200),retry_at:status===429?new Date(Math.max(Date.now()+60000,error.retry_at||0)).toISOString():null});
    }
    if(c.receipt.execution_status!=='AMBIGUOUS')await e.store.put(pendingKey,null);
    await e.store.put('receipt:'+c.publication_key,c.receipt);
  },
  async receipt(c,e) {
    if(!c.receipt)c.receipt={id:digest([c.run_id,c.input]),destination:c.route?.id||'UNKNOWN',platform:c.route?.destination.platform||'UNKNOWN',variant:c.variant?.id||'UNKNOWN',format:c.asset?.format||'UNKNOWN',timestamp:now(),execution_status:'BLOCKED',external_id:null,url:null,campaign_id:c.input.campaign_id,product:c.input.product,signal_id:c.signal?.id||'UNKNOWN',signal_revision:c.signal?.revision||'UNKNOWN',route_key:c.route?.key||null,attempts:0,max_attempts:c.max_attempts||0,retry_at:null,error:c.blocker||'UNKNOWN',api_cost_usd:0,ad_spend_usd:0};
    await e.store.put('receipt:'+c.receipt.id,c.receipt);await e.store.put('latest_receipt',c.receipt);
    const index=await e.store.get('receipt_index')||[];const filtered=index.filter(r=>r.id!==c.receipt.id);filtered.push({...c.receipt,last_collection:now()});await e.store.put('receipt_index',filtered.slice(-200));
  },
  async observe(c,e) {
    c.performance={status:'UNKNOWN',metrics:{},source:'UNAVAILABLE',observed_at:now(),cost_usd:'UNKNOWN'};
    const r=c.receipt;const a=e.adapters[r.platform];
    if(Date.parse(c.state.platforms?.[r.product+':'+r.platform]?.retry_at||0)>Date.now()){c.performance.reason='PLATFORM_RATE_LIMIT_COOLDOWN';await e.store.put('performance:'+r.id,c.performance);return;}
    if(r.execution_status==='PUBLISHED'&&a?.collect&&a.cost==='ZERO') {try{c.performance=await a.collect(r);}catch(error){c.performance.reason=error.message;if(error.status===429){c.state.platforms ||= {};const k=r.product+':'+r.platform;c.state.platforms[k]={...(c.state.platforms[k]||{failures:0}),retry_at:new Date(Math.max(Date.now()+60000,error.retry_at||0)).toISOString()};}}}
    else if(r.execution_status==='PUBLISHED'&&a?.collect){
      const p=e.products[r.product];if(p?.budget?.metrics_approved&&Number.isFinite(p.budget.max_metrics_calls)&&p.budget.max_metrics_calls>0){
        const ledgerKey='metrics_cost:'+r.product+':'+now().slice(0,10);const ledger=await e.store.get(ledgerKey)||{calls:0,reserved_usd:0};const b=p.budget;
        if(!Number.isFinite(b.max_metrics_action_usd)||b.max_metrics_action_usd<=0||!Number.isFinite(b.max_metrics_daily_usd)||ledger.calls>=b.max_metrics_calls||ledger.reserved_usd+b.max_metrics_action_usd>b.max_metrics_daily_usd)c.performance.reason='METRICS_COST_OR_CALL_BOUND';
        else{ledger.calls++;ledger.reserved_usd+=b.max_metrics_action_usd;await e.store.put(ledgerKey,ledger);try{c.performance=await a.collect(r);}catch(error){c.performance.reason=error.message;if(error.status===429){c.state.platforms ||= {};const k=r.product+':'+r.platform;c.state.platforms[k]={...(c.state.platforms[k]||{failures:0}),retry_at:new Date(Math.max(Date.now()+60000,error.retry_at||0)).toISOString()};}}}
      }else c.performance.reason='METRICS_API_COST_APPROVAL_REQUIRED';
    }
    await e.store.put('performance:'+r.id,c.performance);
  },
  async normalize(c,e) {
    c.outcome={receipt_id:c.receipt.id,route_key:c.receipt.route_key,execution_status:c.receipt.execution_status,observed_at:c.performance.observed_at,source:c.performance.source,measurements:c.performance.metrics,engagement_rate:'UNKNOWN',reach:'UNKNOWN',conversion:'UNKNOWN',cost_usd:c.performance.cost_usd??'UNKNOWN',evidence_strength:c.performance.status==='AVAILABLE'?'DIRECT_MEASUREMENT':'EXECUTION_ONLY'};
    // Channel-native values retain names/units/scopes. No email/X/local pseudo-score.
    if(!Object.values(c.outcome.measurements).every(m=>Number.isFinite(m.value)&&m.value>=0&&m.unit&&m.scope))fail('INVALID_MEASUREMENT');
    await e.store.put('outcome:'+c.receipt.id,c.outcome);
  },
  async learn(c) {
    const r=c.receipt;if(!r.route_key||!['PUBLISHED','FAILED','RATE_LIMITED','AMBIGUOUS'].includes(r.execution_status))return;
    const event=digest([r.id,r.attempts,r.execution_status]);
    const observation=digest([event,c.outcome.measurements,c.outcome.evidence_strength]);
    if(c.state.processed[observation])return;
    const newExecution=!c.state.processed[event];
    c.state.platforms ||= {};const platformKey=r.product+':'+r.platform;
    if(newExecution){const health=c.state.platforms[platformKey]||{failures:0,retry_at:null};health.failures=r.execution_status==='PUBLISHED'?0:health.failures+1;health.retry_at=r.retry_at;c.state.platforms[platformKey]=health;}
    const old=c.state.routes[r.route_key]||{successes:0,failures:0,confidence:0,evidence_strength:'UNKNOWN',failed_routes:[]};
    const record=structuredClone(old);
    if(newExecution&&r.execution_status==='PUBLISHED'){record.successes++;record.failures=0;}else if(newExecution){record.failures++;record.failed_routes.push({receipt_id:r.id,status:r.execution_status,at:r.timestamp});record.failed_routes=record.failed_routes.slice(-20);}
    record.retry_at=r.retry_at;record.confidence=Math.min(0.8,(record.successes+record.failures)/10);record.evidence_strength=c.outcome.evidence_strength;
    // Local read-back affects local delivery reliability only; cannot imply audience engagement.
    const verified=c.outcome.measurements.content_verified;
    if(verified?.scope==='local_delivery')record.measurement_adjustment=verified.value===1?0.05:-0.5;
    const likes=c.outcome.measurements.like_count;
    const impressions=c.outcome.measurements.impression_count;
    if(likes?.scope==='x_public_metrics'&&impressions?.scope==='x_public_metrics'&&impressions.value>=100&&likes.value<=impressions.value)record.measurement_adjustment=Math.min(0.2,likes.value/impressions.value);
    record.last_receipt=r.id;record.timing_observations={last_execution_at:r.timestamp,last_observed_at:c.outcome.observed_at,optimal_time:'UNKNOWN'};
    record.measurements=c.outcome.measurements;
    c.state.routes[r.route_key]=record;
    c.state.variants ||= {};if(r.variant_key)c.state.variants[r.variant_key]={score:record.measurement_adjustment||0,evidence_strength:record.evidence_strength,receipt_id:r.id};c.state.processed[event]=true;c.state.processed[observation]=true;c.state.version++;
    c.state.history.push({version:c.state.version,route_key:r.route_key,receipt_id:r.id,before:old,after:record});c.state.history=c.state.history.slice(-100);
  },
  async distribution_map(c,e) {if(c.product&&digest(c.product)!==c.truth_hash)fail('LEARNING_CANNOT_CHANGE_PRODUCT_TRUTH');await e.store.put('learning',c.state);},
};
