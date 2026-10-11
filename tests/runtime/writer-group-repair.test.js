import test from 'node:test';
import assert from 'node:assert/strict';
import {validateCorrespondenceText} from '../../runtime/correspondence-quality.js';
import {assetBuilder,destinations,validateEditorialAsset} from '../../runtime/v2-production.js';
import brand from '../../runtime/email-brand.cjs';
import {humanReadyEmail} from '../../runtime/editorial-email.js';

const formation={id:'new-pooled-finance-model',title:'Clean generation investment',state:'FORMING',causal_chain:['investment','generation','supplier demand'],causal_chain_source:{world_change:['Policy and finance'],formation:['A repeat pooled-investment model is financing Chinese supplier-linked clean generation.']},evidence:[{id:'e1',claim:'The fund has announced financing for clean-generation projects.',url:'https://example.test/source'}],uncertainty:['Financial close','Supplier contracts','Delivered output remains unconfirmed.'],strengthening_evidence:[],weakening_evidence:[],break_conditions:[]};
const scan={publication_state:'PUBLISHED',source_revision:'fixture-2026-10-12',formation};
const route=destinations.find(r=>r.id==='REUTERS-BREAKINGVIEWS-GUEST');

test('known scan sentence joins and exposed field labels are rejected in complete correspondence',()=>{
 for(const body of [
  'The editorial question is whether this change can translate into A repeat pooled-investment model is financing Chinese supplier-linked clean generation.',
  'La cuestión editorial es si este cambio puede traducirse en A repeat pooled-investment model is financing clean generation.',
  'What remains unresolved is Financial close is still pending.',
  'Evidence: An announcement.\n\nThe formation is FORMING.',
  'The proposed contribution would examine the projects and',
  'The source statement describes proposed generation projects.\n\nThe source statement describes proposed generation projects.'
 ])assert.throws(()=>validateCorrespondenceText(body),/EMAIL_|INTERNAL_RESEARCH_FIELDS_EXPOSED/);
 assert.doesNotThrow(()=>validateCorrespondenceText('Hi Editor,\n\nThe fund has announced financing for clean-generation projects. Delivered output remains unconfirmed. Would an article examining the financing be useful?\n\nRegards,\nSean Walker'));
});
test('new formation writer uses standalone evidence, preserves all uncertainty and never splices raw chain text',async()=>{
 assert.ok(route);const before=JSON.stringify(scan),asset=await assetBuilder({scan,route}),body=brand.correspondence(asset.email.body);
 assert.match(body,/The fund has announced financing for clean-generation projects/);
 assert.match(body,/financial close; supplier contracts/);assert.match(body,/Delivered output remains unconfirmed/);
 assert.match(body,/article or research contribution/);assert.match(body,/Sean Walker/);
 assert.doesNotMatch(body,/translate into|What remains unresolved is|A repeat pooled-investment|Policy and finance|FORMING/);
 assert.deepEqual(asset.editorial_binding.source_uncertainty,formation.uncertainty);assert.deepEqual(asset.editorial_binding.evidence_refs,['e1']);assert.equal(JSON.stringify(scan),before);
 assert.doesNotThrow(()=>validateEditorialAsset({asset,scan,route}));
});
test('validation inspects final branded prose and refuses malformed joins even with valid evidence bindings',async()=>{
 const asset=await assetBuilder({scan,route});
 const corrupt=structuredClone(asset);corrupt.email.body=brand.correspondence(corrupt.email.body).replace('The fund has announced financing for clean-generation projects.','The editorial question is whether this change can translate into A repeat pooled-investment model is financing Chinese supplier-linked clean generation.');delete corrupt.email.brand_version;delete corrupt.email.html;brand.brand(corrupt.email);corrupt.body=corrupt.email.body;
 assert.throws(()=>validateEditorialAsset({asset:corrupt,scan,route}),/EMAIL_MALFORMED_SENTENCE_JOIN/);
});
test('untranslated generic evidence requires language-qualified copy rather than an English sentence in Spanish prose',async()=>{
 const spanish=destinations.find(r=>r.id==='REDIMIN-EDITORIAL');
 await assert.rejects(()=>assetBuilder({scan,route:spanish}),/EDITORIAL_SOURCE_LOCALIZATION_REQUIRED/);
});

test('shared human correspondence worker validates complete branded output without changing source bindings',()=>{
 const signal={revision:'r1',state:'FORMING',evidence:['e1'],source_facts:[{id:'e1',text:formation.evidence[0].claim,url:'https://example.test/source'}],source_uncertainty:['Delivered output remains unconfirmed.']};
 const destination={access_method:'verified email',public_contact_point:'editor@example.test',organisation:'Example Publication',accepted_formats:['editor_pitch']};
 const correspondence={reason:'Example Publication covers generation projects.',development:formation.evidence[0].claim,insight:'The announced financing has not yet established delivered output.',proposition:'An article could examine the financing and its limits.',question:'Would an article or research contribution on this development be useful for your publication?'};
 const proposition={subject:'Generation finance',body:Object.values(correspondence).join('\n\n')+'\n\nDelivered output remains unconfirmed.',correspondence,signal_state:signal.state,evidence_refs:['e1'],language:'en',qualifications:[{source_index:0,text:signal.source_uncertainty[0]}],capability_claims:[]};
 const input={proposition,signal,route:destination,identity:{approved:true,name:'Sean Walker',address:'sean@emradar.net'},product:'EMRADAR'};
 const email=humanReadyEmail(input);assert.deepEqual(email.evidence_binding.evidence_refs,['e1']);assert.equal(email.brand_version,'connected-earth-v1');
 const defective=structuredClone(input);defective.proposition.body+='\n\nThe editorial question is whether this change can translate into A repeat pooled-investment model is financing Chinese supplier-linked clean generation.';
 assert.throws(()=>humanReadyEmail(defective),/EMAIL_MALFORMED_SENTENCE_JOIN/);
});
