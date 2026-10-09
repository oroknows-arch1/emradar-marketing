import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import scan from './offshore-production-reference.json' with {type:'json'};
import {fixture,editorialHarness,editorialBudget} from './fixture.js';
import {GraphEngine,digest} from '../../runtime/graph.js';
import {ProductIntake} from '../../runtime/intake.js';
import {autonomousScanCycle,reviewContractRevision} from '../../runtime/autonomous-source.js';
import {editorialOutreachAdapter,xAdapter} from '../../runtime/adapters.js';
import {recoverIdlePreparationLock} from '../../runtime/preparation-recovery.js';
import {draftCapability,validateCapabilityInventory} from '../../runtime/editorial-email.js';
import {editorialContext,produceEditorial} from '../../runtime/editorial-copy.js';
const sha=v=>crypto.createHash('sha256').update(v).digest('hex');
const campaign='EMRADAR_2026_10_08_LAUNCH';
const quiet=async fn=>{const log=console.log;console.log=()=>{};try{return await fn();}finally{console.log=log;}};
async function setup(){
 const f=await fixture(),bytes=Buffer.from(JSON.stringify(scan));
 const attestation={product:'EMRADAR',snapshot_date:scan.snapshot_date,source_path:'data/checkpoints/discovery-'+scan.snapshot_date+'.json',source_sha256:sha(bytes),publication_state:'PUBLISHED',downstream_release_allowed:true,native_gates:Object.fromEntries(['evidence','editorial','brand','risk','publication'].map(g=>[g,'PASS'])),campaign_authority:{campaign_id:campaign,required_stop:'PUBLICATION_REVIEW',external_publication_allowed:false}};
 const policy={...f.p,product_identity:'EMRADAR',destinations:[],uncertainty_state_model:['CONFIRMED','FORMING','INVESTIGATE','UNKNOWN'],source_release_authority:{automatic_after_native_gates:true,required_gates:['evidence','editorial','brand','risk','publication']},budget:editorialBudget,provider_authority:{automatic_connected_approved_only:true},spending_envelope:{currency:'AUD',campaign_limit:5,calendar_month_limit:50}};
 const intake=new ProductIntake({store:f.store,policies:{EMRADAR:policy},sourceKeys:{EMRADAR:'TEST_ONLY'}});
 let actions=0,calls=0;const noSend=()=>{actions++;throw Error('NO_DISTRIBUTION');};
 const harness=editorialHarness(); // Explicit test provider; never used for production assets.
 harness.work=async(_unit,c)=>{
  calls++;const name=c.destination.organisation,development=c.source.source_facts[0].text;
  const insight=name==='MarineLink'?'More exploration acreage could eventually affect offshore vessel requirements; it is not an order book.':'The award expands exploration rights, not discovered reserves or producing capacity.';
  const proposition=name==='MarineLink'?'The article could examine the work milestones preceding offshore support demand.':'The article could examine the distinction between acreage awarded and commercially viable discoveries.';
  const question=`Would this article angle be useful to your editors at ${name}?`;
  const offer='If the angle suits, I can prepare a finished draft with sources for your review.';
  const body=[development,insight,proposition,question,offer].join('\n\n');
  return {result:{subject:name+': Brazil pre-salt exploration rights',body,language:'en',signal_state:c.source.state,evidence_refs:c.source.evidence,claims:[{text:development,evidence_refs:[c.source.source_facts[0].id]}],qualifications:c.source.source_uncertainty.map((text,source_index)=>({text,source_index})),capability_claims:[{text:offer,capability:draftCapability}],correspondence:{reason:question,development,insight,proposition,question,next_step:offer}},proof:{billing:{currency:'AUD',actual:true,amount:0,receipt_id:'TEST_ONLY',provider:'TEST_ONLY'},evidence_refs:c.source.evidence,editorial_checks:Object.fromEntries(['factual_entailment','uncertainty_preserved','destination_fit','originality','capability_inventory','human_correspondence'].map(k=>[k,'PASS']))},decision:{lane:'test'},attempts:1};
 };
 const engineFactory=async()=>new GraphEngine({store:f.store,products:await intake.products(),adapters:{OPEN_ROUTE:editorialOutreachAdapter({senderIdentity:()=>({name:'Sean Walker',address:'sean@emradar.net',approved:true}),sendEmail:noSend}),X:xAdapter({publish:noSend,authorized:async()=>true,fetchMetrics:noSend})},harness});
 const args={intake,store:f.store,engineFactory,sourceKeys:{EMRADAR:'TEST_ONLY'},env:{RENDER_GIT_COMMIT:'test-restored'},fetcher:async u=>({ok:true,arrayBuffer:async()=>u.includes('/verification/')?Buffer.from(JSON.stringify(attestation)):bytes}),log:()=>{}};
 return {...f,args,calls:()=>calls,actions:()=>actions};
}
test('actual October 8 source traverses restored writer and resumes persisted review without replacing X',()=>quiet(async()=>{
 const f=await setup(),first=await autonomousScanCycle(f.args);
 assert.equal(first.status,'AWAITING_REVIEW',JSON.stringify(first.package));
 const x=first.package.proposals.find(p=>p.platform==='X'),emails=first.package.proposals.filter(p=>p.asset.email);
 assert.deepEqual(emails.map(p=>p.destination).sort(),['MARINELINK-EDITORIAL-INQUIRY','OIL-GAS-JOURNAL-EDITORIAL'],JSON.stringify(first.package.rejected_routes));
 assert.notEqual(emails[0].asset.email.proposition.correspondence.insight,emails[1].asset.email.proposition.correspondence.insight);
 for(const p of emails){
  assert.equal(p.review_contract_revision,reviewContractRevision);
  assert.equal(p.review_hash,digest({product_truth:p.review_binding.product_truth,signal_revision:p.signal_revision,asset:p.asset,destination:p.review_binding.destination,source_receipt:p.source_receipt}));
  assert.deepEqual(p.evidence_binding.evidence_refs,p.evidence_refs);
  assert.doesNotMatch(p.asset.email.body,/FORMING|What stood out|evidence-backed contribution|Supporting source/);
  assert(p.asset.email.body.includes('finished draft with sources'));
  const context=editorialContext({signal:{...p.evidence_binding,state:p.signal_state,revision:p.signal_revision,evidence:p.evidence_refs},product:{},route:{id:p.destination,destination:{route_record:p.asset.delivery}},route_plan:{proposed_assets:[{destination_id:p.destination}]}});
  assert.equal(context.response_schema.properties.capability_claims.items.properties.text.enum,undefined);
 }
 // Simulate old writer checkpoint; valid X and sent receipts must remain exact.
 const key='autonomous_scan:'+scan.snapshot_date+':'+first.package.source_sha256,state=await f.store.get(key);
 const oldPackage=structuredClone(first.package);oldPackage.review_contract_revision='old-writer';
 await f.store.put('review_package:'+campaign,oldPackage);await f.store.put(key,{...state,review_contract_revision:'old-writer'});
 for(const p of emails)await f.store.put('publication_review:'+p.proposal_id,{...p,review_contract_revision:'old-writer'});
 const sent={id:'historical-sent',product:'EMRADAR',campaign_id:'historical',execution_status:'SUBMITTED',external_id:'UNCHANGED'};
 await f.store.put('receipt:historical-sent',sent);
 const resumed=await autonomousScanCycle({...f.args,resumeCampaign:campaign});
 assert.equal(resumed.status,'AWAITING_REVIEW');assert.equal(resumed.campaign_id,campaign);
 assert.deepEqual(resumed.package.proposals.find(p=>p.platform==='X'),x);
 assert.deepEqual(await f.store.get('receipt:historical-sent'),sent);
 const before=f.calls();const duplicate=await autonomousScanCycle({...f.args,resumeCampaign:campaign});assert(duplicate.duplicate);assert.equal(f.calls(),before);
 assert.equal(f.actions(),0);assert.equal(resumed.external_actions,0);
}));
test('capability inventory rejects unbounded monitoring',()=>{
 const r={body:'I can provide ongoing monitoring.',capability_claims:[{text:'I can provide ongoing monitoring.',capability:draftCapability}]};
 assert.throws(()=>validateCapabilityInventory(r,{editorial_checks:{capability_inventory:'PASS'}}),/UNVERIFIED_CAPABILITY/);
});
test('idle lock recovery preserves recent locks, in-flight actions and compare-and-delete races',async()=>{
 for(const condition of ['recent','external','provider','race','idle']){
  let deleted=false;const data=new Map([['review_package:'+campaign,{external_actions:0}],['receipt_index',condition==='external'?[{execution_status:'IN_FLIGHT'}]:[]],['harness_stage:test',{status:'IN_FLIGHT',at:new Date().toISOString()}]]);
  const store={get:async k=>data.get(k),put:async(k,v)=>data.set(k,v),keys:async()=>condition==='provider'?['harness_stage:test']:[],client:{sendCommand:async()=>condition==='recent'?5:7200,get:async()=> 'old-token',eval:async()=>{if(condition==='race')return 0;deleted=true;return 1;}}};
  const result=await recoverIdlePreparationLock(store);assert.equal(deleted,condition==='idle');assert.equal(result.external_actions||0,0);
 }
});
test('legacy ownership stability recovers despite Redis idle resetting, while preserving artifacts and other locks',async()=>{
 const t=Date.parse('2026-10-08T17:00:00Z');let token='stale-token';
 const values=new Map([['review_package:'+campaign,{external_actions:0,status:'AWAITING_REVIEW',proposals:[]}],['receipt_index',[]],['campaign_cost_index:'+campaign,[]],['unrelated-lock','KEEP']]);
 const store={get:async k=>values.get(k),put:async(k,v)=>values.set(k,v),keys:async()=>[],client:{sendCommand:async()=>5,get:async()=>token,eval:async(_s,args)=>{if(token!==args.arguments[0])return 0;token=null;return 1;}}};
 assert.equal((await recoverIdlePreparationLock(store,{now:t})).reason,'OBSERVING_LEGACY_LOCK_OWNER');
 const result=await recoverIdlePreparationLock(store,{now:t+300000});assert.equal(result.status,'RECOVERED_IDLE_PREPARATION_LOCK');assert.equal(token,null);assert.equal(values.get('unrelated-lock'),'KEEP');assert.deepEqual(values.get('review_package:'+campaign),{external_actions:0,status:'AWAITING_REVIEW',proposals:[]});
});
test('tracked active owners and recent expense activity prohibit stale-lock recovery',async()=>{
 const now=Date.now(),token='active',token_hash=crypto.createHash('sha256').update(token).digest('hex');
 for(const tracked of [true,false]){
  let deleted=false;const values=new Map([['review_package:'+campaign,{external_actions:0}],['receipt_index',[]],['campaign_cost_index:'+campaign,[]],['campaign_cost:active',{outcome:'RUNNING',timestamp:new Date(now).toISOString(),calls:[]}]]);
  if(tracked)values.set('lock_owner:engine',{token_hash,heartbeat_at:new Date(now).toISOString()});
  const store={get:async k=>values.get(k),put:async(k,v)=>values.set(k,v),keys:async prefix=>prefix==='campaign_cost:'?['campaign_cost:active']:[],client:{sendCommand:async()=>7200,get:async()=>token,eval:async()=>{deleted=true;return 1;}}};
  const result=await recoverIdlePreparationLock(store,{now});assert.equal(deleted,false);assert.equal(result.reason,tracked?'ACTIVE_ENGINE_HEARTBEAT':'RUN_ACTIVITY_RECENT');
 }
});

test('runtime repair resumes only rejected incomplete route and retains completed emails and X',()=>quiet(async()=>{
 const f=await setup(),factory=f.args.engineFactory;let reject=true;
 f.args.engineFactory=async()=>{const e=await factory(),run=e.run.bind(e);e.run=async input=>reject&&input.destination_id==='MARINELINK-EDITORIAL-INQUIRY'?{status:'BLOCKED',blocker:'HUMAN_RECIPIENT_AGENCY_REQUIRED',run_id:'test-rejected',nodes:[{node:'editorial_intelligence',status:'BLOCKED'}]}:run(input);return e;};
 const first=await autonomousScanCycle(f.args);assert.equal(first.package.rejected_routes[0].destination,'MARINELINK-EDITORIAL-INQUIRY');
 const saved=first.package.proposals;const before=f.calls();
 const duplicate=await autonomousScanCycle({...f.args,resumeCampaign:campaign});assert(duplicate.duplicate);assert.equal(f.calls(),before);
 reject=false;const repaired=await autonomousScanCycle({...f.args,resumeCampaign:campaign,env:{RENDER_GIT_COMMIT:'test-repair'}});
 assert.equal(repaired.campaign_id,campaign);assert.equal(repaired.package.rejected_routes.length,0);assert.equal(f.calls(),before+1);
 for(const p of saved)assert.deepEqual(repaired.package.proposals.find(q=>q.proposal_id===p.proposal_id),p);
 const after=f.calls();assert((await autonomousScanCycle({...f.args,resumeCampaign:campaign,env:{RENDER_GIT_COMMIT:'test-repair'}})).duplicate);assert.equal(f.calls(),after);assert.equal(f.actions(),0);
}));
test('recipient agency failure gets one verified correction without relaxing the gate',()=>quiet(async()=>{
 const f=await setup(),result=await autonomousScanCycle(f.args),p=result.package.proposals.find(p=>p.asset.email);
 const context=editorialContext({signal:{...p.evidence_binding,state:p.signal_state,revision:p.signal_revision,evidence:p.evidence_refs},product:{},route:{id:p.destination,destination:{route_record:p.asset.delivery}},route_plan:{proposed_assets:[{destination_id:p.destination}]}});
 const good=p.asset.email.proposition,proof={evidence_refs:p.evidence_refs,editorial_checks:Object.fromEntries(['factual_entailment','uncertainty_preserved','destination_fit','originality','capability_inventory','human_correspondence'].map(k=>[k,'PASS']))};
 const bad=structuredClone(good),question='What exploration milestones remain?';bad.body=bad.body+"\n"+question;bad.correspondence.question=question;let calls=0;
 const output=await produceEditorial(context,async(request,attempt)=>{calls++;if(attempt===2)assert.equal(request.editorial_correction.failed_gate,'HUMAN_RECIPIENT_AGENCY_REQUIRED');return {result:attempt===1?bad:good,proof};});assert.equal(output.result,good);assert.equal(calls,2);
 await assert.rejects(produceEditorial(context,async()=>({result:bad,proof})),/HUMAN_RECIPIENT_AGENCY_REQUIRED/);
 const paraphrased=structuredClone(good);paraphrased.correspondence.insight='Unused paraphrase of the body.';let repaired=0;
 await produceEditorial(context,async(request,attempt)=>{repaired++;if(attempt===2){assert.deepEqual(request.editorial_correction.rejected_result,paraphrased);assert.equal(request.editorial_correction.failed_gate,'HUMAN_PROPOSITION_QUALITIES_REQUIRED');}return {result:attempt===1?paraphrased:good,proof};});assert.equal(repaired,2);
 await assert.rejects(produceEditorial(context,async()=>({result:paraphrased,proof})),/HUMAN_PROPOSITION_QUALITIES_REQUIRED/);
}));
