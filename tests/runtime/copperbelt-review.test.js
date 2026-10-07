import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import sharp from 'sharp';
import scan from './energy-production-reference.json' with {type:'json'};
const energyScan=scan;
import copperbeltScan from './copperbelt-production-reference.json' with {type:'json'};
import brand from '../../runtime/email-brand.cjs';
import directory from '../../state/open-route-directory.json' with {type:'json'};
import {fixture,editorialHarness,editorialBudget} from './fixture.js';
import {GraphEngine} from '../../runtime/graph.js';
import {editorialOutreachAdapter,xAdapter} from '../../runtime/adapters.js';
import {ProductIntake} from '../../runtime/intake.js';
import {autonomousScanCycle,reviewContractRevision} from '../../runtime/autonomous-source.js';
import {nativeXCopy} from '../../runtime/x-copy.js';
import {evidenceVisual,validateCombinedX} from '../../runtime/x-visual.js';
import {formationFromSignal,openRouteScout,prepareRouteAssets} from '../../runtime/open-route-scout.js';
import {validateCorrespondenceProposition,draftCapability,draftOffer} from '../../runtime/editorial-email.js';
import {correspondenceProbe} from '../../runtime/correspondence-probe.js';
import {editorialContext} from '../../runtime/editorial-copy.js';
import {calendarMonth} from '../../runtime/spending.js';
const hash=v=>crypto.createHash('sha256').update(v).digest('hex');
async function setup(transform,preview=false,scan=energyScan){
 const f=await fixture(),bytes=Buffer.from(JSON.stringify(scan));
 const attestation={product:'EMRADAR',snapshot_date:scan.snapshot_date,source_path:'data/checkpoints/discovery-'+scan.snapshot_date+'.json',source_sha256:hash(bytes),publication_state:'PUBLISHED',downstream_release_allowed:true,native_gates:Object.fromEntries(['evidence','editorial','brand','risk','publication'].map(g=>[g,'PASS'])),campaign_authority:{campaign_id:preview?'EMRADAR_2026_10_06_LAUNCH':'EMRADAR_REGRESSION_LEGACY',required_stop:'PUBLICATION_REVIEW',external_publication_allowed:false}};
 const policy={...f.p,product_identity:'EMRADAR',destinations:[],uncertainty_state_model:['CONFIRMED','FORMING','INVESTIGATE','UNKNOWN'],source_release_authority:{automatic_after_native_gates:true,required_gates:['evidence','editorial','brand','risk','publication']},budget:{...editorialBudget,max_worker_calls:20},provider_authority:{automatic_connected_approved_only:true},spending_envelope:{currency:'AUD',campaign_limit:5,calendar_month_limit:50}};
 const intake=new ProductIntake({store:f.store,policies:{EMRADAR:policy},sourceKeys:{EMRADAR:'REGRESSION_ONLY'}});
 let actions=0;const noSend=()=>{actions++;throw Error('EXTERNAL_ACTION_FORBIDDEN');};
 const outreach=editorialOutreachAdapter({senderIdentity:()=>({name:'Sean Walker',address:scan===energyScan?'oroknows@gmail.com':'sean@emradar.net',approved:true}),sendEmail:noSend});
 const harness=editorialHarness(),work=harness.work;
 harness.work=async(...args)=>{
   const r=await work(...args),context=args[1],name=context.destination.organisation;
   const question='Would this analysis be useful for '+name+' readers?';
   const reason=question;
   const insight='What stood out was '+({FINANCIAL_MARKETS:'the gap between recovered exports and delivered prices.',REFINING_AND_STORAGE:'the gap between recovered crude flows and restored refining capacity.',MARITIME_LOGISTICS:'tanker risk remaining distinct from crude export volume.',MINING_TRADE:'the mine-power constraint and outstanding financial close.',CHILE_LATAM:'the unresolved construction and supplier milestones.'})[context.brief.lane];
   const proposition='We are developing an evidence-backed contribution around '+context.destination.relevant_beat_topic[0]+' — while keeping the unresolved delivery risks explicit.';
   // The test model uses one exact fact and keeps all uncertainty in internal metadata, preserving the production shape within the email word limit.
   const development=context.source.source_facts[0].text+' The formation is '+context.source.state+'.';
   const next_step=draftOffer(context.target_language);
   Object.assign(r.result.correspondence,{reason,development,insight,proposition,question,next_step});
   r.result.body=[development+' '+insight,proposition,question,next_step].join('\n\n');
   r.result.claims=[{text:development,evidence_refs:[context.source.source_facts[0].id]}];
   r.result.capability_claims=[{text:next_step,capability:draftCapability}];
   if(name==='Reuters Breakingviews'&&scan===energyScan){
    const development='Crude exports recovered while tanker risk persisted. The formation is '+context.source.state+'.';
    r.result.correspondence.development=development;r.result.body=[development+' '+insight,proposition,question,next_step].join('\n\n');r.result.claims=[{text:development,evidence_refs:[context.source.source_facts[2].id]}];
   }
   return transform?transform(r,context):r;
 };
 const engineFactory=async()=>new GraphEngine({store:f.store,products:await intake.products(),adapters:{OPEN_ROUTE:outreach,X:xAdapter({publish:noSend,authorized:async()=>true,fetchMetrics:noSend})},harness});
 const args={intake,store:f.store,engineFactory,sourceKeys:{EMRADAR:'REGRESSION_ONLY'},env:{RENDER_GIT_COMMIT:'repair-test'},fetcher:async url=>({ok:true,arrayBuffer:async()=>url.includes('/verification/')?Buffer.from(JSON.stringify(attestation)):bytes}),log:()=>{}};
 await autonomousScanCycle({...args,env:{...args.env,MARKETING_EMERGENCY_STOP:'true'}});
 return {...f,args,intake,actions:()=>actions};
}
test('COPPERBELT_COMPOUND_INDUSTRY_RESUMES_X_ONLY_REVIEW_WITH_RENDERED_BOUND_EMAILS',async()=>{
 const f=await setup(null,false,copperbeltScan),first=await autonomousScanCycle(f.args);
 assert.equal(first.status,'AWAITING_REVIEW',JSON.stringify(first.package.blockers));
 const x=first.package.proposals.find(p=>p.platform==='X');assert(x);
 const key='autonomous_scan:'+copperbeltScan.snapshot_date+':'+first.package.source_sha256,state=await f.store.get(key);
 const planKey='route_plan:EMRADAR:'+x.signal_id+':'+x.signal_revision,plan=await f.store.get(planKey);
 const stale={...plan,candidates:plan.candidates.filter(d=>d.destination_id===x.destination),routing_revision:undefined};
 await f.store.put(planKey,stale);
 await f.store.put('receipt_index',[{product:'EMRADAR',campaign_id:first.campaign_id,signal_id:x.signal_id,signal_revision:x.signal_revision,destination:x.destination,proposal_id:x.proposal_id,execution_status:'AWAITING_REVIEW'}]);
 await f.store.put(key,{...state,status:'AWAITING_REVIEW',routes:{[x.destination]:{status:x.status,proposal_id:x.proposal_id}}});
 await f.store.put('review_package:'+first.campaign_id,{...first.package,proposals:[x],routing_revision:undefined});
 const sourceBefore=await f.store.get('source:EMRADAR'),resumed=await autonomousScanCycle(f.args);
 assert.equal(resumed.status,'AWAITING_REVIEW',JSON.stringify(resumed.package.blockers));
 assert.equal(resumed.campaign_id,first.campaign_id);assert.deepEqual(await f.store.get('source:EMRADAR'),sourceBefore);
 const sameX=resumed.package.proposals.find(p=>p.platform==='X');assert.equal(sameX.proposal_id,x.proposal_id);assert.equal(sameX.review_hash,x.review_hash);assert.deepEqual(sameX.asset,x.asset);
 const emails=resumed.package.proposals.filter(p=>p.asset.email);
 assert(emails.some(p=>p.destination==='INTERNATIONAL-MINING-EDITORIAL'));assert(emails.some(p=>p.destination==='GLOBAL-MINING-REVIEW-EDITORIAL'));assert(emails.length>0);
 assert(!resumed.package.proposals.some(p=>p.destination==='HYDROCARBON-ENGINEERING-EDITORIAL'));
 for(const p of emails){assert.equal(p.asset.email.html,brand.render(p.asset.email.body));assert.equal(p.asset.email.from.address,'sean@emradar.net');assert.equal(p.asset.email.reply_to,'sean@emradar.net');assert(p.asset.email.body.endsWith(brand.disclaimer));assert(p.asset.email.html.includes(brand.banner));assert.equal(p.asset.email.to,p.asset.delivery.public_contact_point);assert.equal(p.review_hash,hash(JSON.stringify({product_truth:p.review_binding.product_truth,signal_revision:p.signal_revision,asset:p.asset,destination:p.review_binding.destination,source_receipt:p.source_receipt})));}
 assert.equal(f.actions(),0);assert.equal(resumed.external_actions,0);
 const stable=await autonomousScanCycle(f.args);assert.equal(stable.duplicate,true);assert.deepEqual(stable.package.proposals.map(p=>p.proposal_id),resumed.package.proposals.map(p=>p.proposal_id));
});
