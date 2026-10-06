import crypto from 'node:crypto';
const hash=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
export const emailVersion='human-correspondence-v2';
export const correspondentName='Sean Walker';
const fail=s=>{throw new Error(s);};
const isEmail=route=>/email/i.test(route?.access_method||'');
export {isEmail};
const claims=/(?:\b(?:EMRADAR|we|our|I)\b[^.!?\n]{0,100}\b(?:can|will|would|provide|monitor|follow|update|track|investigate|continu\w*)|\b(?:EMRADAR|we|our)\b[^.!?\n]{0,100}\b(?:coverage|service)\b|\b(?:we propose|we would|we offer)\b|\b(?:EMRADAR|proponemos|ofrecemos|podemos|seguiremos|monitoreamos)\b[^.!?\n]{0,100}\b(?:seguir|mantendr\w*|ofrecer|proporcion\w*|cobertura|contin\w*|actualiz\w*|investig\w*))/iu;
const sentences=text=>text.split(/(?<=[.!?])\s+(?=[A-ZÁÉÍÓÚ¿])/u);
export function removeUnverifiedOffers(text){return text.split(/\n\n+/).map(p=>sentences(p).filter(s=>!claims.test(s)).join(' ')).filter(Boolean).join('\n\n');}
const angles={
  financial_guest_view_pitch:['For Breakingviews readers, the question is committed capital versus delivered output.','A sus lectores les puede interesar la economía de esta inversión.'],
  editor_pitch:['For International Mining’s readers, the question is how equipment and engineering translate into productive capacity.','Para sus lectores de tecnología minera, la pregunta es cómo los equipos y la ingeniería se convierten en capacidad productiva.'],
  supplier_chain_pitch:['For Australian Mining Review readers, the distinction is between expected supplier opportunities and confirmed contract awards.','Para sus lectores de abastecimiento, conviene distinguir las oportunidades previstas de los contratos efectivamente adjudicados.'],
  latam_editor_pitch:['For your regional mining readers, the angle is how investment connects with construction, productive capacity and local suppliers.','Para REDIMIN, el ángulo es cómo la inversión se conecta con las obras, la capacidad productiva y los proveedores de la región.']
};
const uncertaintyTranslations={
  'Construction milestones':'Hitos de construcción',
  'Final cost':'Costo final',
  'Commissioning and ramp':'Puesta en marcha y aumento gradual de la producción',
  'Realised copper-equivalent output':'Producción efectiva equivalente de cobre',
  'Expected output is forecast rather than realised, and returns remain exposed to copper and molybdenum prices.':'La producción prevista aún no es producción efectiva; los retornos también dependen de los precios del cobre y del molibdeno.'
};

// Reuse requires the same native-gated source and exact previously prepared route.
// No caller-supplied copy, source, recipient or promise is accepted by this path.
export function reuseProposition(proposal,signal){
  if(proposal.signal_revision!==signal.revision||proposal.signal_state!==signal.state||hash(proposal.evidence_refs)!==hash(signal.evidence))fail('REVISION_SOURCE_CHANGED');
  if(!isEmail(proposal.asset?.delivery)||proposal.copy!==proposal.asset.copy)fail('REVISION_EMAIL_ARTIFACT_REQUIRED');
  const [headline,...rest]=proposal.copy.split('\n');
  const subject=headline.replace(/^Subject:\s*/,'').trim();
  const language=proposal.asset.localization?.language||'en';
  let body,qualifications;
  if(language==='es-CL'){
    if(proposal.asset.localization?.status!=='VERIFIED'||proposal.asset.localization.copy_hash!==hash(proposal.copy))fail('REVISION_LOCALIZATION_NOT_VERIFIED');
    body=removeUnverifiedOffers(rest.join('\n').trim());
    qualifications=(signal.source_uncertainty||[]).map((text,source_index)=>{
      let translated=uncertaintyTranslations[text];
      if(!translated&&/ceremonial start.*main works scheduled for early (\d{4})/i.test(text)){
        const year=text.match(/early (\d{4})/i)[1];
        translated=`La ceremonia antecede a las obras principales previstas para comienzos de ${year}.`;
        if(!proposal.copy.includes(translated))fail('REVISION_LOCALIZATION_NOT_VERIFIED');
      }
      if(!translated)fail('SOURCE_UNCERTAINTY_LOCALIZATION_REQUIRED');
      return {source_index,text:translated};
    });
    body+='\n\n'+qualifications.map(q=>q.text).filter(t=>!body.includes(t)).join('; ');
  }else{
    const facts=signal.source_facts||[];if(!facts.length||facts.some(f=>!signal.evidence.includes(f.id)||!f.url||!f.text))fail('SOURCE_FACT_BINDING_REQUIRED');
    // The concise Guest View note uses one attributed fact, not a full manuscript.
    body=(proposal.format==='financial_guest_view_pitch'?facts.slice(0,1):facts).map(f=>f.text).join(' ');
    qualifications=(signal.source_uncertainty||[]).map((text,source_index)=>({text,source_index}));
    body+='\n\n'+qualifications.map(q=>q.text).join(' ');
  }
  if(language==='en'){
    const full=qualifications.filter(q=>/[.!?]$/.test(q.text)),fragments=qualifications.filter(q=>!/[.!?]$/.test(q.text));
    for(let i=0;i<fragments.length;i++)if(i>0)fragments[i].text=fragments[i].text[0].toLowerCase()+fragments[i].text.slice(1);
    const items=fragments.map(q=>q.text),pending=items.length?items.slice(0,-1).join(', ')+(items.length>1?', and ':'')+items.at(-1)+' remain unconfirmed.':'';
    const facts=signal.source_facts,chosen=facts.slice(0,1);
    body=chosen.map(f=>f.text).join(' ')+'\n\n'+full.map(q=>q.text).join(' ')+(pending?' '+pending:'');
  }
  if(language==='es-CL'){
    const fragments=qualifications.filter(q=>!/[.!?]$/.test(q.text));
    // Full sentences are retained; unresolved terms become one natural sentence.
    const full=qualifications.filter(q=>/[.!?]$/.test(q.text));
    body=removeUnverifiedOffers(rest.join('\n').trim());
    body+='\n\n'+full.map(q=>q.text).filter(t=>!body.includes(t)).join(' ');
    for(const q of fragments)q.text=q.text[0].toLowerCase()+q.text.slice(1);
    if(fragments.length){const items=fragments.map(q=>q.text);body+=' '+ 'Aún falta confirmar '+items.slice(0,-1).join(', ')+(items.length>1?' y ':'')+items.at(-1)+'.';}
  }
  return {subject,body:body.trim(),language,signal_state:signal.state,evidence_refs:[...signal.evidence],qualifications,provenance:{method:'native_gated_source_and_existing_unsent_proposition',proposal_id:proposal.proposal_id,source_revision:signal.revision}};
}

// One bounded graph responsibility: render a source-qualified proposition into
// the exact review artifact. It never fetches sources, dispatches models or sends.
export function recipientGreeting(route,language){
  const recipient=route.recipient_identity;
  const verified=recipient?.state==='VERIFIED'&&recipient.address===route.public_contact_point&&recipient.evidence_source_url===route.evidence_source_url&&route.verification_state==='VERIFIED'&&recipient.verified_at===route.verified_at;
  if(verified&&recipient.name&&/^[\p{L} .'-]{1,60}$/u.test(recipient.name))return {text:language==='es-CL'?`Hola ${recipient.name},`:`Hi ${recipient.name},`,type:'verified_named',name:recipient.name};
  return {text:language==='es-CL'?'Hola,':'Hello,',type:'neutral',name:null};
}
export function humanReadyEmail({proposition,signal,route,identity,product}){
  if(!isEmail(route))return null;
  if(product!=='EMRADAR')fail('EMAIL_PRODUCT_PROFILE_REQUIRED');
  if(!identity?.approved||identity.name!==correspondentName||identity.address!=='oroknows@gmail.com')fail('APPROVED_EMAIL_SENDER_REQUIRED');
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(route.public_contact_point||''))fail('EDITORIAL_EMAIL_CONTACT_INVALID');
  if(proposition.signal_state!==signal.state||hash(proposition.evidence_refs)!==hash(signal.evidence))fail('EMAIL_SOURCE_BINDING_REQUIRED');
  if(!['en','es-CL'].includes(proposition.language))fail('EMAIL_LANGUAGE_PROFILE_REQUIRED');
  const es=proposition.language==='es-CL',publication=route.organisation||route.destination_name;
  if(!publication||/[\r\n]/.test(publication))fail('EMAIL_DESTINATION_BINDING_REQUIRED');
  const greeting=recipientGreeting(route,proposition.language);
  const context=es?'Soy Sean Walker y trabajo en EMRADAR, un sistema que sigue formaciones de mercado emergentes a partir de evidencia de la economía real.':"I’m Sean Walker, working on EMRADAR, a system that tracks emerging market formations from evidence in the real economy.";
  validateCorrespondenceProposition(proposition,route);
  validateInternalUncertainty(proposition,signal);
  const clean=proposition.body.trim();
  const {reason,insight:angle,question}=proposition.correspondence;
  const introIndex=0;
  const body=[greeting.text,context,clean,(es?'Saludos,':'Regards,')+'\n'+correspondentName+'\nEMRADAR'].join('\n\n');
  const features={version:emailVersion,greeting_type:greeting.type,named_recipient:greeting.name!==null,introduction_style:'person_before_organisation',introduction_variant:introIndex,destination_specific_reason:reason,angle,email_length_words:body.trim().split(/\s+/).length,question_type:'recipient_agency_contribution_question',question,offered_next_step:proposition.correspondence?.next_step||'NONE',localisation:proposition.language,source_revision:signal.revision,causal_effect:'UNKNOWN'};
  const email={version:emailVersion,to:route.public_contact_point,from:{name:correspondentName,address:identity.address},subject:proposition.subject,body,language:proposition.language,proposition,features,visual:'NONE',evidence_binding:evidenceBinding(signal)};
  validateHumanEmail(email,signal,route,identity);return email;
}
export function recipientAgency(question){
  const q=String(question||'');
  return /[?？]/u.test(q)&&(/(?:you|your|les|le|su|ustedes)/iu.test(q)||/would.*(?:this|the).*(?:useful|suitable)/iu.test(q))&&/(?:useful|suit|interest|help|welcome|consider|prefer|fit|servir|interes|util|útil|prefer|encajar)/iu.test(q)&&/(?:note|angle|material|analysis|article|research|contribut|commentary|brief|evidence|enfoque|nota|análisis|artículo|aporte|investigación)/iu.test(q);
}
export const draftCapability='campaign_specific_finished_sourced_draft';
export const draftOffer=language=>language==='es-CL'?'Si les resulta útil, puedo enviar un borrador terminado y conciso con fuentes para su revisión.':'If useful, I can send a concise finished draft with sources for review.';
export const evidenceBinding=signal=>({source_revision:signal.revision,signal_state:signal.state,evidence_refs:[...signal.evidence],source_facts:structuredClone(signal.source_facts||[]),source_uncertainty:[...(signal.source_uncertainty||[])]});
export function validateInternalUncertainty(result,signal){
  if(!(signal.source_uncertainty||[]).every((text,i)=>result.qualifications?.some(q=>q.source_index===i&&q.text===text)))fail('EMAIL_UNCERTAINTY_NOT_PRESERVED');
}
export function correspondenceDensity(body,language='en'){
  const words=body.trim().split(/\s+/u).length;
  if(words>165||/https?:\/\/|www\.|(?:^|\n)(?:Supporting sources?|Sources?|Evidence|Unresolved|Causal chain)\s*:/imu.test(body))fail('HUMAN_CORRESPONDENCE_DENSITY_REQUIRED');
  return words;
}
export function validateCorrespondenceProposition(proposition,route){
  const parts=proposition.correspondence;
  for(const key of ['reason','development','insight','proposition','question'])if(!parts?.[key]?.trim()||!proposition.body.includes(parts[key]))fail('HUMAN_PROPOSITION_QUALITIES_REQUIRED');
  const name=route.organisation||route.destination_name;
  if(!parts.reason.includes(name)||!parts.question.includes(name)||!recipientAgency(parts.question))fail('HUMAN_RECIPIENT_AGENCY_REQUIRED');
  if(!/(?:what stood out|lo que destac[oó]|lo que llam[oó].*atenci[oó])/iu.test(parts.insight)||!/(?:evidence.backed contribution|contribuci[oó]n.*(?:evidencia|fuentes))/iu.test(parts.proposition)||!/(?:unresolved|unconfirmed|uncertain|unknown|pending|remain.*open|sin resolver|incertidumbre|pendiente)/iu.test(parts.proposition))fail('HUMAN_CORRESPONDENCE_STRUCTURE_REQUIRED');
  if(!parts.development.includes(proposition.signal_state))fail('EMAIL_SOURCE_STATE_REQUIRED');
  if(proposition.body.trim().split(/\s+/u).length>137||/(?:^|\n)(?:Evidence|Unresolved|Causal chain|Sources?)\s*:|(?:I'm|I’m) writing from EMRADAR|relevant to your audience/imu.test(proposition.body)||/https?:\/\//i.test(proposition.body))fail('HUMAN_PROPOSITION_MEMO_OR_BOILERPLATE');
  const offer=draftOffer(proposition.language);
  if(parts.next_step!==offer||!proposition.body.includes(offer)||!proposition.capability_claims?.some(c=>c.text===offer&&c.capability===draftCapability))fail('UNVERIFIED_CAPABILITY_CLAIM');
}
export function validateCapabilityInventory(result,proof){
  if(proof?.editorial_checks?.capability_inventory!=='PASS'||!Array.isArray(result?.capability_claims))fail('CAPABILITY_INVENTORY_VERIFICATION_REQUIRED');
  let factualBody=result.body;
  for(const claim of result.capability_claims){
    if(claim.text!==draftOffer(result.language)||!result.body.includes(claim.text)||claim.capability!==draftCapability)fail('UNVERIFIED_CAPABILITY_CLAIM');
    factualBody=factualBody.replace(claim.text,'');
  }
  if(claims.test(factualBody))fail('UNVERIFIED_CAPABILITY_CLAIM');
}
export function validateHumanEmail(email,signal,route,identity){
  if(!email?.subject?.trim()||/[\r\n]/.test(email.subject)||!email.body?.trim()||email.to!==route.public_contact_point||hash(email.from)!==hash({name:identity.name,address:identity.address})||email.version!==emailVersion)fail('HUMAN_READY_EMAIL_REQUIRED');
  const greeting=recipientGreeting(route,email.language);
  if(!email.body.startsWith(greeting.text+'\n\n')||!/(?:I'm|I’m|My name is|Soy|Me llamo) Sean Walker/u.test(email.body)||!email.body.endsWith('\n'+correspondentName+'\nEMRADAR'))fail('EMAIL_CORRESPONDENCE_REQUIRED');
  validateCorrespondenceProposition(email.proposition,route);
  validateCapabilityInventory(email.proposition,{editorial_checks:{capability_inventory:'PASS'}});
  validateInternalUncertainty(email.proposition,signal);
  if(hash(email.evidence_binding)!==hash(evidenceBinding(signal)))fail('EMAIL_SOURCE_BINDING_REQUIRED');
  if(email.features?.version!==emailVersion||email.features.greeting_type!==greeting.type||email.features.email_length_words!==email.body.trim().split(/\s+/).length)fail('EMAIL_LEARNING_FEATURE_BINDING_REQUIRED');
  if(/(?:^|\n)Subject:/.test(email.body)||claims.test(email.proposition.body.replace(draftOffer(email.language),'')))fail('UNVERIFIED_CAPABILITY_CLAIM');
  if(email.features.source_revision!==signal.revision||email.features.named_recipient!==(greeting.name!==null)||email.features.localisation!==email.language||email.features.causal_effect!=='UNKNOWN'||!['destination_specific_reason','angle','question'].every(k=>email.features[k]&&email.body.includes(email.features[k])))fail('EMAIL_LEARNING_FEATURE_BINDING_REQUIRED');
  correspondenceDensity(email.body,email.language);
  const limit=route.submission_requirements?.match(/(\d+) words or less/i);
  if(limit&&email.body.trim().split(/\s+/).length>Number(limit[1]))fail('EDITORIAL_DESTINATION_LENGTH_EXCEEDED');
  return {status:'PASS',version:emailVersion,claims:[{capability:'current_evidence_mapping',state:'VERIFIED',authorized:true,evidence:email.evidence_binding},{capability:draftCapability,state:'VERIFIED',authorized:true,scope:'One finished sourced draft for this campaign and destination, on request',evidence:{source_revision:signal.revision,evidence_refs:[...signal.evidence],artifact_hash:hash({subject:email.subject,body:email.body})}}],excluded_capabilities:[{capability:'ongoing_monitoring_or_continuous_coverage',state:'UNVERIFIED',authorized:false,reason:'No ongoing service authorized.'}]};
}
