import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import vm from 'node:vm';
import {createReviewAuth} from '../../runtime/review-auth.js';
import {fixture} from './fixture.js';
import {GraphEngine} from '../../runtime/graph.js';
import {FileStore} from '../../runtime/store.js';
import {campaignReviewHtml} from '../../runtime/campaign-review-html.js';
const source=await fs.readFile(new URL('../../server.js',import.meta.url),'utf8');
const start=source.indexOf("  if(u.pathname==='/PUBLICATION_REVIEW/session'");
const end=source.indexOf('  if(req.method==="POST"&&["/RUN_MARKETING"',start);
const route=source.slice(start,end);
test('one owner credential authenticates exact approval/rejection across restart; handoff is durable without sending',async t=>{
 const f=await fixture();for(const d of f.p.destinations)d.platform='EXTERNAL';
 const engine=new GraphEngine({store:f.store,products:{TEST_PRODUCT:f.p},adapters:{EXTERNAL:f.adapter}});
 const run=await engine.run(f.input),p=await f.store.get('publication_review:'+run.review.proposal_id);
 const asset=JSON.stringify(p.asset);p.preview_warnings=[{reason:'LOW_ROUTE_SCORE'},{reason:'EDITORIAL_FIT'}];p.status='BLOCKED';await f.store.put('publication_review:'+p.proposal_id,p);
 let auth=createReviewAuth({secret:'test-owner',origin:()=> 'https://review.test'}),handoffs=0;
 const handler=vm.runInNewContext('(async(req,res,u)=>{'+route+'res.writeHead(404);res.end();})',{
 reviewAuth:{configured:()=>auth.configured(),establish:(req,res)=>auth.establish(req,res)},authorizedPublicationReview:req=>auth.authorized(req),
 json:(res,status,value)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value));},
 readBody:async req=>{const chunks=[];for await(const c of req)chunks.push(c);return Buffer.concat(chunks);},
 marketingEngine:async()=>engine,setImmediate:()=>{handoffs++;},distributionCycle:()=>{throw Error('NO_LIVE_DISTRIBUTION');}
 });
 const server=http.createServer((req,res)=>handler(req,res,new URL(req.url,'https://review.test')));
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const request=(path,options)=>fetch('http://127.0.0.1:'+server.address().port+path,options);
 let r=await request('/PUBLICATION_REVIEW/session',{method:'POST',headers:{Authorization:'Bearer wrong'}});assert.equal(r.status,403);
 r=await request('/PUBLICATION_REVIEW/session',{method:'POST',headers:{Authorization:'Bearer test-owner'}});assert.equal(r.status,200);
 const header=r.headers.get('set-cookie'),cookie=header.split(';')[0];assert.match(header,/HttpOnly; Secure; SameSite=Strict/);assert(!header.includes('test-owner'));
 auth=createReviewAuth({secret:'test-owner',origin:()=> 'https://review.test'});
 r=await request('/PUBLICATION_REVIEW/session',{headers:{Cookie:cookie}});assert.equal((await r.json()).authenticated,true);
 const approve={proposal_id:p.proposal_id,review_hash:p.review_hash,decision:'APPROVED'};
 const post=body=>({method:'POST',headers:{Cookie:cookie,Origin:'https://review.test','Content-Type':'application/json'},body:JSON.stringify(body)});
 r=await request('/PUBLICATION_REVIEW', {...post(approve),headers:{...post(approve).headers,Origin:'https://evil.test'}});assert.equal(r.status,403);
 r=await request('/PUBLICATION_REVIEW',post({...approve,review_hash:'f'.repeat(64)}));assert.equal(r.status,409);assert.equal(handoffs,0);
 for(let i=0;i<2;i++){r=await request('/PUBLICATION_REVIEW',post(approve));assert.equal(r.status,202);assert.equal((await r.json()).distribution_status,'QUEUED');}
 const reopened=new FileStore(f.store.directory);assert.equal((await reopened.get('publication_approval:'+p.proposal_id)).status,'OWNER_APPROVED');
 assert.equal((await f.store.keys('distribution_work:')).length,1);assert.equal(JSON.stringify((await f.store.get('publication_review:'+p.proposal_id)).asset),asset);assert.equal(handoffs,2);
 const h=campaignReviewHtml({proposals:[p],owner_decisions:{[p.proposal_id]:{status:'OWNER_APPROVED'}}},'EMRADAR_2026_10_09_LAUNCH');assert.match(h,/OWNER_APPROVED/);assert.match(h,/data-decision="APPROVED" disabled/);assert(!h.includes('OWNER OVERRIDE'));
 r=await request('/PUBLICATION_REVIEW',post({...approve,decision:'REJECTED',reason:'Owner declined'}));assert.equal(r.status,200);assert.equal((await f.store.get('publication_review:'+p.proposal_id)).status,'REJECTED');assert.equal(await f.store.get('publication_approval:'+p.proposal_id),null);assert.equal(handoffs,2);
});
test('session expiry, tampering, missing configuration and secret rotation fail closed',()=>{
 let now=1000000,cookie;
 const req={method:'POST',headers:{authorization:'Bearer test-owner',origin:'https://review.test'}};
 const auth=createReviewAuth({secret:'test-owner',origin:()=> 'https://review.test',clock:()=>now});auth.establish(req,{setHeader:(_n,v)=>cookie=v.split(';')[0]});
 const saved={method:'GET',headers:{cookie}};assert(auth.authorized(saved));assert(!auth.authorized({...saved,headers:{cookie:cookie+'x'}}));
 assert(!createReviewAuth({secret:'rotated',origin:()=>'',clock:()=>now}).authorized(saved));assert(!createReviewAuth({secret:'',origin:()=>''}).authorized(req));
 now+=31*86400000;assert(!auth.authorized(saved));
});
