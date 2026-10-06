import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import {correspondenceProbe} from '../../runtime/correspondence-probe.js';
import {humanReadyEmail,validateHumanEmail,validateCapabilityInventory,correspondenceDensity,normalizeCorrespondence,draftOffer,draftCapability,recipientGreeting} from '../../runtime/editorial-email.js';
import {editorialContext,validateEditorial} from '../../runtime/editorial-copy.js';
import {previewCorrespondence} from '../../runtime/owner-preview.js';
import {GraphEngine} from '../../runtime/graph.js';
import {fixture,editorialBudget} from './fixture.js';
import {ProductIntake} from '../../runtime/intake.js';
import {autonomousScanCycle,reviewContractRevision} from '../../runtime/autonomous-source.js';
import {editorialOutreachAdapter,xAdapter} from '../../runtime/adapters.js';
import scan from './energy-production-reference.json' with {type:'json'};
const proof=signal=>({billing:{currency:'AUD',actual:true,amount:0,receipt_id:'test-billing',provider:'TEST'},evidence_refs:signal.evidence,editorial_checks:Object.fromEntries(['factual_entailment','uncertainty_preserved','destination_fit','originality','capability_inventory','human_correspondence'].map(k=>[k,'PASS']))});
const render=p=>humanReadyEmail({proposition:p.email.proposition,signal:p.signal,route:p.route,identity:p.identity,product:'EMRADAR'});
const context=p=>({source:p.signal,target_language:'en',destination:p.route});
const reference=`Hello,

I’m Sean Walker, working on EMRADAR, a system that tracks emerging market formations from evidence in the real economy.

Our 23 September scan identified India’s semiconductor ecosystem as FORMING. What stood out was not another chip-factory announcement, but equipment investment, packaging partnerships, supplier development and workforce capacity beginning to appear together.

We are developing an evidence-backed contribution around the less-visible ecosystem forming around India’s chip factories: equipment, materials, packaging and testing, facility systems, suppliers and skills — while keeping unresolved questions such as commercial utilisation and supplier economics explicit.

Would this be suitable as an article or research contribution for Semiconductor For You?

If useful, I can send a concise finished draft with sources for review.

Regards,
Sean Walker
EMRADAR`;
test('Successful SFY reference passes whole-email density and correspondence contract',()=>{
 assert(correspondenceDensity(reference)<=165);
 const p=correspondenceProbe(),paragraphs=reference.split('\n\n');
 p.route.organisation='Semiconductor For You';p.route.recipient_identity=null;
 const finding=paragraphs[2],development=finding.slice(0,finding.indexOf(' What stood out')),insight=finding.slice(finding.indexOf('What stood out'));
 p.email.proposition={...p.email.proposition,body:paragraphs.slice(2,6).join('\n\n'),correspondence:{reason:paragraphs[4],development,insight,proposition:paragraphs[3],question:paragraphs[4],next_step:draftOffer('en')}};
 const e=render(p);assert.equal(e.body,reference);assert.doesNotThrow(()=>validateHumanEmail(e,p.signal,p.route,p.identity));
});
// Retained real production failures; no regeneration or live dependencies.
import badProduction from './sfy-bad-production-emails.json' with {type:'json'};
test('Bad exact production ship.energy research summary fails density',()=>assert.throws(()=>correspondenceDensity(badProduction['SHIP-ENERGY-EDITORIAL']),/DENSITY/));
test('Bad exact production Riviera research summary fails density',()=>assert.throws(()=>correspondenceDensity(badProduction['RIVIERA-TANKER-EDITORIAL']),/DENSITY/));
test('Initial and warning preview bodies contain no URLs; full review evidence and uncertainty are bound',()=>{
 const p=correspondenceProbe(),e=render(p);for(const mail of [e,previewCorrespondence(e.proposition,p.signal,p.route)]){assert.doesNotMatch(mail.body,/https?:|Supporting sources?:/i);assert.deepEqual(mail.evidence_binding.source_facts,p.signal.source_facts);assert.deepEqual(mail.evidence_binding.source_uncertainty,p.signal.source_uncertainty);}
 const missing=structuredClone(p);missing.email.proposition.qualifications.pop();assert.throws(()=>render(missing),/UNCERTAINTY/);
 assert(!p.signal.source_uncertainty.every(t=>e.body.includes(t)));assert.doesNotThrow(()=>validateEditorial(e.proposition,proof(p.signal),context(p)));
});
test('Bounded sourced-draft offer is VERIFIED; ongoing services remain forbidden',()=>{
 const p=correspondenceProbe();assert.doesNotThrow(()=>validateCapabilityInventory(p.email.proposition,proof(p.signal)));assert.equal(validateHumanEmail(p.email,p.signal,p.route,p.identity).claims.find(c=>c.capability===draftCapability).state,'VERIFIED');
 for(const text of ['We will keep monitoring.','Our ongoing coverage is available.','I can provide continuous updates.','I can arrange interviews.']){const r=structuredClone(p.email.proposition);r.body+='\n\n'+text;assert.throws(()=>validateCapabilityInventory(r,proof(p.signal)),/UNVERIFIED_CAPABILITY/);}
});
test('Whole email has six functions, 110–150 target and <=165 hard maximum',()=>{
 const p=correspondenceProbe(),e=p.email;assert(e.features.email_length_words>=110&&e.features.email_length_words<=150);assert.match(e.body,/Hi Paul,/);for(const t of ['Sean Walker','EMRADAR','Our 5 October scan','FORMING','What stood out','evidence-backed contribution','unresolved','Would this be suitable',draftOffer('en'),'Regards,'])assert(e.body.includes(t));assert.throws(()=>correspondenceDensity(reference+' '+Array(50).fill('extra').join(' ')),/DENSITY/);
});
test('Writer schema uses bounded offer, reduced total budget and internal uncertainty',()=>{
 const p=correspondenceProbe(),c=editorialContext({signal:p.signal,product:{},route:{id:p.route.destination_id,destination:{route_record:p.route}},route_plan:{proposed_assets:[{destination_id:p.route.destination_id}]}});assert.match(c.response_schema.properties.body.description,/122 words/);assert.equal(c.response_schema.properties.capability_claims.items.properties.capability.enum[0],draftCapability);assert.match(c.response_schema.properties.qualifications.items.properties.text.description,/internal metadata/);assert.match(c.instructions,/110–150/);
});
test('Unverified, stale or mismatched recipient names remain neutral',()=>{
 const p=correspondenceProbe();assert.equal(recipientGreeting(p.route,'en').text,'Hi Paul,');for(const recipient_identity of [null,{...p.route.recipient_identity,state:'UNKNOWN'},{...p.route.recipient_identity,address:'wrong@example.test'},{...p.route.recipient_identity,verified_at:'2020-01-01'}])assert.equal(recipientGreeting({...p.route,recipient_identity},'en').text,'Hello,');
});
async function productionSetup(){
 const f=await fixture(),bytes=Buffer.from(JSON.stringify(scan)),digest=crypto.createHash('sha256').update(bytes).digest('hex');
 const attestation={product:'EMRADAR',snapshot_date:scan.snapshot_date,source_path:'data/checkpoints/discovery-'+scan.snapshot_date+'.json',source_sha256:digest,publication_state:'PUBLISHED',downstream_release_allowed:true,native_gates:Object.fromEntries(['evidence','editorial','brand','risk','publication'].map(g=>[g,'PASS'])),campaign_authority:{campaign_id:'EMRADAR_2026_10_06_LAUNCH',required_stop:'PUBLICATION_REVIEW',external_publication_allowed:false}};
 const policy={...f.p,product_identity:'EMRADAR',destinations:[],uncertainty_state_model:['CONFIRMED','FORMING','INVESTIGATE','UNKNOWN'],source_release_authority:{automatic_after_native_gates:true,required_gates:['evidence','editorial','brand','risk','publication']},budget:{...editorialBudget,max_worker_calls:1},provider_authority:{automatic_connected_approved_only:true},spending_envelope:{currency:'AUD',campaign_limit:5,calendar_month_limit:50}};
 const intake=new ProductIntake({store:f.store,policies:{EMRADAR:policy},sourceKeys:{EMRADAR:'TEST_ONLY'}});
 let actions=0,calls=0;const noSend=()=>{actions++;throw Error('EXTERNAL_ACTION_FORBIDDEN');};
 const harness={quote:async()=>({currency:'AUD',verified:true,provider_enforced:true,max_cost_aud:0,receipt_id:'test-quote'}),work:async(_unit,c)=>{
  calls++;const name=c.destination.organisation,focus=c.destination.relevant_beat_topic[0];
  const development=`Our 6 October scan identified the energy logistics bottleneck as ${c.source.state}.`,insight=`What stood out was how ${focus} constraints can outlast recovered crude exports.`,proposition=`We are developing an evidence-backed contribution around ${focus} and delivered fuel availability — while keeping unresolved risk duration, refinery restoration and price pass-through explicit.`,question=`Would this be suitable as an article or research contribution for ${name}?`,next_step=draftOffer('en');
  const compact=name==='Reuters Breakingviews';
  const finding=compact?'Our 6 October scan identified energy logistics as CONFIRMED.':development;
  const observation=compact?'What stood out was costly delivery despite recovering exports.':insight;
  const contribution=compact?'We are developing an evidence-backed contribution on delivery costs, keeping unresolved normalisation timing explicit.':proposition;
  const ask=compact?'Would this analysis suit Reuters Breakingviews?':question;
  const body=[finding+' '+observation,contribution,ask,next_step].join('\n\n');
  return {result:{subject:`${name}: ${focus} after crude flows recover`,body,language:'en',signal_state:c.source.state,evidence_refs:c.source.evidence,claims:[{text:observation,evidence_refs:c.source.evidence}],qualifications:c.source.source_uncertainty.map((text,source_index)=>({text,source_index})),capability_claims:[{text:next_step,capability:draftCapability}],correspondence:{reason:ask,development:finding,insight:observation,proposition:contribution,question:ask,next_step}},proof:proof(c.source),decision:{lane:'model'},attempts:1};
 }};
 const engineFactory=async()=>new GraphEngine({store:f.store,products:await intake.products(),harness,adapters:{OPEN_ROUTE:editorialOutreachAdapter({senderIdentity:()=>({name:'Sean Walker',address:'oroknows@gmail.com',approved:true}),sendEmail:noSend}),X:xAdapter({publish:noSend,authorized:async()=>true,fetchMetrics:noSend})}});
 const args={intake,store:f.store,engineFactory,sourceKeys:{EMRADAR:'TEST_ONLY'},env:{RENDER_GIT_COMMIT:'sfy-test'},fetcher:async url=>({ok:true,arrayBuffer:async()=>url.includes('/verification/')?Buffer.from(JSON.stringify(attestation)):bytes}),log:()=>{}};
 return {...f,args,actions:()=>actions,calls:()=>calls};
}
test('Production-shaped signed-source graph prepares every credible destination; exact review stop; internal worker limit cannot truncate preview',async()=>{
 const f=await productionSetup(),r=await autonomousScanCycle(f.args);assert.equal(r.status,'AWAITING_REVIEW',JSON.stringify(r.package.blockers));assert.equal(r.campaign_id,'EMRADAR_2026_10_06_LAUNCH');assert.equal(r.external_actions,0);assert.equal(f.actions(),0);assert.equal(r.package.required_stop,'PUBLICATION_REVIEW');
 const emails=r.package.proposals.filter(p=>p.platform!=='X');assert.equal(emails.length,7);assert.equal(new Set(emails.map(p=>p.asset.email.body)).size,7);for(const p of emails){assert.doesNotMatch(p.asset.email.body,/https?:|Supporting source/);assert(p.asset.email.body.includes(draftOffer('en')));assert(correspondenceDensity(p.asset.email.body)<=165);const limit=p.asset.delivery.submission_requirements?.match(/(\d+) words or less/i);if(limit)assert(p.asset.email.body.trim().split(/\s+/).length<=Number(limit[1]));assert(p.evidence_binding.source_facts.length);assert(p.evidence_binding.source_uncertainty.length);}
 const x=r.package.proposals.find(p=>p.platform==='X');assert(x.asset.copy);assert(x.asset.base64);assert(x.asset.combined_review_artifact);
 const calls=f.calls(),r2=await autonomousScanCycle(f.args);assert(r2.duplicate);assert.equal(f.calls(),calls);assert.equal(f.actions(),0);
});
test('Old unsent publication artifacts are superseded once; valid X copy and visual stay exactly unchanged',async()=>{
 const f=await productionSetup(),r=await autonomousScanCycle(f.args),x=r.package.proposals.find(p=>p.platform==='X');const key='autonomous_scan:'+scan.snapshot_date+':'+r.package.source_sha256;
 const obsolete={...r.package.proposals.find(p=>p.platform!=='X'),proposal_id:'superseded-oldest',status:'SUPERSEDED'};await f.store.put('publication_review:'+obsolete.proposal_id,obsolete);
 await f.store.put('receipt_index',[{product:'EMRADAR',campaign_id:r.campaign_id,signal_id:obsolete.signal_id,signal_revision:obsolete.signal_revision,destination:obsolete.destination,proposal_id:obsolete.proposal_id,execution_status:'AWAITING_REVIEW'},...r.package.proposals.map(p=>({product:'EMRADAR',campaign_id:r.campaign_id,signal_id:p.signal_id,signal_revision:p.signal_revision,destination:p.destination,proposal_id:p.proposal_id,execution_status:'AWAITING_REVIEW'}))]);
 for(const p of r.package.proposals){p.review_contract_revision='old';await f.store.put('publication_review:'+p.proposal_id,p);}
 const state=await f.store.get(key);state.review_contract_revision='old';await f.store.put(key,state);
 const second=await autonomousScanCycle(f.args);assert.equal(second.status,'AWAITING_REVIEW',JSON.stringify(second.package.blockers));const x2=second.package.proposals.find(p=>p.platform==='X');assert.deepEqual(x2.asset,x.asset);assert.equal(x2.proposal_id,x.proposal_id);assert.equal(f.actions(),0);assert.equal(second.package.review_contract_revision,reviewContractRevision);
});

test('Source-truth failures never become preview warnings',()=>{const p=correspondenceProbe(),r=structuredClone(p.email.proposition);r.signal_state='CONFIRMED';assert.throws(()=>validateEditorial(r,proof(p.signal),context(p)),/SOURCE_STATE_MISMATCH/);const verification=proof(p.signal);verification.editorial_checks.factual_entailment='FAIL';assert.throws(()=>validateEditorial(p.email.proposition,verification,context(p)),/SOURCE_TRUTH_VERIFICATION_REQUIRED/);});

test('Scan state can share the adjacent finding sentence; lowercase state is not a changed evidence state',()=>{const p=correspondenceProbe();p.email.proposition.body=p.email.proposition.body.replace('FORMING','forming');p.email.proposition.correspondence.development=p.email.proposition.correspondence.development.replace('FORMING','forming');assert.doesNotThrow(()=>render(p));});

import excerptProduction from './sfy-excerpt-production-reference.json' with {type:'json'};
test('Real production excerpt failures normalize into six-section short emails with all internal sources',()=>{for(const sample of excerptProduction){const signal={revision:sample.binding.source_revision,state:sample.binding.signal_state,evidence:sample.binding.evidence_refs,source_facts:sample.binding.source_facts,source_uncertainty:sample.binding.source_uncertainty};const result=normalizeCorrespondence(sample.proposition,signal,sample.route);assert.doesNotThrow(()=>validateEditorial(result,proof(signal),{source:signal,destination:sample.route,target_language:'en'}));const identity={approved:true,name:'Sean Walker',address:'oroknows@gmail.com'};const route={...sample.route,access_method:'public editorial email',public_contact_point:sample.route.public_contact_point==='UNKNOWN'?'regression@example.test':sample.route.public_contact_point};const email=humanReadyEmail({proposition:result,signal,route,identity,product:'EMRADAR'});assert(email.body.split('\n\n').length===7);assert(correspondenceDensity(email.body)<=165);assert.deepEqual(email.evidence_binding.source_uncertainty,signal.source_uncertainty);assert(email.body.includes(signal.state));}});
