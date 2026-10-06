import test from 'node:test';
import assert from 'node:assert/strict';
import {correspondenceProbe} from '../../runtime/correspondence-probe.js';
import {humanReadyEmail,validateHumanEmail,recipientGreeting} from '../../runtime/editorial-email.js';
import {editorialContext,validateEditorial} from '../../runtime/editorial-copy.js';
import {normalizeOutcome,analyseOutcomes,learnRouting} from '../../runtime/outcomes.js';
import {fixture} from './fixture.js';
const proof={evidence_refs:['SG0','SG1'],editorial_checks:{factual_entailment:'PASS',uncertainty_preserved:'PASS',destination_fit:'PASS',originality:'PASS',capability_inventory:'PASS',human_correspondence:'PASS'}};
const render=p=>humanReadyEmail({proposition:p.email.proposition,signal:p.signal,route:p.route,identity:p.identity,product:'EMRADAR'});
const context=p=>({source:p.signal,target_language:'en',destination:p.route});

test('email producer receives the actual v2 contract and exact consumer field names',()=>{
 const p=correspondenceProbe(),before=structuredClone(p.signal);
 const c=editorialContext({signal:p.signal,product:{},route:{id:p.route.destination_id,destination:{route_record:p.route}},route_plan:{proposed_assets:[{destination_id:p.route.destination_id}]}});
 assert.match(c.human_correspondence_contract,/human_ready_email/);
 assert.deepEqual(c.response_contract.correspondence.required,['reason','development','insight','proposition','question']);
 assert(c.response_contract.required.includes('correspondence'));assert.match(c.response_contract.body_rule,/extract.*verbatim/);
 assert.equal(c.response_schema.additionalProperties,false);assert.deepEqual(c.response_schema.required,Object.keys(c.response_schema.properties));
 assert.deepEqual(c.response_schema.properties.correspondence.required,['reason','development','insight','proposition','question','next_step']);
 assert(c.response_schema.properties.claims.items.required.includes('text'));assert(c.response_schema.properties.qualifications.items.required.includes('text'));
 assert.equal(c.response_schema.properties.qualifications.minItems,p.signal.source_uncertainty.length);assert.deepEqual(c.response_schema.properties.qualifications.items.properties.source_index.enum,p.signal.source_uncertainty.map((_,i)=>i));
 for(const key of c.response_contract.correspondence.required){assert.match(c.response_contract.correspondence.properties[key].description,/exact, contiguous excerpt/);const draft=structuredClone(p.email.proposition);draft.correspondence[key]='A paraphrase absent from the body.';assert.throws(()=>validateEditorial(draft,proof,context(p)),/HUMAN_PROPOSITION_QUALITIES_REQUIRED/);}
 assert.deepEqual(p.signal,before);assert.doesNotThrow(()=>validateEditorial(p.email.proposition,proof,context(p)));
});

// Owner-provided SFY reference describes communication qualities, not authority
// to promise a finished article. Tests intentionally allow different wording.
const semiconductorReference={origin:'OWNER_SUPPLIED_SUCCESSFUL_SEMICONDUCTOR_FOR_YOU_COMMUNICATION',qualities:['human_person','greeting','brief_context','recipient_reason','development','insight','proposition','question','truthful_next_step_or_omission','sign_off']};
test('SFY reference qualities survive without a fixed email template or unsupported finished-draft promise',()=>{
 const p=correspondenceProbe(),e=p.email;assert.equal(p.external_actions,0);assert.equal(p.mode,'TEST_ONLY_NOT_SENT');assert.equal(semiconductorReference.qualities.length,10);
 assert.match(e.body,/Sean Walker/);assert(e.body.includes(e.proposition.correspondence.reason));assert(e.body.includes(e.proposition.correspondence.insight));assert(e.body.includes(e.proposition.correspondence.proposition));assert(e.body.includes(e.proposition.correspondence.question));assert(e.body.endsWith('Sean Walker\nEMRADAR'));assert(e.body.split('\n\n')[1].split(/\s+/).length<30);
 assert.doesNotMatch(e.body,/writing from EMRADAR|Evidence:|Reader action:|let us know if|finished draft|can send/i);
 const introductions=new Set();for(let i=0;i<12;i++){const variant=structuredClone(p);variant.email.proposition.subject+=' '+i;introductions.add(render(variant).body.split('\n\n')[1]);}assert(introductions.size>1);
 assert.equal(validateEditorial(e.proposition,proof,context(p)).includes(e.proposition.body),true);
});
test('verified names bind to contact/source/date; neutral greeting handles missing, stale, mismatched or malicious names',()=>{
 const p=correspondenceProbe();assert.equal(recipientGreeting(p.route,'en').text,'Hi Paul,');
 for(const change of [{recipient_identity:null},{recipient_identity:{...p.route.recipient_identity,state:'UNKNOWN'}},{recipient_identity:{...p.route.recipient_identity,address:'another@example.test'}},{recipient_identity:{...p.route.recipient_identity,evidence_source_url:'https://unverified.test'}},{recipient_identity:{...p.route.recipient_identity,verified_at:'2020-01-01'}},{recipient_identity:{...p.route.recipient_identity,name:'Paul\nBcc: bad'}}])assert.equal(recipientGreeting({...p.route,...change},'en').text,'Hello,');
});
test('human identity and approved transport are independently enforced',()=>{
 for(const identity of [{name:'EMRADAR',address:'oroknows@gmail.com',approved:true},{name:'Sean Walker',address:'personal@example.test',approved:true},{name:'Sean Walker',address:'oroknows@gmail.com',approved:false}]){const p=correspondenceProbe();p.identity=identity;assert.throws(()=>render(p),/APPROVED_EMAIL_SENDER/);}
});
test('future correspondence needs verified clear reasoning and a real question; evidence packets and generic fit fail',()=>{
 const p=correspondenceProbe();for(const key of ['reason','development','insight','proposition','question']){const x=structuredClone(p);delete x.email.proposition.correspondence[key];assert.throws(()=>validateEditorial(x.email.proposition,proof,context(x)),/HUMAN_PROPOSITION/);}
 const noProof=structuredClone(proof);delete noProof.editorial_checks.human_correspondence;assert.throws(()=>validateEditorial(p.email.proposition,noProof,context(p)),/HUMAN_CORRESPONDENCE_VERIFICATION/);
 for(const text of ['Evidence: E1',"I'm writing from EMRADAR.",'This is relevant to your audience.','https://evidence.test/full-packet']){const x=structuredClone(p);x.email.proposition.body+='\n'+text;assert.throws(()=>validateEditorial(x.email.proposition,proof,context(x)),/HUMAN_PROPOSITION_MEMO/);}
});
test('source state, facts, every uncertainty and causal reasoning remain bound; email sources stay concise',()=>{
 const p=correspondenceProbe(),before=structuredClone(p.signal),e=render(p);assert.deepEqual(p.signal,before);assert.deepEqual(e.proposition.evidence_refs,p.signal.evidence);assert.equal(e.proposition.signal_state,'FORMING');assert.equal((e.body.match(/https:\/\//g)||[]).length,1);
 const changed=structuredClone(p);changed.email.proposition.evidence_refs=['UNBOUND'];assert.throws(()=>render(changed),/EMAIL_SOURCE_BINDING/);
 const missing=structuredClone(p);missing.email.proposition.qualifications.pop();assert.throws(()=>render(missing),/EMAIL_UNCERTAINTY/);
});
test('only the included source-linked note is an allowed next step; finished draft, interviews and monitoring fail',()=>{
 const p=correspondenceProbe(),x=structuredClone(p),offer='I’m sharing the source-linked note below.';x.email.proposition.body+='\n\n'+offer;x.email.proposition.correspondence.next_step=offer;x.email.proposition.capability_claims=[{text:offer,capability:'source_linked_note'}];assert.doesNotThrow(()=>validateEditorial(x.email.proposition,proof,context(x)));assert.equal(render(x).features.offered_next_step,offer);
 for(const offer of ['If useful, I can send a finished article.','I can arrange interviews.','We will keep monitoring.','Our ongoing coverage is available.']){const y=structuredClone(p);y.email.proposition.body+='\n\n'+offer;y.email.proposition.correspondence.next_step=offer;assert.throws(()=>validateEditorial(y.email.proposition,proof,context(y)),/UNVERIFIED_CAPABILITY/);}
});
test('REDIMIN is composed in professional Spanish with recipient-specific reasoning and preserved uncertainty',()=>{
 const p=correspondenceProbe();p.route={...p.route,destination_id:'REDIMIN-EDITORIAL',organisation:'REDIMIN',public_contact_point:'editorial@redimin.cl',recipient_identity:null,accepted_formats:['latam_editor_pitch']};
 const correspondence={reason:'Les escribo por la cobertura que hace REDIMIN de la minería y los proveedores en Chile.',development:'Sierra Gorda ha presentado el proyecto de una cuarta línea de molienda, por US$725 millones.',insight:'Lo que me llamó la atención es la distancia entre aprobar una inversión y convertirla en mayor producción.',proposition:'Propongo una nota sobre lo que falta para que esa inversión se traduzca en capacidad productiva.',question:'¿Les serviría este enfoque para REDIMIN?'};
 const texts=['La ceremonia antecede a las obras principales previstas para comienzos de 2027.','La producción aún es una proyección; los retornos dependen de los precios del cobre y del molibdeno.','hitos de construcción','costo final','puesta en marcha','producción efectiva'];
 const qualifications=texts.map((text,source_index)=>({text,source_index}));const body=[...Object.values(correspondence),texts[0],texts[1],'Falta confirmar los hitos de construcción, el costo final, la puesta en marcha y la producción efectiva.'].join('\n\n');
 p.email.proposition={...p.email.proposition,language:'es-CL',body,correspondence,qualifications};const e=render(p);assert(e.body.startsWith('Hola,'));assert.match(e.body,/Sean Walker/);assert(e.body.endsWith('Saludos,\nSean Walker\nEMRADAR'));assert(!e.body.includes('Le escribo desde EMRADAR'));assert.equal(e.features.localisation,'es-CL');
});
test('review-bound features survive restart into analysis with one-sample uncertainty; sent receipts and proposals stay immutable',async()=>{
 const p=correspondenceProbe(),f=await fixture();const proposal={proposal_id:'test-proposal',created_at:'2026-10-05T00:00:00Z',asset:{email:p.email,delivery:p.route},format:'editor_pitch'};const receipt={id:'test-receipt',proposal_id:proposal.proposal_id,product:'EMRADAR',campaign_id:'REGRESSION_ONLY',signal_id:p.signal.id,signal_revision:p.signal.revision,signal_state:p.signal.state,destination:p.route.destination_id,platform:'OPEN_ROUTE',execution_status:'SUBMITTED',timestamp:'2026-10-05T00:00:01Z',delivery_hash:'historical-hash'};
 await f.store.put('publication_review:'+proposal.proposal_id,proposal);await f.store.put('receipt:'+receipt.id,receipt);const beforeProposal=await f.store.get('publication_review:'+proposal.proposal_id),beforeReceipt=await f.store.get('receipt:'+receipt.id);
 const o=await normalizeOutcome(f.store,receipt,{metrics:{},source:'NO_TRANSPORT',observed_at:'2026-10-06T00:00:00Z'});assert.deepEqual(o.correspondence_features,p.email.features);const a=await analyseOutcomes(f.store),group=Object.values(a.groups)[0];assert.equal(group.sample_size,1);assert.deepEqual(group.supporting_observations[0].correspondence_features,p.email.features);const learning=await learnRouting(f.store,a);assert.equal(Object.values(learning.signals)[0].adjustment,0);assert.match(Object.values(learning.signals)[0].uncertainty,/Correlation is not causation/);assert.deepEqual(await f.store.get('publication_review:'+proposal.proposal_id),beforeProposal);assert.deepEqual(await f.store.get('receipt:'+receipt.id),beforeReceipt);
});
test('tampered greeting, identity, feature metadata and sign-off cannot pass capability review',()=>{
 const p=correspondenceProbe();for(const change of [e=>e.body=e.body.replace('Hi Paul,','Hello,'),e=>e.body=e.body.replace(/(?:My name is|I'm) Sean Walker/,"I'm writing from EMRADAR"),e=>e.body=e.body.replace('Sean Walker\nEMRADAR','Editorial desk'),e=>e.features.named_recipient=false]){const e=structuredClone(p.email);change(e);assert.throws(()=>validateHumanEmail(e,p.signal,p.route,p.identity));}
});
