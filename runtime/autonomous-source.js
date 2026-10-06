import crypto from 'node:crypto';
import {emradarSource,signSource} from './intake.js';
import scanControl from '../config/scan-control.json' with {type:'json'};

const origin='https://emerging-markets-radar.onrender.com';
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const at=()=>new Date().toISOString();
const executed=new Set(['PUBLISHED','SUBMITTED','IN_FLIGHT','AMBIGUOUS']);
export const intakeHeld=(env=process.env)=>scanControl.hold_new_scans===true||env.MARKETING_EMERGENCY_STOP==='true';
async function read(url,fetcher){
  const response=await fetcher(url,{cache:'no-store',signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw new Error('AUTHORITATIVE_SOURCE_HTTP_'+response.status);
  return Buffer.from(await response.arrayBuffer());
}
export async function publishedSource(fetcher=fetch){
  const latest=JSON.parse(await read(origin+'/data/discovery.json',fetcher));
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
export async function autonomousScanCycle({intake,store,engineFactory,sourceKeys,fetcher=fetch,env=process.env,log=console.log}){
  if(intakeHeld(env))return {status:'HELD',reason:'MARKETING_EMERGENCY_STOP',external_actions:0};
  const published=await publishedSource(fetcher),{scan,source,attestation,source_sha256}=published;
  if(!sourceKeys.EMRADAR)throw new Error('SOURCE_NOT_REGISTERED');
  const handoff=await store.locked('autonomous_source',async()=>{
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
  const engine=await engineFactory(),product=engine.products.EMRADAR;
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
  if(state.status==='AWAITING_REVIEW')return {status:'AWAITING_REVIEW',duplicate:true,handoff,campaign_id:state.campaign_id,package:await store.get('review_package:'+state.campaign_id),external_actions:0};
  if(state.next_due&&Date.parse(state.next_due)>Date.now())return {status:state.status,duplicate:true,handoff,campaign_id:state.campaign_id,external_actions:0};
  const runtime=env.RENDER_GIT_COMMIT||'UNKNOWN';
  // Bounded failures retry after a runtime repair, or at most three times per runtime.
  if(state.runtime_commit!==runtime){state.attempts=0;state.runtime_commit=runtime;}
  if(state.attempts>=3)return {status:'BLOCKED',blocker:state.blocker,handoff,campaign_id:state.campaign_id,external_actions:0};
  state.attempts++;state.status='PREPARING';await store.put(key,state);
  const existingProposals=[];
  for(const r of matching){const id=r.proposal_id||r.review?.proposal_id||r.publication_review?.proposal_id;if(id){const p=await store.get('publication_review:'+id);if(p?.signal_revision===state.signal_revision&&JSON.stringify(p.source_receipt)===JSON.stringify(product.source_receipt))existingProposals.push(p);}}
  const reuse=destination=>existingProposals.find(p=>p.destination===destination);
  const external=destination=>matching.find(r=>r.destination===destination&&executed.has(r.execution_status));
  const results=[];
  const run=async destination=>{
    const saved=reuse(destination);
    if(saved){state.routes[destination]={status:saved.status,proposal_id:saved.proposal_id,reused:true};return;}
    const sent=external(destination);
    if(sent){state.routes[destination]={status:sent.execution_status,receipt_id:sent.id,reused:true};return;}
    const result=await engine.run({product:'EMRADAR',campaign_id:state.campaign_id,signal_id:state.signal_id,
      ...(destination?{destination_id:destination}:{}),stop_at:'PUBLICATION_REVIEW'});
    if(result.nodes?.some(n=>n.node==='execute'))throw new Error('AUTONOMOUS_REVIEW_STOP_VIOLATION');
    results.push(result);
    const route=result.review?.destination||destination||result.selection?.options?.find(o=>o.key===result.selection.selected)?.id||'UNSELECTED';
    state.routes[route]={status:result.status,proposal_id:result.review?.proposal_id||null,blocker:result.blocker,run_id:result.run_id};
    await store.put(key,state);
    return result;
  };
  let first;
  if(existingProposals.length){for(const p of existingProposals)state.routes[p.destination]={status:p.status,proposal_id:p.proposal_id,reused:true};}
  // Reuse the graph's own persisted route decisions, never a second routing system.
  const planKey='route_plan:EMRADAR:'+state.signal_id+':'+state.signal_revision;
  let routePlan=await store.get(planKey);
  if(!routePlan){first=await run();routePlan=first?.route_plan;}
  const selected=first?.selection?.options?.map(o=>o.id)||routePlan?.candidates?.map(d=>d.destination_id)||[];
  for(const destination of [...new Set(selected)].slice(0,5)){
    if(state.routes[destination]?.proposal_id||executed.has(state.routes[destination]?.status)||results.some(r=>r.review?.destination===destination))continue;
    await run(destination);
  }
  const proposals=[];
  for(const r of Object.values(state.routes)){if(r.proposal_id){const p=await store.get('publication_review:'+r.proposal_id);if(p&&!proposals.some(x=>x.proposal_id===p.proposal_id))proposals.push({...p,artifact_hash:p.review_hash,cost:await store.get('campaign_cost:'+p.cost_receipt_id)});}}
  const blockers=Object.entries(state.routes).filter(([,r])=>!r.proposal_id&&!executed.has(r.status)).map(([destination,r])=>({destination,reason:r.blocker||r.status}));
  const packageRecord={scan_date:scan.snapshot_date,source_sha256,source_receipt:product.source_receipt,campaign_id:state.campaign_id,
    formation:{id:state.signal_id,state:state.evidence_state},status:blockers.length?'BLOCKED':'AWAITING_REVIEW',proposals,blockers,
    external_actions:0,required_stop:'PUBLICATION_REVIEW',runtime_commit:runtime,updated_at:at(),handoff};
  if(!proposals.length&&!blockers.length){packageRecord.status='BLOCKED';blockers.push({reason:'NO_ELIGIBLE_REVIEW_ARTIFACT'});}
  state.status=packageRecord.status;state.blocker=blockers[0]?.reason||null;state.next_due=new Date(Date.now()+300000).toISOString();
  await store.put('review_package:'+state.campaign_id,packageRecord);await store.put('review_package_latest:EMRADAR',packageRecord);await store.put(key,state);
  log('AUTONOMOUS_SCAN_REVIEW '+JSON.stringify({...packageRecord,proposals:proposals.map(p=>({proposal_id:p.proposal_id,destination:p.destination,status:p.status,artifact_hash:p.review_hash}))}));
  for(const p of proposals)log('AUTONOMOUS_REVIEW_ARTIFACT '+JSON.stringify({scan_date:scan.snapshot_date,campaign_id:state.campaign_id,proposal:p}));
  return {status:packageRecord.status,handoff,campaign_id:state.campaign_id,package:packageRecord,external_actions:0};
}
