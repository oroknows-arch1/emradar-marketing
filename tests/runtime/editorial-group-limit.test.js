import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {FileStore} from '../../runtime/store.js';
import {StreamlinedMarketingEngineV2} from '../../runtime/streamlined-engine-v2.js';
import {selectDestinations} from '../../runtime/destination-rotation.js';
import {editorialEvidence,verifyEmailGroupLimit,editorialReviewPolicy} from '../../runtime/editorial-group-policy.js';
import {equivalentEmailGroups,campaignReviewHtml} from '../../runtime/campaign-review-html.js';
import {reviewAction} from '../../runtime/v2-review-actions.js';
const X={id:'EMRADAR-X-OROKNOWS',endpoint:{address:'@fixture',verification_state:'VERIFIED'},delivery:{method:'X',supported:true},connector:{authorized:true},finished_contribution_supported:true,editorial_relevance:true,evidence_suitable:true};
const formation=(id,industry)=>({id,state:'FORMING',industries:[industry],evidence:[{id:'e'+id,claim:industry+' investment is announced.',url:'https://example.test/evidence'}],causal_chain:['investment','construction'],uncertainty:['Output remains unconfirmed.'],strengthening_evidence:[],weakening_evidence:[],break_conditions:[]});
const scan={publication_state:'PUBLISHED',source_revision:'limit-fixture-r1',formations:[formation('copper','Copper mining'),formation('solar','Solar generation')]};scan.formation=scan.formations[0];
const route=(i,industry='Copper mining')=>({id:'D'+String(i).padStart(2,'0'),industries:[industry],relevant_beat_topic:[industry],editorial_relevance:true,evidence_suitable:true,endpoint:{address:'editor'+i+'@example.test',verification_state:'VERIFIED'},delivery:{method:'EMAIL',supported:true},connector:{authorized:true},finished_contribution_supported:true});
const campaign=n=>'EMRADAR_2099_02_'+String(n).padStart(2,'0')+'_LAUNCH';
async function store(){return new FileStore(await mkdtemp(path.join(os.tmpdir(),'group-limit-')));}
function asset(route,group=route.id){const subject='Contribution '+group,body='Hello,\n\nExact complete editorial correspondence '+group+'. Uncertainty remains explicit.\n\nWould an article or research contribution be useful?\n\nRegards,\nSean Walker\nEMRADAR';return {subject,body,to:route.endpoint.address,delivery_method:route.delivery.method,email:{subject,body,to:route.endpoint.address},copy:'Subject: '+subject+'\n\n'+body};}

test('hard fifteen-group ceiling is planned before expensive generation with mandatory separate X',async()=>{
 const s=await store(),routes=Array.from({length:40},(_,i)=>route(i,i<20?'Copper mining':'Solar generation')).concat(X);let expensiveCalls=0;
 const engine=new StreamlinedMarketingEngineV2({store:s,destinations:routes,assetBuilder:async({route})=>{expensiveCalls++;return route.id===X.id?{subject:'X fixture',body:'X text',to:route.endpoint.address,delivery_method:'X',mime:'image/png',base64:'fixture',copy:'X text'}:asset(route);}});
 const record=await engine.prepare({campaign_id:campaign(1),scan});assert.equal(record.destination_selection.planned_email_groups,15);assert.equal(record.email_group_count,15);assert.equal(expensiveCalls,16);assert.equal(record.proposals.length,16);assert.equal(record.external_actions,0);
 assert.equal(record.proposals.filter(p=>p.destination===X.id).length,1);assert(record.route_dispositions.some(d=>d.reason==='EMAIL_GROUP_LIMIT_ROTATE_FUTURE_SCAN'));assert.equal((await s.keys('v2:preparation-work:')).length,0);
});
test('genuine shared complete drafts maximise recipient coverage to thirty without consuming extra groups',async()=>{
 const s=await store(),single={...scan,formations:[scan.formation]},routes=Array.from({length:40},(_,i)=>route(i)).concat(X),group=r=>'shared-'+Number(r.id.slice(1))%10;let calls=0;
 const planner=async({route})=>({asset:asset(route,group(route))});
 const engine=new StreamlinedMarketingEngineV2({store:s,destinations:routes,assetPlanner:planner,assetBuilder:async({route})=>{calls++;return route.id===X.id?{subject:'X',body:'X',to:route.endpoint.address,delivery_method:'X'}:asset(route,group(route));}}),record=await engine.prepare({campaign_id:campaign(1),scan:single});
 assert.equal(record.destination_selection.external_count,30);assert.equal(record.email_group_count,10);assert.equal(record.proposals.length,31);assert.equal(calls,31);const groups=equivalentEmailGroups(record.proposals).filter(g=>g.email);assert(groups.some(g=>g.proposals.length>1));
 const html=campaignReviewHtml(record,record.campaign_id,{v2:true,decisionPath:'/V2/PUBLICATION_REVIEW'});assert.match(html,/id="remaining-actions">11<\/span>/);assert.equal((html.match(/<section class="email-group"/g)||[]).length,10);
});
test('greetings, publication wording and editorial asks cannot artificially reduce the ceiling',()=>{
 const base=asset(route(0),'shared'),variants=[base,{...base,email:{...base.email,body:base.body.replace('Hello,','Hi Jane,')}},{...base,email:{...base.email,body:base.body.replace('research contribution','interview')}},{...base,email:{...base.email,body:base.body+'\nPublication-specific relevance.'}}];
 const proposals=variants.map(a=>({asset:a,evidence_binding:editorialEvidence(scan)}));assert.equal(equivalentEmailGroups(proposals).length,4);
 assert.throws(()=>verifyEmailGroupLimit(Array.from({length:16},(_,i)=>({asset:asset(route(i)),evidence_binding:editorialEvidence(scan)}))),/EDITORIAL_EMAIL_GROUP_LIMIT_EXCEEDED/);
 assert.equal(editorialReviewPolicy.max_email_groups,15);assert.equal(editorialReviewPolicy.max_external_destinations,30);
});
test('changed generated identity is refused before exposing or persisting an unreviewed proposal',async()=>{
 const s=await store(),r=route(0),engine=new StreamlinedMarketingEngineV2({store:s,destinations:[r,X],assetPlanner:async({route})=>({asset:asset(route,'planned')}),assetBuilder:async({route})=>asset(route,'different')});
 await assert.rejects(()=>engine.prepare({campaign_id:campaign(1),scan}),/PLANNED_EDITORIAL_IDENTITY_CHANGED/);assert.equal((await s.keys('v2:review:')).length,0);assert.equal(await s.get('v2:campaign:'+campaign(1)),null);
});
test('overflow stays eligible for later scans and no owner-review backlog is queued',async()=>{
 const s=await store(),routes=Array.from({length:40},(_,i)=>route(i,i<20?'Copper mining':'Solar generation')).concat(X),first=await selectDestinations({store:s,campaign_id:campaign(1),scan,destinations:routes}),next=await selectDestinations({store:s,campaign_id:campaign(2),scan:{...scan,source_revision:'limit-r2'},destinations:routes});
 assert.equal(first.external_count,15);assert.equal(next.external_count,15);const previous=new Set(first.selected.map(r=>r.destination_id));assert(next.selected.filter(r=>r.destination_id!==X.id).every(r=>!previous.has(r.destination_id)));assert.equal((await s.keys('v2:preparation-work:')).length,0);
});
test('restart reuses the group budget, exact plan and existing member hashes',async()=>{
 const s=await store(),routes=[route(0),route(1),X],build=async({route})=>route.id===X.id?{subject:'X',body:'X',to:route.endpoint.address,delivery_method:'X'}:asset(route,'shared'),plan=async({route})=>({asset:asset(route,'shared')}),engine=new StreamlinedMarketingEngineV2({store:s,destinations:routes,assetPlanner:plan,assetBuilder:build});
 const first=await engine.prepare({campaign_id:campaign(1),scan});const restarted=new StreamlinedMarketingEngineV2({store:new FileStore(s.directory),destinations:routes.reverse(),assetPlanner:()=>{throw Error('NO_REPLAN');},assetBuilder:()=>{throw Error('NO_REGENERATION');}}),second=await restarted.prepare({campaign_id:campaign(1),scan});assert.equal(JSON.stringify(first),JSON.stringify(second));assert.equal(first.email_group_count,1);
});
test('identical member decisions, individual override and approval-only distribution remain protected',async()=>{
 const s=await store(),routes=[route(0),route(1),X];let sends=0;const engine=new StreamlinedMarketingEngineV2({store:s,destinations:routes,assetPlanner:async({route})=>({asset:asset(route,'shared')}),assetBuilder:async({route})=>route.id===X.id?{subject:'X',body:'X',to:route.endpoint.address,delivery_method:'X'}:asset(route,'shared'),transports:{EMAIL:{quote:async()=>({currency:'AUD',max_cost_aud:0}),send:async()=>{sends++;return {id:'fixture-provider',status:'ACCEPTED',receipt:{message_id:'fixture-provider'},actual_cost_aud:0};}}}});
 const record=await engine.prepare({campaign_id:campaign(1),scan}),group=equivalentEmailGroups(record.proposals).find(g=>g.email);assert.equal(group.proposals.length,2);await engine.distribute();assert.equal(sends,0);
 for(const p of group.proposals)await engine.decide({...p,decision:'APPROVE'});const first=group.proposals[0];await reviewAction(engine,{...first,action:'OVERRIDE',previous_decision:'APPROVE',decision:'REJECT',reason:'Explicit owner change'});
 await engine.distribute();assert.equal(sends,1);await engine.distribute();assert.equal(sends,1);assert.equal((await s.get('v2:decision:'+first.proposal_id)).decision,'REJECT');assert.equal((await s.get('v2:review:'+first.proposal_id)).review_hash,first.review_hash);
});
