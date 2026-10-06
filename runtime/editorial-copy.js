import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import {validateCapabilityInventory,validateCorrespondenceProposition,isEmail} from './editorial-email.js';

export const editorialContract=await fs.readFile(new URL('../contracts/editorial-copy-system-v1.md',import.meta.url),'utf8');
export const correspondenceContract=await fs.readFile(new URL('../contracts/human-correspondence-v2.md',import.meta.url),'utf8');
export const correspondenceFields=Object.freeze(['reason','development','insight','proposition','question']);
export const editorialVersion=crypto.createHash('sha256').update(editorialContract+correspondenceContract).digest('hex');
export function editorialResponseSchema(signal,route,language){
  const string={type:'string'},refs={type:'array',items:{type:'string',enum:signal.evidence},minItems:1};
  const object=properties=>({type:'object',additionalProperties:false,properties,required:Object.keys(properties)});
  const roles={reason:`Why ${route.organisation||route.destination_name}, naming it using its verified beat.`,development:'One concise attributed source-supported development.',insight:'What stands out in the causal reasoning, in plain language.',proposition:'A concrete editorial angle for this recipient.',question:'A natural editorial question to this recipient, containing a question mark.'};
  const limit=Number(route.submission_requirements?.match(/(\d+) words or less/i)?.[1]||205);
  return object({
    subject:{...string,description:'A short natural email subject, without labels.'},
    body:{...string,description:`Natural email proposition, at most ${Math.min(180,limit-25)} words. No labels or headings (including Reason, Development, Insight, Proposition or Question), greeting, sender, signature or URLs. Preserve ALL source uncertainties and counterevidence. Multiple correspondence roles may share the same sentence to fit the limit.`},
    language:{type:'string',enum:[language]},signal_state:{type:'string',enum:[signal.state]},evidence_refs:refs,
    claims:{type:'array',minItems:1,items:object({text:{...string,description:'Exact excerpt from body, not a paraphrase.'},evidence_refs:refs})},
    qualifications:{type:'array',minItems:signal.source_uncertainty.length,items:object({source_index:{type:'integer',enum:signal.source_uncertainty.map((_,i)=>i)},text:{...string,description:'Exact excerpt from body preserving the indexed uncertainty. Include a record for EVERY source index; shared sentences are allowed.'}})},
    capability_claims:{type:'array',items:object({text:string,capability:{type:'string',enum:['source_linked_note']}})},
    correspondence:object({...Object.fromEntries(correspondenceFields.map(key=>[key,{...string,description:roles[key]+' Exact, contiguous excerpt copied from body, not a paraphrase. Nonempty; excerpts may overlap.'}])),next_step:{type:['string','null'],description:'Null unless the currently included source-linked note is explicitly and truthfully offered with a capability claim.'}})
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
    ...(isEmail(c.route.destination.route_record)?{
      human_correspondence_contract:correspondenceContract,
      response_schema:editorialResponseSchema(c.signal,c.route.destination.route_record,c.route.destination.route_record.destination_class==='latam_trade_publication'?'es-CL':'en'),
      response_contract:{
        type:'object',required:['subject','body','language','signal_state','evidence_refs','claims','qualifications','capability_claims','correspondence'],
        correspondence:{type:'object',required:correspondenceFields,properties:Object.fromEntries(correspondenceFields.map(key=>[key,{type:'string',minLength:1,description:'Copy an exact, contiguous excerpt from body; do not paraphrase or summarise it.'}]))},
        body_rule:'Write body once, then extract the five correspondence values from it verbatim. Values may overlap or share a sentence when it performs multiple roles. Do not return correspondence as a list, renamed keys, or a separate paraphrased draft. Preserve every qualification in body. Return all fields at the top level of the JSON result.'
      }
    }:{}),
    source:{...c.signal,source_facts:facts},
    product_copy_profile:c.product.copy_profile||c.product.product_copy_profile||null,
    brand_system:c.product.brand_system||'UNDEFINED',
    destination:c.route.destination.route_record,
    brief:c.route_plan.proposed_assets.find(a=>a.destination_id===c.route.id),
    capabilities:{source_linked_note:{state:'VERIFIED',authorized:true,scope:'Only the current source-bound note included in the email'},ongoing_monitoring_or_continuous_coverage:{state:'UNVERIFIED',authorized:false}},
    target_language:c.route.destination.route_record.destination_class==='latam_trade_publication'?'es-CL':'en',
    instructions:'For email destinations, produce a concise plain-language proposition for one knowledgeable person to discuss with an editor. Evidence supports the conversation: never lead with an evidence packet. Return correspondence with reason (why this publication, naming it and using verified route beats), development (what happened), insight (what stood out in the causal reasoning), proposition (a concrete editorial angle), question (a natural destination-specific question), and optional next_step (only the permitted current note, with capability inventory). Each value must appear verbatim in body as short natural paragraphs, including every uncertainty. Vary wording to suit the development and recipient; never reuse a fixed campaign template. Write directly in the destination language, including Chilean professional Spanish for es-CL; do not translate an English template. No greeting, identity, sign-off, source URLs or evidence headings inside body: the separate correspondence graph worker adds those. Maximum 180 body words; budget greeting, introduction, source link and sign-off inside the destination total word limit (about 40 words overhead). Do not claim to deliver an article or research product without verified capability. A separate verifier must return editorial_checks.human_correspondence=PASS for concrete recipient fit, plain language, insight, proposition, natural question and locally natural language. Transform the evidence-qualified source into an original destination-specific editorial pitch. Apply the full editorial contract and product voice. Do not imitate any named publication or journalist. Do not output schema labels, canned causal chains, forecasts as realised outcomes, investment recommendations, or claims of supplier awards without evidence. Include every material source uncertainty naturally. Facts, quantities and claims must be grounded in source evidence. Follow destination submission length and format requirements. Return subject, body, language, signal_state, evidence_refs, claims (each with exact body text and evidence_refs), and qualifications (each with source_index into source_uncertainty and exact body text). Do not promise future research, investigation, monitoring, updates, coverage or any ongoing service. The only permitted offer is the current source-linked note. Return capability_claims listing every material service claim with exact body text and capability; use an empty array when absent. A separate verifier must validate factual entailment, uncertainty preservation, originality, destination fit and completeness of the capability inventory, returning editorial_checks.capability_inventory=PASS only when all service claims are enumerated.'
  };
}

export function validateEditorial(result,proof,context){
  const refs=context.source.evidence;
  validateCapabilityInventory(result,proof);
  if(isEmail(context.destination)){validateCorrespondenceProposition(result,context.destination);if(proof?.editorial_checks?.human_correspondence!=='PASS')throw new Error('HUMAN_CORRESPONDENCE_VERIFICATION_REQUIRED');}
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
