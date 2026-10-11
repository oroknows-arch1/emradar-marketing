import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {assetBuilder,destinations,validateEditorialAsset} from '../../runtime/v2-production.js';
import {createV2Runtime} from '../../runtime/v2-integration.js';
import brand from '../../runtime/email-brand.cjs';

const digest=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const route=destinations.find(r=>r.id==='REDIMIN-EDITORIAL');
function source(language='en'){
 return {publication_state:'PUBLISHED',source_revision:'test-spanish:r1',snapshot_date:'2026-10-12',formation:{id:'test-clean-finance',title:language==='en'?'Clean generation finance':'Financiamiento de generación limpia',state:'FORMING',causal_chain:['financing','construction','generation'],evidence:[{id:'e1',url:'https://example.test/source',claim:language==='en'?'A fund announced financing for clean-generation projects.':'Un fondo anunció financiamiento para proyectos de generación limpia.'}],uncertainty:[language==='en'?'Delivered capacity remains unconfirmed.':'La capacidad operativa aún no está confirmada.'],strengthening_evidence:[],weakening_evidence:[],break_conditions:[]}};
}
function verifiedWork({mutate=()=>{},checks={},inspect=()=>{}}={}){
 return async context=>{
  inspect(context);
  const correspondence={reason:context.destination.organisation+' sigue las inversiones que pueden cambiar la demanda de recursos y equipos.',development:'Un fondo anunció financiamiento para proyectos de generación limpia.',insight:'El anuncio permite examinar cómo el financiamiento podría conectarse con las obras y la demanda de equipos, sin dar por confirmadas esas consecuencias.',proposition:'Una contribución podría distinguir el anuncio de financiamiento de los resultados operativos que todavía no están demostrados.',question:'¿Les sería útil un artículo o una contribución de investigación sobre este desarrollo y sus límites?'};
  const result={subject:'Financiamiento anunciado y resultados pendientes',body:Object.values(correspondence).join('\n\n')+'\n\nLa capacidad operativa aún no está confirmada.',language:'es-CL',signal_state:context.source.state,evidence_refs:[...context.source.evidence],claims:[{text:correspondence.development,evidence_refs:['e1']}],qualifications:context.source.source_uncertainty.map((text,source_index)=>({text,source_index})),capability_claims:[],correspondence};
  mutate(result);
  return {result,proof:{status:'VERIFIED',input_hash:context.input_hash,output_hash:digest(result),evidence_refs:['e1'],editorial_checks:{factual_entailment:'PASS',uncertainty_preserved:'PASS',originality:'PASS',capability_inventory:'PASS',human_correspondence:'PASS',...checks}}};
 };
}

for(const language of ['en','es'])test(language+' evidence uses the established verified writer and renders complete natural Spanish',async()=>{
 const scan=source(language),before=JSON.stringify(scan);let calls=0;
 const asset=await assetBuilder({scan,route,editorialWork:verifiedWork({inspect:context=>{
  calls++;assert.equal(context.target_language,'es-CL');assert.equal(context.source.source_facts[0].text,scan.formation.evidence[0].claim);assert.deepEqual(context.source.source_uncertainty,scan.formation.uncertainty);assert.equal(context.destination.organisation,route.organisation);assert.match(context.instructions,/Write directly in the destination language/);
 }})});
 assert.equal(calls,1);const plain=brand.correspondence(asset.email.body);
 assert.match(plain,/Hola/);assert.match(plain,/Soy Sean Walker/);assert.match(plain,/REDIMIN sigue/);assert.match(plain,/Un fondo anunció financiamiento/);assert.match(plain,/capacidad operativa aún no está confirmada/);assert.match(plain,/¿Les sería útil un artículo/);
 assert.doesNotMatch(plain,/Delivered capacity|Clean generation finance|A fund announced|FORMING|translate into/);
 assert.equal(asset.email.language,'es-CL');assert.equal(asset.to,route.endpoint.address);assert.equal(asset.delivery.public_contact_point,asset.to);assert.equal(asset.subject,asset.email.subject);assert.equal(asset.body,asset.email.body);assert.equal(asset.copy,'Subject: '+asset.subject+'\n\n'+asset.email.body);
 assert.deepEqual(asset.editorial_binding.source_uncertainty,scan.formation.uncertainty);assert.deepEqual(asset.email.evidence_binding.source_facts.map(f=>f.text),scan.formation.evidence.map(e=>e.claim));assert.equal(JSON.stringify(scan),before);
 assert.doesNotThrow(()=>validateEditorialAsset({asset,scan,route}));brand.envelope(asset.email);
});
test('missing language capability remains explicit and returns no defective asset',async()=>{
 for(const scan of [source('en'),source('es')])await assert.rejects(()=>assetBuilder({scan,route}),/EDITORIAL_SOURCE_LOCALIZATION_REQUIRED/);
 const work=verifiedWork();await assert.rejects(()=>assetBuilder({scan:source(),route,editorialWork:async c=>{const output=await work(c);output.proof.status='UNVERIFIED';return output;}}),/HARNESS_OUTPUT_NOT_VERIFIED/);
});
test('independent verification rejects unsupported claims and missing uncertainty',async()=>{
 await assert.rejects(()=>assetBuilder({scan:source(),route,editorialWork:verifiedWork({checks:{factual_entailment:'FAIL'},mutate:r=>{r.body+='\n\nLos proyectos ya producen 500 MW.';r.claims.push({text:'Los proyectos ya producen 500 MW.',evidence_refs:['e1']});}})}),/EDITORIAL_VERIFICATION_REQUIRED/);
 await assert.rejects(()=>assetBuilder({scan:source(),route,editorialWork:verifiedWork({mutate:r=>{r.claims[0].evidence_refs=['invented-source'];}})}),/EDITORIAL_CLAIM_BINDING_REQUIRED/);
 await assert.rejects(()=>assetBuilder({scan:source(),route,editorialWork:verifiedWork({mutate:r=>{r.qualifications=[];}})}),/EMAIL_UNCERTAINTY_NOT_PRESERVED/);
});
test('English fragments are refused in subject, model prose and complete rendered Spanish',async()=>{
 for(const mutate of [r=>{r.subject='Clean generation finance remains unresolved';},r=>{r.body+='\n\nDelivered capacity remains unconfirmed.';},r=>{r.body+='\n\nGrid connection';}])await assert.rejects(()=>assetBuilder({scan:source(),route,editorialWork:verifiedWork({mutate})}),/EDITORIAL_MIXED_LANGUAGE_CONTAMINATION/);
 const scan=source(),asset=await assetBuilder({scan,route,editorialWork:verifiedWork()}),bad=structuredClone(asset),plain=brand.correspondence(bad.email.body);
 bad.email.body=plain.replace('La capacidad operativa aún no está confirmada.','Delivered capacity remains unconfirmed.');brand.brand(bad.email);bad.body=bad.email.body;
 assert.throws(()=>validateEditorialAsset({asset:bad,scan,route}),/EDITORIAL_MIXED_LANGUAGE_CONTAMINATION/);
});
test('proofs and evidence URLs must bind the actual source and output',async()=>{
 const work=verifiedWork();
 for(const key of ['input_hash','output_hash'])await assert.rejects(()=>assetBuilder({scan:source(),route,editorialWork:async c=>{const v=await work(c);v.proof[key]='not-bound';return v;}}),/HARNESS_OUTPUT_NOT_VERIFIED/);
 const scan=source();delete scan.formation.evidence[0].url;await assert.rejects(()=>assetBuilder({scan,route,editorialWork:work}),/SOURCE_FACT_BINDING_REQUIRED/);
});
test('existing V2 configuration forwards verified work without changing source or transport authority',async()=>{
 let transportCalls=0;
 const runtime=await createV2Runtime({store:{},integrationModule:{destinations:[],assetBuilder,editorialWork:verifiedWork()},editorialAdapter:{publish:()=>{transportCalls++;throw Error('NO_DISTRIBUTION');}}});
 const scan=source(),asset=await runtime.engine.assetBuilder({scan,route});assert.equal(asset.email.language,'es-CL');assert.equal(asset.to,route.endpoint.address);assert.equal(transportCalls,0);
});
