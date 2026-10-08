import crypto from 'node:crypto';
import {emradarSource,signSource} from './intake.js';
import scanControl from '../config/scan-control.json' with {type:'json'};
import {validateCombinedX} from './x-visual.js';
import {formationFromSignal,openRouteScout,prepareRouteAssets,commercialEvidenceBranch,routingRevision} from './open-route-scout.js';
import openRouteDirectory from '../state/open-route-directory.json' with {type:'json'};

const origin='https://emerging-markets-radar.onrender.com';
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const at=()=>new Date().toISOString();
export const reviewContractRevision='sfy-bounded-draft-correspondence-v3';
const executed=new Set(['PUBLISHED','SUBMITTED','IN_FLIGHT','AMBIGUOUS']);
// Terminal optional content/qualification failures are retained for review.
// Infrastructure, ambiguous execution, source truth and cost authority failures
// remain unresolved campaign blockers; they must never be hidden as rejections.
const optionalTerminalGates=new Set(['UNVERIFIED_CAPABILITY_CLAIM','EDITORIAL_RESULT_INVALID','CAPABILITY_INVENTORY_VERIFICATION_REQUIRED','HUMAN_PROPOSITION_QUALITIES_REQUIRED','HUMAN_DESTINATION_REASON_OR_QUESTION_REQUIRED','HUMAN_RECIPIENT_AGENCY_REQUIRED','HUMAN_PROPOSITION_MEMO_OR_BOILERPLATE','HUMAN_CORRESPONDENCE_VERIFICATION_REQUIRED','EXTERNAL_EDITORIAL_SCHEMA_LEAK','UNSUPPORTED_FINANCIAL_CLAIM','EDITORIAL_CLAIM_BINDING_REQUIRED','EDITORIAL_UNCERTAINTY_NOT_PRESERVED','EDITORIAL_VERIFICATION_REQUIRED','EDITORIAL_DESTINATION_LENGTH_EXCEEDED','DESTINATION_PERMISSION_REQUIRED','REQUESTED_DESTINATION_NOT_AVAILABLE']);
const routingReceiptKey=campaignId=>'discovery_routing_completion:'+campaignId+':'+reviewContractRevision;
const completeReviewCheckpoint=(state,pkg,receipt)=>{
  if(state?.status!=='AWAITING_REVIEW'||state.review_contract_revision!==reviewContractRevision||pkg?.review_contract_revision!==reviewContractRevision||pkg?.routing_revision!==routingRevision)return false;
  if(receipt?.review_contract_revision!==reviewContractRevision||receipt.campaign_id!==state.campaign_id||receipt.status!=='COMPLETE')return false;
  if(receipt.route_plan_sha256!==pkg.route_plan_sha256||receipt.dispositions_sha256!==sha(JSON.stringify(pkg.route_dispositions||[])))return false;
  const dispositions=pkg.route_dispositions||[],ids=new Set(dispositions.map(d=>d.destination));
  return Array.isArray(pkg.proposals)&&pkg.proposals.length>0&&Array.isArray(receipt.discovered_destinations)&&receipt.discovered_destinations.every(id=>ids.has(id))&&
    Array.isArray(receipt.candidate_destinations)&&receipt.candidate_destinations.every(id=>ids.has(id)&&dispositions.find(d=>d.destination===id)?.status!=='DISCOVERED_ONLY');
};
export const intakeHeld=(env=process.env)=>scanControl.hold_new_scans===true||env.MARKETING_EMERGENCY_STOP==='true';
async function read(url,fetcher){
  const response=await fetcher(url,{cache:'no-store',signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw new Error('AUTHORITATIVE_SOURCE_HTTP_'+response.status);
  return Buffer.from(await response.arrayBuffer());
}
export async function publishedSource(fetcher=fetch,snapshotDate=null){
  const latest=JSON.parse(await read(snapshotDate?origin+'/data/checkpoints/discovery-'+snapshotDate+'.json':origin+'/data/discovery.json',fetcher));
  const date=latest.snapshot_date;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date||'')||latest.publication_state!=='PUBLISHED')throw new Error('AUTHORITATIVE_SCAN_NOT_PUBLISHED');
  const [bytes,attestationBytes]=await Promise.all([
    read(origin+'/data/checkpoints/discovery-'+date+'.json',fetcher),
    read(origin+'/verification/downstream-release-attestation-'+date+'.json',fetcher)
  ]);
  const scan=JSON.parse(bytes),a=JSON.parse(attestationBytes),source_sha256=sha(bytes);
  if(scan.snapshot_date!==date||scan.publication_state!=='PUBLISHED'||JSON.stringify(scan)!==JSON.stringify(latest)||
    a.product!=='EMRADAR'||a.snapshot_date!==date||a.source_path!=='data/checkpoints/discovery-'+date+'.json'||
    a.source_sha256!==source_sha256||a.publication_state!=='PUBLISHED'||a.downstream_release_allowed!==true||
    a.campaign_authority?.external_publication_allowed!==false||a.campaign_authority?.required_stop!=='PUBLICATION_REVIEW'||
    !/^EMRADAR_[A-Z0-9_]{8,80}$/.test(a.campaign_authority?.campaign_id||''))throw new Error('AUTHORITATIVE_SOURCE_ATTESTATION_MISMATCH');
  if(!['evidence','editorial','brand','risk','publication'].every(g=>a.native_gates?.[g]==='PASS'))throw new Error('AUTHORITATIVE_SOURCE_GATES_INCOMPLETE');
  const source=emradarSource(scan,{release_approved:true,evidence:true,editorial:true});source.native_gates=a.native_gates;
  return {scan,source,attestation:a,source_sha256};
}

// This admits source truth and prepares exact review artifacts through GraphEngine.
// It never invokes approval or transport. No browser or ChatGPT-held secret is used.
export async function autonomousScanCycle({intake,store,engineFactory,sourceKeys,fetcher=fetch,env=process.env,log=console.log,resumeCampaign=null}){
  if(intakeHeld(env))return {status:'HELD',reason:'MARKETING_EMERGENCY_STOP',external_actions:0};
  if(resumeCampaign&&!/^EMRADAR_\d{4}_\d{2}_\d{2}_LAUNCH$/.test(resumeCampaign))throw Error('RESUME_CAMPAIGN_INVALID');
  const snapshotDate=resumeCampaign?resumeCampaign.slice(8,18).replaceAll('_','-'):null;
  const savedPackage=resumeCampaign?await store.get('review_package:'+resumeCampaign):null;
  if(resumeCampaign&&!savedPackage)throw Error('PERSISTED_CAMPAIGN_REVIEW_REQUIRED');
  const published=await publishedSource(fetcher,snapshotDate),{scan,source,attestation,source_sha256}=published;
  if(!sourceKeys.EMRADAR)throw new Error('SOURCE_NOT_REGISTERED');
  if(resumeCampaign&&(savedPackage.source_sha256!==source_sha256||attestation.campaign_authority.campaign_id!==resumeCampaign||!savedPackage.source_receipt))throw Error('PERSISTED_CAMPAIGN_SOURCE_BINDING_MISMATCH');
  const handoff=resumeCampaign?{status:'PERSISTED_SOURCE_REUSED',...savedPackage.source_receipt}:await store.locked('autonomous_source',async()=>{
    const previous=await store.get('source:EMRADAR');
    if(previous?.source.signals?.some(s=>s.source_snapshot>scan.snapshot_date))throw new Error('STALE_PUBLISHED_SCAN');
    const same=previous&&JSON.stringify(previous.source.signals)===JSON.stringify(source.signals)&&
      JSON.stringify(previous.source.native_gates)===JSON.stringify(source.native_gates);
    const envelope={product:'EMRADAR',sequence:same?previous.sequence:(previous?.sequence||0)+1,source};
    const signature=signSource(envelope,sourceKeys.EMRADAR);
    // Duplicate sources still pass signature verification; reuse their sequence.
    return intake.receive(envelope,signature);
  });
  const key='autonomous_scan:'+scan.snapshot_date+':'+source_sha256;
  let state=await store.get(key);
  if(resumeCampaign&&(!state||state.campaign_id!==resumeCampaign))throw Error('PERSISTED_CAMPAIGN_STATE_REQUIRED');
  const engine=await engineFactory();
  if(resumeCampaign){
    if(engine.products.EMRADAR?.source_release_authority?.automatic_after_native_gates!==true)throw Error('NATIVE_SOURCE_RELEASE_AUTHORITY_REQUIRED');
    engine.products.EMRADAR={...engine.products.EMRADAR,...source,review:{evidence:true,editorial:true,brand:true,risk:true},source_receipt:savedPackage.source_receipt};
  }
  const product=engine.products.EMRADAR;
  if(!product?.source_receipt||!product.release_approved)throw new Error('SOURCE_REVIEW_OR_RELEASE_REQUIRED');
  // Preserve any existing campaign identity before admitting a new one.
  const receipts=await store.get('receipt_index')||[];
  const matching=receipts.filter(r=>r.product==='EMRADAR'&&product.signals.some(s=>s.id===r.signal_id&&s.revision===r.signal_revision&&s.source_snapshot===scan.snapshot_date));
  if(!state){
    const signal=product.signals.find(s=>s.id===matching[0]?.signal_id)||product.signals.find(s=>s.id===scan.records[0]?.id);
    if(!signal)throw new Error('SOURCE_SIGNAL_MISSING');
    state={scan_date:scan.snapshot_date,source_sha256,campaign_id:matching[0]?.campaign_id||attestation.campaign_authority.campaign_id,
      signal_id:signal.id,signal_revision:signal.revision,evidence_state:signal.state,created_at:at(),routes:{},attempts:0,status:'PREPARING'};
    await store.put(key,state);
  }
  // Repair stale deterministic qualification without rerunning an existing X asset
  // or changing source truth, campaign identity, approval or transport state.
  const planKey='route_plan:EMRADAR:'+state.signal_id+':'+state.signal_revision;
  let routePlan=await store.get(planKey);
  if(routePlan&&routePlan.routing_revision!==routingRevision){
    const signal=product.signals.find(s=>s.id===state.signal_id&&s.revision===state.signal_revision);
    if(!signal)throw Error('SAVED_CAMPAIGN_SOURCE_UNAVAILABLE');
    const formation=formationFromSignal(signal),learning={};
    for(const d of routePlan.discovered||[]){const score=d.score_factors?.historical_route_performance;if(typeof score==='number')learning[d.destination_id]={score};}
    const authorizedAccounts=(routePlan.candidates||[]).filter(d=>d.destination_id==='EMRADAR-X-OROKNOWS').map(d=>d.destination_id);
    const open=openRouteScout({formation,directory:openRouteDirectory,learning,authorizedAccounts});
    routePlan={...open,valid_until:routePlan.valid_until,proposed_assets:prepareRouteAssets({formation,candidates:open.candidates}),commercial_evidence:commercialEvidenceBranch(formation),stop:'PUBLICATION_REVIEW'};
    await store.put(planKey,routePlan);
  }
  if(state.status==='AWAITING_REVIEW'&&state.review_contract_revision===reviewContractRevision){
    const pkg=await store.get('review_package:'+state.campaign_id),receipt=await store.get(routingReceiptKey(state.campaign_id));
    if(completeReviewCheckpoint(state,pkg,receipt))return {status:'AWAITING_REVIEW',duplicate:true,handoff,campaign_id:state.campaign_id,package:pkg,external_actions:0};
  }
  if(state.status!=='AWAITING_REVIEW'&&state.review_contract_revision===reviewContractRevision&&state.runtime_commit===(env.RENDER_GIT_COMMIT||'UNKNOWN')&&state.next_due&&Date.parse(state.next_due)>Date.now())return {status:state.status,duplicate:true,handoff,campaign_id:state.campaign_id,external_actions:0};
  const runtime=env.RENDER_GIT_COMMIT||'UNKNOWN';
  // Bounded failures retry after a runtime repair, or at most three times per runtime.
  const contractChanged=state.review_contract_revision!==reviewContractRevision;
  const runtimeChanged=state.runtime_commit!==runtime||contractChanged;
  if(runtimeChanged){state.attempts=0;state.runtime_commit=runtime;state.routes=Object.fromEntries(Object.entries(state.routes).filter(([,r])=>r.proposal_id||executed.has(r.status)));}
  if(state.attempts>=3)return {status:'BLOCKED',blocker:state.blocker,handoff,campaign_id:state.campaign_id,external_actions:0};
  state.attempts++;state.status='PREPARING';await store.put(key,state);
  const existingProposals=[];
  for(const r of matching){const id=r.proposal_id||r.review?.proposal_id||r.publication_review?.proposal_id;if(id){const p=await store.get('publication_review:'+id);if(p?.status==='AWAITING_REVIEW'&&(p.input?.campaign_id===state.campaign_id||r.campaign_id===state.campaign_id)&&p.signal_revision===state.signal_revision&&JSON.stringify(p.source_receipt)===JSON.stringify(product.source_receipt))existingProposals.push(p);}}
  const reuse=destination=>existingProposals.filter(p=>p.destination===destination).sort((a,b)=>Date.parse(b.created_at)-Date.parse(a.created_at))[0];
  const external=destination=>matching.find(r=>r.destination===destination&&executed.has(r.execution_status));
  const results=[];
  const preview=/^EMRADAR_2026_10_(06|07|08)_LAUNCH$/.test(state.campaign_id);
  const run=async(destination,refreshDiscovery=false)=>{
    const saved=reuse(destination);
    if(!refreshDiscovery&&saved&&(saved.review_contract_revision===reviewContractRevision||destination==='EMRADAR-X-OROKNOWS')&&Date.parse(saved.expires_at)>Date.now()){state.routes[destination]={status:saved.status,proposal_id:saved.proposal_id,reused:true};return;}
    if(saved&&await store.get('publication_approval:'+saved.proposal_id))throw Error('APPROVED_REVIEW_ARTIFACT_CANNOT_AUTO_SUPERSEDE');
    const sent=external(destination);
    if(sent){state.routes[destination]={status:sent.execution_status,receipt_id:sent.id,reused:true};return;}
    const result=await engine.run({product:'EMRADAR',campaign_id:state.campaign_id,signal_id:state.signal_id,
      ...(destination?{destination_id:destination}:{}),...(preview?{owner_preview:true}:{}),...(refreshDiscovery?{refresh_discovery:true}:{}),...(saved?{revision_proposal_id:saved.proposal_id,expected_review_hash:saved.review_hash,refresh_editorial:!refreshDiscovery}:{}),stop_at:'PUBLICATION_REVIEW'});
    if(result.nodes?.some(n=>n.node==='execute'))throw new Error('AUTONOMOUS_REVIEW_STOP_VIOLATION');
    results.push(result);
    const route=result.review?.destination||destination||result.selection?.options?.find(o=>o.key===result.selection.selected)?.id||'UNSELECTED';
    const terminal=route!=='EMRADAR-X-OROKNOWS'&&!result.review?.proposal_id&&optionalTerminalGates.has(result.blocker);
    state.routes[route]={status:terminal?'OPTIONAL_REJECTED':result.status,proposal_id:result.review?.proposal_id||null,blocker:result.blocker,run_id:result.run_id,...(terminal?{terminal:true,reason:result.blocker,gate:result.nodes?.find(n=>n.status==='BLOCKED')?.node||'pre_review'}:{})};
    await store.put(key,state);
    return result;
  };
  let first;
  if(contractChanged)state.routes=Object.fromEntries(Object.entries(state.routes).filter(([,r])=>executed.has(r.status)));
  if(existingProposals.length){for(const p of existingProposals.filter(p=>p.review_contract_revision===reviewContractRevision||p.destination==='EMRADAR-X-OROKNOWS'))state.routes[p.destination]={status:p.status,proposal_id:p.proposal_id,reused:true};}
  // Reuse the graph's own persisted route decisions, never a second routing system.
  if(!routePlan){first=await run('EMRADAR-X-OROKNOWS');routePlan=first?.route_plan||routePlan;}
  const selected=[...(routePlan?.candidates?.map(d=>d.destination_id)||[]),...(first?.selection?.options?.map(o=>o.id)||[])];
  const xEvaluation=await store.get('route_evaluation:EMRADAR:'+state.signal_id+':'+state.signal_revision);
  const optional=[...new Set(selected)].filter(id=>id!=='EMRADAR-X-OROKNOWS');
  for(const destination of ['EMRADAR-X-OROKNOWS',...optional]){
    if(state.routes[destination]?.proposal_id||state.routes[destination]?.status==='OPTIONAL_REJECTED'||executed.has(state.routes[destination]?.status)||results.some(r=>r.review?.destination===destination||r.selection?.options?.find(o=>o.key===r.selection.selected)?.id===destination))continue;
    await run(destination);
  }
  const proposals=[];
  for(const r of Object.values(state.routes)){if(r.proposal_id){const p=await store.get('publication_review:'+r.proposal_id);if(p?.status==='AWAITING_REVIEW'&&!proposals.some(x=>x.proposal_id===p.proposal_id))proposals.push({...p,artifact_hash:p.review_hash,cost:await store.get('campaign_cost:'+p.cost_receipt_id)});}}
  const blockers=Object.entries(state.routes).filter(([,r])=>!r.proposal_id&&r.status!=='OPTIONAL_REJECTED'&&!executed.has(r.status)).map(([destination,r])=>({destination,reason:r.blocker||r.status}));
  const rejected_routes=Object.entries(state.routes).filter(([,r])=>r.status==='OPTIONAL_REJECTED').map(([destination,r])=>({destination,status:r.status,terminal:true,reason:r.reason,gate:r.gate,run_id:r.run_id}));
  const candidateRoutes=routePlan?.candidates||[],discovered=routePlan?.discovered?.length?routePlan.discovered:candidateRoutes,candidateIds=new Set(candidateRoutes.map(d=>d.destination_id));
  const route_dispositions=discovered.map(route=>{
    const outcome=state.routes[route.destination_id];
    if(outcome)return {destination:route.destination_id,classification:route.classification,route_score:route.route_score,status:outcome.status,proposal_id:outcome.proposal_id||null,reason:outcome.reason||outcome.blocker||null,gate:outcome.gate||null};
    return {destination:route.destination_id,classification:route.classification,route_score:route.route_score,status:candidateIds.has(route.destination_id)?'DISCOVERED_ONLY':'NOT_CANDIDATE',proposal_id:null,reason:route.route_reason||route.classification,gate:'discovery_routing'};
  });
  const route_plan_sha256=sha(JSON.stringify(routePlan||null));
  const packageRecord={scan_date:scan.snapshot_date,source_sha256,source_receipt:product.source_receipt,campaign_id:state.campaign_id,
    formation:{id:state.signal_id,state:state.evidence_state},status:blockers.length?'BLOCKED':'AWAITING_REVIEW',proposals,blockers,rejected_routes,
    routing_revision:routingRevision,route_plan_sha256,route_dispositions,external_actions:0,required_stop:'PUBLICATION_REVIEW',runtime_commit:runtime,updated_at:at(),handoff,capabilities:{editorial_harness_connected:!!engine.harness},x_evaluation:await store.get('route_evaluation:EMRADAR:'+state.signal_id+':'+state.signal_revision)};
  if(!proposals.length&&!blockers.length){packageRecord.status='BLOCKED';blockers.push({reason:'NO_ELIGIBLE_REVIEW_ARTIFACT'});}
  const x=proposals.find(p=>p.destination==='EMRADAR-X-OROKNOWS');
  let validX=false;
  try{if(x?.asset?.combined_review_artifact!==true)throw Error('X_COMBINED_ARTIFACT_REQUIRED');validateCombinedX(x.asset,product.signals.find(s=>s.id===state.signal_id),product.source_receipt);validX=true;}
  catch{packageRecord.status='BLOCKED';blockers.push({destination:'EMRADAR-X-OROKNOWS',reason:'MANDATORY_X_COPY_AND_VISUAL_REVIEW_REQUIRED'});}
  if(validX&&packageRecord.x_evaluation){packageRecord.x_evaluation={...packageRecord.x_evaluation,visual:'GENERATED_EVIDENCE_GRAPHIC',visual_sha256:x.asset.sha256,combined_review_artifact:x.proposal_id,content_review_state:'READY'};await store.put('route_evaluation:EMRADAR:'+state.signal_id+':'+state.signal_revision,packageRecord.x_evaluation);}
  packageRecord.review_contract_revision=reviewContractRevision;
  const routingReceipt={receipt_type:'DISCOVERY_ROUTING_COMPLETION',status:route_dispositions.some(d=>d.status==='DISCOVERED_ONLY')?'INCOMPLETE':'COMPLETE',campaign_id:state.campaign_id,scan_date:scan.snapshot_date,source_sha256,signal_id:state.signal_id,signal_revision:state.signal_revision,review_contract_revision:reviewContractRevision,route_plan_sha256,dispositions_sha256:sha(JSON.stringify(route_dispositions)),discovered_destinations:discovered.map(d=>d.destination_id),candidate_destinations:[...candidateIds],completed_at:at(),external_actions:0};
  packageRecord.discovery_routing_completion_receipt=routingReceipt;
  if(routingReceipt.status!=='COMPLETE'){packageRecord.status='BLOCKED';blockers.push({reason:'DISCOVERY_ROUTING_COMPLETENESS_REQUIRED'});}
  state.review_contract_revision=reviewContractRevision;
  state.status=packageRecord.status;state.blocker=blockers[0]?.reason||null;state.next_due=new Date(Date.now()+300000).toISOString();
  await store.put(routingReceiptKey(state.campaign_id),routingReceipt);await store.put('review_package:'+state.campaign_id,packageRecord);await store.put('review_package_latest:EMRADAR',packageRecord);await store.put(key,state);
  log('AUTONOMOUS_SCAN_REVIEW '+JSON.stringify({...packageRecord,proposals:proposals.map(p=>({proposal_id:p.proposal_id,destination:p.destination,status:p.status,artifact_hash:p.review_hash}))}));
  for(const p of proposals)log('AUTONOMOUS_REVIEW_ARTIFACT '+JSON.stringify({scan_date:scan.snapshot_date,campaign_id:state.campaign_id,proposal:p}));
  // Small complete preview records avoid truncating human-readable content
  // behind a large PNG. The canonical asset and its hashes stay in Redis.
  for(const p of proposals)log('AUTONOMOUS_OWNER_PREVIEW '+JSON.stringify({campaign_id:state.campaign_id,destination:p.destination,proposal_id:p.proposal_id,subject:p.asset?.email?.subject||null,body:p.asset?.email?.body||p.copy,copy:p.platform==='X'?p.asset.copy:null,svg:p.platform==='X'?p.asset.svg:null,visual_sha256:p.asset?.sha256||null,route:p.asset?.delivery||null,evidence_state:p.signal_state,evidence_refs:p.evidence_refs,warnings:p.preview_warnings||[],review_state:p.review_state||'READY',permission_state:p.permission_state||'EXACT_OWNER_REVIEW_REQUIRED',cost_state:p.distribution_cost_state||p.cost_state,cost:p.cost,preview_only:p.preview_only||false}));
  return {status:packageRecord.status,handoff,campaign_id:state.campaign_id,package:packageRecord,external_actions:0};
}
