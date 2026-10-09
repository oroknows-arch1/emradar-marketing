import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import http from 'node:http';
const source=await fs.readFile(new URL('../../server.js',import.meta.url),'utf8');
const start=source.indexOf("  if(u.pathname==='/PUBLICATION_REVIEW'&&['GET','POST'].includes(req.method)){");
const end=source.indexOf('  if(req.method==="POST"&&["/RUN_MARKETING"',start);
assert(start>=0&&end>start);
const route=source.slice(start,end);
async function fixture(t){
 const pkg={campaign_id:'EMRADAR_2026_10_07_LAUNCH',status:'AWAITING_REVIEW',external_actions:0,required_stop:'PUBLICATION_REVIEW',proposals:[{proposal_id:'a'.repeat(64),review_hash:'b'.repeat(64),asset:{email:{body:'Exact reviewed correspondence',html:'<p>Exact reviewed correspondence</p>',from:{name:'Sean Walker',address:'sean@emradar.net'},replyTo:'sean@emradar.net'}},status:'AWAITING_REVIEW'}]};
 const persisted=JSON.stringify(pkg),keys=[];let mutations=0,distribution=0,engineLoads=0;
 const handler=vm.runInNewContext('(async(req,res,u)=>{'+route+'res.writeHead(404);res.end();})',{
 RedisStore:class{async get(key){keys.push(key);return key==='review_package:'+pkg.campaign_id?JSON.parse(persisted):null;}},
 store:async()=>({}),authorizedPublicationReview:()=>false,
 json:(res,status,value)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(value));},
 marketingEngine:async()=>{engineLoads++;return {approvePublication:()=>{mutations++;},rejectPublication:()=>{mutations++;}};},
 readBody:async()=>{throw Error('UNAUTHORIZED_BODY_MUST_NOT_BE_READ');},
 setImmediate:()=>{distribution++;},distributionCycle:()=>{distribution++;}
 });
 const server=http.createServer((req,res)=>handler(req,res,new URL(req.url,'https://'+req.headers.host)));
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 return {pkg,keys,request:(path,opts={})=>fetch('http://127.0.0.1:'+server.address().port+path,opts),unchanged:()=>{assert.equal(JSON.stringify(pkg),persisted);assert.equal(mutations,0);assert.equal(distribution,0);assert.equal(engineLoads,0);}};
}
test('existing package GET retrieves exact persisted campaign without login or internal credentials and cannot distribute',async t=>{
 const f=await fixture(t);const r=await f.request('/PUBLICATION_REVIEW?package=EMRADAR&campaign_id='+f.pkg.campaign_id);
 assert.equal(r.status,200);assert.deepEqual(await r.json(),{...f.pkg,execution_recovery:null});assert.deepEqual(f.keys,['review_package:'+f.pkg.campaign_id,'preparation_lock_recovery:'+f.pkg.campaign_id]);f.unchanged();
});
test('package query never bypasses owner approval or rejection authorization',async t=>{
 const f=await fixture(t);
 for(const decision of ['APPROVED','REJECTED']){
 const r=await f.request('/PUBLICATION_REVIEW?package=EMRADAR&campaign_id='+f.pkg.campaign_id,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({decision,proposal_id:'a'.repeat(64),review_hash:'b'.repeat(64)})});
 assert.equal(r.status,403);assert.equal((await r.json()).reason,'OWNER_PUBLICATION_REVIEW_AUTH_REQUIRED');
 }
 assert.deepEqual(f.keys,[]);f.unchanged();
});
test('invalid campaign and protected individual proposal access fail without reading campaign state',async t=>{
 const f=await fixture(t);
 assert.equal((await f.request('/PUBLICATION_REVIEW?package=EMRADAR&campaign_id=invalid')).status,400);
 assert.equal((await f.request('/PUBLICATION_REVIEW?proposal_id='+'a'.repeat(64))).status,403);
 assert.deepEqual(f.keys,[]);f.unchanged();
});
test('detour is absent; approval/revision/distribution/outcome guards and reviewed hash binding remain',()=>{
 assert(!/createOwnerReview|MARKETING_OWNER_REVIEW_PASSWORD|owner-review|SAME_ORIGIN_FORM_REQUIRED/.test(source));
 assert.match(route,/approvePublication\(decision\)/);assert.match(route,/rejectPublication\(decision\)/);assert.match(route,/distributionCycle\(\)/);
 for(const path of ['/PUBLICATION_REVIEW/revise','/OUTCOME_REVIEW','/PUBLICATION_REVIEW/recover-connection-timeout']){
 const i=source.indexOf("u.pathname==='"+path+"'");assert(i>=0);assert(source.slice(i,i+350).includes('authorizedPublicationReview(req)'));
 }
});
