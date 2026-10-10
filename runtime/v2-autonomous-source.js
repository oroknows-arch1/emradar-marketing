import crypto from 'node:crypto';
import {intakeHeld,publishedSource} from './autonomous-source.js';

const digest=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const reviewCoverageRevision='evidence-broadening-v1';
const editorialRepairRevision='sfy-human-correspondence-v2';
const strings=value=>Array.isArray(value)?value.filter(v=>typeof v==='string'&&v):[];
const flattenChain=chain=>Object.values(chain||{}).flatMap(strings);

export function v2ScanFromPublished({scan,source_sha256}){
  const records=scan?.records||[];
  if(!records.length)throw new Error('SOURCE_SIGNAL_MISSING');
  const formation=record=>{
    const uncertainty=[...strings(record.contradictions),...strings(record.chain_evolution?.unresolved_evidence)];
    return {
      id:record.id,title:record.theme||record.id,state:record.status,
      causal_chain:flattenChain(record.causal_chain),
      causal_chain_source:record.causal_chain||{},
      evidence:(record.evidence||[]).map(e=>({id:digest(e),url:e.url||null,claim:e.fact||e.claim||e.text})),
      uncertainty,
      strengthening_evidence:strings(record.chain_evolution?.strengthening_evidence),
      weakening_evidence:strings(record.chain_evolution?.weakening_evidence),
      break_conditions:strings(record.chain_evolution?.break_conditions),
      companies:(record.listed_players||[]).map(v=>v.name).filter(Boolean),
      tickers:(record.listed_players||[]).map(v=>v.ticker).filter(Boolean),
      industries:strings(record.causal_chain?.industries),
      geography:[record.location].filter(Boolean)
    };
  };
  const formations=records.map(formation);
  return {
    publication_state:'PUBLISHED',
    snapshot_date:scan.snapshot_date,
    source_revision:source_sha256,
    formation:formations[0],formations
  };
}

export async function autonomousV2ScanCycle({store,runtime,fetcher=fetch,env=process.env,log=console.log}){
  if(intakeHeld(env))return {status:'HELD',reason:'MARKETING_EMERGENCY_STOP',external_actions:0};
  const published=await publishedSource(fetcher),campaign_id=published.attestation.campaign_authority.campaign_id;
  const key='v2:intake:'+campaign_id,prior=await store.get(key),scan=v2ScanFromPublished(published);
  if(prior&&prior.source_sha256!==published.source_sha256)throw new Error('CAMPAIGN_SOURCE_CHANGED');
  const existing=await store.get('v2:campaign:'+campaign_id);
  if(prior?.status==='PREPARED'&&existing){return {...prior,duplicate:true,preparation:existing,external_actions:0};}
  const admitted={campaign_id,scan_date:published.scan.snapshot_date,source_sha256:published.source_sha256,source_revision:scan.source_revision,status:'ADMITTED',attestation:{source_path:published.attestation.source_path,publication_state:published.attestation.publication_state,native_gates:published.attestation.native_gates,required_stop:published.attestation.campaign_authority.required_stop,external_publication_allowed:published.attestation.campaign_authority.external_publication_allowed},admitted_at:new Date().toISOString(),external_actions:0};
  await store.put(key,admitted);
  const preparation=await runtime.prepare({campaign_id,scan});
  if(preparation.external_actions!==0)throw new Error('V2_AUTONOMOUS_DISTRIBUTION_VIOLATION');
  await store.put('v2:review_package:'+campaign_id,preparation);
  const receipt={...admitted,status:'PREPARED',preparation_status:preparation.status,proposal_count:preparation.proposals.length,prepared_at:new Date().toISOString()};
  await store.put(key,receipt);log('V2_AUTONOMOUS_INTAKE '+JSON.stringify(receipt));
  return {...receipt,preparation};
}

export async function recoverV2ReviewCoverage({store,runtime,campaign_id,fetcher=fetch,log=console.log}){
  if(!/^EMRADAR_\d{4}_\d{2}_\d{2}_LAUNCH$/.test(campaign_id||''))throw new Error('CAMPAIGN_ID_INVALID');
  const existing=await store.get('v2:review_package:'+campaign_id);
  if(existing?.coverage_revision===reviewCoverageRevision)return {campaign_id,status:existing.status,proposal_count:existing.proposals.length,disposition_count:existing.route_dispositions.length,duplicate:true,external_actions:0};
  const snapshotDate=campaign_id.slice(8,18).replaceAll('_','-');
  const published=await publishedSource(fetcher,snapshotDate);
  if(published.attestation.campaign_authority.campaign_id!==campaign_id)throw new Error('CAMPAIGN_SOURCE_CHANGED');
  const intakeKey='v2:intake:'+campaign_id,prior=await store.get(intakeKey);
  if(!prior||prior.source_sha256!==published.source_sha256)throw new Error('PERSISTED_V2_INTAKE_REQUIRED');
  const expanded=await runtime.prepare({campaign_id,scan:v2ScanFromPublished(published),expand_review:true});
  if(expanded.external_actions!==0)throw new Error('V2_REVIEW_EXPANSION_DISTRIBUTION_VIOLATION');
  const preparation={...expanded,coverage_revision:reviewCoverageRevision};
  await store.put('v2:campaign:'+campaign_id,preparation);
  await store.put('v2:review_package:'+campaign_id,preparation);
  const receipt={...prior,status:'PREPARED',preparation_status:preparation.status,proposal_count:preparation.proposals.length,coverage_revision:reviewCoverageRevision,coverage_recovered_at:new Date().toISOString()};
  await store.put(intakeKey,receipt);
  log('V2_REVIEW_COVERAGE_RECOVERY '+JSON.stringify({campaign_id,proposal_count:preparation.proposals.length,disposition_count:preparation.route_dispositions.length,external_actions:0}));
  return {campaign_id,status:preparation.status,proposal_count:preparation.proposals.length,disposition_count:preparation.route_dispositions.length,external_actions:0};
}

export async function repairV2EditorialReview({store,runtime,campaign_id,fetcher=fetch,log=console.log}){
  if(!/^EMRADAR_\d{4}_\d{2}_\d{2}_LAUNCH$/.test(campaign_id||''))throw new Error('CAMPAIGN_ID_INVALID');
  const existing=await store.get('v2:review_package:'+campaign_id);
  if(existing?.editorial_repair_revision===editorialRepairRevision)return {campaign_id,status:existing.status,proposal_count:existing.proposals.length,corrected_count:existing.editorial_repair?.superseded_count||0,valid_assets_preserved:existing.editorial_repair?.approved_assets_preserved||0,duplicate:true,external_actions:0};
  const snapshotDate=campaign_id.slice(8,18).replaceAll('_','-'),published=await publishedSource(fetcher,snapshotDate);
  if(published.attestation.campaign_authority.campaign_id!==campaign_id)throw new Error('CAMPAIGN_SOURCE_CHANGED');
  const intakeKey='v2:intake:'+campaign_id,prior=await store.get(intakeKey);
  if(!prior||prior.source_sha256!==published.source_sha256)throw new Error('PERSISTED_V2_INTAKE_REQUIRED');
  const repaired=await runtime.prepare({campaign_id,scan:v2ScanFromPublished(published),expand_review:true,supersede_unapproved_editorial:true});
  if(repaired.external_actions!==0)throw new Error('V2_EDITORIAL_REPAIR_DISTRIBUTION_VIOLATION');
  const preparation={...repaired,coverage_revision:existing?.coverage_revision||reviewCoverageRevision,editorial_repair_revision:editorialRepairRevision};
  await store.put('v2:campaign:'+campaign_id,preparation);await store.put('v2:review_package:'+campaign_id,preparation);
  await store.put(intakeKey,{...prior,status:'PREPARED',preparation_status:preparation.status,proposal_count:preparation.proposals.length,editorial_repair_revision:editorialRepairRevision,editorial_repaired_at:new Date().toISOString()});
  const result={campaign_id,status:preparation.status,proposal_count:preparation.proposals.length,corrected_count:preparation.editorial_repair?.superseded_count||0,valid_assets_preserved:preparation.editorial_repair?.approved_assets_preserved||0,external_actions:0};
  log('V2_EDITORIAL_REVIEW_REPAIR '+JSON.stringify(result));return result;
}
