import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {campaignReviewHtml,equivalentEmailGroups} from '../../runtime/campaign-review-html.js';
import {FileStore} from '../../runtime/store.js';
import {createV2Runtime} from '../../runtime/v2-integration.js';
import {groupedReviewFixture} from './grouped-review-fixture.js';

const options={v2:true,decisionPath:'/V2/PUBLICATION_REVIEW'};
test('69 saved proposals become four equivalent email groups and one individual X asset without mutation',()=>{
 const record=groupedReviewFixture(),before=JSON.stringify(record),groups=equivalentEmailGroups(record.proposals);
 assert.equal(groups.filter(g=>g.email).length,4);assert.equal(groups.filter(g=>!g.email).length,1);assert.equal(groups.flatMap(g=>g.proposals).length,69);
 assert.deepEqual(new Set(groups.flatMap(g=>g.proposals.map(p=>p.proposal_id))),new Set(record.proposals.map(p=>p.proposal_id)));
 assert.deepEqual(groups.filter(g=>g.email).map(g=>g.proposals.length),[17,17,17,17]);
 const html=campaignReviewHtml(record,record.campaign_id,options);assert.equal((html.match(/class="decisions"/g)||[]).length,69);assert.match(html,/Distinct email groups:<\/strong> 4/);assert.match(html,/Exact saved X text/);assert.match(html,/data:image\/png;base64,c2F2ZWQ=/);assert.match(html,/Uncertainty retained/);
 for(const p of record.proposals){assert(html.includes('data-id="'+p.proposal_id+'"'));assert(html.includes('data-hash="'+p.review_hash+'"'));if(p.asset.email)assert(html.includes(p.asset.email.to));}
 assert.equal(JSON.stringify(record),before);
 const reversed=equivalentEmailGroups(record.proposals.slice().reverse()).filter(g=>g.email);assert.deepEqual(new Set(reversed.map(g=>g.id)),new Set(groups.filter(g=>g.email).map(g=>g.id)));
 for(const g of reversed)assert.equal(g.proposals[0].proposal_id,groups.find(x=>x.id===g.id).proposals[0].proposal_id);
});
test('different claims, evidence, angles, requests, wording, presentation and attachments never coalesce',()=>{
 const members=equivalentEmailGroups(groupedReviewFixture().proposals).find(g=>g.email).proposals;
 for(const change of [p=>p.asset.email.body+=' New claim.',p=>p.binding.evidence.references=['different-source'],p=>p.asset.email.subject+=' Different angle',p=>p.asset.email.body=p.asset.email.body.replace('research contribution','interview'),p=>p.asset.email.html+='<p>Additional qualification</p>',p=>p.asset.attachments=[{filename:'evidence.pdf',content:'different-bytes'}]]){
  const p=structuredClone(members[1]);change(p);assert.equal(equivalentEmailGroups([members[0],p]).length,2);
 }
 const first=structuredClone(members[0]),second=structuredClone(members[1]);first.asset.email.body+='\n\nPublication 0 reports a new investment.';second.asset.email.body+='\n\nPublication 4 reports a new investment.';assert.equal(equivalentEmailGroups([first,second]).length,2);
});
test('identical manual correspondence groups while article and X assets remain separate',()=>{
 const p=groupedReviewFixture().proposals[0],manual={...p,asset:{...p.asset,delivery_method:'MANUAL'}},article={...p,asset:{...p.asset,article:{title:'Article',body:'Body'}}};
 assert.equal(equivalentEmailGroups([manual,manual,article,article]).length,3);
});

// Execute the actual embedded browser handlers against a minimal DOM and local protected runtime.
function browser(record,request){
 const groupNodes=equivalentEmailGroups(record.proposals).filter(g=>g.email).map(g=>{
  const group={dataset:{group:g.id},result:{textContent:''},reason:{value:''},members:{open:false},labels:new Map(),buttons:[],decisions:[]};
  group.querySelector=selector=>selector==='.group-result'?group.result:selector==='.group-reason'?group.reason:selector==='.members'?group.members:group.labels.get(selector.match(/data-member-status="([^"]+)"/)?.[1]);
  group.querySelectorAll=selector=>selector==='.decisions'?group.decisions:selector.includes('data-group-revision')?[...group.buttons,group.revision]:group.buttons;
  group.revision={dataset:{groupRevision:''},disabled:false,closest:()=>group};
  group.buttons=['APPROVE','REJECT'].map(decision=>({dataset:{groupDecision:decision},disabled:false,closest:()=>group}));
  group.decisions=g.proposals.map(p=>{
   const status=record.owner_decisions[p.proposal_id]?.status,settled=['OWNER_APPROVED','REJECTED','SUBMITTED'].includes(status),d={dataset:{id:p.proposal_id,hash:p.review_hash,settled:String(settled),previous:status==='OWNER_APPROVED'?'APPROVE':status==='REJECTED'?'REJECT':''},result:{textContent:status||''},reason:{value:''}};
   d.buttons=['APPROVE','REJECT'].map(decision=>({dataset:{decision},disabled:settled,closest:()=>d}));d.revision={dataset:{revision:''},disabled:false,closest:()=>d};d.override={dataset:{override:''},disabled:false,hidden:!settled,closest:()=>d};d.querySelector=selector=>selector==='.result'?d.result:selector==='button[data-revision]'?d.revision:selector==='button[data-override]'?d.override:d.reason;d.querySelectorAll=()=>d.buttons;d.closest=()=>group;group.labels.set(p.proposal_id,{textContent:status||''});return d;
  });
  if(group.decisions.every(d=>d.dataset.settled==='true'))group.buttons.forEach(b=>b.disabled=true);return group;
 });
 const nodes={authentication:{hidden:false},credential:{value:'',addEventListener(){}},'auth-status':{textContent:''},'remaining-actions':{textContent:''},'remaining-members':{textContent:''}},requests=[];
 const document={getElementById:id=>nodes[id],querySelectorAll:selector=>selector==='button[data-decision]'?groupNodes.flatMap(g=>g.decisions.flatMap(d=>d.buttons)):selector==='button[data-group-decision]'?groupNodes.flatMap(g=>g.buttons):selector==='.decisions'?groupNodes.flatMap(g=>g.decisions):selector==='button[data-revision]'?groupNodes.flatMap(g=>g.decisions.map(d=>d.revision)):selector==='button[data-override]'?groupNodes.flatMap(g=>g.decisions.map(d=>d.override)):selector==='button[data-group-revision]'?groupNodes.map(g=>g.revision):[]};
 const fetch=async(url,init)=>{if(url==='/PUBLICATION_REVIEW/session')return {json:async()=>({authenticated:true,configured:true})};assert.equal(url,'/V2/PUBLICATION_REVIEW');assert.equal(init.credentials,'same-origin');const payload=JSON.parse(init.body);requests.push(payload);return request(payload);};
 const html=campaignReviewHtml(record,record.campaign_id,options),script=html.slice(html.indexOf('<script>')+8,html.indexOf('</script>'));
 vm.runInNewContext(script,{document,fetch,confirm:()=>true,Map,Set,Error});return {groups:groupNodes,requests,nodes};
}
async function local(record){
 const store=new FileStore(await fs.mkdtemp(path.join(os.tmpdir(),'group-review-'))),deliveries=new Map();
 for(const p of record.proposals)await store.put('v2:review:'+p.proposal_id,p);
 const runtime=await createV2Runtime({store,integrationModule:{destinations:[],assetBuilder:()=>{throw Error('NO_GENERATION');}},editorialAdapter:{publish:async(asset,key)=>{deliveries.set(key,(deliveries.get(key)||0)+1);return {id:'fake-provider-'+key,status:'SUBMITTED',provider_receipt:{test_only:true}};}}});
 const request=async payload=>{try{const value=await runtime.decide(payload,'Bearer fixture-owner');return {ok:true,json:async()=>value};}catch(e){return {ok:false,json:async()=>({reason:e.message})};}};
 return {store,runtime,request,deliveries};
}
function smallRecord(){const r=groupedReviewFixture();r.proposals=equivalentEmailGroups(r.proposals).find(g=>g.email).proposals.slice(0,3);return r;}
async function ownerTest(fn){const saved=process.env.MARKETING_PUBLICATION_REVIEW_TOKEN;process.env.MARKETING_PUBLICATION_REVIEW_TOKEN='fixture-owner';try{await fn();}finally{if(saved===undefined)delete process.env.MARKETING_PUBLICATION_REVIEW_TOKEN;else process.env.MARKETING_PUBLICATION_REVIEW_TOKEN=saved;}}

test('group approval persists exact individual decisions, reports partial failures, resumes and protects rejection',()=>ownerTest(async()=>{
 const record=smallRecord(),f=await local(record),rejected=record.proposals[0];await f.runtime.engine.decide({...rejected,decision:'REJECT'});record.owner_decisions[rejected.proposal_id]={status:'REJECTED'};const original=await f.store.get('v2:decision:'+rejected.proposal_id);let failed=false;
 const ui=browser(record,async payload=>{if(payload.proposal_id===record.proposals[1].proposal_id&&!failed){failed=true;return {ok:false,json:async()=>({reason:'TEMPORARY_FAILURE'})};}return f.request(payload);}),g=ui.groups[0];
 await g.buttons[0].onclick();assert.match(g.result.textContent,/1 saved; 1 already decided; 1 failed/);assert.equal(g.members.open,true);assert.equal(f.deliveries.size,1);
 await g.buttons[0].onclick();assert.match(g.result.textContent,/1 saved; 2 already decided; 0 failed/);assert.equal(f.deliveries.size,2);assert([...f.deliveries.values()].every(n=>n===1));assert.deepEqual(await f.store.get('v2:decision:'+rejected.proposal_id),original);
 for(const p of record.proposals.slice(1)){const d=await f.store.get('v2:decision:'+p.proposal_id);assert.equal(d.review_hash,p.review_hash);assert.equal(d.decision,'APPROVE');}
 assert.equal(ui.requests.length,3);await g.buttons[0].onclick();assert.equal(ui.requests.length,3);
 const refreshed={...record,owner_decisions:Object.fromEntries(record.proposals.map(p=>[p.proposal_id,{status:p===rejected?'REJECTED':'OWNER_APPROVED'}]))};const fresh=browser(refreshed,f.request);await fresh.groups[0].buttons[0].onclick();assert.equal(fresh.requests.length,0);
}));
test('individual approval and group rejection retain separate decisions and reject changed hashes',()=>ownerTest(async()=>{
 const record=smallRecord(),f=await local(record),ui=browser(record,f.request),g=ui.groups[0];const first=g.decisions[0];await first.buttons[0].onclick();assert.equal(f.deliveries.size,1);
 g.reason.value='Owner rejected this correspondence';await g.buttons[1].onclick();assert.equal(f.deliveries.size,1);const saved=await Promise.all(record.proposals.map(p=>f.store.get('v2:decision:'+p.proposal_id)));assert.equal(saved.filter(d=>d.decision==='APPROVE').length,1);assert.equal(saved.filter(d=>d.decision==='REJECT').length,2);assert(ui.requests.filter(p=>p.decision==='REJECT').every(p=>p.reason===g.reason.value));
 const changed=smallRecord(),other=await local(changed),p=changed.proposals[1],persisted=await other.store.get('v2:review:'+p.proposal_id);persisted.binding.asset.email.body+=' changed';await other.store.put('v2:review:'+p.proposal_id,persisted);const second=browser(changed,other.request);await second.groups[0].buttons[0].onclick();assert.match(second.groups[0].result.textContent,/1 failed/);assert.equal(await other.store.get('v2:decision:'+p.proposal_id),null);assert.equal(other.deliveries.size,2);
}));
test('duplicate clicks and a lost response cannot repeat a provider-confirmed delivery',()=>ownerTest(async()=>{
 const record=smallRecord(),f=await local(record);let lose=true;const ui=browser(record,async payload=>{const response=await f.request(payload);if(lose){lose=false;throw Error('response lost after persistence');}return response;}),g=ui.groups[0];
 await Promise.all([g.buttons[0].onclick(),g.buttons[0].onclick()]);assert.match(g.result.textContent,/1 failed/);assert.equal(f.deliveries.size,3);await g.buttons[0].onclick();assert.equal(f.deliveries.size,3);assert([...f.deliveries.values()].every(n=>n===1));
}));

test('greetings, publication names and closings are editorial identity while transport differences are not',()=>{
 const members=smallRecord().proposals;
 assert.equal(equivalentEmailGroups(members).length,1);
 for(const alter of [p=>p.asset.email.body=p.asset.email.body.replace('Hi Editor,','Hi Jane,'),p=>p.asset.email.body=p.asset.email.body.replace(/Publication/g,'Another publication'),p=>p.asset.email.body+='\nDifferent closing']){
  const p=structuredClone(members[1]);alter(p);assert.equal(equivalentEmailGroups([members[0],p]).length,2);
 }
 const p=structuredClone(members[1]);p.asset.to='another@example.test';p.asset.email.to=p.asset.to;p.asset.delivery.public_contact_point=p.asset.to;p.asset.recipient_status='OTHER_TRANSPORT_METADATA';
 assert.equal(equivalentEmailGroups([members[0],p]).length,1);
});
test('remaining actions count distinct undecided groups and updates after group rejection',()=>ownerTest(async()=>{
 const record=smallRecord(),f=await local(record);
 const initial=campaignReviewHtml(record,record.campaign_id,options);
 assert.match(initial,/id="remaining-actions">1<\/span>/);assert.match(initial,/id="remaining-members">3<\/span>/);
 const ui=browser(record,f.request),g=ui.groups[0];g.reason.value='Unsuitable';await g.buttons[1].onclick();
 assert.equal(ui.nodes['remaining-actions'].textContent,0);assert.equal(ui.nodes['remaining-members'].textContent,0);assert.equal(f.deliveries.size,0);
}));
test('group revision persists requests only for undecided members and survives duplicate clicks',()=>ownerTest(async()=>{
 const record=smallRecord(),f=await local(record),p=record.proposals[0];await f.runtime.engine.decide({...p,decision:'REJECT'});record.owner_decisions[p.proposal_id]={status:'REJECTED'};
 const before=await f.runtime.review(p.proposal_id),decision=await f.store.get('v2:decision:'+p.proposal_id),ui=browser(record,f.request),g=ui.groups[0];g.reason.value='Explain the evidence in natural language.';
 await g.revision.onclick();await g.revision.onclick();
 assert.equal((await f.store.keys('v2:revision-request:')).length,2);assert.match(g.result.textContent,/2 revision requests saved; 1 already decided/);
 const member=record.proposals[1],revision=await f.store.get('v2:revision-latest:'+member.proposal_id);assert.equal(revision.reason,g.reason.value);
 const restored={...record,owner_decisions:{...record.owner_decisions,[member.proposal_id]:{revision}}};assert.match(campaignReviewHtml(restored,record.campaign_id,options),/Revision requested: Explain the evidence in natural language/);
 assert.deepEqual(await f.runtime.review(p.proposal_id),before);assert.deepEqual(await f.store.get('v2:decision:'+p.proposal_id),decision);assert.equal(f.deliveries.size,0);
 for(const other of record.proposals.slice(1))assert.equal(await f.store.get('v2:decision:'+other.proposal_id),null);
}));
test('explicit individual override preserves its hash and audit history and never changes other members',()=>ownerTest(async()=>{
 const record=smallRecord(),f=await local(record),p=record.proposals[0];await f.runtime.engine.decide({...p,decision:'APPROVE'});record.owner_decisions[p.proposal_id]={status:'OWNER_APPROVED'};
 const old=await f.store.get('v2:decision:'+p.proposal_id),ui=browser(record,f.request),d=ui.groups[0].decisions[0];d.reason.value='Owner changed this individual assessment.';await d.override.onclick();
 const saved=await f.store.get('v2:decision:'+p.proposal_id);assert.equal(saved.decision,'REJECT');assert.equal(saved.review_hash,p.review_hash);assert.deepEqual(saved.history,[old]);
 assert.equal((await f.store.get('v2:work:'+p.proposal_id)).status,'CANCELLED_BY_OWNER');assert.equal(f.deliveries.size,0);assert.match(d.result.textContent,/Individual override saved/);
 for(const other of record.proposals.slice(1))assert.equal(await f.store.get('v2:decision:'+other.proposal_id),null);
}));
test('overrides reject stale decisions, altered bindings, delivery records and unavailable owner authentication',()=>ownerTest(async()=>{
 const record=smallRecord(),f=await local(record),p=record.proposals[0];await f.runtime.engine.decide({...p,decision:'REJECT'});
 const input={proposal_id:p.proposal_id,review_hash:p.review_hash,action:'OVERRIDE',previous_decision:'REJECT',decision:'APPROVE',reason:'Explicit owner change'};
 await assert.rejects(()=>f.runtime.decide(input,'Bearer wrong'),/OWNER_PUBLICATION_REVIEW_AUTH_REQUIRED/);
 await assert.rejects(()=>f.runtime.decide({...input,previous_decision:'APPROVE'},'Bearer fixture-owner'),/OWNER_DECISION_CHANGED/);
 const saved=await f.runtime.review(p.proposal_id);await f.store.put('v2:receipt:'+saved.delivery_key,{execution_status:'SUBMITTED',external_id:'confirmed'});
 await assert.rejects(()=>f.runtime.decide(input,'Bearer fixture-owner'),/DELIVERY_RECORD_PROTECTED/);
 await f.store.del('v2:receipt:'+saved.delivery_key);saved.asset.email.body+=' changed';await f.store.put('v2:review:'+p.proposal_id,saved);
 await assert.rejects(()=>f.runtime.decide(input,'Bearer fixture-owner'),/REVIEW_ASSET_CHANGED/);
 assert.equal((await f.store.get('v2:decision:'+p.proposal_id)).decision,'REJECT');assert.equal(f.deliveries.size,0);
}));
test('approved individual override authorizes once and preserves provider duplicate protection',()=>ownerTest(async()=>{
 const record=smallRecord(),f=await local(record),p=record.proposals[0];await f.runtime.engine.decide({...p,decision:'REJECT'});
 const input={proposal_id:p.proposal_id,review_hash:p.review_hash,action:'OVERRIDE',previous_decision:'REJECT',decision:'APPROVE',reason:'Explicit owner approval'};
 await f.runtime.decide(input,'Bearer fixture-owner');await f.runtime.decide(input,'Bearer fixture-owner');assert.equal(f.deliveries.size,1);assert([...f.deliveries.values()].every(n=>n===1));
}));
test('an active distribution lease prevents override without changing authority',()=>ownerTest(async()=>{
 const record=smallRecord(),f=await local(record),p=record.proposals[0];await f.runtime.engine.decide({...p,decision:'REJECT'});const prior=await f.store.get('v2:decision:'+p.proposal_id);
 await f.store.leased('v2:distribution',async()=>assert.rejects(()=>f.runtime.decide({proposal_id:p.proposal_id,review_hash:p.review_hash,action:'OVERRIDE',previous_decision:'REJECT',decision:'APPROVE',reason:'Explicit owner approval'},'Bearer fixture-owner'),/DISTRIBUTION_IN_PROGRESS_RETRY_REVIEW_ACTION/));
 assert.deepEqual(await f.store.get('v2:decision:'+p.proposal_id),prior);assert.equal(f.deliveries.size,0);
}));

