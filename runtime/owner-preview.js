// Owner-authorized preview policy is scoped to the existing campaign. It never
// grants publication authority or changes the AUD spending envelope.
export const ownerPreview=input=>input?.product==='EMRADAR'&&input.campaign_id==='EMRADAR_2026_10_06_LAUNCH'&&input.owner_preview===true&&input.stop_at==='PUBLICATION_REVIEW';
export const previewWarning=reason=>/^(UNVERIFIED_CAPABILITY_CLAIM|CAPABILITY_INVENTORY_VERIFICATION_REQUIRED|HUMAN_[A-Z_]+|EMAIL_(UNCERTAINTY_NOT_PRESERVED|EDITORIAL_PROPOSITION_REQUIRED)|EDITORIAL_(RESULT_INVALID|CLAIM_BINDING_REQUIRED|UNCERTAINTY_NOT_PRESERVED|VERIFICATION_REQUIRED|DESTINATION_LENGTH_EXCEEDED|REVIEW_REQUIRED)|EXTERNAL_EDITORIAL_SCHEMA_LEAK|DESTINATION_PERMISSION_REQUIRED|ACCOUNT_AUTHORIZATION_REQUIRED|DESTINATION_ADAPTER_UNAVAILABLE)$/.test(reason);
export function previewCorrespondence(result,signal,route){
 if(typeof result?.subject!=='string'||!result.subject.trim()||typeof result?.body!=='string'||!result.body.trim())throw Error('PREVIEW_CONTENT_MISSING');
 const recipient=route.recipient_identity?.state==='VERIFIED'?route.recipient_identity.name:null;
 const body=[recipient?'Hi '+recipient+',':'Hello,',"I'm Sean Walker, working on EMRADAR.",result.body,'Supporting sources: '+signal.source_facts.map(f=>f.url).join('\n'),'Regards,\nSean Walker\nEMRADAR'].join('\n\n');
 return {version:'human-correspondence-v2',subject:result.subject,body,to:route.public_contact_point||'UNKNOWN',from:{name:'Sean Walker',address:'oroknows@gmail.com'},language:result.language,proposition:result,preview_only:true,features:{version:'human-correspondence-v2',greeting_type:recipient?'verified_named':'neutral',email_length_words:body.trim().split(/\s+/).length,source_revision:signal.revision,question:result.correspondence?.question||null,question_type:'recipient_agency_contribution_question'}};
}
