import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {FileStore} from '../../runtime/store.js';
import {selectDestinations,pitchIdentity,substantiallySamePitch} from '../../runtime/destination-rotation.js';
import {StreamlinedMarketingEngineV2} from '../../runtime/streamlined-engine-v2.js';
import {destinations as directory} from '../../runtime/v2-production.js';

const X={id:'EMRADAR-X-OROKNOWS',editorial_relevance:false,evidence_suitable:false,endpoint:{address:'@fixture',verification_state:'VERIFIED'},delivery:{method:'X',supported:true},connector:{authorized:true},finished_contribution_supported:true};
const formation=(id='copper',category='Copper mining')=>({id,state:'FORMING',title:category,industries:[category],evidence:[{id:'e-'+id,claim:category+' companies announced new investment.',url:'https://example.test/source'}],causal_chain:['investment','construction','production'],uncertainty:['Delivered capacity remains uncertain.'],strengthening_evidence:[],weakening_evidence:[],break_conditions:[]});
const scan=(formations=[formation()],revision='test:r1')=>({publication_state:'PUBLISHED',source_revision:revision,formations,formation:formations[0]});
const route=(id,category='Copper mining')=>({id,industries:[category],relevant_beat_topic:[category],editorial_relevance:true,evidence_suitable:true,endpoint:{address:id.toLowerCase()+'@example.test',verification_state:'VERIFIED'},delivery:{method:'EMAIL',supported:true},connector:{authorized:true},finished_contribution_supported:true});
const campaign=n=>'EMRADAR_2099_01_'+String(n).padStart(2,'0')+'_LAUNCH';
async function store(){return new FileStore(await mkdtemp(path.join(os.tmpdir(),'destination-rotation-')));}
const externals=plan=>plan.selected.filter(s=>s.destination_id!==X.id);
const select=(s,id,input,routes)=>selectDestinations({store:s,campaign_id:id,scan:input,destinations:[...routes,X]});

test('categories require evidence relevance and credible routes, not geography or a forced quota',async()=>{
 const s=await store(),input=scan(),valid=route('MINING'),geographyOnly=route('SHIPPING','Shipping'),unknown={...route('UNKNOWN'),endpoint:{address:'unknown@example.test',verification_state:'VERIFIED_DISCOVERY_ONLY'}};
 const result=await select(s,campaign(1),input,[valid,geographyOnly,unknown]);
 assert.deepEqual(externals(result).map(r=>r.destination_id),['MINING']);assert.equal(result.categories[0].category,'copper mining');assert.equal(result.categories[0].selected_count,1);assert.equal(result.categories[0].quota_forced,false);
 assert(result.dispositions.some(d=>d.destination==='SHIPPING'&&d.reason==='NO_EVIDENCE_SUPPORTED_CATEGORY'));assert(result.dispositions.some(d=>d.destination==='UNKNOWN'&&d.reason==='NO_CREDIBLE_VERIFIED_ROUTE'));assert.equal(result.external_actions,0);
});
test('manual verified submission routes are credible but remain review only',async()=>{
 const s=await store(),manual={...route('MANUAL'),endpoint:{address:'contact form',verification_state:'VERIFIED'},delivery:{method:'MANUAL',supported:false},connector:{authorized:false},delivery_record:{public_submission_url:'https://example.test/contact'}};
 const result=await select(s,campaign(1),scan(),[manual]);assert.equal(externals(result).length,1);
 const missing={...manual,id:'MISSING',delivery_record:{public_submission_url:'UNKNOWN'}};const second=await select(s,campaign(2),scan(),[missing]);assert.equal(externals(second).length,0);
});
test('five evidence-supported categories enforce thirty unique external destinations plus mandatory X',async()=>{
 const s=await store(),categories=['Copper mining','Solar generation','Battery manufacturing','Medical equipment','Port construction'],formations=categories.map((c,i)=>formation('f'+i,c)),routes=categories.flatMap((c,i)=>Array.from({length:14},(_,j)=>route('D'+i+'-'+String(j).padStart(2,'0'),c)));
 const result=await select(s,campaign(1),scan(formations),routes);assert.equal(externals(result).length,30);assert.equal(new Set(externals(result).map(r=>r.destination_id)).size,30);assert.equal(result.selected.filter(r=>r.destination_id===X.id).length,1);assert.equal(result.selected.length,31);assert(result.categories.every(c=>c.selected_count>=5));
});
test('one category stops at the target range even when more eligible outlets exist',async()=>{
 const s=await store(),result=await select(s,campaign(1),scan(),Array.from({length:25},(_,i)=>route('D'+String(i).padStart(2,'0'))));assert.equal(externals(result).length,10);
});
test('cross-category and cross-finding matches select each outlet once',async()=>{
 const s=await store(),f=formation();f.industries=['Copper mining','Solar generation'];f.evidence[0].claim='Copper mining and solar generation companies announced investment.';
 const multi={...route('MULTI'),industries:['Copper mining','Solar generation'],relevant_beat_topic:['Copper mining','Solar generation']};
 const result=await select(s,campaign(1),scan([f,{...f,id:'second'}]),[multi]);assert.equal(externals(result).length,1);assert.equal(externals(result)[0].categories.length,2);assert.equal(new Set(result.selected.map(r=>r.destination_id)).size,2);
 assert(result.dispositions.some(d=>d.reason==='CROSS_CATEGORY_DESTINATION_DEDUPLICATION'));
});
test('substantially unchanged pitches rotate to fresh outlets, then stop without forcing repeats',async()=>{
 const s=await store(),routes=Array.from({length:15},(_,i)=>route('D'+String(i).padStart(2,'0'))),first=await select(s,campaign(1),scan(),routes),second=await select(s,campaign(2),scan(undefined,'test:r2'),routes),third=await select(s,campaign(3),scan(undefined,'test:r3'),routes);
 assert.equal(externals(first).length,10);assert.equal(externals(second).length,5);assert.equal(externals(third).length,0);assert.equal(third.categories[0].available_count,0);assert.equal(third.selected.length,1);
 const ids=new Set(externals(first).map(r=>r.destination_id));assert(externals(second).every(r=>!ids.has(r.destination_id)));assert(second.dispositions.some(d=>d.reason==='SUBSTANTIALLY_IDENTICAL_PREVIOUS_PITCH'));
});
test('material evidence changes permit a new pitch and numerical changes are never treated as duplicates',()=>{
 const f=formation(),old=pitchIdentity(f),equivalent=pitchIdentity({...f,evidence:[{id:'another-id',claim:f.evidence[0].claim.toUpperCase()}]});assert(substantiallySamePitch(old,equivalent));
 for(const change of [g=>g.state='CONFIRMED',g=>g.causal_chain=['investment','grid capacity','production'],g=>g.uncertainty=['Capacity is now independently verified.'],g=>g.evidence[0].claim+=' Commercial output started.',g=>g.strengthening_evidence=['Plant operating.']]){const modified=structuredClone(f);change(modified);assert.equal(substantiallySamePitch(old,pitchIdentity(modified)),false);}
 const a={...f,evidence:[{claim:'Copper mine capacity reached 100 tonnes.'}]},b={...f,evidence:[{claim:'Copper mine capacity reached 200 tonnes.'}]};assert.equal(substantiallySamePitch(pitchIdentity(a),pitchIdentity(b)),false);
});
test('restart reuses the exact plan despite reordered registry, new history or newly discovered directory entries',async()=>{
 const s=await store(),routes=[route('A'),route('B')],input=scan(),first=await select(s,campaign(1),input,routes),snapshot=JSON.stringify(first);
 await s.put('v2:learning',{destinations:{B:{replies:5,publications:1}}});const restarted=new FileStore(s.directory),second=await select(restarted,campaign(1),input,[route('C'),...routes.reverse()]);assert.equal(JSON.stringify(second),snapshot);assert.equal((await s.keys('v2:destination-selection:')).length,1);
 await assert.rejects(()=>select(restarted,campaign(1),scan(undefined,'changed'),routes),/DESTINATION_SELECTION_SOURCE_CHANGED/);
 await assert.rejects(()=>select(restarted,campaign(1),input,[{...route('A'),endpoint:{address:'different@example.test',verification_state:'VERIFIED'}},route('B')]),/SELECTED_DESTINATION_CHANGED/);
});
test('under-contacted outlets receive preference while a suitable successful relationship is retained',async()=>{
 const s=await store(),routes=Array.from({length:12},(_,i)=>route('D'+String(i).padStart(2,'0'))),learning={version:4,destinations:{D11:{replies:2,publications:1}}};await s.put('v2:learning',learning);
 for(let i=0;i<4;i++)await s.put('v2:receipt:contact-'+i,{id:'contact-'+i,destination:'D00',external_id:'provider-'+i,execution_status:'SUBMITTED'});
 const before=JSON.stringify(await s.get('v2:learning')),result=await select(s,campaign(1),scan(),routes),chosen=externals(result);
 assert(chosen.some(r=>r.destination_id==='D11'&&r.reason==='PRESERVE_OBSERVED_EDITORIAL_RELATIONSHIP'));assert(!chosen.some(r=>r.destination_id==='D00'));assert.equal(JSON.stringify(await s.get('v2:learning')),before);
});
test('unknown outcomes stay neutral and legacy positive outcome evidence is reused without mutation',async()=>{
 const s=await store(),outcome={destination:'B',outcome_state:'EDITOR_INTEREST',outcome_evidence:{reply_message_id:'fixture-reply'}},unknown={destination:'A',outcome_state:'UNKNOWN'};await s.put('outcome_index',['positive','unknown']);await s.put('outcome:positive',outcome);await s.put('outcome:unknown',unknown);
 const result=await select(s,campaign(1),scan(),[route('A'),route('B')]);const a=externals(result).find(r=>r.destination_id==='A'),b=externals(result).find(r=>r.destination_id==='B');assert.equal(a.observations.outcome,'UNKNOWN');assert.equal(a.observations.contacts,0);assert.equal(b.observations.relationship,true);assert.deepEqual(await s.get('outcome:positive'),outcome);assert.deepEqual(await s.get('outcome:unknown'),unknown);
});
test('existing receipt-bound pitches prevent repeated submissions even before rotation history exists',async()=>{
 const s=await store(),f=formation();await s.put('v2:review:old',{binding:{evidence:{...f,formation_state:f.state}}});const receipt={id:'r1',destination:'A',proposal_id:'old',execution_status:'SUBMITTED',external_id:'provider-id'};await s.put('v2:receipt:r1',receipt);
 const result=await select(s,campaign(1),scan(),[route('A'),route('B')]);assert.deepEqual(externals(result).map(r=>r.destination_id),['B']);assert.deepEqual(await s.get('v2:receipt:r1'),receipt);
});
test('mandatory X and persistent-store requirements fail explicitly instead of fabricating a route',async()=>{
 await assert.rejects(()=>selectDestinations({store:{},campaign_id:campaign(1),scan:scan(),destinations:[]}),/DESTINATION_ROTATION_PERSISTENCE_REQUIRED/);
 await assert.rejects(async()=>selectDestinations({store:await store(),campaign_id:campaign(1),scan:scan(),destinations:[route('A')]}),/MANDATORY_X_DESTINATION_MISSING/);
});
test('real directory selection is a subset of saved verified routes and never mutates the directory',async()=>{
 const s=await store(),before=JSON.stringify(directory),result=await selectDestinations({store:s,campaign_id:campaign(1),scan:scan(),destinations:directory});assert(result.external_count<=30);assert(result.selected.every(r=>directory.some(d=>d.id===r.destination_id)));assert.equal(JSON.stringify(directory),before);
});
test('selected proposals retain approvals, hashes, exact delivery, duplicate protection and feedback learning',async()=>{
 const s=await store();let calls=0,builds=0;const routes=[route('A'),route('B'),X],builder=async({route})=>{builds++;return {subject:'Fixture contribution',body:'Exact fixture body',to:route.endpoint.address,delivery_method:route.delivery.method};},transport={quote:async()=>({currency:'AUD',max_cost_aud:0}),send:async()=>{calls++;return {id:'fixture-provider',status:'ACCEPTED',receipt:{message_id:'fixture-provider'},actual_cost_aud:0};}};
 const engine=new StreamlinedMarketingEngineV2({store:s,destinations:routes,assetBuilder:builder,transports:{EMAIL:transport}}),input=scan(),prepared=await engine.prepare({campaign_id:campaign(1),scan:input});assert.equal(prepared.proposals.length,3);assert.equal(prepared.destination_selection.external_count,2);assert.equal(prepared.external_actions,0);assert.equal(calls,0);
 const p=prepared.proposals.find(p=>p.destination==='A'),other=prepared.proposals.find(p=>p.destination==='B');await engine.decide({...p,decision:'APPROVE'});await engine.decide({...other,decision:'REJECT'});
 const restarted=new StreamlinedMarketingEngineV2({store:new FileStore(s.directory),destinations:routes.reverse(),assetBuilder:builder,transports:{EMAIL:transport}}),replayed=await restarted.prepare({campaign_id:campaign(1),scan:input});assert.equal(builds,3);assert.equal(replayed.proposals.find(r=>r.destination==='A').review_hash,p.review_hash);
 const sent=await restarted.distribute();assert.equal(calls,1);assert.equal(sent[0].status,'SUBMITTED');await restarted.distribute();assert.equal(calls,1);assert.equal((await s.get('v2:decision:'+other.proposal_id)).decision,'REJECT');
 const feedback=await restarted.learn({receipt_id:sent[0].receipt.id,events:[{type:'EDITORIAL_REPLY',payload:{request:'fixture article'}}]});assert.equal(feedback.learning.destinations.A.replies,1);assert.equal(feedback.reentry_events,1);
});

test('interrupted preparation resumes its saved plan and existing proposal without advancing rotation',async()=>{
 const s=await store(),routes=[route('A'),route('B'),X],input=scan();let interrupt=true;
 const builder=async({route})=>{if(route.id==='B'&&interrupt){interrupt=false;throw Error('FIXTURE_INTERRUPTION');}return {subject:'Fixture',body:'Exact fixture',to:route.endpoint.address,delivery_method:route.delivery.method};};
 const engine=new StreamlinedMarketingEngineV2({store:s,destinations:routes,assetBuilder:builder});await assert.rejects(()=>engine.prepare({campaign_id:campaign(1),scan:input}),/FIXTURE_INTERRUPTION/);
 const plan=await s.get('v2:destination-selection:'+campaign(1)),saved=(await s.keys('v2:review:'))[0],original=await s.get(saved);
 const restarted=new StreamlinedMarketingEngineV2({store:new FileStore(s.directory),destinations:routes.reverse(),assetBuilder:builder}),completed=await restarted.prepare({campaign_id:campaign(1),scan:input});
 assert.equal(completed.proposals.length,3);assert.deepEqual(await s.get('v2:destination-selection:'+campaign(1)),plan);assert.deepEqual(await s.get(saved),original);assert.equal((await s.keys('v2:destination-selection:')).length,1);
});

test('preexisting campaign reviews and decisions remain untouched by rotation replay',async()=>{
 const s=await store(),existing={campaign_id:campaign(1),scan_hash:(await import('node:crypto')).createHash('sha256').update(JSON.stringify(scan())).digest('hex'),status:'AWAITING_OWNER_REVIEW',proposals:[{proposal_id:'legacy',review_hash:'original-hash',destination:'EXISTING'}]},approval={decision:'APPROVE',review_hash:'original-hash'};
 await s.put('v2:campaign:'+campaign(1),existing);await s.put('v2:decision:legacy',approval);
 const engine=new StreamlinedMarketingEngineV2({store:s,destinations:[route('A'),X],assetBuilder:()=>{throw Error('NO_REGENERATION');}}),result=await engine.prepare({campaign_id:campaign(1),scan:scan()});
 assert.deepEqual(result,existing);assert.deepEqual(await s.get('v2:decision:legacy'),approval);assert.equal((await s.keys('v2:destination-selection:')).length,0);
});
