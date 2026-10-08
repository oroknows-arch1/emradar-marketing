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
import {editorialContext} from '../../runtime/editorial-copy.js';
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
