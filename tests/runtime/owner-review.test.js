import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import {createOwnerReview} from '../../runtime/owner-review.js';
const pkg={campaign_id:'EMRADAR_2026_10_07_LAUNCH',status:'AWAITING_REVIEW',external_actions:0,proposals:[{destination:'Editorial',copy:'Hello <script>alert(1)</script>',asset:{email:{subject:'Saved title',body:'Complete saved body'},delivery:{recipient:'editor@example.test'}},evidence_refs:['source-1']}]};
async function fixture(t,options={}){
 let reads=0,attempts=0,clock=Date.now();
 const handler=createOwnerReview({password:()=>options.missing?undefined:'test-only-password',getPackage:async()=>{reads++;return pkg;},limitAttempt:async()=>++attempts<=2,now:()=>clock});
 const server=http.createServer((req,res)=>handler(req,res,new URL(req.url,'https://'+req.headers.host)));
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const base='http://127.0.0.1:'+server.address().port;
 const request=(path,opts={})=>fetch(base+path,{redirect:'manual',...opts});
 const login=()=>request('/owner-review/login',{method:'POST',headers:{origin:base.replace('http:','https:'),'content-type':'application/x-www-form-urlencoded'},body:'password=test-only-password'});
 return {origin:base.replace('http:','https:'),request,login,reads:()=>reads,expire:()=>clock+=9*3600000};
}
test('no-shell failure is retained; owner login provides complete persisted package without internal token',async t=>{
 const f=await fixture(t);let r=await f.request('/owner-review/package');assert.equal(r.status,403);assert.equal((await r.json()).reason,'OWNER_PUBLICATION_REVIEW_AUTH_REQUIRED');assert.equal(f.reads(),0);
 r=await f.login();assert.equal(r.status,303);const c=r.headers.get('set-cookie');for(const flag of ['Secure','HttpOnly','SameSite=Strict'])assert.ok(c.includes(flag));assert.ok(!c.includes('test-only-password'));
 r=await f.request('/owner-review/package?campaign_id='+pkg.campaign_id,{headers:{cookie:c.split(';')[0]}});assert.deepEqual(await r.json(),pkg);assert.equal(f.reads(),1);
});
test('review session cannot mutate, approve, reject or distribute',async t=>{
 const f=await fixture(t);const cookie=(await f.login()).headers.get('set-cookie').split(';')[0];
 for(const path of ['/owner-review','/owner-review/package','/owner-review/approve','/owner-review/reject','/owner-review/distribute']){const r=await f.request(path,{method:'POST',headers:{cookie},body:'APPROVED'});assert.ok([404,405].includes(r.status));}
 assert.equal(f.reads(),0);
 const server=await fs.readFile(new URL('../../server.js',import.meta.url),'utf8');assert.match(server,/if\(u.pathname==='\/PUBLICATION_REVIEW'&&\['GET','POST'\].includes\(req.method\)\)\{\s*if\(!authorizedPublicationReview\(req\)\)/);assert.match(server,/function authorizedPublicationReview\(req\)\{\s*const secret=process.env.MARKETING_PUBLICATION_REVIEW_TOKEN/);
});
test('forged and expired sessions cannot read state',async t=>{
 const f=await fixture(t);const cookie=(await f.login()).headers.get('set-cookie').split(';')[0];
 assert.equal((await f.request('/owner-review/package',{headers:{cookie:cookie.slice(0,-1)+'z'}})).status,403);f.expire();assert.equal((await f.request('/owner-review/package',{headers:{cookie}})).status,403);assert.equal(f.reads(),0);
});
test('cross-site login and wrong password fail without secret disclosure',async t=>{
 const f=await fixture(t);let r=await f.request('/owner-review/login',{method:'POST',headers:{origin:'https://attacker.test','content-type':'application/x-www-form-urlencoded'},body:'password=test-only-password'});assert.equal(r.status,403);
 r=await f.request('/owner-review/login',{method:'POST',headers:{origin:f.origin,'content-type':'application/x-www-form-urlencoded'},body:'password=wrong'});assert.equal(r.status,401);assert.ok(!(await r.text()).includes('test-only-password'));assert.equal(f.reads(),0);
});
test('rate limit bounds login attempts and missing configuration fails closed',async t=>{
 const f=await fixture(t);await f.login();await f.login();assert.equal((await f.login()).status,429);
 const missing=await fixture(t,{missing:true});assert.equal((await missing.request('/owner-review/package')).status,503);
});
test('complete page displays persisted copy and recipient with no executable artifact content',async t=>{
 const f=await fixture(t);const cookie=(await f.login()).headers.get('set-cookie').split(';')[0];const r=await f.request('/owner-review/view?campaign_id='+pkg.campaign_id,{headers:{cookie}});const html=await r.text();assert.ok(html.includes('Complete saved body'));assert.ok(html.includes('editor@example.test'));assert.ok(!html.includes('<script>'));assert.ok(html.includes('&lt;script&gt;'));assert.ok(!html.includes('test-only-password'));assert.ok(r.headers.get('content-security-policy').includes("default-src 'none'"));assert.equal(f.reads(),1);
});

test('normal browser entry GET without Origin or form content type serves login HTML directly',async t=>{
 const f=await fixture(t);
 const r=await f.request('/owner-review',{headers:{'sec-fetch-mode':'navigate','sec-fetch-dest':'document','sec-fetch-site':'none','user-agent':'Mozilla/5.0'}});
 assert.equal(r.status,200);assert.match(r.headers.get('content-type'),/^text\/html/);
 assert.equal(r.headers.get('location'),null);
 const body=await r.text();assert.ok(body.includes('<form method="post" action="/owner-review/login">'));
 assert.ok(body.includes('type="password"'));assert.ok(!body.includes('SAME_ORIGIN_FORM_REQUIRED'));
 assert.ok(!body.includes('test-only-password'));assert.equal(f.reads(),0);
});
test('login POST still requires same-origin form headers before credentials are processed',async t=>{
 const f=await fixture(t);
 for(const headers of [{},{origin:'https://attacker.test','content-type':'application/x-www-form-urlencoded'},{origin:f.origin,'content-type':'application/json'}]){
 const r=await f.request('/owner-review/login',{method:'POST',headers,body:''});
 assert.equal(r.status,403);assert.equal((await r.json()).reason,'SAME_ORIGIN_FORM_REQUIRED');
 }
 assert.equal(f.reads(),0);
});

test('public entry GET remains form-only with no Origin, Referer or authentication and with an authenticated cookie',async t=>{
 const f=await fixture(t);
 const cookie=(await f.login()).headers.get('set-cookie').split(';')[0];
 for(const headers of [{},{cookie}]){
  const r=await f.request('/owner-review?campaign_id='+pkg.campaign_id,{headers});
  assert.equal(r.status,200);assert.match(r.headers.get('content-type'),/^text\/html/);
  const html=await r.text();assert.ok(html.includes('type="password"'));
  for(const value of [pkg.campaign_id,'Complete saved body','editor@example.test','test-only-password','MARKETING_PUBLICATION_REVIEW_TOKEN','SAME_ORIGIN_FORM_REQUIRED'])assert.ok(!html.includes(value));
 }
 assert.equal(f.reads(),0);
});
test('public entry precedes password configuration; protected view still requires authentication',async t=>{
 const f=await fixture(t,{missing:true});
 const r=await f.request('/owner-review');assert.equal(r.status,200);assert.ok((await r.text()).includes('<form'));
 const configured=await fixture(t);assert.equal((await configured.request('/owner-review/view')).status,403);assert.equal(configured.reads(),0);
});
test('same-origin login retains authentication and redirects only to protected read-only view',async t=>{
 const f=await fixture(t);const r=await f.login();assert.equal(r.status,303);assert.equal(r.headers.get('location'),'/owner-review/view');
 const cookie=r.headers.get('set-cookie').split(';')[0];
 assert.equal((await f.request('/owner-review/view',{method:'POST',headers:{cookie},body:''})).status,405);
 assert.equal(f.reads(),0);
});
