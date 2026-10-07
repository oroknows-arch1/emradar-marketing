import brand from './email-brand.cjs';
import {recipientGreeting,evidenceBinding} from './editorial-email.js';
// Owner-authorized preview policy is scoped to the existing campaign. It never
// grants publication authority or changes the AUD spending envelope.
export const ownerPreview=input=>input?.product==='EMRADAR'&&input.campaign_id==='EMRADAR_2026_10_06_LAUNCH'&&input.owner_preview===true&&input.stop_at==='PUBLICATION_REVIEW';
export const previewWarning=reason=>/^(UNVERIFIED_CAPABILITY_CLAIM|CAPABILITY_INVENTORY_VERIFICATION_REQUIRED|HUMAN_[A-Z_]+|EMAIL_(UNCERTAINTY_NOT_PRESERVED|EDITORIAL_PROPOSITION_REQUIRED)|EDITORIAL_(RESULT_INVALID|CLAIM_BINDING_REQUIRED|UNCERTAINTY_NOT_PRESERVED|VERIFICATION_REQUIRED|DESTINATION_LENGTH_EXCEEDED|REVIEW_REQUIRED)|EXTERNAL_EDITORIAL_SCHEMA_LEAK|DESTINATION_PERMISSION_REQUIRED|ACCOUNT_AUTHORIZATION_REQUIRED|DESTINATION_ADAPTER_UNAVAILABLE)$/.test(reason);
export function previewCorrespondence(result,signal,route){
 if(typeof result?.subject!=='string'||!result.subject.trim()||typeof result?.body!=='string'||!result.body.trim())throw Error('PREVIEW_CONTENT_MISSING');
 const greeting=recipientGreeting(route,result.language),recipient=greeting.name;
 const es=result.language==='es-CL';
 const body=[greeting.text,es?'Soy Sean Walker y trabajo en EMRADAR, un sistema que sigue formaciones de mercado emergentes a partir de evidencia de la economía real.':"I’m Sean Walker, working on EMRADAR, a system that tracks emerging market formations from evidence in the real economy.",result.body.replace(/https?:\/\/\S+/g,''),(es?'Saludos,':'Regards,')+'\nSean Walker\nEMRADAR'].join('\n\n');
 return brand.brand({version:'human-correspondence-v2',subject:result.subject,body,to:route.public_contact_point||'UNKNOWN',from:{name:'Sean Walker',address:brand.identity.address},language:result.language,proposition:result,evidence_binding:evidenceBinding(signal),preview_only:true,features:{version:'human-correspondence-v2',greeting_type:greeting.type,named_recipient:recipient!==null,introduction_style:'person_before_organisation',introduction_variant:0,destination_specific_reason:result.correspondence?.reason,angle:result.correspondence?.insight,localisation:result.language,causal_effect:'UNKNOWN',offered_next_step:result.correspondence?.next_step,email_length_words:body.trim().split(/\s+/).length,source_revision:signal.revision,question:result.correspondence?.question||null,question_type:'recipient_agency_contribution_question'}});
}

