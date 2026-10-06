import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import sharp from 'sharp';
import scan from './energy-production-reference.json' with {type:'json'};
import directory from '../../state/open-route-directory.json' with {type:'json'};
import {fixture,editorialHarness,editorialBudget} from './fixture.js';
import {GraphEngine} from '../../runtime/graph.js';
import {editorialOutreachAdapter,xAdapter} from '../../runtime/adapters.js';
import {ProductIntake} from '../../runtime/intake.js';
import {autonomousScanCycle,reviewContractRevision} from '../../runtime/autonomous-source.js';
import {nativeXCopy} from '../../runtime/x-copy.js';
import {evidenceVisual,validateCombinedX} from '../../runtime/x-visual.js';
import {formationFromSignal,openRouteScout,prepareRouteAssets} from '../../runtime/open-route-scout.js';
import {validateCorrespondenceProposition} from '../../runtime/editorial-email.js';
import {correspondenceProbe} from '../../runtime/correspondence-probe.js';
const hash=v=>crypto.createHash('sha256').update(v).digest('hex');
async function setup(){
 const f=await fixture(),bytes=Buffer.from(JSON.stringify(scan));
 const attestation={product:'EMRADAR',snapshot_date:scan.snapshot_date,source_path:'data/checkpoints/discovery-'+scan.snapshot_date+'.json',source_sha256:hash(bytes),publication_state:'PUBLISHED',downstream_release_allowed:true,native_gates:Object.fromEntries(['evidence','editorial','brand','risk','publication'].map(g=>[g,'PASS'])),campaign_authority:{campaign_id:'EMRADAR_2026_10_06_LAUNCH',required_stop:'PUBLICATION_REVIEW',external_publication_allowed:false}};
 const policy={...f.p,product_identity:'EMRADAR',destinations:[],uncertainty_state_model:['CONFIRMED','FORMING','INVESTIGATE','UNKNOWN'],source_release_authority:{automatic_after_native_gates:true,required_gates:['evidence','editorial','brand','risk','publication']},budget:{...editorialBudget,max_worker_calls:20}};
 const intake=new ProductIntake({store:f.store,policies:{EMRADAR:policy},sourceKeys:{EMRADAR:'REGRESSION_ONLY'}});
 let actions=0;const noSend=()=>{actions++;throw Error('EXTERNAL_ACTION_FORBIDDEN');};
 const outreach=editorialOutreachAdapter({senderIdentity:()=>({name:'Sean Walker',address:'oroknows@gmail.com',approved:true}),sendEmail:noSend});
 const harness=editorialHarness(),work=harness.work;
 harness.work=async(...args)=>{
   const r=await work(...args),context=args[1],name=context.destination.organisation;
   const reason="I'm contacting "+name+" about "+context.destination.relevant_beat_topic[0]+'.';
   const insight=({FINANCIAL_MARKETS:'Recovered exports do not establish lower delivered prices.',REFINING_AND_STORAGE:'Recovered crude flows do not establish restored refining capacity.',MARITIME_LOGISTICS:'Tanker risk remains distinct from crude export volume.'})[context.brief.lane];
   const proposition='The proposed analysis examines '+context.destination.relevant_beat_topic[0]+'.';
   const question='Would this analysis be useful for your readers?';
   for(const [key,value] of Object.entries({reason,insight,proposition,question})){r.result.body=r.result.body.replace(r.result.correspondence[key],value);r.result.correspondence[key]=value;}
   // The test model uses one exact fact and all uncertainties, preserving the production shape within the email word limit.
   const development=context.source.source_facts[0].text;
   r.result.body=r.result.body.replace(r.result.correspondence.development,development);r.result.correspondence.development=development;r.result.claims=[{text:development,evidence_refs:[context.source.source_facts[0].id]}];
   if(name==='Reuters Breakingviews'){
    const development='Crude exports recovered while tanker risk persisted.';
    r.result.body=r.result.body.replace(r.result.correspondence.development,development);r.result.correspondence.development=development;r.result.claims=[{text:development,evidence_refs:[context.source.source_facts[2].id]}];
    const concise=['Crude recovery could ease upstream tightness.','Executives have scarcity incentives.','War risk changes rapidly; disabled tracking obscures movements.'];
    for(let i=0;i<3;i++){r.result.body=r.result.body.replace(r.result.qualifications[i].text,concise[i]);r.result.qualifications[i].text=concise[i];}
   }
   return r;
 };
 const engineFactory=async()=>new GraphEngine({store:f.store,products:await intake.products(),adapters:{OPEN_ROUTE:outreach,X:xAdapter({publish:noSend,authorized:async()=>true,fetchMetrics:noSend})},harness});
 const args={intake,store:f.store,engineFactory,sourceKeys:{EMRADAR:'REGRESSION_ONLY'},env:{RENDER_GIT_COMMIT:'repair-test'},fetcher:async url=>({ok:true,arrayBuffer:async()=>url.includes('/verification/')?Buffer.from(JSON.stringify(attestation)):bytes}),log:()=>{}};
 await autonomousScanCycle({...args,env:{...args.env,MARKETING_EMERGENCY_STOP:'true'}});
 return {...f,args,intake,actions:()=>actions};
}
test('DESTINATION_DISCOVERY_CONTINUES_AFTER_FIRST_VALID_ROUTE',()=>{
 const formation=scan.records[0],routes=openRouteScout({formation,directory,authorizedAccounts:['EMRADAR-X-OROKNOWS']});
 assert(routes.candidates.some(d=>d.destination_id==='REUTERS-BREAKINGVIEWS-GUEST'));
 assert(routes.candidates.some(d=>d.destination_id==='HYDROCARBON-ENGINEERING-EDITORIAL'));
 assert(routes.candidates.some(d=>d.destination_id==='MARINELINK-EDITORIAL-INQUIRY'));
 assert.equal(routes.discovered.length,directory.destinations.length);
 const one=openRouteScout({formation,directory:{destinations:directory.destinations.filter(d=>d.destination_id==='REUTERS-BREAKINGVIEWS-GUEST')}});
 assert.equal(one.candidates.length,1);
});
test('DESTINATION_SPECIFIC_PROPOSITIONS',()=>{
 const formation=scan.records[0],routes=openRouteScout({formation,directory,authorizedAccounts:['EMRADAR-X-OROKNOWS']});
 const briefs=prepareRouteAssets({formation,candidates:routes.candidates});
 const hydro=briefs.find(b=>b.destination_id==='HYDROCARBON-ENGINEERING-EDITORIAL'),marine=briefs.find(b=>b.destination_id==='MARINELINK-EDITORIAL-INQUIRY');
 assert.notEqual(hydro.angle,marine.angle);assert.match(hydro.angle,/refining/);assert.match(marine.angle,/tanker/);
});
test('X_PREMIUM_DOES_NOT_FAIL_OBSOLETE_SHORT_COPY_RULE',async()=>{
 const f=await setup();const result=await autonomousScanCycle(f.args),x=result.package.proposals.find(p=>p.platform==='X');
 assert(x,x?.status||JSON.stringify(result.package.blockers));assert(x.copy.length>280);assert(x.copy.includes(scan.records[0].evidence[0].fact));assert.equal(f.actions(),0);
});
test('VALID_SCAN_ALWAYS_PRODUCES_X_REVIEW_BRANCH',async()=>{
 const f=await setup(),result=await autonomousScanCycle(f.args);
 assert(result.package.proposals.some(p=>p.destination==='EMRADAR-X-OROKNOWS'));
 assert(result.package.proposals.some(p=>p.destination==='REUTERS-BREAKINGVIEWS-GUEST'));assert.equal(f.actions(),0);
});
test('X_WITHOUT_SOURCE_IMAGE_GENERATES_EVIDENCE_VISUAL',async()=>{
 const f=await setup(),result=await autonomousScanCycle(f.args),x=result.package.proposals.find(p=>p.platform==='X');
 assert(x,JSON.stringify(result.package.blockers));assert.equal(x.asset.mime,'image/png');assert.equal(x.asset.generated,true);
 const info=await sharp(Buffer.from(x.asset.base64,'base64')).metadata();assert.equal(info.width,1200);assert(info.height>300);
 const signal=(await f.intake.products()).EMRADAR.signals.find(s=>s.id===x.asset.lineage.signal_id);const bound=Object.values(signal.causal_chain).flat().concat(signal.source_uncertainty);
 assert(x.asset.lineage.blocks.flatMap(b=>b.texts).every(t=>bound.includes(t)));assert.equal(f.actions(),0);
});
test('X_REQUIRES_COPY_AND_VISUAL',async()=>{
 const signal={id:'test',revision:'r1',state:'CONFIRMED',evidence:['E1'],source_facts:[{id:'E1',text:'An asset exists.'}],source_uncertainty:['Output is unresolved.']};
 const visual=await evidenceVisual(signal,null);const asset={...visual,copy:nativeXCopy(signal).copy};
 assert(validateCombinedX(asset,signal,null));assert.throws(()=>validateCombinedX({copy:asset.copy},signal,null),/COPY_AND_VISUAL/);
 assert.throws(()=>validateCombinedX(visual,signal,null),/COPY_AND_VISUAL/);assert.throws(()=>validateCombinedX({...asset,base64:'tampered'},signal,null),/HASH/);
});
test('X_UNKNOWN_DISTRIBUTION_COST_PRESERVES_REVIEW_ARTIFACT',async()=>{
 const f=await setup(),result=await autonomousScanCycle(f.args),x=result.package.proposals.find(p=>p.platform==='X');
 assert(x,JSON.stringify(result.package.blockers));assert.equal(x.cost_state,'UNKNOWN');assert.equal(x.distribution_cost_state,'UNKNOWN');assert.equal(x.distribution_state,'BLOCKED_PENDING_COST_RESOLUTION');
 const engine=await f.args.engineFactory(),attempt=await engine.approvePublication({proposal_id:x.proposal_id,review_hash:x.review_hash});
 assert.equal(attempt.blocker,'ACTUAL_COST_BOUND_UNKNOWN');assert.equal(f.actions(),0);
});
test('HUMAN_CORRESPONDENCE_REQUIRES_RECIPIENT_AGENCY',()=>{
 const p=correspondenceProbe(),draft=structuredClone(p.email.proposition),old=draft.correspondence.question;
 draft.correspondence.question='Could this logistics bottleneck reverse soon, easing fuel cost inflation?';draft.body=draft.body.replace(old,draft.correspondence.question);
 assert.throws(()=>validateCorrespondenceProposition(draft,p.route),/RECIPIENT_AGENCY/);assert.doesNotThrow(()=>validateCorrespondenceProposition(p.email.proposition,p.route));
});
test('PRODUCTION_SHAPED_PATH_STOPS_AT_PUBLICATION_REVIEW',async()=>{
 const f=await setup(),first=await autonomousScanCycle(f.args);
 assert.equal(first.status,'AWAITING_REVIEW',JSON.stringify(first.package.blockers));assert.equal(first.package.required_stop,'PUBLICATION_REVIEW');assert.equal(first.external_actions,0);assert.equal(f.actions(),0);
 assert.equal(first.package.proposals.filter(p=>p.platform==='X').length,1);assert(first.package.proposals.find(p=>p.platform==='X').asset.combined_review_artifact);
 const external=first.package.proposals.filter(p=>p.platform!=='X');assert(external.length>1&&external.length<=5);assert.equal(new Set(external.map(p=>p.copy)).size,external.length);
 const second=await autonomousScanCycle(f.args);assert(second.duplicate);assert.deepEqual(first.package.proposals.map(p=>p.proposal_id),second.package.proposals.map(p=>p.proposal_id));
 // An incomplete old review checkpoint is refreshed by the same signed autonomous entry, preserving campaign identity.
 const key='autonomous_scan:'+scan.snapshot_date+':'+first.package.source_sha256,state=await f.store.get(key);
 const original=external.find(p=>p.destination==='REUTERS-BREAKINGVIEWS-GUEST');
 const legacy={...original,proposal_id:'f'.repeat(64),review_hash:'e'.repeat(64),review_contract_revision:'old'};
 await f.store.put('publication_review:'+legacy.proposal_id,legacy);
 await f.store.put('receipt_index',first.package.proposals.map(p=>({product:'EMRADAR',campaign_id:first.campaign_id,signal_id:first.package.formation.id,signal_revision:p.signal_revision,destination:p.destination,proposal_id:p.destination===legacy.destination?legacy.proposal_id:p.proposal_id,execution_status:'AWAITING_REVIEW'})));
 await f.store.put(key,{...state,review_contract_revision:'old',routes:{},status:'AWAITING_REVIEW'});
 const resumed=await autonomousScanCycle(f.args);assert.equal(resumed.campaign_id,first.campaign_id);assert.equal(resumed.status,'AWAITING_REVIEW');assert.equal(resumed.package.review_contract_revision,reviewContractRevision);assert.equal(f.actions(),0);const superseded=await f.store.get('publication_review:'+legacy.proposal_id);assert.equal(superseded.status,'SUPERSEDED');assert(resumed.package.proposals.some(p=>p.replaces_proposal_id===legacy.proposal_id));
});
