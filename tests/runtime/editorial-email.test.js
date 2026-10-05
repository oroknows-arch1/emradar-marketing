import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {fixture,editorialHarness,editorialBudget} from './fixture.js';
import {GraphEngine,digest} from '../../runtime/graph.js';
import {editorialOutreachAdapter} from '../../runtime/adapters.js';
import {humanReadyEmail,reuseProposition,validateHumanEmail,validateCapabilityInventory} from '../../runtime/editorial-email.js';
import {reviewedMail} from '../../runtime/editorial-outreach-gmail.js';
import directory from '../../state/open-route-directory.json' with {type:'json'};

const identity={name:'EMRADAR',address:'oroknows@gmail.com',approved:true};
const route=id=>directory.destinations.find(d=>d.destination_id===id);
const signal={id:'copper-project',revision:'r1',state:'FORMING',evidence:['E1'],source_title:'Copper project expansion',source_facts:[{id:'E1',text:'The operator announced a copper processing expansion.',url:'https://example.test/source'}],source_uncertainty:['Forecast output is not realised output.','Final cost','Commissioning and ramp'],causal_chain:{industries:['Copper mining','Grinding equipment','Mine construction']}};
async function legacy(id='INTERNATIONAL-MINING-EDITORIAL'){
 const f=await fixture();f.p.product_identity='EMRADAR';f.p.destinations=[];f.p.signals=[structuredClone(signal)];f.p.budget=editorialBudget;f.p.source_receipt={digest:'native-source',sequence:4};
 const r=route(id);let delivered=[];
 const adapter=editorialOutreachAdapter({senderIdentity:()=>identity,sendEmail:async request=>{delivered.push(request);return {id:'test-mail',status:'ACCEPTED'};}});
 const engine=new GraphEngine({store:f.store,products:{EMRADAR:f.p},adapters:{OPEN_ROUTE:adapter},harness:editorialHarness()});
 const input={product:'EMRADAR',campaign_id:'LEGACY_EMAIL',signal_id:signal.id,destination_id:id};
 const copy='Subject: A copper processing story\n\n'+signal.source_facts[0].text+'\n\nEMRADAR can provide a continuing account through ramp-up.';
 const p={proposal_id:'a'.repeat(64),review_hash:'b'.repeat(64),publication_key:'old-publication',input,product:'EMRADAR',signal_id:signal.id,signal_revision:signal.revision,signal_state:signal.state,evidence_refs:signal.evidence,destination:id,platform:'OPEN_ROUTE',format:r.accepted_formats[0],copy,asset:{format:r.accepted_formats[0],copy,delivery:r,localization:null},source_receipt:f.p.source_receipt,cost_state:'ZERO',status:'AWAITING_REVIEW',expires_at:'2099-01-01T00:00:00.000Z'};
 await f.store.put('publication_review:'+p.proposal_id,p);
 return {...f,product:f.p,engine,p,delivered};
}

test('bounded revision refreshes only same unsent route, preserves source and costs, invalidates old approval and is idempotent',async()=>{
 const f=await legacy(),truth=structuredClone(f.product);
 const result=await f.engine.revisePublication(f.p);assert.equal(result.status,'AWAITING_REVIEW',result.blocker);
 const p=await f.store.get('publication_review:'+result.proposal_id);
 assert.notEqual(p.proposal_id,f.p.proposal_id);assert.deepEqual(p.evidence_refs,signal.evidence);assert.equal(p.signal_state,'FORMING');assert.equal(p.cost_state,'ZERO');assert.equal(result.cost_receipt.total,0);assert.deepEqual(f.product,truth);
 assert.equal(p.capability_claim_gate.status,'PASS');assert.equal(p.asset.email.visual,'NONE');assert.equal(p.asset.delivery.public_contact_point,f.p.asset.delivery.public_contact_point);
 assert(p.asset.email.body.startsWith('Hello,'));assert(p.asset.email.body.endsWith('Regards,\nEMRADAR'));assert.match(p.asset.email.body,/Forecast output is not realised output/);assert.doesNotMatch(p.asset.email.body,/continuing account|can provide/);
 assert.equal(f.delivered.length,0);assert.equal((await f.store.get('publication_review:'+f.p.proposal_id)).status,'SUPERSEDED');
 await assert.rejects(f.engine.approvePublication(f.p),/EXPIRED_OR_CHANGED/);
 const repeat=await f.engine.revisePublication(f.p);assert.equal(repeat.proposal_id,p.proposal_id);assert.equal(f.delivered.length,0);
 const run=await f.store.get('run:'+result.run_id);assert(!run.nodes.some(n=>n.node==='execute'));assert.equal(run.selection.options.length,1);assert.equal(run.learning_after.version,run.learning_before.version);
 const submitted=await f.engine.approvePublication(p);assert.equal(submitted.status,'PASS',submitted.blocker);assert.equal(f.delivered.length,1);assert.deepEqual(f.delivered[0].asset,p.asset);
});

test('tampered reviewed email and changed source cannot authorize any delivery',async()=>{
 const f=await legacy();const r=await f.engine.revisePublication(f.p);const p=await f.store.get('publication_review:'+r.proposal_id);
 p.asset.email.subject='Changed after review';await f.store.put('publication_review:'+p.proposal_id,p);
 await assert.rejects(f.engine.approvePublication(p),/EXPIRED_OR_CHANGED/);assert.equal(f.delivered.length,0);
 const g=await legacy();g.product.signals[0].revision='r2';const blocked=await g.engine.revisePublication(g.p);assert.equal(blocked.status,'BLOCKED');assert.equal(blocked.blocker,'REVISION_SOURCE_CHANGED');assert.equal(g.delivered.length,0);
});

test('revision refuses approved, delivered and ambiguous proposals and wrong review hashes',async()=>{
 for(const status of ['SUBMITTED','IN_FLIGHT','AMBIGUOUS']){
  const f=await legacy();await f.store.put('receipt:'+f.p.publication_key,{execution_status:status});const result=await f.engine.revisePublication(f.p);assert.equal(result.status,'BLOCKED');assert.equal(result.blocker,'PUBLICATION_ALREADY_EXECUTED_OR_AMBIGUOUS');assert.equal(f.delivered.length,0);
 }
 const f=await legacy();await f.store.put('publication_approval:'+f.p.proposal_id,{approved_by:'OWNER'});await assert.rejects(f.engine.revisePublication(f.p),/UNAPPROVED_UNSENT/);
 await assert.rejects(f.engine.revisePublication({...f.p,review_hash:'wrong'}),/EXPIRED_OR_CHANGED/);
});

test('future generation requires independently verified complete capability inventory',async()=>{
 for(const capability of ['ongoing_monitoring','continuous_coverage','not_implemented']){
  const result={body:'A recurring dossier is available.',capability_claims:[{text:'A recurring dossier is available.',capability}]};
  assert.throws(()=>validateCapabilityInventory(result,{editorial_checks:{capability_inventory:'PASS'}}),/UNVERIFIED_CAPABILITY/);
 }
 assert.throws(()=>validateCapabilityInventory({body:'A note.',capability_claims:[]},{}),/INVENTORY_VERIFICATION/);
 const f=await legacy();const fresh={...f.p.input,campaign_id:'FUTURE_CAPABILITY_TEST'};const work=f.engine.harness.work;
 f.engine.harness.work=async(...args)=>{const r=await work(...args);r.result.body+=' EMRADAR will continuously monitor the project.';r.result.capability_claims=[{text:'EMRADAR will continuously monitor the project.',capability:'ongoing_monitoring'}];return r;};
 const result=await f.engine.run(fresh);assert.equal(result.status,'BLOCKED');assert.equal(result.blocker,'UNVERIFIED_CAPABILITY_CLAIM');assert.equal(result.review,null);assert.equal(f.delivered.length,0);
});

test('Gmail envelopes use exact reviewed subject/body/sender, and reject hidden subject or recipient changes',async()=>{
 const f=await legacy();const r=await f.engine.revisePublication(f.p);const p=await f.store.get('publication_review:'+r.proposal_id);
 const old=process.env.EDITORIAL_GMAIL_USER,oldPassword=process.env.EDITORIAL_GMAIL_APP_PASSWORD;process.env.EDITORIAL_GMAIL_USER=identity.address;process.env.EDITORIAL_GMAIL_APP_PASSWORD='fixture-only';
 try{const mail=reviewedMail(p.asset,p.asset.delivery);assert.equal(mail.subject,p.asset.email.subject);assert.equal(mail.text,p.asset.email.body);assert.deepEqual(mail.from,p.asset.email.from);assert.equal(mail.to,p.asset.email.to);assert.doesNotMatch(mail.text,/^Subject:/m);
  const changed=structuredClone(p.asset);changed.email.to='another@example.test';assert.throws(()=>reviewedMail(changed,p.asset.delivery),/EXACT_REVIEWED_EMAIL/);
 }finally{if(old===undefined)delete process.env.EDITORIAL_GMAIL_USER;else process.env.EDITORIAL_GMAIL_USER=old;if(oldPassword===undefined)delete process.env.EDITORIAL_GMAIL_APP_PASSWORD;else process.env.EDITORIAL_GMAIL_APP_PASSWORD=oldPassword;}
});

test('verified Spanish proposition remains Spanish, unverified promise is removed and every source uncertainty survives',()=>{
 const s={...signal,source_uncertainty:['The ceremonial start precedes the main works scheduled for early 2027.','Final cost','Commissioning and ramp']};
 const copy='Subject: Propuesta editorial: una expansión minera\n\nEl operador anunció una expansión minera. La ceremonia antecede a las obras principales previstas para comienzos de 2027. EMRADAR mantendría una cobertura continua del proyecto.';
 const p={signal_revision:s.revision,signal_state:s.state,evidence_refs:s.evidence,copy,format:'latam_editor_pitch',proposal_id:'old',asset:{copy,delivery:route('REDIMIN-EDITORIAL'),localization:{language:'es-CL',status:'VERIFIED',copy_hash:digest(copy)}}};
 const proposition=reuseProposition(p,s),email=humanReadyEmail({proposition,signal:s,route:p.asset.delivery,identity,product:'EMRADAR'});
 assert(email.body.startsWith('Hola,'));assert(email.body.endsWith('Saludos,\nEMRADAR'));assert.match(email.body,/comienzos de 2027/);assert.match(email.body,/costo final/);assert.match(email.body,/puesta en marcha/);assert.doesNotMatch(email.body,/cobertura continua/);assert.equal(validateHumanEmail(email,s,p.asset.delivery,identity).status,'PASS');
 p.asset.localization.copy_hash='changed';assert.throws(()=>reuseProposition(p,s),/LOCALIZATION_NOT_VERIFIED/);
});
