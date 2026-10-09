import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {FileStore} from '../../runtime/store.js';
import {digest} from '../../runtime/graph.js';
import {applySentenceCorrection} from '../../runtime/sentence-correction.js';
import {approveExact,drainApproved} from '../../runtime/approved-distribution.js';
const campaign='EMRADAR_2026_10_07_LAUNCH',sentence='The formation is FORMING.';
const targets=['GLOBAL-MINING-REVIEW-EDITORIAL','MINING-WEEKLY-TIP','AUSTRALIAN-MINING-REVIEW-EDITORIAL'];
const hash=p=>digest({product_truth:p.review_binding.product_truth,signal_revision:p.signal_revision,asset:p.asset,destination:p.review_binding.destination,source_receipt:p.source_receipt});
async function setup(t){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'sentence-test-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const store=new FileStore(dir),proposals=[];
 for(const destination of targets){
  const body='Hello,\n\nThe partners signed a framework. '+sentence+' Financing remains uncertain.\n\nRegards,\nSean Walker';
  const email={subject:destination,to:destination+'@test.invalid',from:{name:'Sean Walker',address:'sean@emradar.net'},body,proposition:{body,claims:[{text:'The partners signed a framework.',evidence_refs:['source']}],qualifications:[{source_index:0,text:'Financing remains uncertain.'}]},html:'<p>'+body+'</p>',features:{email_length_words:body.split(/\s+/).length},evidence_binding:{evidence_refs:['source'],source_uncertainty:['Financing remains uncertain.']}};
  const p={input:{campaign_id:campaign},destination,publication_key:digest(destination),review_binding:{product_truth:'source-truth',destination:{id:destination}},signal_revision:'same-source',source_receipt:{digest:'same-receipt'},evidence_binding:email.evidence_binding,copy:body,asset:{copy:body,email},status:'AWAITING_REVIEW'};p.review_hash=hash(p);p.proposal_id=digest([p.publication_key,p.review_hash]);proposals.push(p);await store.put('publication_review:'+p.proposal_id,p);
 }
 const unrelated={proposal_id:'unrelated-x',asset:{base64:'UNCHANGED'}};const pkg={campaign_id:campaign,proposals:[...proposals,unrelated],route_dispositions:proposals.map(p=>({destination:p.destination,proposal_id:p.proposal_id})),review_contract_revision:'preserved',discovery_routing_completion_receipt:{status:'COMPLETE'}};
 await store.put('review_package:'+campaign,pkg);await store.put('review_package:EMRADAR_2026_10_08_LAUNCH',{UNCHANGED:true});await store.put('receipt:previous-delivery',{execution_status:'SUBMITTED',provider_receipt:'preserve'});
 return {store,engine:{store},proposals,pkg,manifest:{campaign_id:campaign,sentence,authority:'TEST_OWNER',proposals:proposals.map(({proposal_id,review_hash,destination})=>({proposal_id,review_hash,destination}))}};
}
test('exact three deletions retain bindings, originals, unrelated assets and receipts; approval never queues or sends',async t=>{
 const f=await setup(t),before=new Map(await Promise.all((await f.store.keys('')).map(async k=>[k,await f.store.get(k)])));
 const report=await applySentenceCorrection(f.engine,f.manifest);assert.equal(report.status,'COMPLETE');assert.equal(report.results.length,3);
 const pkg=await f.store.get('review_package:'+campaign);
 for(const original of f.proposals){
  const p=pkg.proposals.find(p=>p.destination===original.destination),e=p.asset.email;
  assert.equal(e.body,original.asset.email.body.replace(sentence+' ',''));assert.equal(e.subject,original.asset.email.subject);assert.equal(e.to,original.asset.email.to);assert.deepEqual(e.from,original.asset.email.from);assert.deepEqual(p.evidence_binding,original.evidence_binding);assert.deepEqual(e.evidence_binding,original.asset.email.evidence_binding);assert.deepEqual(e.proposition.claims,original.asset.email.proposition.claims);assert.deepEqual(e.proposition.qualifications,original.asset.email.proposition.qualifications);assert.equal(p.review_hash,hash(p));assert.equal(p.proposal_id,digest([p.publication_key,p.review_hash]));
  assert.equal((await f.store.get('publication_approval:'+p.proposal_id)).review_hash,p.review_hash);assert.equal(await f.store.get('distribution_work:'+p.proposal_id),null);assert.equal((await f.store.get('publication_review:'+original.proposal_id)).replacement_proposal_id,p.proposal_id);
 }
 assert.deepEqual(pkg.proposals.at(-1),f.pkg.proposals.at(-1));assert.deepEqual(await f.store.get('review_package:EMRADAR_2026_10_08_LAUNCH'),before.get('review_package:EMRADAR_2026_10_08_LAUNCH'));assert.deepEqual(await f.store.get('receipt:previous-delivery'),before.get('receipt:previous-delivery'));
 const saved=new Map(await Promise.all((await f.store.keys('')).map(async k=>[k,await f.store.get(k)])));assert.deepEqual(await applySentenceCorrection(f.engine,f.manifest),await f.store.get('sentence_correction:'+campaign+':v1'));
 assert.deepEqual(new Map(await Promise.all((await f.store.keys('')).map(async k=>[k,await f.store.get(k)]))),saved);assert.deepEqual(await drainApproved(f.engine,{}),[]);
 // A later normal approval still creates normal durable work; correction added no release requirement.
 const p=pkg.proposals[0];assert.equal((await approveExact(f.engine,p)).distribution_status,'QUEUED');
});
test('delivered, ambiguous, queued or changed identities stop before edits or approvals',async t=>{
 for(const condition of ['sent','ambiguous','queued','hash','scope']){
  const f=await setup(t),p=f.proposals[0];
  if(condition==='sent'||condition==='ambiguous')await f.store.put('receipt:'+p.publication_key,{execution_status:condition==='sent'?'SUBMITTED':'AMBIGUOUS'});
  if(condition==='queued')await f.store.put('distribution_work:'+p.proposal_id,{status:'QUEUED'});
  if(condition==='hash')f.manifest.proposals[0].review_hash='wrong';
  if(condition==='scope')f.manifest.campaign_id='EMRADAR_2026_10_08_LAUNCH';
  await assert.rejects(applySentenceCorrection(f.engine,f.manifest));assert.deepEqual(await f.store.get('review_package:'+campaign),f.pkg);assert.equal((await f.store.keys('publication_approval:')).length,0);
 }
});
