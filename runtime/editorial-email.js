import crypto from 'node:crypto';
const hash=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
export const emailVersion='human-ready-email-v1';
const fail=s=>{throw new Error(s);};
const isEmail=route=>/email/i.test(route?.access_method||'');
export {isEmail};
const claims=/(?:\b(?:EMRADAR|we|our|I)\b[^.!?\n]{0,100}\b(?:can|will|would|provide|monitor|follow|update|track|investigate|continu\w*|coverage|service)|\b(?:we propose|we would|we offer)\b|\b(?:EMRADAR|proponemos|ofrecemos|podemos|seguiremos|monitoreamos)\b[^.!?\n]{0,100}\b(?:seguir|mantendr\w*|ofrecer|proporcion\w*|cobertura|contin\w*|actualiz\w*|investig\w*))/iu;
const sentences=text=>text.split(/(?<=[.!?])\s+(?=[A-ZÁÉÍÓÚ¿])/u);
export function removeUnverifiedOffers(text){return text.split(/\n\n+/).map(p=>sentences(p).filter(s=>!claims.test(s)).join(' ')).filter(Boolean).join('\n\n');}
const angles={
  financial_guest_view_pitch:['Your readers may find the investment economics relevant.','A sus lectores les puede interesar la economía de esta inversión.'],
  editor_pitch:['For your mining-technology readers, the question is how equipment and engineering translate into productive capacity.','Para sus lectores de tecnología minera, la pregunta es cómo los equipos y la ingeniería se convierten en capacidad productiva.'],
  supplier_chain_pitch:['For your procurement readers, the distinction is between expected supplier opportunities and confirmed contract awards.','Para sus lectores de abastecimiento, conviene distinguir las oportunidades previstas de los contratos efectivamente adjudicados.'],
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
  return {subject,body:body.trim(),language,signal_state:signal.state,evidence_refs:[...signal.evidence],qualifications,provenance:{method:'native_gated_source_and_existing_unsent_proposition',proposal_id:proposal.proposal_id,source_revision:signal.revision}};
}

export function humanReadyEmail({proposition,signal,route,identity,product}){
  if(!isEmail(route))return null;
  if(product!=='EMRADAR')fail('EMAIL_PRODUCT_PROFILE_REQUIRED');
  if(!identity?.approved||!identity.name||!identity.address||/[\r\n]/.test(identity.name+identity.address))fail('APPROVED_EMAIL_SENDER_REQUIRED');
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(route.public_contact_point||''))fail('EDITORIAL_EMAIL_CONTACT_INVALID');
  if(proposition.signal_state!==signal.state||hash(proposition.evidence_refs)!==hash(signal.evidence))fail('EMAIL_SOURCE_BINDING_REQUIRED');
  const es=proposition.language==='es-CL';
  const angle=angles[route.accepted_formats[0]]?.[es?1:0];if(!angle)fail('EMAIL_DESTINATION_ANGLE_REQUIRED');
  const context=es?'EMRADAR conecta cambios documentados con sus consecuencias económicas.':'EMRADAR maps evidence and market consequences.';
  const clean=removeUnverifiedOffers(proposition.body);
  if(!clean.trim())fail('EMAIL_EDITORIAL_PROPOSITION_REQUIRED');
  if(!(signal.source_uncertainty||[]).every((_,i)=>proposition.qualifications?.some(q=>q.source_index===i&&clean.includes(q.text))))fail('EMAIL_UNCERTAINTY_NOT_PRESERVED');
  const compact=route.accepted_formats.includes('financial_guest_view_pitch');
  const refs=(signal.source_facts||[]).filter(f=>signal.evidence.includes(f.id));
  const sourceText=(compact?refs.slice(0,1):refs).map(f=>f.url).join('\n');
  if(!sourceText)fail('EMAIL_SOURCE_LINK_REQUIRED');
  const intro=compact?context+' '+angle:context+' '+(es?'Le escribo porque este desarrollo puede ser relevante para sus lectores.':'I’m writing because this development may be relevant to your readers.')+' '+angle;
  const offer=compact?'':es?'Comparto a continuación una nota basada en las fuentes indicadas; las cifras previstas y los resultados efectivos se mantienen separados.':'I’m sharing a note drawn from the sources below, keeping expected outcomes separate from results already delivered.';
  const body=[es?'Hola,':'Hello,',intro,offer,clean,(es?'Fuentes: ':'Source'+(compact?'': 's')+': ')+sourceText,es?'¿Les interesaría este enfoque para su cobertura editorial?':'Would this sourced note interest your editors?',(es?'Saludos,':'Regards,')+'\n'+identity.name].filter(Boolean).join('\n\n');
  const email={version:emailVersion,to:route.public_contact_point,from:{name:identity.name,address:identity.address},subject:proposition.subject,body,language:proposition.language,proposition,visual:'NONE'};
  validateHumanEmail(email,signal,route,identity);
  return email;
}
export function validateHumanEmail(email,signal,route,identity){
  if(!email?.subject?.trim()||/[\r\n]/.test(email.subject)||!email.body?.trim()||email.to!==route.public_contact_point||hash(email.from)!==hash({name:identity.name,address:identity.address})||email.version!==emailVersion)fail('HUMAN_READY_EMAIL_REQUIRED');
  if(!email.body.startsWith(email.language==='es-CL'?'Hola,':'Hello,')||!email.body.endsWith('\n'+identity.name))fail('EMAIL_CORRESPONDENCE_REQUIRED');
  if(/(?:^|\n)Subject:/.test(email.body)||claims.test(email.body))fail('UNVERIFIED_CAPABILITY_CLAIM');
  if(!(signal.source_uncertainty||[]).every((_,i)=>email.proposition.qualifications?.some(q=>q.source_index===i&&email.body.includes(q.text))))fail('EMAIL_UNCERTAINTY_NOT_PRESERVED');
  const limit=route.submission_requirements?.match(/(\d+) words or less/i);
  if(limit&&email.body.trim().split(/\s+/).length>Number(limit[1]))fail('EDITORIAL_DESTINATION_LENGTH_EXCEEDED');
  return {status:'PASS',version:emailVersion,claims:[{capability:'source_linked_note',state:'VERIFIED',authorized:true,evidence:{source_revision:signal.revision,evidence_refs:[...signal.evidence],artifact_hash:hash({subject:email.subject,body:email.body})}}],excluded_capabilities:[{capability:'ongoing_monitoring_or_continuous_coverage',state:'UNVERIFIED',authorized:false,reason:'No current campaign-scoped production proof; no ongoing service promised.'}]};
}
