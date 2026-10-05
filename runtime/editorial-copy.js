import fs from 'node:fs/promises';
import crypto from 'node:crypto';

export const editorialContract=await fs.readFile(new URL('../contracts/editorial-copy-system-v1.md',import.meta.url),'utf8');
export const editorialVersion=crypto.createHash('sha256').update(editorialContract).digest('hex');
export const externalSchemaLeak=copy=>/\b(FORMING|INVESTIGATE|WATCH\/NO SIGNAL)\b|(?:^|\n)\s*(?:Evidence|Unresolved|EMRADAR contribution|Reader action|Causal chain)\s*:|→/im.test(copy);

// A brief is internal routing data. Only verified editorial work can turn it
// into external copy. The source packet is never rewritten by this layer.
export function editorialContext(c){
  const facts=(c.signal.source_facts||[]).filter(f=>c.signal.evidence.includes(f.id));
  if(!facts.length||facts.length!==(c.signal.source_facts||[]).length||facts.some(f=>!f.text||!f.url))throw new Error('SOURCE_FACT_BINDING_REQUIRED');
  return {
    editorial_contract:editorialContract,contract_revision:editorialVersion,
    source:{...c.signal,source_facts:facts},
    product_copy_profile:c.product.copy_profile||c.product.product_copy_profile||null,
    brand_system:c.product.brand_system||'UNDEFINED',
    destination:c.route.destination.route_record,
    brief:c.route_plan.proposed_assets.find(a=>a.destination_id===c.route.id),
    target_language:c.route.destination.route_record.destination_class==='latam_trade_publication'?'es-CL':'en',
    instructions:'Transform the evidence-qualified source into an original destination-specific editorial pitch. Apply the full editorial contract and product voice. Do not imitate any named publication or journalist. Do not output schema labels, canned causal chains, forecasts as realised outcomes, investment recommendations, or claims of supplier awards without evidence. Include every material source uncertainty naturally. Facts, quantities and claims must be grounded in source evidence. Follow destination submission length and format requirements. Return subject, body, language, signal_state, evidence_refs, claims (each with exact body text and evidence_refs), and qualifications (each with source_index into source_uncertainty and exact body text). A separate verifier must validate factual entailment, uncertainty preservation, originality and destination fit.'
  };
}

export function validateEditorial(result,proof,context){
  const refs=context.source.evidence;
  const copy=`Subject: ${result?.subject||''}\n\n${result?.body||''}`;
  if(!result?.subject?.trim()||!result?.body?.trim()||result.signal_state!==context.source.state||result.language!==context.target_language)throw new Error('EDITORIAL_RESULT_INVALID');
  if(externalSchemaLeak(copy))throw new Error('EXTERNAL_EDITORIAL_SCHEMA_LEAK');
  if(/\b(buy now|guaranteed return|risk.free investment|compra ahora|rendimiento garantizado|inversi[oó]n sin riesgo)\b/i.test(copy))throw new Error('UNSUPPORTED_FINANCIAL_CLAIM');
  const bound=ids=>Array.isArray(ids)&&ids.length>0&&ids.every(id=>refs.includes(id));
  if(!bound(proof?.evidence_refs)||!bound(result.evidence_refs)||!result.claims?.length||!result.claims.every(x=>x.text&&result.body.includes(x.text)&&bound(x.evidence_refs)))throw new Error('EDITORIAL_CLAIM_BINDING_REQUIRED');
  if(!(context.source.source_uncertainty||[]).every((_,i)=>result.qualifications?.some(q=>q.source_index===i&&q.text&&result.body.includes(q.text))))throw new Error('EDITORIAL_UNCERTAINTY_NOT_PRESERVED');
  if(!['factual_entailment','uncertainty_preserved','destination_fit','originality'].every(k=>proof?.editorial_checks?.[k]==='PASS'))throw new Error('EDITORIAL_VERIFICATION_REQUIRED');
  const limit=context.destination.submission_requirements?.match(/(\d+) words or less/i);
  if(limit&&copy.trim().split(/\s+/).length>Number(limit[1]))throw new Error('EDITORIAL_DESTINATION_LENGTH_EXCEEDED');
  return copy;
}
