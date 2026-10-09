import test from 'node:test';import assert from 'node:assert/strict';
import scan from './october9-production-reference.json' with {type:'json'};
import directory from '../../state/open-route-directory.json' with {type:'json'};
import {emradarSource} from '../../runtime/intake.js';
import {campaignPreparation,preparedCorrespondence,preparedArticle,limitationProposal} from '../../runtime/october9-preparation.js';
import {humanReadyEmail,validateCorrespondenceProposition,validateInternalUncertainty} from '../../runtime/editorial-email.js';
import {HarnessBridge} from '../../runtime/harness.js';import {approveExact} from '../../runtime/approved-distribution.js';import {fixture} from './fixture.js';
import crypto from 'node:crypto';
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const product=emradarSource(scan,{release_approved:true,evidence:true,editorial:true});product.source_receipt={digest:'existing-source',sequence:8};
test('all twelve prepared contributions retain exact qualifications, human correspondence and source bindings',()=>{
 for(const [id,seed] of Object.entries(campaignPreparation.prepared)){
  const signal=product.signals.find(s=>s.id===seed.signal_id),route=directory.destinations.find(d=>d.destination_id===id),c={input:{campaign_id:campaignPreparation.campaign_id},route:{id},signal},p=preparedCorrespondence(c);
  validateCorrespondenceProposition(p,route);validateInternalUncertainty(p,signal);
  assert(p.claims.every(claim=>p.body.includes(claim.text)&&claim.evidence_refs.every(ref=>signal.evidence.includes(ref))));
  if(/email/i.test(route.access_method)&&route.public_contact_point.includes('@'))humanReadyEmail({proposition:p,signal,route,identity:{approved:true,name:'Sean Walker',address:'sean@emradar.net'},product:'EMRADAR'});
  const article=preparedArticle(c);if(article){assert(article.source_links.every(l=>signal.source_facts.some(f=>f.url===l.url)));assert.deepEqual(article.qualifications,signal.source_uncertainty);}
 }
});
test('prepared result is independently verified without another generation request; failed factual verification remains blocked',async()=>{
 const result={body:'Source-bound prepared correspondence'},context={prepared_correspondence:result,input_hash:'exact',editorial_authority:{suitability:'OWNER_ONLY'}};let executed=0,facts='PASS',verified=0;
 const b=new HarnessBridge({routeWorkUnit:()=>({contractVersion:'elastic-routing-v0.1',workUnitId:'prepared',lane:'model',attemptCeiling:1}),registry:async()=>[],execute:async()=>{executed++;throw Error('NO_REGENERATION');},verify:async input=>{verified++;assert.deepEqual(input.result,result);return {status:'VERIFIED',input_hash:'exact',output_hash:hash(result),evidence_refs:['source'],editorial_checks:{factual_entailment:facts,uncertainty_preserved:'PASS',originality:'PASS',capability_inventory:'PASS',human_correspondence:'PASS',destination_fit:'FAIL'}};}});
 await b.work({workUnitId:'prepared'},context);assert.equal(executed,0);assert.equal(verified,1);
 facts='FAIL';b.verify=async()=>({status:'NOT_VERIFIED',input_hash:'exact',output_hash:hash(result),evidence_refs:['source'],editorial_checks:{factual_entailment:'FAIL'}});await assert.rejects(b.work({workUnitId:'prepared'},context),/OUTPUT_NOT_VERIFIED/);
});
test('four unsupported beats are visible, source-bound assessments and cannot enqueue publication',async()=>{
 const f=await fixture();let count=0;
 for(const route of directory.destinations){const p=limitationProposal({product,route,campaign_id:campaignPreparation.campaign_id,source_sha256:campaignPreparation.source_sha256,signals:product.signals});if(!p)continue;count++;assert.equal(p.evidence_support_status,'NOT EVIDENCE-SUPPORTED');assert.equal(p.asset.source_records.length,7);await f.store.put('publication_review:'+p.proposal_id,p);const approved=await approveExact({store:f.store},{proposal_id:p.proposal_id,review_hash:p.review_hash});assert.equal(approved.distribution_status,'NOT_QUEUED');assert.equal(await f.store.get('distribution_work:'+p.proposal_id),null);}
 assert.equal(count,4);
});
