import fs from 'node:fs/promises';
import {approveExact,drainApproved,recoverApprovedCampaign} from './approved-distribution.js';
import scanControl from '../config/scan-control.json' with {type:'json'};
import {intakeHeld} from './autonomous-source.js';
import {normalizeOutcome,analyseOutcomes,learnRouting,historicalRoutingInput} from './outcomes.js';
import {evaluateX} from './route-feedback.js';
import {checkPublication} from './publication-outcomes.js';
import {evidenceVisual,validateCombinedX} from './x-visual.js';
import {nativeXCopy} from './x-copy.js';
import crypto from 'node:crypto';
import {marketingWorkUnit} from './harness.js';
import {SpendEnvelope,zeroQuote,zeroBilling} from './spending.js';
import {organicWorkers,discoveryTestId} from './organic-discovery.js';
import openRouteDirectory from '../state/open-route-directory.json' with {type:'json'};
import {openRouteScout,commercialEvidenceBranch,prepareRouteAssets,formationFromSignal} from './open-route-scout.js';
import {editorialContext,validateEditorial,produceEditorial,externalSchemaLeak,editorialVersion} from './editorial-copy.js';
import {humanReadyEmail,normalizeCorrespondence,validateHumanEmail,reuseProposition,isEmail,emailVersion} from './editorial-email.js';
import {beginCosts,finishCosts,costCall,costKey} from './campaign-costs.js';
import {ownerPreview,previewWarning,previewCorrespondence} from './owner-preview.js';

export const digest=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const graph=JSON.parse(await fs.readFile(new URL('../graph/marketing-graph-v1.json',import.meta.url),'utf8'));
const distributionMap=JSON.parse(await fs.readFile(new URL('../state/distribution-map.json',import.meta.url),'utf8'));
const integrationRegister=JSON.parse(await fs.readFile(new URL('../state/integration-register.json',import.meta.url),'utf8'));
const now=()=>new Date().toISOString();
const fail=(reason)=>{throw new Error(reason);};
const initial=()=>({version:0,routes:{},platforms:{},processed:{},history:[]});
const keyOf=(p,s,d,f)=>[p,s,d,f].map(encodeURIComponent).join(':');
const score=(state,key)=>{const r=state.routes[key];return r?Math.max(-1,Math.min(1,(r.successes-r.failures)/(r.successes+r.failures+2)+(r.measurement_adjustment||0))):0;};
const ownerBlockers=new Set(['PUBLICATION_REVIEW_REQUIRED','DESTINATION_PERMISSION_REQUIRED','ACCOUNT_AUTHORIZATION_REQUIRED','API_COST_APPROVAL_REQUIRED','WORKER_COST_APPROVAL_REQUIRED']);
const blockerDisposition=reason=>ownerBlockers.has(reason)?{scope:'OWNER_AUTHORITY',surface_to_owner:true}:{scope:'INTERNAL_EXECUTION',surface_to_owner:false};
function registeredEmradarDestinations(signal){
  const reviewed=integrationRegister.reviewed_at;
  const validUntil=new Date(Date.parse(reviewed+'T00:00:00Z')+365*24*3600000).toISOString();
  return (distributionMap.routes||[]).filter(r=>r.product==='EMRADAR'&&r.status==='LIVE_EXECUTION_VERIFIED').flatMap(r=>{
    const platform=(integrationRegister.platforms||[]).find(p=>p.id===r.platform&&p.status==='TESTED'&&p.distribution_mode==='AUTOMATIC_AFTER_GATES_AND_EXACT_PUBLICATION_REVIEW');
    if(!platform||!r.receipt||!r.id)return [];
    return [{id:r.id,platform:r.platform,signal_ids:[signal.id],formats:['text'],relevance:1,baseline:{id:r.receipt,valid_until:validUntil},delta:{signal_revision:signal.revision,meaningful:r.formation!==signal.id,evidence_ids:[...signal.evidence]},permission:{approved:true,valid_until:validUntil,signal_revision:signal.revision,scope:'PREPARE_FOR_EXACT_PUBLICATION_REVIEW'},review_only:true}];
  });
}
function approved(p,s) {
  if(!p || !s || !p.product_identity || p.release_approved!==true || p.review?.evidence!==true || p.review?.brand!==true || p.review?.editorial!==true || p.review?.risk!==true)fail('SOURCE_REVIEW_OR_RELEASE_REQUIRED');
  if(!p.uncertainty_state_model.includes(s.state)||!s.id||!s.revision||!s.evidence?.length||!(s.approved_copy?.length||s.source_facts?.length||s.source_material))fail('SOURCE_CONTRACT_INCOMPLETE');
  if(!(s.approved_copy||[]).every(c=>typeof c==='string'&&c.includes(s.state)))fail('STATE_NOT_VISIBLE_IN_APPROVED_COPY');
}

export class GraphEngine {
  constructor({store,products,adapters,harness=null,maxSteps=40,xAccountStatus=null}) {this.xAccountStatus=xAccountStatus;this.store=store;this.products=products;this.adapters=adapters;this.harness=harness;this.maxSteps=maxSteps;this.spend=new SpendEnvelope(store);}
  async previewDiscovery(input) {
    if(input.product!=='EMRADAR'||input.test_id!==discoveryTestId)fail('X_DISCOVERY_SOURCE_OR_TEST_NOT_AUTHORIZED');
    return this.store.locked('x_discovery',async()=>{
      const saved=await this.store.get('x_discovery:preview:'+discoveryTestId);
      if(saved)return saved;
      const c={input,trace:[],state:await this.store.get('learning')||initial(),run_id:crypto.randomUUID(),status:'RUNNING',read_only:true};
      await this.traverse(c,'emradar_finding');
      const result={test_id:discoveryTestId,status:c.status,blocker:c.blocker||null,api_error:c.api_error||null,source:c.source||null,nodes:c.trace,reads:c.reads||[],cost:c.discoveryLedger||null,candidates:c.candidates||[],no_engagement:c.no_engagement===true,learning_unchanged:JSON.stringify(c.state)===JSON.stringify(await this.store.get('learning')||initial())};
      await this.store.put('x_discovery:preview:'+discoveryTestId,result);
      return result;
    });
  }
  async approvePublication(decision) {return approveExact(this,decision);}
  async distributeApproved(options) {return drainApproved(this,workers,options);}
  async recoverApprovedCampaign(manifest) {return recoverApprovedCampaign(this,manifest);}
  async revisePublication({proposal_id,review_hash}) {
    const p=await this.store.get('publication_review:'+proposal_id);
    if(!p||p.review_hash!==review_hash)fail('PUBLICATION_REVIEW_EXPIRED_OR_CHANGED');
    if(p.status==='SUPERSEDED'&&p.replacement_proposal_id){const replacement=await this.store.get('publication_review:'+p.replacement_proposal_id);if(replacement?.status==='AWAITING_REVIEW')return {status:'AWAITING_REVIEW',proposal_id:replacement.proposal_id,replaces:proposal_id,external_actions:0};}
    if(p.status!=='AWAITING_REVIEW'||await this.store.get('publication_approval:'+proposal_id))fail('REVISION_REQUIRES_UNAPPROVED_UNSENT_PROPOSAL');
    const result=await this.run({...p.input,revision_proposal_id:proposal_id,expected_review_hash:review_hash,stop_at:'PUBLICATION_REVIEW'});
    return {status:result.status,blocker:result.blocker,proposal_id:result.review?.proposal_id||null,replaces:proposal_id,run_id:result.run_id,cost_receipt:result.cost_receipt,external_actions:0};
  }
  async rejectPublication({proposal_id,review_hash,reason}) {
    return this.store.locked('engine',async()=>{
      const p=await this.store.get('publication_review:'+proposal_id);
      if(!p||p.review_hash!==review_hash||!reason)fail('PUBLICATION_REVIEW_EXPIRED_OR_CHANGED');
      const executed=await this.store.get('receipt:'+p.publication_key);
      if(['PUBLISHED','SUBMITTED','IN_FLIGHT','AMBIGUOUS'].includes(executed?.execution_status))fail('PUBLICATION_ALREADY_EXECUTED_OR_AMBIGUOUS');
      p.status='REJECTED';p.rejection={reason,at:now(),by:'OWNER'};
      if(p.editorial?.cache_key)await this.store.put(p.editorial.cache_key,null);
      await this.store.put('publication_review:'+proposal_id,p);
      await this.store.put('publication_approval:'+proposal_id,null);
      for(const id of await this.store.get('campaign_cost_index:'+p.input.campaign_id)||[]){const r=await this.store.get(costKey(id));if(r?.proposal_id===proposal_id)await finishCosts(this.store,id,{outcome:'REJECTED',blocker:reason,proposal_id});}
      return {proposal_id,status:'REJECTED',reason,external_actions:0};
    });
  }
  async modelWork(c,node,context,approvalKey,productionAttempt=1) {
    if(!this.harness)fail('HARNESS_DISPATCH_NOT_CONNECTED');
    const b=c.product.budget||{};
    const audAuthority=c.input.product==='EMRADAR'&&approvalKey==='creation_approved'&&c.product.provider_authority?.automatic_connected_approved_only===true&&c.product.spending_envelope?.currency==='AUD'&&c.product.spending_envelope.campaign_limit===5&&c.product.spending_envelope.calendar_month_limit===50;
    if(!audAuthority&&(!b[approvalKey]||!Number.isFinite(b.max_worker_usd)||b.max_worker_usd<=0||!Number.isFinite(b.max_worker_daily_usd)||!Number.isSafeInteger(b.max_worker_calls)||b.max_worker_calls<1))fail('WORKER_COST_APPROVAL_REQUIRED');
    if(!this.harness.quote)fail('ACTUAL_COST_BOUND_UNKNOWN');
    const ledgerKey='worker_cost:'+c.input.product+':'+now().slice(0,10);const ledger=await this.store.get(ledgerKey)||{calls:0,reserved_usd:0};
    if(!(audAuthority&&ownerPreview(c.input))&&(ledger.calls+2>(audAuthority?Math.min(20,b.max_worker_calls>0?b.max_worker_calls:20):b.max_worker_calls)||(!audAuthority&&ledger.reserved_usd+b.max_worker_usd*2>b.max_worker_daily_usd)))fail('WORKER_DAILY_BOUND');
    const costQuote=await this.harness.quote(marketingWorkUnit(node,c.input.product),context);
    if(audAuthority&&!ownerPreview(c.input)&&(costQuote.max_cost_aud>.25||(ledger.reserved_aud||0)+costQuote.max_cost_aud>5))fail('WORKER_DAILY_BOUND');
    const costReservation=await this.spend.reserve({campaign_id:c.input.campaign_id,quote:costQuote,action_id:c.run_id+':'+node+(productionAttempt>1?':correction:'+productionAttempt:''),run_id:c.run_id,category:node==='scout'?'research_search_api':'generation'});
    ledger.calls+=2;
    if(audAuthority){ledger.reserved_aud=(ledger.reserved_aud||0)+costQuote.max_cost_aud;c.worker_reserved_aud=(c.worker_reserved_aud||0)+costQuote.max_cost_aud;c.worker_reserved_usd='UNKNOWN';}
    else{ledger.reserved_usd+=b.max_worker_usd*2;c.worker_reserved_usd=(c.worker_reserved_usd||0)+b.max_worker_usd*2;}
    await this.store.put(ledgerKey,ledger);
    const input={...context,learning_routes:Object.fromEntries(Object.entries(c.state.routes).filter(([key])=>key.startsWith(encodeURIComponent(c.input.product)+':')))};input.input_hash=digest(input);
    let work;try{work=await this.harness.work(marketingWorkUnit(node,c.input.product),{...input,cost_reservation:costReservation});}catch(error){await this.spend.settle(costReservation,error.billing);throw error;}
    const provider_cost=await this.spend.settle(costReservation,work.proof.billing);
    c.provider_costs||=[];c.provider_costs.push(provider_cost);
    c.node_work={node,decision:work.decision,attempts:work.attempts,proof:work.proof,cost_usd:'UNKNOWN',provider_cost,reserved_usd:audAuthority?'UNKNOWN':b.max_worker_usd*2,...(audAuthority?{reserved_aud:costQuote.max_cost_aud,authority:'PERSISTED_OWNER_AUD_ENVELOPE'}:{})};
    await this.store.put('work:'+c.run_id+':'+node,c.node_work);return work;
  }
  async tick({feedbackOnly=scanControl.hold_new_scans&&!!this.products.EMRADAR}={}) {
    // Bounded autonomous scheduler node: one product revision, then at most one
    // due performance observation. State is persistent across restarts.
    const plan=await this.store.locked('engine',async()=>{
      const index=await this.store.get('receipt_index')||[];
      const seen=await this.store.get('scheduler_seen')||{};
      let selected=null;
      for(const [product,p] of Object.entries(this.products)) {
        if(feedbackOnly||!p.autonomous?.enabled)continue;
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
      const due=index.find(r=>['PUBLISHED','SUBMITTED'].includes(r.execution_status)&&Date.now()-Date.parse(r.last_collection||r.timestamp)>=300000);
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
    if(intakeHeld()&&!input.revision_proposal_id&&!input.reviewed_proposal_id&&input.product==='EMRADAR')fail('NEXT_SCAN_HELD_BY_OWNER');
    if(!input.product||!input.campaign_id)fail('PRODUCT_AND_CAMPAIGN_REQUIRED');
    if(input.revision_proposal_id&&input.stop_at!=='PUBLICATION_REVIEW')fail('REVISION_MUST_STOP_AT_PUBLICATION_REVIEW');
    return this.store.locked('engine',async()=>{
      const c={input,trace:[],state:await this.store.get('learning')||initial(),routing_memory:await this.store.get('routing_memory'),run_id:crypto.randomUUID(),status:'RUNNING'};
      c.learning_before=structuredClone(c.state);
      await beginCosts(this.store,{run_id:c.run_id,input,source:this.products[input.product]?.signals?.find(s=>!input.signal_id||s.id===input.signal_id)});
      try{await this.traverse(c,'ingest');}catch(error){c.status='FAILED';c.blocker=error.message;}
      if(c.status==='RUNNING')c.status=['PUBLISHED','SUBMITTED'].includes(c.receipt?.execution_status)?'PASS':c.receipt?.execution_status||'BLOCKED';
      const cost_receipt=await finishCosts(this.store,c.run_id,{outcome:c.status,blocker:c.blocker,proposal_id:c.review?.proposal_id,source:c.signal});
      const result={run_id:c.run_id,product:input.product,campaign_id:input.campaign_id,status:c.status,cost_receipt,blocker:c.blocker||null,blocker_disposition:c.blocker?blockerDisposition(c.blocker):null,nodes:c.trace,selection:c.selection,route_plan:c.route_plan||null,commercial_evidence:c.commercial_evidence||null,review:c.review||null,receipt:c.receipt||null,performance:c.performance||null,outcome:c.outcome||null,learning_before:c.learning_before,learning_after:c.state};
      await this.store.put('run:'+c.run_id,result);await this.store.put('latest',result);return result;
    });
  }
  async traverse(c,start) {
    let id=start;let count=0;
      while(id) {
        if(++count>this.maxSteps){c.status='FAILED';c.blocker='STEP_BOUND';if(!c.read_only)await workers.receipt(c,this);break;}
        const node=graph.nodes.find(n=>n.id===id);if(!node||!workers[id])fail('UNBOUND_GRAPH_NODE:'+id);
        const entry={node:id,lane:'deterministic',at:now(),status:'RUNNING',input_hash:digest({product:c.input.product,campaign:c.input.campaign_id,learning:c.state.version})};
        if(!c.read_only)console.log('MARKETING_GRAPH_NODE '+JSON.stringify({campaign_id:c.input.campaign_id,node:id,status:'RUNNING'}));
        try {await workers[id](c,this);entry.status='PASS';if(c.node_work?.node===id){entry.lane=c.node_work.decision.lane;entry.worker_receipt=c.node_work;}}catch(e){if(ownerPreview(c.input)&&c.route?.destination?.platform==='OPEN_ROUTE'&&c.editorial?.result?.body&&previewWarning(e.message)){c.preview_warnings||=[];c.preview_warnings.push({gate:id,reason:e.message});entry.status='PASS';entry.warning=e.message;}else{entry.status='BLOCKED';entry.reason=e.message;c.blocker=e.message;c.status='BLOCKED';}}
        entry.output_hash=digest({asset:c.asset,receipt:c.receipt,outcome:c.outcome,version:c.state.version,route:c.route?.id});c.trace.push(entry);
        if(!c.read_only)console.log('MARKETING_GRAPH_NODE '+JSON.stringify({campaign_id:c.input.campaign_id,node:id,status:entry.status,reason:entry.reason||null}));
        const edges=graph.edges.filter(e=>e.from===id);
        const event=entry.status==='BLOCKED'?'blocked':c.review_pending&&id==='publication_review'?'awaiting_review':c.duplicate&&id==='execute'?'duplicate':'success';
        const edge=edges.find(e=>e.event===event);id=edge?.to||null;
      }
  }
  async feedback(receiptId) {
    return this.store.locked('engine',async()=>{
      const r=await this.store.get('receipt:'+receiptId);if(!r)fail('RECEIPT_NOT_FOUND');
      const p=this.products[r.product],signal=p?.signals.find(v=>v.id===r.signal_id&&v.revision===r.signal_revision);
      if(signal&&digest(p.source_receipt||null)===digest(r.source_receipt||null))await this.store.put('signal_snapshot:'+r.product+':'+r.signal_id+':'+r.signal_revision,{signal,source_receipt:r.source_receipt});
      const c={input:{product:r.product,campaign_id:r.campaign_id},receipt:r,state:await this.store.get('learning')||initial(),trace:[],status:'RUNNING',run_id:crypto.randomUUID()};
      await beginCosts(this.store,{run_id:c.run_id,input:c.input,source:{id:r.signal_id,revision:r.signal_revision},kind:'FEEDBACK'});
      try{await this.traverse(c,'observe');}finally{await finishCosts(this.store,c.run_id,{outcome:c.status==='RUNNING'?'FEEDBACK_COMPLETE':c.status,blocker:c.blocker});}
      const receiptIndex=await this.store.get('receipt_index')||[];const indexed=receiptIndex.find(v=>v.id===r.id);if(indexed){indexed.last_collection=now();await this.store.put('receipt_index',receiptIndex);}
      const feedbackRecord={run_id:c.run_id,trace:c.trace,outcome:c.outcome||null,learning:c.state,routing_memory:c.routing_memory};await this.store.put('feedback_run:'+c.run_id,feedbackRecord);const feedbackIndex=await this.store.get('feedback_history:'+r.id)||[];feedbackIndex.push(c.run_id);await this.store.put('feedback_history:'+r.id,feedbackIndex);await this.store.put('feedback:'+r.id,feedbackRecord);if(await this.store.get('outcome_work:'+r.id))await this.store.put('outcome_work:'+r.id,{receipt_id:r.id,status:'WAITING_NEXT_OBSERVATION',last_collection:now(),feedback_run_id:c.run_id});return {trace:c.trace,outcome:c.outcome,learning:c.state};
    });
  }
}

const workers={
  ...organicWorkers,
  async ingest(c,e) {
    c.product=structuredClone(e.products[c.input.product]);c.signal=c.product?.signals?.find(s=>!c.input.signal_id||s.id===c.input.signal_id);
    c.truth_hash=digest(c.product||null);approved(c.product,c.signal);
    const reuseId=c.input.revision_proposal_id||c.input.reviewed_proposal_id;
    if(reuseId){
      const p=await e.store.get('publication_review:'+reuseId);
      if(!p||p.status!=='AWAITING_REVIEW'||p.product!==c.input.product||p.input.campaign_id!==c.input.campaign_id||p.destination!==c.input.destination_id||digest(p.source_receipt||null)!==digest(c.product.source_receipt||null))fail('REVISION_SOURCE_OR_PROPOSAL_CHANGED');
      if(c.input.revision_proposal_id&&(p.review_hash!==c.input.expected_review_hash||await e.store.get('publication_approval:'+reuseId)))fail('REVISION_REQUIRES_UNAPPROVED_UNSENT_PROPOSAL');
      const prior=await e.store.get('receipt:'+p.publication_key);
      if(['PUBLISHED','SUBMITTED','IN_FLIGHT','AMBIGUOUS'].includes(prior?.execution_status)||prior?.external_id)fail('PUBLICATION_ALREADY_EXECUTED_OR_AMBIGUOUS');
      if(p.signal_revision!==c.signal.revision||p.signal_state!==c.signal.state||digest(p.evidence_refs)!==digest(c.signal.evidence))fail('REVISION_SOURCE_CHANGED');
      c.reused_proposal=p;
    }
    await e.store.put('signal_snapshot:'+c.input.product+':'+c.signal.id+':'+c.signal.revision,{signal:c.signal,source_receipt:c.product.source_receipt,truth_hash:c.truth_hash});
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
    if(c.input.product==='EMRADAR')c.x_evaluation=await evaluateX({store:e.store,product:c.product,signal:c.signal,adapter:e.adapters.X,accountStatus:e.xAccountStatus,campaign_id:c.input.campaign_id});
    if(c.reused_proposal&&!c.input.refresh_editorial&&!c.input.refresh_discovery){
      const p=c.reused_proposal,d=p.asset.delivery;
      if(!isEmail(d)||d.verification_state!=='VERIFIED'||d.destination_id!==p.destination)fail('REVISION_VERIFIED_EMAIL_ROUTE_REQUIRED');
      const valid_until=p.review_binding?.destination.permission.valid_until||p.expires_at;
      c.candidates=[{id:p.destination,platform:p.platform,signal_ids:[c.signal.id],formats:['text'],relevance:1,baseline:{id:d.evidence_source_url,valid_until},delta:{signal_revision:c.signal.revision,meaningful:true,evidence_ids:[...c.signal.evidence]},permission:{approved:true,valid_until,signal_revision:c.signal.revision,scope:'EXECUTE_AFTER_EXACT_PUBLICATION_REVIEW'},review_only:true,route_record:d}];
      if(p.review_binding)c.candidates[0].permission=structuredClone(p.review_binding.destination.permission);
      return;
    }
    if(c.input.product==='EMRADAR'){
      const formation=formationFromSignal(c.signal);
      const configured=(c.product.destinations||[]).map(d=>({...d,permission:d.permission||c.product.destination_permissions?.[d.id]||{approved:false}}));
      if(formation.evidence.length){
        const authorizedAccounts=[];
        if(e.adapters.X?.authorized&&await e.adapters.X.authorized('EMRADAR'))authorizedAccounts.push('EMRADAR-X-OROKNOWS');
        const learning={};
        for(const [k] of Object.entries(c.state.routes||{})){
          const [product,signal,destination]=k.split(':').map(decodeURIComponent);
          if(product===c.input.product&&signal===c.signal.id)learning[destination]={score:score(c.state,k)};
        }
        const open=openRouteScout({formation,directory:openRouteDirectory,learning,authorizedAccounts});
        c.commercial_evidence=commercialEvidenceBranch(formation);
        const priorPlan=await e.store.get('route_plan:'+c.input.product+':'+c.signal.id+':'+c.signal.revision);
        const validUntil=priorPlan?.valid_until||new Date(Date.now()+7*86400000).toISOString();
        c.route_plan={...open,valid_until:validUntil,proposed_assets:prepareRouteAssets({formation,candidates:open.candidates}),commercial_evidence:c.commercial_evidence,stop:'PUBLICATION_REVIEW'};
        await e.store.put('route_plan:'+c.input.product+':'+c.signal.id+':'+c.signal.revision,c.route_plan);
        const openCandidates=[];
        for(const d of open.candidates){

          const platform=d.destination_id==='EMRADAR-X-OROKNOWS'?'X':'OPEN_ROUTE';
          const executable=platform==='X'||!!(e.adapters.OPEN_ROUTE?.supportsRoute?.(d)&&await e.adapters.OPEN_ROUTE.authorized?.(c.input.product,d));
          const {classification,prepare_eligible,execution_state,route_score,score_factors,route_reason,...routeRecord}=d;
          openCandidates.push({id:d.destination_id,platform,signal_ids:[c.signal.id],formats:['text'],relevance:route_score,baseline:{id:d.evidence_source_url,valid_until:validUntil},delta:{signal_revision:c.signal.revision,meaningful:true,evidence_ids:[...c.signal.evidence]},permission:{approved:true,valid_until:validUntil,signal_revision:c.signal.revision,scope:executable?'EXECUTE_AFTER_EXACT_PUBLICATION_REVIEW':'PREPARE_FOR_EXACT_PUBLICATION_REVIEW'},review_only:true,open_access_prepare_only:platform==='OPEN_ROUTE'&&!executable,route_record:routeRecord});
        }
        const existing=c.candidates.length?c.candidates:configured;
        c.candidates=[...existing,...openCandidates.filter(o=>!existing.some(r=>r.id===o.id))];
      }
      if(!c.candidates.length)c.candidates=(configured.length?configured:registeredEmradarDestinations(c.signal));
      const xRecord=openRouteDirectory.destinations.find(d=>d.destination_id==='EMRADAR-X-OROKNOWS');
      if(!c.candidates.some(d=>d.id===xRecord.destination_id))c.candidates.push({id:xRecord.destination_id,platform:'X',signal_ids:[c.signal.id],formats:['text'],relevance:1,baseline:{id:xRecord.evidence_source_url,valid_until:'2099-01-01'},delta:{signal_revision:c.signal.revision,meaningful:true,evidence_ids:[...c.signal.evidence]},permission:{approved:true,valid_until:'2099-01-01',signal_revision:c.signal.revision,scope:'PREPARE_FOR_EXACT_PUBLICATION_REVIEW'},review_only:true,route_record:xRecord});
      if(!c.candidates.length)fail('NO_VERIFIED_OPEN_OR_EXECUTABLE_DESTINATION');
      return;
    }
    if(!c.candidates.length){
      const cached=await e.store.get('discovery:'+c.input.product+':'+c.signal.revision);
      if(cached)c.candidates=cached.destinations.map(d=>({...d,permission:c.product.destination_permissions?.[d.id]||{approved:false}}));
      else{
        const work=await e.modelWork(c,'scout',{signal:c.signal,brand:c.product.brand_system},'discovery_approved');
        if(!Array.isArray(work.result.destinations)||!work.result.destinations.length||work.result.destinations.length>5)fail('DISCOVERY_RESULT_INVALID');
        c.candidates=work.result.destinations.map(d=>{
          if(!d.id||!d.platform||!Array.isArray(d.formats))fail('DISCOVERY_RESULT_INVALID');
          return {...d,permission:c.product.destination_permissions?.[d.id]||{approved:false}};
        });
        await e.store.put('discovery:'+c.input.product+':'+c.signal.revision,{destinations:c.candidates,proof:work.proof});
      }
    }
  },
  async commercial_evidence(c,e) {if(c.input.product!=='EMRADAR')return;c.commercial_evidence ||= commercialEvidenceBranch(formationFromSignal(c.signal));await e.store.put('commercial_evidence:'+c.input.product+':'+c.signal.id+':'+c.signal.revision,c.commercial_evidence);},
  async baseline(c) {c.candidates=c.candidates.filter(d=>d.baseline?.id&&d.baseline?.valid_until&&Date.parse(d.baseline.valid_until)>Date.now());if(!c.candidates.length)fail('DESTINATION_BASELINE_REQUIRED');},
  async delta(c) {c.candidates=c.candidates.filter(d=>d.delta?.signal_revision===c.signal.revision&&d.delta?.meaningful===true&&d.delta?.evidence_ids?.every(id=>c.signal.evidence.includes(id))&&d.delta.evidence_ids.length);},
  async novelty_gate(c) {if(!c.candidates.length)fail('NO_MEANINGFUL_DELTA');},
  async route(c,e) {
    c.routing_memory ||= await e.store.get('routing_memory');
    const options=[];
    for(const d of c.candidates)for(const f of d.formats){const key=keyOf(c.input.product,c.signal.id,d.id,f);const l=c.state.routes[key];const health=c.state.platforms?.[c.input.product+':'+d.platform];const feedback=historicalRoutingInput(c.routing_memory,{destination:d.id,platform:d.platform,evidence_state:c.signal.state});options.push({id:d.id,destination:d,format:f,key,score:(d.relevance||0)+score(c.state,key)+feedback.adjustment,learned:score(c.state,key),historical_evidence:feedback,breaker:l?.failures>=3||health?.failures>=3,cooldown:Date.parse(l?.retry_at||0)>Date.now()||Date.parse(health?.retry_at||0)>Date.now()});}
    options.sort((a,b)=>Number(a.destination.open_access_prepare_only)-Number(b.destination.open_access_prepare_only)||b.score-a.score||a.id.localeCompare(b.id)||a.format.localeCompare(b.format));
    const available=ownerPreview(c.input)?options:options.filter(o=>!o.breaker&&!o.cooldown);
    c.route=c.input.destination_id?available.find(o=>o.id===c.input.destination_id):(available.find(o=>o.destination.platform!=='X')||available[0]);
    if(c.input.destination_id&&!c.route)fail('REQUESTED_DESTINATION_NOT_AVAILABLE');
    c.selection={learning_version:c.state.version,options:options.map(({destination,...o})=>o),selected:c.route?.key||null};
    if(!c.route)fail('CIRCUIT_OPEN_OR_RATE_LIMITED');
    if(ownerPreview(c.input)&&(c.route.breaker||c.route.cooldown))c.preview_warnings=[{gate:'route',reason:'DISTRIBUTION_CIRCUIT_OR_COOLDOWN_REQUIRES_RESOLUTION'}];
  },
  async editorial_intelligence(c,e) {
    c.allowed_copy=[...(c.signal.approved_copy||[])];
    if(c.input.product==='EMRADAR'&&c.route.destination.platform==='X'){const native=nativeXCopy(c.signal);c.allowed_copy=[native.copy];c.copy=native.copy;c.fact_bindings=native.evidence_refs;c.copy_method=native.method;return;}
    if(c.route?.destination?.platform==='OPEN_ROUTE'){
      approved(c.product,c.signal);if(digest(c.product)!==c.truth_hash)fail('EVIDENCE_TRUTH_CHANGED');
      if(c.reused_proposal&&!c.input.refresh_editorial){
        c.email_proposition=c.reused_proposal.asset.email?.proposition||reuseProposition(c.reused_proposal,c.signal);
        c.copy=c.input.reviewed_proposal_id?c.reused_proposal.copy:'Subject: '+c.email_proposition.subject+'\n\n'+c.email_proposition.body;c.allowed_copy=[c.copy];c.copy_method='native_gated_proposition_reuse';return;
      }
      const context=editorialContext(c),key='editorial_copy:'+digest(context);
      let editorial=await e.store.get(key);
      if(!editorial){const work=await produceEditorial(context,(request,attempt)=>e.modelWork(c,'editorial_intelligence',request,'creation_approved',attempt),record=>e.store.put('editorial_attempt:'+c.run_id+':'+record.attempt,{...record,campaign_id:c.input.campaign_id,destination:c.route.id}));editorial={result:work.result,proof:work.proof,origin_run_id:c.run_id,preview_warnings:work.preview_warnings||[]};await e.store.put(key,editorial);}
      editorial.result=normalizeCorrespondence(editorial.result,c.signal,c.route.destination.route_record);
      try{validateEditorial(editorial.result,editorial.proof,context);editorial.preview_warnings=[];}catch{}
      c.editorial={...editorial,contract_revision:editorialVersion,cache_key:key};c.preview_warnings=[...(c.preview_warnings||[]),...(editorial.preview_warnings||[])];
      try{c.allowed_copy=[validateEditorial(editorial.result,editorial.proof,context)];}catch(error){if(!ownerPreview(c.input)||!previewWarning(error.message))throw error;c.preview_warnings.push({gate:'editorial_intelligence',reason:error.message});c.allowed_copy=['Subject: '+editorial.result.subject+'\n\n'+editorial.result.body];}c.copy_method='editorial_copy_system_v1';
      c.copy=c.allowed_copy[0];return;
    }
    if(!c.allowed_copy.length&&c.signal.source_facts?.length){
      const deterministicApproved=c.product.copy_policy?.extractive_template_approved===true||(c.input.product==='EMRADAR'&&c.product.review.editorial===true);
      if(!deterministicApproved)fail('COPY_TEMPLATE_APPROVAL_REQUIRED');
      const facts=c.signal.source_facts.filter(f=>typeof f.text==='string'&&f.text&&c.signal.evidence.includes(f.id));
      if(!facts.length)fail('SOURCE_FACT_BINDING_REQUIRED');
      const state=c.signal.state;
      const uncertainty=(c.signal.source_uncertainty||[])[0]||'UNKNOWN';
      const copy=c.input.product==='EMRADAR'&&c.route.destination.platform==='X'?`${c.input.product} — ${state}\n\n${facts[0].text}\n\nUnresolved: ${uncertainty}`:`${c.input.product} — ${state}\n\n${facts[0].text}\n\nUnresolved evidence: ${(c.signal.source_uncertainty||[]).join('; ')||'UNKNOWN'}`;
      if(c.input.product==='EMRADAR'&&c.route.destination.platform==='X'&&copy.length>280)fail('DESTINATION_NATIVE_COPY_REQUIRED');
      c.allowed_copy=[copy];
      c.fact_bindings=facts.map(f=>f.id);c.copy_method='extractive_template';
    }
    if(!c.allowed_copy.length){
      if(c.input.product==='EMRADAR')fail('DETERMINISTIC_COPY_PATH_REQUIRED');
      const context={source:c.signal,brand_system:c.product.brand_system,destination:c.route.id};
      const work=await e.modelWork(c,'editorial_intelligence',context,'creation_approved');
      if(!work.proof.evidence_refs.every(id=>c.signal.evidence.includes(id)))fail('HARNESS_COPY_EVIDENCE_OUT_OF_SCOPE');
      if(!Array.isArray(work.result.copy)||!work.result.copy.every(x=>typeof x==='string'&&x.includes(c.signal.state)))fail('HARNESS_COPY_STATE_NOT_PRESERVED');
      c.allowed_copy=work.result.copy;c.copy_proof=work.proof;c.copy_method='verified_harness';
    }
    c.copy=c.allowed_copy[0];if(!c.copy)fail('COPY_PRODUCTION_FAILED');
  },
  async localization(c,e) {
    if(c.input.reviewed_proposal_id){c.localization=structuredClone(c.reused_proposal.asset.localization);return;}
    if(c.email_proposition){c.localization={language:c.email_proposition.language,source_hash:digest(c.signal),copy_hash:digest(c.copy),evidence_refs:[...c.signal.evidence],status:'VERIFIED'};return;}
    if(c.editorial){c.localization={language:c.editorial.result.language,source_hash:digest(c.signal),copy_hash:digest(c.copy),evidence_refs:c.editorial.result.evidence_refs,status:'VERIFIED'};return;}
    if(c.route?.id!=='REDIMIN-EDITORIAL')return;
    const source_copy=c.copy;
    const cacheKey='localization:'+digest([c.input.product,c.signal.id,c.signal.revision,c.route.id,source_copy,'es-CL']);
    let localized=await e.store.get(cacheKey);
    if(!localized){
      const work=await e.modelWork(c,'localization',{source_copy,source_language:'en',target_language:'es-CL',signal_state:c.signal.state,evidence_refs:[...c.signal.evidence],destination:c.route.id},'creation_approved');
      localized={...work.result,evidence_refs:[...work.proof.evidence_refs]};
      await e.store.put(cacheKey,localized);
    }
    if(localized.language!=='es-CL'||typeof localized.copy!=='string'||!localized.copy.trim())fail('LOCALIZATION_RESULT_INVALID');
    if(!localized.evidence_refs.every(id=>c.signal.evidence.includes(id))||localized.signal_state!==c.signal.state)fail('LOCALIZATION_EVIDENCE_VALIDATION_FAILED');
    if(/\b(compra ahora|rendimiento garantizado|inversi[oó]n sin riesgo)\b/i.test(localized.copy))fail('LOCALIZATION_QUALITY_GATE_FAILED');
    c.allowed_copy=[localized.copy];c.copy=localized.copy;c.localization={language:'es-CL',source_hash:digest(source_copy),copy_hash:digest(c.copy),evidence_refs:[...localized.evidence_refs],status:'VERIFIED'};
  },
  async human_ready_email(c,e) {
    const route=c.route?.destination?.route_record;if(!isEmail(route)&&!(ownerPreview(c.input)&&c.route?.destination?.platform==='OPEN_ROUTE'))return;
    const identity=e.adapters.OPEN_ROUTE?.senderIdentity?.();
    const proposition=c.email_proposition||c.editorial?.result;
    if(!proposition)fail('EDITORIAL_TRANSFORMATION_REQUIRED');
    if(c.input.reviewed_proposal_id){c.email=structuredClone(c.reused_proposal.asset.email);return;}
    if(ownerPreview(c.input)){try{c.email=isEmail(route)&&!c.preview_warnings?.length?humanReadyEmail({proposition,signal:c.signal,route,identity,product:c.input.product}):previewCorrespondence(proposition,c.signal,route);}catch(error){if(!previewWarning(error.message))throw error;c.preview_warnings.push({gate:'human_ready_email',reason:error.message});c.email=previewCorrespondence(proposition,c.signal,route);}}else c.email=humanReadyEmail({proposition,signal:c.signal,route,identity,product:c.input.product});
    c.copy='Subject: '+c.email.subject+'\n\n'+c.email.body;c.allowed_copy=[c.copy];
    c.localization={...c.localization,copy_hash:digest(c.copy),language:c.email.language};
  },
  async capability_claim_gate(c,e) {
    if(!isEmail(c.route?.destination?.route_record))return;
    c.capability_claim_gate=validateHumanEmail(c.email,c.signal,c.route.destination.route_record,e.adapters.OPEN_ROUTE?.senderIdentity?.());
  },
  async editorial_quality_gate(c) {
    if(!c.allowed_copy.includes(c.copy)||!c.product.review.editorial)fail('EDITORIAL_REVIEW_REQUIRED');
    if(c.route?.destination?.platform==='OPEN_ROUTE'&&!c.email){if(!c.editorial||c.copy_method!=='editorial_copy_system_v1')fail('EDITORIAL_TRANSFORMATION_REQUIRED');if(externalSchemaLeak(c.copy))fail('EXTERNAL_EDITORIAL_SCHEMA_LEAK');validateEditorial(c.editorial.result,c.editorial.proof,editorialContext(c));}
    if(/\b(buy now|guaranteed return|risk.free investment)\b/i.test(c.copy))fail('UNSUPPORTED_FINANCIAL_CLAIM');
  },
  async variant_factory(c) {
    c.state.variants ||= {};
    c.copy=[...c.allowed_copy].sort((a,b)=>(c.state.variants[digest([c.input.product,c.signal.id,c.route.id,c.route.format,b])]?.score||0)-(c.state.variants[digest([c.input.product,c.signal.id,c.route.id,c.route.format,a])]?.score||0))[0];
    if(/\b(buy now|guaranteed return|risk.free investment)\b/i.test(c.copy))fail('VARIANT_EVIDENCE_OR_EDITORIAL_BOUND');
    c.variant_key=digest([c.input.product,c.signal.id,c.route.id,c.route.format,c.copy]);
    c.variant={id:digest([c.signal.id,c.signal.revision,c.copy]).slice(0,16),copy:c.copy,source_state:c.signal.state,evidence:[...c.signal.evidence],voice:c.product.brand_system||'UNDEFINED'};},
  async format(c,e) {
    if(c.input.reviewed_proposal_id){c.asset=structuredClone(c.reused_proposal.asset);return;}
    if(c.input.product==='EMRADAR'&&c.route.destination.platform==='X'){
      const key='x_visual:'+digest([c.signal,c.product.source_receipt||null,'V1']);
      let visual=await e.store.get(key);if(!visual){visual=await evidenceVisual(c.signal,c.product.source_receipt);await e.store.put(key,visual);}
      c.asset={...visual,copy:c.copy,combined_review_artifact:true};validateCombinedX(c.asset,c.signal,c.product.source_receipt);
    }else if(c.route.destination.platform==='OPEN_ROUTE'){c.asset={format:c.route.destination.route_record.accepted_formats[0],copy:c.copy,delivery:{...c.route.destination.route_record},localization:c.localization||null,...(c.email?{email:c.email,capability_claim_gate:c.capability_claim_gate}: {})};}
    else if(c.route.format==='svg'){
      const escape=s=>s.replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[ch]));
      const rows=c.copy.match(/.{1,65}(?:\s|$)|.{1,65}/g)||[];
      c.asset={format:'svg',copy:c.copy,svg:`<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="${Math.max(240,rows.length*32+110)}"><rect width="100%" height="100%" fill="#101820"/><text fill="white" font-size="24" font-family="sans-serif">${rows.map((s,i)=>`<tspan x="35" y="${65+i*32}">${escape(s)}</tspan>`).join('')}</text></svg>`};
    }else if(c.route.format==='image'){
      const a=c.signal.approved_asset;if(!a?.base64||!a.sha256||!a.reviewed||!['image/png','image/jpeg'].includes(a.mime))fail('APPROVED_IMAGE_REQUIRED');
      if(crypto.createHash('sha256').update(Buffer.from(a.base64,'base64')).digest('hex')!==a.sha256)fail('ASSET_HASH_MISMATCH');
      c.asset={...a,format:'image',copy:c.copy};
    }else if(c.route.format==='text')c.asset={format:'text',copy:c.copy};else fail('FORMAT_WORKER_UNAVAILABLE');
  },
  async adapt(c,e) {c.adapter=c.route.destination.open_access_prepare_only?{formats:c.route.destination.route_record.accepted_formats,cost:c.route.destination.route_record.cost,authorized:async()=>true,validate:async()=>true}:e.adapters[c.route.destination.platform];if(!c.adapter?.formats.includes(c.asset.format))fail('DESTINATION_ADAPTER_UNAVAILABLE');await c.adapter.validate?.(c.asset);},
  async evidence_gate(c) {approved(c.product,c.signal);if(digest(c.product)!==c.truth_hash||c.variant.source_state!==c.signal.state||!c.allowed_copy.includes(c.asset.copy))fail('EVIDENCE_TRUTH_CHANGED');},
  async brand_gate(c) {if(!c.product.review.brand||!c.product.review.risk)fail('BRAND_OR_RISK_REVIEW_REQUIRED');},
  async permission_gate(c) {
    const d=c.route.destination;
    if(d.permission?.approved!==true||Date.parse(d.permission.valid_until)<=Date.now()||!d.permission.valid_until||d.permission.signal_revision!==c.signal.revision)fail('DESTINATION_PERMISSION_REQUIRED');
    if(c.adapter.authorized&&!await c.adapter.authorized(c.input.product)&&!(c.input.product==='EMRADAR'&&c.route.destination.platform==='X'&&c.input.stop_at==='PUBLICATION_REVIEW'))fail('ACCOUNT_AUTHORIZATION_REQUIRED');
    // UNKNOWN-cost APIs are blocked until a bounded owner budget exists.
    if(c.adapter.cost!=='ZERO'&&!c.route.destination.review_only){
      if(!c.adapter.quote)fail('ACTUAL_COST_BOUND_UNKNOWN');
      const budget=c.product.budget;
      if(budget?.approved!==true||!Number.isFinite(budget.max_action_usd)||budget.max_action_usd<=0||!Number.isFinite(budget.max_cycle_usd)||budget.max_cycle_usd<budget.max_action_usd||!Number.isFinite(d.max_api_calls)||d.max_api_calls<1)fail('API_COST_APPROVAL_REQUIRED');
      if(c.adapter.publishCalls&&d.max_api_calls<c.adapter.publishCalls(c.asset))fail('API_CALL_BOUND_TOO_LOW');
      if(!Number.isFinite(d.max_action_usd)||d.max_action_usd>budget.max_action_usd)fail('API_COST_BOUND_REQUIRED');
    }
  },
  async publication_review(c,e) {
    if(c.route.destination.platform==='LOCAL')return;
    if(c.input.product==='EMRADAR'&&c.route.destination.platform==='X')validateCombinedX(c.asset,c.signal,c.product.source_receipt);
    if(!ownerPreview(c.input)&&isEmail(c.route.destination.route_record)&&(!c.email||c.capability_claim_gate?.status!=='PASS'))fail('HUMAN_EMAIL_AND_CAPABILITY_GATE_REQUIRED');
    const publication_key=digest([c.input.product,c.signal.id,c.signal.revision,c.route.id,c.route.format,c.variant.id]);
    const destination_binding={id:c.route.destination.id,platform:c.route.destination.platform,format:c.route.format,permission:c.route.destination.permission,route_record:c.route.destination.route_record||null};
    const review_hash=digest({product_truth:c.truth_hash,signal_revision:c.signal.revision,asset:c.asset,destination:destination_binding,source_receipt:c.product.source_receipt||null});
    const proposal_id=digest([publication_key,review_hash]);
    const existing=await e.store.get('publication_review:'+proposal_id);if(['REJECTED','SUPERSEDED'].includes(existing?.status))fail('EDITORIAL_REJECTED_COPY_REQUIRES_REGENERATION');
    if(c.input.reviewed_proposal_id&&(proposal_id!==c.reused_proposal.proposal_id||review_hash!==c.reused_proposal.review_hash))fail('REVIEWED_EMAIL_ARTIFACT_CHANGED');
    const approval=await e.store.get('publication_approval:'+proposal_id);
    if(c.input.stop_at!=='PUBLICATION_REVIEW'&&approval?.review_hash===review_hash&&approval.approved_by==='OWNER'&&Date.parse(approval.expires_at)>Date.now()){
      if(c.reused_proposal?.asset.email&&digest(c.asset)!==digest(c.reused_proposal.asset))fail('REVIEWED_EMAIL_ARTIFACT_CHANGED');
      c.review={proposal_id,review_hash,decision:'APPROVED',approved_at:approval.approved_at};return;
    }
    const proposal={proposal_id,review_hash,publication_key,input:{product:c.input.product,campaign_id:c.input.campaign_id,signal_id:c.signal.id,destination_id:c.route.id},product:c.input.product,signal_id:c.signal.id,signal_revision:c.signal.revision,signal_state:c.signal.state,evidence_refs:[...c.signal.evidence],destination:c.route.id,platform:c.route.destination.platform,format:c.asset.format,variant:c.variant.id,copy:c.asset.copy,asset:c.asset,source_receipt:c.product.source_receipt||null,cost_state:c.adapter.cost,publication_cost_gate:c.adapter.cost==='ZERO'?'READY':'REQUIRED_BEFORE_EXECUTION',created_at:now(),expires_at:new Date(Date.now()+24*3600000).toISOString(),status:'AWAITING_REVIEW'};
    proposal.review_contract_revision='sfy-bounded-draft-correspondence-v2';
    if(ownerPreview(c.input)){proposal.preview_warnings=[...new Map((c.preview_warnings||[]).map(w=>[w.gate+':'+w.reason,w])).values()];proposal.review_state=proposal.preview_warnings.length?'PREVIEW_WITH_WARNING':'READY';proposal.preview_only=proposal.preview_warnings.length>0||c.email?.preview_only===true;proposal.permission_state='EXACT_OWNER_REVIEW_REQUIRED';}
    if(c.route.destination.platform==='X'){proposal.content_review_state='READY';proposal.distribution_cost_state=c.adapter.cost;proposal.distribution_state=c.adapter.cost==='ZERO'?'EXACT_OWNER_REVIEW_REQUIRED':'BLOCKED_PENDING_COST_RESOLUTION';}
    proposal.review_binding={product_truth:c.truth_hash,destination:destination_binding};
    proposal.evidence_binding={source_revision:c.signal.revision,signal_state:c.signal.state,evidence_refs:[...c.signal.evidence],source_facts:structuredClone(c.signal.source_facts||[]),source_uncertainty:[...(c.signal.source_uncertainty||[])]};
    proposal.capability_claim_gate=c.capability_claim_gate||null;proposal.email_version=c.email?emailVersion:null;proposal.correspondence_features=c.email?.features||null;
    proposal.run_id=c.run_id;proposal.cost_receipt_id=c.run_id;proposal.editorial=c.editorial?{contract_revision:c.editorial.contract_revision,cache_key:c.editorial.cache_key,origin_run_id:c.editorial.origin_run_id}:null;
    if(existing){proposal.created_at=existing.created_at;proposal.expires_at=existing.expires_at;}
    await e.store.put('publication_review:'+proposal_id,proposal);
    if(c.input.revision_proposal_id&&c.reused_proposal.proposal_id!==proposal_id){
      const old={...c.reused_proposal,status:'SUPERSEDED',replacement_proposal_id:proposal_id};
      await e.store.put('publication_review:'+old.proposal_id,old);
      proposal.replaces_proposal_id=old.proposal_id;await e.store.put('publication_review:'+proposal_id,proposal);
    }
    c.review={proposal_id,review_hash,decision:'AWAITING_REVIEW',expires_at:proposal.expires_at,product:proposal.product,signal_state:proposal.signal_state,destination:proposal.destination,format:proposal.format,copy:proposal.copy,evidence_refs:proposal.evidence_refs};
    c.review_pending=true;c.status='AWAITING_REVIEW';c.blocker='PUBLICATION_REVIEW_REQUIRED';
  },
  async execute(c,e) {
    if(intakeHeld())fail('MARKETING_EMERGENCY_STOP');
    if(c.route.destination.platform!=='LOCAL'&&(c.input.stop_at==='PUBLICATION_REVIEW'||c.review?.decision!=='APPROVED'))fail('EXACT_PUBLICATION_APPROVAL_REQUIRED');
    if(c.route.destination.open_access_prepare_only)fail('OPEN_ROUTE_EXECUTOR_NOT_IMPLEMENTED');
    c.publication_key=c.approved_distribution?c.approved_proposal.publication_key:digest([c.input.product,c.signal.id,c.signal.revision,c.route.id,c.route.format,c.variant.id]);
    const prior=await e.store.get('receipt:'+c.publication_key);
    if(['PUBLISHED','SUBMITTED'].includes(prior?.execution_status)){c.receipt=prior;c.duplicate=true;return;}
    if(prior?.execution_status==='IN_FLIGHT'||prior?.execution_status==='AMBIGUOUS')fail('AMBIGUOUS_PUBLICATION_RECOVERY_REQUIRED');
    if(prior?.attempts>=c.max_attempts)fail('RETRY_BOUND');
    if(Date.parse(prior?.retry_at||0)>Date.now())fail('RETRY_NOT_DUE');
    let dailyLedger;
    let dailyLedgerKey;
    const standing=c.approved_distribution&&c.input.product==='EMRADAR'&&c.route.destination.platform==='X';
    if(c.adapter.cost!=='ZERO'){
      if(!c.adapter.quote)fail('ACTUAL_COST_BOUND_UNKNOWN');
    }
    if(c.adapter.cost!=='ZERO'&&!standing){
      dailyLedgerKey='cost:'+c.input.product+':'+now().slice(0,10);dailyLedger=await e.store.get(dailyLedgerKey)||{reserved_usd:0,calls:0};const b=c.product.budget;
      if(!Number.isFinite(b.max_daily_usd)||!Number.isFinite(b.max_daily_api_calls)||dailyLedger.reserved_usd+c.route.destination.max_action_usd>b.max_daily_usd||dailyLedger.calls+c.route.destination.max_api_calls>b.max_daily_api_calls)fail('DAILY_COST_OR_CALL_BOUND');
    }
    const costQuote=c.adapter.cost==='ZERO'?zeroQuote(c.publication_key):c.adapter.quote?await c.adapter.quote({operation:'publish',asset:c.asset,product:c.input.product}):null;
    c.cost_reservation=await e.spend.reserve({campaign_id:c.input.campaign_id,quote:costQuote,action_id:c.run_id+':publish',run_id:c.run_id,category:'distribution',standing_authority:standing});
    if(dailyLedger){dailyLedger.reserved_usd+=c.route.destination.max_action_usd;dailyLedger.calls+=c.route.destination.max_api_calls;await e.store.put(dailyLedgerKey,dailyLedger);c.reserved_cost_usd=c.route.destination.max_action_usd;}
    c.receipt={id:c.publication_key,destination:c.route.id,platform:c.route.destination.platform,variant:c.variant.id,variant_key:c.variant_key,format:c.route.format,timestamp:now(),execution_status:'IN_FLIGHT',external_id:null,url:null,campaign_id:c.input.campaign_id,product:c.input.product,signal_id:c.signal.id,signal_revision:c.signal.revision,signal_state:c.signal.state,evidence_refs:[...c.signal.evidence],source_receipt:c.product.source_receipt||null,publication_review:c.review||null,route_key:c.route.key,attempts:(prior?.attempts||0)+1,max_attempts:c.max_attempts,retry_at:null,error:null,api_cost_usd:c.adapter.cost==='ZERO'?0:'UNKNOWN',ad_spend_usd:0,delivery_hash:digest(c.asset),reserved_cost_usd:c.reserved_cost_usd||0};
    const pendingKey='pending:'+c.input.product+':'+c.signal.id+':'+c.signal.revision;
    if(c.asset.email)Object.assign(c.receipt,{recipient:c.asset.email.to,sender_identity:c.asset.email.from,approved_artifact_hash:c.review.review_hash,proposal_id:c.review.proposal_id,idempotency_key:c.publication_key});
    if(prior){const history=await e.store.get('receipt_history:'+c.publication_key)||[];history.push(prior);await e.store.put('receipt_history:'+c.publication_key,history);}
    c.receipt.account=c.route.destination.route_record?.public_contact_point||'UNKNOWN';
    c.receipt.approved_artifact_hash ||= c.review?.review_hash||null;
    c.receipt.proposal_id ||= c.review?.proposal_id||null;
    if(c.approved_distribution)Object.assign(c.receipt,{review_hash:c.review.review_hash,asset_hash:c.asset.sha256||digest(c.asset),idempotency_key:c.publication_key,provider_route:c.asset.delivery||c.route.destination.id});
    if(c.approved_distribution){if(!await e.store.claimReceipt('receipt:'+c.publication_key,c.receipt)){await e.spend.settle(c.cost_reservation,c.adapter.cost==='ZERO'?zeroBilling(c.publication_key):null);fail('PUBLICATION_ALREADY_CLAIMED');}}
    else await e.store.put('receipt:'+c.publication_key,c.receipt);
    await e.store.put(pendingKey,{receipt_id:c.publication_key,status:'IN_FLIGHT'});
    try {
      const result=await c.adapter.publish(c.asset,c.publication_key,c.input.product,c.approved_distribution?{proposal:c.approved_proposal,approval:await e.store.get('publication_approval:'+c.approved_proposal.proposal_id)}:null);
      if(!result?.id||!['PUBLISHED','SUBMITTED'].includes(result.status))fail('PUBLICATION_RECEIPT_MISSING');
      Object.assign(c.receipt,{execution_status:result.status,external_id:String(result.id),url:result.url||null,timestamp:now(),api_cost_usd:result.cost_usd??'UNKNOWN',delivery_status:result.delivery_status||null,provider_receipt:result.provider_receipt||null});
      c.provider_billing=result.billing;
    }catch(error){
      c.provider_billing=error.billing;
      const status=error.status;
      // A timeout/5xx after POST might already have published. Never repeat it blindly.
      Object.assign(c.receipt,{execution_status:status===429?'RATE_LIMITED':status&&status>=400&&status<500?'FAILED':'AMBIGUOUS',error:String(error.message).slice(0,200),retry_at:status===429?new Date(Math.max(Date.now()+60000,error.retry_at||0)).toISOString():null});
    }
    // Persist provider outcome before billing/indexing, so later failures cannot lose delivery proof.
    await e.store.put('receipt:'+c.publication_key,c.receipt);
    c.receipt.provider_cost=await e.spend.settle(c.cost_reservation,c.adapter.cost==='ZERO'?zeroBilling(c.publication_key):c.provider_billing);
    await e.store.put('receipt:'+c.publication_key,c.receipt);
    if(c.receipt.execution_status!=='AMBIGUOUS')await e.store.put(pendingKey,null);
  },
  async receipt(c,e) {
    if(!c.receipt)c.receipt={id:digest([c.run_id,c.input]),destination:c.route?.id||'UNKNOWN',platform:c.route?.destination.platform||'UNKNOWN',variant:c.variant?.id||'UNKNOWN',format:c.asset?.format||'UNKNOWN',timestamp:now(),execution_status:c.review_pending?'AWAITING_REVIEW':'BLOCKED',external_id:null,url:null,campaign_id:c.input.campaign_id,product:c.input.product,signal_id:c.signal?.id||'UNKNOWN',signal_revision:c.signal?.revision||'UNKNOWN',signal_state:c.signal?.state||'UNKNOWN',evidence_refs:c.signal?.evidence||[],source_receipt:c.product?.source_receipt||null,route_key:c.route?.key||null,attempts:0,max_attempts:c.max_attempts||0,retry_at:null,error:c.blocker||'UNKNOWN',blocker_disposition:c.blocker?blockerDisposition(c.blocker):null,review:c.review||null,api_cost_usd:c.worker_reserved_usd?'UNKNOWN':0,worker_reserved_usd:c.worker_reserved_usd||0,ad_spend_usd:0};
    c.receipt.worker_costs=c.provider_costs||[];
    await e.store.put('receipt:'+c.receipt.id,c.receipt);await e.store.put('latest_receipt',c.receipt);
    const index=await e.store.get('receipt_index')||[];const filtered=index.filter(r=>r.id!==c.receipt.id);filtered.push({...c.receipt,last_collection:now()});await e.store.put('receipt_index',filtered);
  },
  async observe(c,e) {
    c.performance={status:'UNKNOWN',metrics:{},source:'UNAVAILABLE',observed_at:now(),cost_usd:'UNKNOWN'};
    const r=c.receipt;const a=e.adapters[r.platform];const linkedProposal=await e.store.get('publication_review:'+(r.proposal_id||r.publication_review?.proposal_id));const readReceipt={...r,publication_domain:linkedProposal?.asset.delivery?.evidence_source_url?new URL(linkedProposal.asset.delivery.evidence_source_url).hostname.replace(/^www\./,''):null};
    if(Date.parse(c.state.platforms?.[r.product+':'+r.platform]?.retry_at||0)>Date.now()){c.performance.reason='PLATFORM_RATE_LIMIT_COOLDOWN';await e.store.put('performance:'+r.id,c.performance);return;}
    if(['PUBLISHED','SUBMITTED'].includes(r.execution_status)&&a?.collect&&a.cost==='ZERO') {await costCall(e.store,c.run_id,{action_id:c.run_id+':collect',category:'observation',provider:r.platform,service:'collect',amount_aud:0,state:'ZERO',reason:'VERIFIED_ZERO_COST_ADAPTER'});try{c.performance=await a.collect(readReceipt);}catch(error){c.performance.reason=error.message;if(error.status===429){c.state.platforms ||= {};const k=r.product+':'+r.platform;c.state.platforms[k]={...(c.state.platforms[k]||{failures:0}),retry_at:new Date(Math.max(Date.now()+60000,error.retry_at||0)).toISOString()};}}}
    else if(['PUBLISHED','SUBMITTED'].includes(r.execution_status)&&a?.collect){
      const p=e.products[r.product];if(!a.quote){c.performance.reason='ACTUAL_COST_BOUND_UNKNOWN';await e.store.put('performance:'+r.id,c.performance);return;}if(p?.budget?.metrics_approved&&Number.isFinite(p.budget.max_metrics_calls)&&p.budget.max_metrics_calls>0){
        const ledgerKey='metrics_cost:'+r.product+':'+now().slice(0,10);const ledger=await e.store.get(ledgerKey)||{calls:0,reserved_usd:0};const b=p.budget;
        if(!Number.isFinite(b.max_metrics_action_usd)||b.max_metrics_action_usd<=0||!Number.isFinite(b.max_metrics_daily_usd)||ledger.calls>=b.max_metrics_calls||ledger.reserved_usd+b.max_metrics_action_usd>b.max_metrics_daily_usd)c.performance.reason='METRICS_COST_OR_CALL_BOUND';
        else{const quote=await a.quote({operation:'collect',receipt:r});const reservation=await e.spend.reserve({campaign_id:r.campaign_id,quote,action_id:c.run_id+':collect',run_id:c.run_id,category:'observation'});ledger.calls++;ledger.reserved_usd+=b.max_metrics_action_usd;await e.store.put(ledgerKey,ledger);try{c.performance=await a.collect(readReceipt);}catch(error){c.performance.reason=error.message;c.performance.billing=error.billing;if(error.status===429){c.state.platforms ||= {};const k=r.product+':'+r.platform;c.state.platforms[k]={...(c.state.platforms[k]||{failures:0}),retry_at:new Date(Math.max(Date.now()+60000,error.retry_at||0)).toISOString()};}}c.performance.provider_cost=await e.spend.settle(reservation,c.performance.billing);}
      }else c.performance.reason='METRICS_API_COST_APPROVAL_REQUIRED';
    }
    const candidates=await e.store.get('publication_candidates:'+r.id)||[];for(const url of c.performance.publication_candidates||[]){if(candidates.length<3&&!candidates.some(c=>c.url===url))candidates.push({url,at:now(),origin:'MATCHED_GMAIL_REPLY_LINK_NOT_PUBLICATION_PROOF'});}await e.store.put('publication_candidates:'+r.id,candidates);
    for(const candidate of candidates.slice(0,3)){try{const proposal=await e.store.get('publication_review:'+(r.proposal_id||r.publication_review?.proposal_id));const observation=await checkPublication({proposal,receipt:r,url:candidate.url});await e.store.put('publication_check:'+r.id+':'+digest(candidate.url),observation);if(observation.state==='PUBLISHED')(c.performance.events||=[]).push(observation);}catch(error){await e.store.put('publication_check:'+r.id+':'+digest(candidate.url),{state:'UNKNOWN',reason:error.message});}}
    await e.store.put('performance:'+r.id,c.performance);
  },
  async normalize(c,e) {c.outcome=await normalizeOutcome(e.store,c.receipt,c.performance);},
  async performance_analysis(c,e) {c.analysis=await analyseOutcomes(e.store);},
  async learn(c,e) {
    c.routing_memory=await learnRouting(e.store,c.analysis);
    const r=c.receipt;if(!r.route_key||!['PUBLISHED','SUBMITTED','FAILED','RATE_LIMITED','AMBIGUOUS'].includes(r.execution_status))return;
    const event=digest([r.id,r.attempts,r.execution_status]);
    const observation=digest([event,c.outcome.measurements,c.outcome.evidence_strength]);
    if(c.state.processed[observation])return;
    const newExecution=!c.state.processed[event];
    c.state.platforms ||= {};const platformKey=r.product+':'+r.platform;
    if(newExecution){const health=c.state.platforms[platformKey]||{failures:0,retry_at:null};health.failures=['PUBLISHED','SUBMITTED'].includes(r.execution_status)?0:health.failures+1;health.retry_at=r.retry_at;c.state.platforms[platformKey]=health;}
    const old=c.state.routes[r.route_key]||{successes:0,failures:0,confidence:0,evidence_strength:'UNKNOWN',failed_routes:[]};
    const record=structuredClone(old);
    if(newExecution&&['PUBLISHED','SUBMITTED'].includes(r.execution_status)){record.successes++;record.failures=0;}else if(newExecution){record.failures++;record.failed_routes.push({receipt_id:r.id,status:r.execution_status,at:r.timestamp});record.failed_routes=record.failed_routes.slice(-20);}
    record.retry_at=r.retry_at;record.confidence=Math.min(0.8,(record.successes+record.failures)/10);record.evidence_strength=c.outcome.evidence_strength;
    // Local read-back affects local delivery reliability only; cannot imply audience engagement.
    const verified=c.outcome.measurements.content_verified;
    if(verified?.scope==='local_delivery')record.measurement_adjustment=verified.value===1?0.05:-0.5;
    const likes=c.outcome.measurements.like_count;
    const impressions=c.outcome.measurements.impression_count;
    if(likes?.scope==='x_public_metrics'&&impressions?.scope==='x_public_metrics'&&impressions.value>=100&&likes.value<=impressions.value)record.measurement_adjustment=Math.min(0.2,likes.value/impressions.value);
    record.provider_costs=c.outcome.provider_costs;record.last_receipt=r.id;record.timing_observations={last_execution_at:r.timestamp,last_observed_at:c.outcome.observed_at,optimal_time:'UNKNOWN'};
    record.current_measurement_state=c.performance.status;
    if(Object.keys(c.outcome.measurements).length)record.measurements=c.outcome.measurements;
    record.last_known_evidence_strength=record.evidence_strength==='DIRECT_MEASUREMENT'?'DIRECT_MEASUREMENT':old.last_known_evidence_strength||'UNKNOWN';
    c.state.routes[r.route_key]=record;
    c.state.variants ||= {};if(r.variant_key)c.state.variants[r.variant_key]={score:record.measurement_adjustment||0,evidence_strength:record.evidence_strength,receipt_id:r.id};c.state.processed[event]=true;c.state.processed[observation]=true;c.state.version++;
    c.state.history.push({version:c.state.version,route_key:r.route_key,receipt_id:r.id,before:old,after:record});
  },
  async distribution_map(c,e) {if(c.product&&digest(c.product)!==c.truth_hash)fail('LEARNING_CANNOT_CHANGE_PRODUCT_TRUTH');await e.store.put('learning',c.state);},
};
