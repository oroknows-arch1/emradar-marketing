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
  const roles={reason:`Why ${route.organisation||route.destination_name}, naming it using its verified beat.`,development:'A short, accurate account of the verified development in ordinary editorial language. Keep exact evidence state in signal_state metadata, not in external prose.',insight:'What stood out was <destination-relevant insight>. Share the short scan paragraph with development.',proposition:'A natural, publication-specific explanation of the potential story and its significance. Integrate material uncertainties in ordinary language without listing research constraints or promising outcomes.',question:'Ask the recipient whether or how this material or proposed contribution would be useful for their publication. Give them agency over the angle or destination-native format. A question about the subject matter alone is invalid. Name the publication. Prefer: Would this be suitable as an article or research contribution for <publication>? Adapt types to the verified destination.'};
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
      instructions:`Write a concise first-contact note from one knowledgeable person to a publication editor, informed by the successful Semiconductor For You correspondence behaviour, not its facts or fixed wording. Lead with a concrete VERIFIED development drawn from source_facts; explain why it matters specifically to this destination's readers and what original contribution or useful question it suggests. Connect the development to its practical consequences in plain language. Express only material unresolved issues naturally, without exporting research metadata, evidence-state labels, checklist phrases or internal terminology. Exact signal state belongs in signal_state metadata; all source_uncertainty texts belong verbatim in indexed qualifications. Do not write formulaic phrases such as 'We are developing an evidence-backed contribution around' or 'while keeping ... explicit'. Never imply awarded acreage is discovered reserves or production, or infer commercial outcomes from exploration rights without evidence. Invite the editor to decide whether an article or research contribution would be useful for their named publication, with a genuine recipient-agency question. End with the existing authorized offer: ${draftOffer(c.route.destination.route_record.destination_class==='latam_trade_publication'?'es-CL':'en')} Include it in capability_claims as ${draftCapability}; do not offer ongoing monitoring, updates, interviews or unverified services. Renderer supplies greeting, Sean Walker/EMRADAR identity and sign-off (about 28 words). Aim for 110–150 words TOTAL rendered email, maximum 165 or lower verified limit. Keep body concise and readable, without headings, URLs, citations or evidence dumps. Return correspondence reason/development/insight/proposition/question as exact contiguous excerpts of body; excerpts may overlap. Every claim must be an exact body excerpt with bound evidence IDs. Preserve factual entailment, source uncertainty, original destination fit and language (professional Chilean Spanish where applicable). Different destinations require independently derived insights, not publication-name substitutions. Return exactly the response_schema fields, with no greeting, identity or signature in body.`gnature in body. Same structure and paragraph rhythm, different insight and contribution for each destination.`

  };
}

export function validateEditorial(result,proof,context){
  if(typeof result?.subject!=='string'||!result.subject.trim()||typeof result?.body!=='string'||!result.body.trim()||result.language!==context.target_language)throw new Error('EDITORIAL_RESULT_INVALID');
  if(result.signal_state!==context.source.state)throw new Error('EDITORIAL_SOURCE_STATE_MISMATCH');
  if(!['factual_entailment','uncertainty_preserved'].every(k=>proof?.editorial_checks?.[k]==='PASS'))throw new Error('EDITORIAL_SOURCE_TRUTH_VERIFICATION_REQUIRED');
  const refs=context.source.evidence;
  validateCapabilityInventory(result,proof);
  if(context.human_correspondence_contract||isEmail(context.destination)){validateCorrespondenceProposition(result,context.destination);if(proof?.editorial_checks?.human_correspondence!=='PASS')throw new Error('HUMAN_CORRESPONDENCE_VERIFICATION_REQUIRED');}
  const copy=`Subject: ${result?.subject||''}\n\n${result?.body||''}`;
  if(externalSchemaLeak(copy)&&!isEmail(context.destination)&&!context.owner_preview)throw new Error('EXTERNAL_EDITORIAL_SCHEMA_LEAK');
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
