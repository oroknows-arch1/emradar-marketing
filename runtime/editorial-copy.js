import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import {validateCapabilityInventory,validateCorrespondenceProposition,validateInternalUncertainty,normalizeCorrespondence,draftOffer,draftCapability,isEmail} from './editorial-email.js';
import {ownerPreview,previewWarning} from './owner-preview.js';

export const editorialContract=await fs.readFile(new URL('../contracts/editorial-copy-system-v1.md',import.meta.url),'utf8');
export const correspondenceContract=await fs.readFile(new URL('../contracts/human-correspondence-v2.md',import.meta.url),'utf8');
export const correspondenceFields=Object.freeze(['reason','development','insight','proposition','question']);
export const editorialVersion=crypto.createHash('sha256').update(editorialContract+correspondenceContract).digest('hex');
export function editorialResponseSchema(signal,route,language){
  const permittedNote=draftOffer(language);
  const string={type:'string'},refs={type:'array',items:{type:'string',enum:signal.evidence},minItems:1};
  const object=properties=>({type:'object',additionalProperties:false,properties,required:Object.keys(properties)});
  const roles={reason:`Why ${route.organisation||route.destination_name}, naming it using its verified beat.`,development:'One short scan finding paragraph: Our <date> scan identified <formation> as <exact evidence state>.',insight:'What stood out was <destination-relevant insight>. Share the short scan paragraph with development.',proposition:'One short paragraph: We are developing an evidence-backed contribution around <specific angle> — while keeping <material unresolved questions> explicit.',question:'Ask the recipient whether or how this material or proposed contribution would be useful for their publication. Give them agency over the angle or destination-native format. A question about the subject matter alone is invalid. Name the publication. Prefer: Would this be suitable as an article or research contribution for <publication>? Adapt types to the verified destination.'};
  const limit=Number(route.submission_requirements?.match(/(\d+) words or less/i)?.[1]||165);
  return object({
    subject:{...string,description:'A short natural email subject, without labels.'},
    body:{...string,description:`Natural email proposition, at most ${Math.max(1,Math.min(122,limit-28))} words. No labels or headings (including Reason, Development, Insight, Proposition or Question), greeting, sender, signature or URLs. Summarize material uncertainty truthfully in the contribution paragraph. Keep all full uncertainty texts internally in qualifications; do not reproduce all in body. Multiple correspondence roles may share the same sentence to fit the limit.`},
    language:{type:'string',enum:[language]},signal_state:{type:'string',enum:[signal.state]},evidence_refs:refs,
    claims:{type:'array',minItems:1,items:object({text:{...string,description:'Exact excerpt from body, not a paraphrase.'},evidence_refs:refs})},
    qualifications:{type:'array',minItems:signal.source_uncertainty.length,items:object({source_index:{type:'integer',enum:signal.source_uncertainty.map((_,i)=>i)},text:{...string,description:'Exact original source_uncertainty text for the indexed uncertainty; internal metadata, not an email excerpt. Include EVERY index.'}})},
    capability_claims:{type:'array',maxItems:1,items:object({text:{type:'string',enum:[permittedNote]},capability:{type:'string',enum:[draftCapability]}})},
    correspondence:object({...Object.fromEntries(correspondenceFields.map(key=>[key,{...string,description:roles[key]+' Exact, contiguous excerpt copied from body, not a paraphrase. Nonempty; excerpts may overlap.'}])),next_step:{type:'string',enum:[permittedNote],description:'Include this exact owner-authorized bounded draft offer as the final paragraph of body and in capability_claims. It authorizes one sourced draft for this campaign, not ongoing services.'}})
  });
}
export const externalSchemaLeak=copy=>/\b(FORMING|INVESTIGATE|WATCH\/NO SIGNAL)\b|(?:^|\n)\s*(?:Evidence|Unresolved|EMRADAR contribution|Reader action|Causal chain)\s*:|→/im.test(copy);

// A brief is internal routing data. Only verified editorial work can turn it
// into external copy. The source packet is never rewritten by this layer.
export function editorialContext(c){
  const facts=(c.signal.source_facts||[]).filter(f=>c.signal.evidence.includes(f.id));
  if(!facts.length||facts.length!==(c.signal.source_facts||[]).length||facts.some(f=>!f.text||!f.url))throw new Error('SOURCE_FACT_BINDING_REQUIRED');
  return {
    editorial_contract:editorialContract,contract_revision:editorialVersion,
    owner_preview:ownerPreview(c.input),
    ...{
      human_correspondence_contract:correspondenceContract,
      response_schema:editorialResponseSchema(c.signal,c.route.destination.route_record,c.route.destination.route_record.destination_class==='latam_trade_publication'?'es-CL':'en'),
      response_contract:{
        type:'object',required:['subject','body','language','signal_state','evidence_refs','claims','qualifications','capability_claims','correspondence'],
        correspondence:{type:'object',required:correspondenceFields,properties:Object.fromEntries(correspondenceFields.map(key=>[key,{type:'string',minLength:1,description:'Copy an exact, contiguous excerpt from body; do not paraphrase or summarise it.'}]))},
        body_rule:'Write body once, then extract the five correspondence values from it verbatim. Values may overlap or share a sentence when it performs multiple roles. Do not return correspondence as a list, renamed keys, or a separate paraphrased draft. Preserve every full source uncertainty in qualifications as internal metadata; summarize material uncertainty in the contribution paragraph. Return all fields at the top level of the JSON result.'
      }
    },
    source:{...c.signal,source_facts:facts},
    product_copy_profile:c.product.copy_profile||c.product.product_copy_profile||null,
    brand_system:c.product.brand_system||'UNDEFINED',
    destination:c.route.destination.route_record,
    brief:c.route_plan.proposed_assets.find(a=>a.destination_id===c.route.id),
    capabilities:{[draftCapability]:{state:'VERIFIED',authorized:true,scope:'Owner-approved bounded offer of one finished sourced draft for this campaign and destination on request',offer:draftOffer(c.route.destination.route_record.destination_class==='latam_trade_publication'?'es-CL':'en')},ongoing_monitoring_or_continuous_coverage:{state:'UNVERIFIED',authorized:false}},
    target_language:c.route.destination.route_record.destination_class==='latam_trade_publication'?'es-CL':'en',
    instructions:!isEmail(c.route.destination.route_record)?`Prepare a destination-specific, source-grounded editorial form submission, not an email. Write a concise natural subject and body tailored to the publication and its verified submission requirements. Do not put internal evidence-state labels (FORMING, INVESTIGATE, WATCH/NO SIGNAL), schema headings, arrows, or email correspondence structure in external body. Keep the exact source state in signal_state metadata. Preserve all source uncertainty verbatim in qualifications and material uncertainty accurately in the body. Bind claims to verified evidence references; never invent claims, commitments, or capabilities. The verified one-off sourced draft offer may be included only if appropriate for the form and backed by capability_claims. Return the response_schema fields, with correspondence excerpts where requested. Do not submit externally before owner approval.`:`Compose a short first-contact editorial introduction using the Semiconductor For You communication behaviour, with destination-specific facts and angle, never copied campaign content. Renderer adds greeting, concise Sean Walker/EMRADAR identity and sign-off (28 words). Target 110–150 words TOTAL rendered email, hard maximum 165 or lower verified limit. Body has four short paragraphs: (1) Our <scan date> scan identified <formation> as <EXACT source state>. What stood out was <reader-relevant insight>. (2) We are developing an evidence-backed contribution around <specific destination-native angle> — while keeping <material unresolved issue(s)> explicit. (3) One natural recipient-agency question naming the publication, e.g. Would this be suitable as an article or research contribution for <publication>? Adapt types to destination. (4) ${draftOffer(c.route.destination.route_record.destination_class==='latam_trade_publication'?'es-CL':'en')} This bounded campaign-specific offer is VERIFIED; list it in capability_claims as ${draftCapability}. No ongoing monitoring, updates, continuous coverage, interviews or unsupported services. Return correspondence reason/development/insight/proposition/question as exact contiguous body excerpts; reason may share the destination-native question or angle. Use only enough evidence to explain the insight: no statistics dump, full causal chain, report headings, URLs or citations. Sources stay internal. Preserve ALL source_uncertainty verbatim in qualifications indexed by source_index, not in email body. Summarize only material uncertainty needed for truthful first contact in proposition. Retain evidence state and unresolved facts; never invent facts or certainty. Claims are exact body excerpts with source evidence IDs. Independent verifier checks factual entailment, truthful material uncertainty summary plus complete internal uncertainty, destination fit, originality, human correspondence and complete capability inventory. Write in destination language; professional Chilean Spanish when required. Return exact response_schema fields; no greeting, identity or signature in body. Same structure and paragraph rhythm, different insight and contribution for each destination.`

  };
}

export function validateEditorial(result,proof,context){
  if(typeof result?.subject!=='string'||!result.subject.trim()||typeof result?.body!=='string'||!result.body.trim()||result.language!==context.target_language)throw new Error('EDITORIAL_RESULT_INVALID');
  if(result.signal_state!==context.source.state)throw new Error('EDITORIAL_SOURCE_STATE_MISMATCH');
  if(!['factual_entailment','uncertainty_preserved'].every(k=>proof?.editorial_checks?.[k]==='PASS'))throw new Error('EDITORIAL_SOURCE_TRUTH_VERIFICATION_REQUIRED');
  const refs=context.source.evidence;
  validateCapabilityInventory(result,proof);
  if(isEmail(context.destination)){validateCorrespondenceProposition(result,context.destination);if(proof?.editorial_checks?.human_correspondence!=='PASS')throw new Error('HUMAN_CORRESPONDENCE_VERIFICATION_REQUIRED');}
  const copy=`Subject: ${result?.subject||''}\n\n${result?.body||''}`;
  if(externalSchemaLeak(copy)&&!isEmail(context.destination))throw new Error('EXTERNAL_EDITORIAL_SCHEMA_LEAK');
  if(/\b(buy now|guaranteed return|risk.free investment|compra ahora|rendimiento garantizado|inversi[oó]n sin riesgo)\b/i.test(copy))throw new Error('UNSUPPORTED_FINANCIAL_CLAIM');
  const bound=ids=>Array.isArray(ids)&&ids.length>0&&ids.every(id=>refs.includes(id));
  if(!bound(proof?.evidence_refs)||!bound(result.evidence_refs)||!result.claims?.length||!result.claims.every(x=>x.text&&result.body.includes(x.text)&&bound(x.evidence_refs)))throw new Error('EDITORIAL_CLAIM_BINDING_REQUIRED');
  validateInternalUncertainty(result,context.source);
  if(!['factual_entailment','uncertainty_preserved','destination_fit','originality'].every(k=>proof?.editorial_checks?.[k]==='PASS'))throw new Error('EDITORIAL_VERIFICATION_REQUIRED');
  const limit=context.destination.submission_requirements?.match(/(\d+) words or less/i);
  if(limit&&copy.trim().split(/\s+/).length>Number(limit[1]))throw new Error('EDITORIAL_DESTINATION_LENGTH_EXCEEDED');
  return copy;
}

// One correction is allowed only for the two diagnosed content defects. Each
// call still owns its quote, reservation, verification and billing receipt.
export async function produceEditorial(context,work,record=async()=>{}){
  let correction=null;
  for(let attempt=1;attempt<=2;attempt++){
    const request=correction?{...context,editorial_correction:{attempt,failed_gate:correction,instructions:'Write a new destination-specific result using the exact response_schema. Preserve all source facts and uncertainty. Remove ongoing/unsupported services; retain the verified bounded campaign-specific finished sourced draft offer. Copy all correspondence excerpts exactly from body.'}}:context;
    const output=await work(request,attempt);
    output.result=normalizeCorrespondence(output.result,context.source,context.destination);
    try{validateEditorial(output.result,output.proof,context);await record({attempt,status:'PASS'});return output;}
    catch(error){await record({attempt,status:'REJECTED',reason:error.message});if(context.owner_preview&&previewWarning(error.message)&&output.result?.subject?.trim()&&output.result?.body?.trim()){return {...output,preview_warnings:[{gate:'editorial_intelligence',reason:error.message}],preview_only:true};}if(attempt===2||!['UNVERIFIED_CAPABILITY_CLAIM','EDITORIAL_RESULT_INVALID','EDITORIAL_SOURCE_STATE_MISMATCH'].includes(error.message))throw error;correction=error.message;}
  }
}
