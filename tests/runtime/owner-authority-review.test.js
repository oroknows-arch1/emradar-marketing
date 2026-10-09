import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import directory from '../../state/open-route-directory.json' with {type:'json'};
import {fixture,editorialHarness,editorialBudget} from './fixture.js';
import {GraphEngine} from '../../runtime/graph.js';
import {ProductIntake} from '../../runtime/intake.js';
import {autonomousScanCycle} from '../../runtime/autonomous-source.js';
import {openRouteScout} from '../../runtime/open-route-scout.js';
import {editorialOutreachAdapter,xAdapter} from '../../runtime/adapters.js';
import {campaignReviewHtml} from '../../runtime/campaign-review-html.js';
import {SpendEnvelope,calendarMonth} from '../../runtime/spending.js';
import {HarnessBridge} from '../../runtime/harness.js';
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const scan=JSON.parse(await fs.readFile(new URL('./october9-production-reference.json',import.meta.url)));
async function setup(){
 const f=await fixture(),bytes=await fs.readFile(new URL('./october9-production-reference.json',import.meta.url));
 const attestation={product:'EMRADAR',snapshot_date:scan.snapshot_date,source_path:'data/checkpoints/discovery-'+scan.snapshot_date+'.json',source_sha256:hash(bytes),publication_state:'PUBLISHED',downstream_release_allowed:true,native_gates:Object.fromEntries(['evidence','editorial','brand','risk','publication'].map(g=>[g,'PASS'])),campaign_authority:{campaign_id:'EMRADAR_2026_10_09_LAUNCH',required_stop:'PUBLICATION_REVIEW',external_publication_allowed:false}};
 const policy={...f.p,product_identity:'EMRADAR',destinations:[],uncertainty_state_model:['CONFIRMED','FORMING','INVESTIGATE','UNKNOWN'],source_release_authority:{automatic_after_native_gates:true,required_gates:['evidence','editorial','brand','risk','publication']},budget:editorialBudget,provider_authority:{automatic_connected_approved_only:true},spending_envelope:{currency:'AUD',campaign_limit:5,calendar_month_limit:50}};
 const intake=new ProductIntake({store:f.store,policies:{EMRADAR:policy},sourceKeys:{EMRADAR:'TEST_ONLY'}});
 let actions=0,calls=0;const noSend=()=>{actions++;throw Error('EXTERNAL_ACTION_FORBIDDEN');};
 const harness=editorialHarness(),work=harness.work;
 harness.work=async(unit,context)=>{calls++;const result=await work(unit,context);if(context.prepared_correspondence){result.result=structuredClone(context.prepared_correspondence);return result;}result.proof.editorial_checks.destination_fit='FAIL';result.result.correspondence.development=context.source.source_facts[0].text;result.result.body=[...Object.values(result.result.correspondence),context.source.source_uncertainty[0]].filter(Boolean).join('\n\n');result.result.claims=[{text:context.source.source_facts[0].text,evidence_refs:[context.source.source_facts[0].id]}];return result;};
 const engineFactory=async()=>new GraphEngine({store:f.store,products:await intake.products(),adapters:{OPEN_ROUTE:editorialOutreachAdapter({senderIdentity:()=>({name:'Sean Walker',address:'sean@emradar.net',approved:true}),sendEmail:noSend}),X:xAdapter({publish:noSend,authorized:async()=>true,fetchMetrics:noSend})},harness});
 return {...f,engineFactory,calls:()=>calls,actions:()=>actions,args:{intake,store:f.store,engineFactory,sourceKeys:{EMRADAR:'TEST_ONLY'},env:{RENDER_GIT_COMMIT:'test-owner-authority'},fetcher:async url=>({ok:true,arrayBuffer:async()=>url.includes('/verification/')?Buffer.from(JSON.stringify(attestation)):bytes}),log:()=>{}}};
}
test('October 9 all registered destinations reach owner review; replay preserves exact X and all proposals',async()=>{
 const f=await setup(),r=await autonomousScanCycle(f.args);
 assert.equal(r.status,'AWAITING_REVIEW',JSON.stringify(r.package.blockers));
 assert.equal(r.package.route_dispositions.length,directory.destinations.length);
 assert.equal(r.package.proposals.length,directory.destinations.length,JSON.stringify(r.package.incomplete_preparation));
 const x=r.package.proposals.find(p=>p.platform==='X'),png=Buffer.from(x.asset.base64,'base64');assert.equal(hash(png),x.asset.sha256);
 const key='autonomous_scan:'+scan.snapshot_date+':'+r.package.source_sha256,state=await f.store.get(key);
 const planKey='route_plan:EMRADAR:'+x.signal_id+':'+x.signal_revision,oldPlan=await f.store.get(planKey);
 await f.store.put(planKey,{...oldPlan,routing_revision:'old-score-veto',candidates:oldPlan.candidates.filter(d=>d.destination_id===x.destination)});
 await f.store.put(key,{...state,preparation_revision:null,runtime_commit:'old-runtime',routes:{[x.destination]:{status:'AWAITING_REVIEW',proposal_id:x.proposal_id}}});
 await f.store.put('review_package:'+r.campaign_id,{...r.package,routing_revision:'old-score-veto',proposals:[x]});
 const recovered=await autonomousScanCycle({...f.args,resumeCampaign:r.campaign_id});
 assert.deepEqual(recovered.package.proposals.find(p=>p.platform==='X').asset,x.asset);assert.equal(recovered.package.proposals.find(p=>p.platform==='X').review_hash,x.review_hash);
 const calls=f.calls(),same=await autonomousScanCycle(f.args);assert.equal(same.duplicate,true);assert.equal(f.calls(),calls);assert.deepEqual(same.package.proposals,recovered.package.proposals);
 const plan=await f.store.get('route_plan:EMRADAR:'+x.signal_id+':'+x.signal_revision);
 assert.equal(plan.candidates.length,directory.destinations.length);assert(plan.discovered.some(d=>d.route_score<.7));assert(plan.discovered.every(d=>d.score_factors));
 assert(r.package.route_dispositions.some(d=>d.score_factors.industry_relevance===0&&d.route_reason));
 assert(r.package.route_dispositions.every(d=>scan.records.some(s=>s.id===d.contribution_signal_id)));
 assert(campaignReviewHtml(r.package,r.campaign_id).includes('data:image/png;base64,'+x.asset.base64));assert.equal(f.actions(),0);
});
test('low relevance and historical outcomes describe every registered route without veto',()=>{
 const formation={id:'new',evidence:[{fact:'A disclosed fact',url:'https://example.test'}],causal_chain:{industries:['Unfamiliar industry']}};
 const routes=openRouteScout({formation,directory,learning:Object.fromEntries(directory.destinations.map(d=>[d.destination_id,{score:-100}]))});
 assert.equal(routes.candidates.length,directory.destinations.length);assert(routes.discovered.every(d=>d.score_factors.historical_route_performance===-100));assert.equal(routes.rejected.length,0);
});
test('unverified recipients and unsupported forms cannot execute even after owner approval',async()=>{
 const adapter=editorialOutreachAdapter({sendEmail:()=>{throw Error('MUST_NOT_SEND');}});
 await assert.rejects(adapter.publish({delivery:{...directory.destinations[1],verification_state:'UNKNOWN'}},'test','EMRADAR'),/CAPABILITY_UNAVAILABLE/);
 const form=directory.destinations.find(d=>d.access_method.toLowerCase().includes('form'));assert(form);assert.equal(adapter.supportsRoute(form),false);
});
test('AUD campaign and month limits remain enforced for preparation',async()=>{
 const f=await fixture(),spend=new SpendEnvelope(f.store),month=calendarMonth(),quote={currency:'AUD',verified:true,provider_enforced:true,max_cost_aud:.1,receipt_id:'test'};
 await f.store.put('spend:'+month,{month,actual_aud:5,unresolved:{},campaigns:{C:5},receipts:{},historical_billing:'UNKNOWN'});
 await assert.rejects(spend.reserve({campaign_id:'C',quote,category:'generation'}),/CAMPAIGN_AUD_5/);
 await f.store.put('spend:'+month,{month,actual_aud:50,unresolved:{},campaigns:{},receipts:{},historical_billing:'UNKNOWN'});
 await assert.rejects(spend.reserve({campaign_id:'C',quote,category:'generation'}),/MONTH_AUD_50/);
});
test('worker fit cannot veto review, but failed factual entailment cannot pass',async()=>{
 const unit={workUnitId:'test'},result={body:'A bound fact'},context={input_hash:'bound-input',editorial_authority:{suitability:'OWNER_ONLY'}};
 let facts='PASS';
 const bridge=new HarnessBridge({routeWorkUnit:()=>({contractVersion:'elastic-routing-v0.1',workUnitId:'test',lane:'model',attemptCeiling:1}),registry:async()=>[],execute:async()=>result,verify:async()=>({status:'NOT_VERIFIED',input_hash:'bound-input',output_hash:hash(JSON.stringify(result)),evidence_refs:['fact'],editorial_checks:{factual_entailment:facts,uncertainty_preserved:'PASS',originality:'PASS',capability_inventory:'PASS',human_correspondence:'PASS',destination_fit:'FAIL'}})});
 assert.equal((await bridge.work(unit,context)).proof.status,'VERIFIED');
 facts='FAIL';await assert.rejects(bridge.work(unit,context),/HARNESS_OUTPUT_NOT_VERIFIED/);
});
