import http from "node:http";
import crypto from "node:crypto";
import { URL, URLSearchParams } from "node:url";
import { createClient } from "redis";
import fs from 'node:fs/promises';
import { GraphEngine } from './runtime/graph.js';
import { RedisStore } from './runtime/store.js';
import {ProductIntake,loadPolicies,emradarSource,signSource} from './runtime/intake.js';
import {applyAuthority} from './runtime/authority.js';
import {loadHarness} from './runtime/harness.js';
import { xAdapter, localAdapter } from './runtime/adapters.js';
import {blueskyConnector,linkedinConnector,mastodonConnector,socialAdapter} from './runtime/social-connectors.js';
import {integrationStatus} from './runtime/integration-status.js';
import {verifySchedulerToken} from './runtime/scheduler-auth.js';
import {createXAuthorization} from './runtime/x-authorization.js';
import {xDiscoveryConnector} from './runtime/x-discovery.js';
import {runDiscoveryPreview} from './scripts/run-x-discovery-preview.js';
import {createLinkedInOAuth,linkedinCallbackUrl} from './runtime/linkedin-oauth.js';

const PORT=Number(process.env.PORT||10000);
const X_CLIENT_ID=process.env.X_CLIENT_ID||"";
const X_CLIENT_SECRET=process.env.X_CLIENT_SECRET||"";
const LINKEDIN_CLIENT_ID=process.env.LINKEDIN_CLIENT_ID||"";
const LINKEDIN_CLIENT_SECRET=process.env.LINKEDIN_CLIENT_SECRET||"";
const PUBLIC_BASE_URL=(process.env.PUBLIC_BASE_URL||"").replace(/\/$/,"");
const KEY_VALUE_URL=process.env.KEY_VALUE_URL||"";
const sessions=new Map();
let kv=null;
async function store(){
  if(!KEY_VALUE_URL) throw new Error("KEY_VALUE_URL_NOT_CONFIGURED");
  if(!kv){kv=createClient({url:KEY_VALUE_URL});kv.on("error",e=>console.error("Key Value error",e.message));await kv.connect();}
  else if(!kv.isOpen) await kv.connect();
  return kv;
}
const PRODUCTS=["EMRADAR","Atlasoquence"];
let xAuthorization=null;
async function authorization(){
  if(!xAuthorization)xAuthorization=createXAuthorization({client:await store(),exchange:tokenExchange,clientId:X_CLIENT_ID});
  return xAuthorization;
}
const productKey=p=>String(p||"EMRADAR").toLowerCase();
async function saveLinkedInAuth(product,auth){const s=await store();await s.set(`marketing:linkedin:authorized:${productKey(product)}`,JSON.stringify(auth));}
async function loadLinkedInAuth(product){try{const s=await store();const raw=await s.get(`marketing:linkedin:authorized:${productKey(product)}`);return raw?JSON.parse(raw):null;}catch(e){console.error("Key Value load failed",e.message);return null;}}
async function currentAuth(product="EMRADAR"){return (await authorization()).current(product);}
const receipts=[]; // OAuth diagnostics only; graph publication receipts live in Redis.

const json=(res,status,body)=>{res.writeHead(status,{"content-type":"application/json","cache-control":"no-store"});res.end(JSON.stringify(body));};
const base64url=b=>Buffer.from(b).toString("base64url");
const callbackUrl=(req)=>`${PUBLIC_BASE_URL||`https://${req.headers.host}`}/oauth/x/callback`;
const linkedinRedirectUrl=req=>linkedinCallbackUrl({publicBaseUrl:PUBLIC_BASE_URL,host:req.headers.host});
const html=(res,body)=>{res.writeHead(200,{"content-type":"text/html; charset=utf-8","cache-control":"no-store"});res.end(body);};

async function tokenExchange(body){
  const headers={"content-type":"application/x-www-form-urlencoded"};
  if(X_CLIENT_SECRET) headers.authorization="Basic "+Buffer.from(`${X_CLIENT_ID}:${X_CLIENT_SECRET}`).toString("base64");
  const r=await fetch("https://api.x.com/2/oauth2/token",{method:"POST",headers,body:new URLSearchParams(body)});
  const data=await r.json(); if(!r.ok) throw new Error(`X token exchange failed (${r.status})`); return data;
}
async function xFetch(url,token,options={}){
  const r=await fetch(url,{...options,headers:{authorization:`Bearer ${token}`,...(options.headers||{})}});
  const data=await r.json().catch(()=>({})); if(!r.ok) {const error=new Error(`X API failed (${r.status})`);error.status=r.status;error.retry_at=Number(r.headers.get('x-rate-limit-reset')||0)*1000;throw error;} return data;
}
async function readBody(req){const chunks=[];let bytes=0;for await(const c of req){bytes+=c.length;if(bytes>12000000)throw new Error('INPUT_TOO_LARGE');chunks.push(c);}return Buffer.concat(chunks);}
function failReceipt(stage,error){const receipt={ok:false,stage,timestamp:new Date().toISOString(),error:String(error?.message||error).slice(0,240)};receipts.push(receipt);return receipt;}

function authorizedRequest(req){
  const secret=process.env.MARKETING_ENGINE_TOKEN;
  const actual=String(req.headers.authorization||'');
  const expected='Bearer '+secret;
  return !!secret&&Buffer.byteLength(actual)===Buffer.byteLength(expected)&&crypto.timingSafeEqual(Buffer.from(actual),Buffer.from(expected));
}
function authorizedPublicationReview(req){
  const secret=process.env.MARKETING_PUBLICATION_REVIEW_TOKEN;
  const actual=String(req.headers.authorization||'');const expected='Bearer '+secret;
  return !!secret&&Buffer.byteLength(actual)===Buffer.byteLength(expected)&&crypto.timingSafeEqual(Buffer.from(actual),Buffer.from(expected));
}
async function publishX(asset,key,product){
  const auth=await currentAuth(product);if(!auth?.access_token){const error=new Error('X authorization required');error.status=401;throw error;}
  let media;
  if(asset.format==='image'){
    const bytes=Buffer.from(asset.base64,'base64');
    const init=await xFetch("https://api.x.com/2/media/upload/initialize",auth.access_token,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({media_type:asset.mime,total_bytes:bytes.length,media_category:"tweet_image"})});
    const mediaId=init?.data?.id||init?.data?.media_id||init?.media_id_string||init?.id;
    if(!mediaId)throw new Error('X media receipt missing');
    const append=new FormData();append.set('segment_index','0');append.set('media',new Blob([bytes],{type:asset.mime}),'asset');
    await xFetch(`https://api.x.com/2/media/upload/${mediaId}/append`,auth.access_token,{method:'POST',body:append});
    const final=await xFetch(`https://api.x.com/2/media/upload/${mediaId}/finalize`,auth.access_token,{method:'POST'});
    if(final?.data?.processing_info||final?.processing_info)throw new Error('X_MEDIA_PROCESSING_REQUIRES_STATUS_CHECK');
    media={media_ids:[String(mediaId)]};
  }
  const post=await xFetch('https://api.x.com/2/tweets',auth.access_token,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({text:asset.copy,...(media?{media}:{})})});
  if(!post?.data?.id)throw new Error('X publication receipt missing post id');
  return {status:'PUBLISHED',id:post.data.id,url:`https://x.com/i/web/status/${post.data.id}`,cost_usd:'UNKNOWN'};
}
async function productIntake(){
  const policies=applyAuthority(await loadPolicies(process.env.MARKETING_PRODUCTS_FILE,process.env.MARKETING_PRODUCTS_JSON));
  return new ProductIntake({store:new RedisStore(await store()),policies,sourceKeys:JSON.parse(process.env.MARKETING_SOURCE_KEYS_JSON||'{}')});
}
async function marketingEngine(){
  const products=await (await productIntake()).products();
  const linkedinAuth=await loadLinkedInAuth('EMRADAR');
  const adapters={X:xAdapter({publish:publishX,discovery:xDiscoveryConnector({currentAuth}),authorized:async product=>!!(await currentAuth(product))?.access_token,fetchMetrics:async(id,product)=>{
    const auth=await currentAuth(product);
    if(!auth?.access_token)throw new Error('X authorization required');
    return xFetch(`https://api.x.com/2/tweets/${encodeURIComponent(id)}?tweet.fields=public_metrics`,auth.access_token);
  }}),LINKEDIN:socialAdapter(linkedinConnector({accessToken:linkedinAuth?.access_token||process.env.LINKEDIN_ACCESS_TOKEN,organizationUrn:process.env.LINKEDIN_ORGANIZATION_URN,apiVersion:process.env.LINKEDIN_API_VERSION})),BLUESKY:socialAdapter(blueskyConnector({service:process.env.BLUESKY_SERVICE_URL,identifier:process.env.BLUESKY_IDENTIFIER,appPassword:process.env.BLUESKY_APP_PASSWORD})),MASTODON:socialAdapter(mastodonConnector({server:process.env.MASTODON_SERVER,accessToken:process.env.MASTODON_ACCESS_TOKEN}))};
  if(process.env.MARKETING_TEST_DIRECTORY)adapters.LOCAL=localAdapter(process.env.MARKETING_TEST_DIRECTORY);
  return new GraphEngine({store:new RedisStore(await store()),products,adapters,harness:await loadHarness(process.env.MARKETING_HARNESS_MODULE)});
}

const server=http.createServer(async(req,res)=>{
  const u=new URL(req.url,`http://${req.headers.host}`);
  if(u.pathname==='/X_DISCOVERY_PREVIEW'&&['GET','POST'].includes(req.method)){
    if(!authorizedRequest(req))return json(res,403,{ok:false,status:'BLOCKED',reason:'ENGINE_AUTHORIZATION_REQUIRED'});
    try{
      if(req.method==='GET')return json(res,200,await new RedisStore(await store()).get('x_discovery:preview:EMRADAR_X_DISCOVERY_2026_10_03_V0_1')||{status:'NOT_RUN'});
      return json(res,200,await (await marketingEngine()).previewDiscovery(JSON.parse(await readBody(req))));
    }catch(e){return json(res,409,{ok:false,status:'BLOCKED',reason:e.message});}
  }
  if(req.method==="GET"&&u.pathname==="/"){const states=await Promise.all(PRODUCTS.map(async p=>[p,!!(await currentAuth(p).catch(()=>null))?.access_token]));return html(res,`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Marketing Engine</title><style>body{font-family:system-ui;margin:0;background:#0b0d10;color:#f4f4f4}main{max-width:760px;margin:auto;padding:40px 20px}h1{font-size:32px}.sub{color:#9aa3ad}.grid{display:grid;gap:16px;margin-top:32px}.card{border:1px solid #2b3037;border-radius:16px;padding:22px;background:#12161b}.row{display:flex;justify-content:space-between;align-items:center;gap:16px}.status{color:#9aa3ad}.on{color:#9fe3b1}a,button{display:inline-block;margin-top:18px;padding:11px 14px;border-radius:9px;border:1px solid #3b424c;background:#fff;color:#111;text-decoration:none;font-weight:650}.secondary{background:transparent;color:#fff}</style></head><body><main><h1>Marketing Engine</h1><div class="sub">Products, connections and execution.</div><div class="grid">${states.map(([p,on])=>`<section class="card"><div class="row"><div><h2>${p}</h2><div class="status">X <span class="${on?"on":""}">● ${on?"Connected":"Not connected"}</span></div></div><div>Adapter ● Ready</div></div><a href="/oauth/x/start?product=${encodeURIComponent(p)}">${on?"Reconnect X":"Connect X"}</a> <a class="secondary" href="/product?name=${encodeURIComponent(p)}">Open product</a></section>`).join("")}</div><a class="secondary" href="/onboarding">+ Add product</a></main></body></html>`);}
  if(req.method==="GET"&&u.pathname==="/onboarding") return html(res,`<!doctype html><html><body style="font-family:system-ui;max-width:680px;margin:50px auto;padding:20px"><h1>Add product</h1><p>The first onboarding contract captures identity, source of truth, channels, rules and goal. Atlasoquence is already registered through its adapter.</p><p><a href="/">Back to products</a></p></body></html>`);
  if(req.method==="GET"&&u.pathname==="/product"){const p=u.searchParams.get("name");if(!PRODUCTS.includes(p))return json(res,404,{ok:false,error:"unknown_product"});const auth=await currentAuth(p).catch(()=>null);return html(res,`<!doctype html><html><body style="font-family:system-ui;max-width:680px;margin:50px auto;padding:20px"><a href="/">← Products</a><h1>${p}</h1><p>Adapter: Ready</p><p>X: ${auth?.access_token?"Connected":"Not connected"}</p><p>Additional spend: owner approval required</p><p>Execution endpoint: POST /RUN_MARKETING</p></body></html>`);}
  if(req.method==="GET"&&u.pathname==="/health"){const states=Object.fromEntries(await Promise.all(PRODUCTS.map(async p=>[p,!!(await currentAuth(p).catch(()=>null))?.access_token])));return json(res,200,{ok:true,service:"MARKETING_ENGINE_X_EXECUTOR_V0_2",products:states,auth_store:KEY_VALUE_URL?"persistent":"memory_only",cost_gate:{additional_spend_without_owner_approval:0,api_billing:"UNKNOWN"}});}
  if(req.method==="GET"&&u.pathname==="/integrations/status"){
    if(!authorizedRequest(req))return json(res,403,{ok:false,status:"BLOCKED",reason:"ENGINE_AUTHORIZATION_REQUIRED"});
    const xAuthorized=!!(await currentAuth('EMRADAR').catch(()=>null))?.access_token;
    const linkedinAuthorized=!!((await loadLinkedInAuth('EMRADAR'))?.access_token||process.env.LINKEDIN_ACCESS_TOKEN);
    return json(res,200,{ok:true,platforms:integrationStatus(process.env,{xAuthorized,linkedinAuthorized})});
  }
  if(req.method==="GET"&&u.pathname==="/oauth/x/start"){
    const product=u.searchParams.get("product")||"EMRADAR";if(!PRODUCTS.includes(product))return json(res,400,{ok:false,error:"unknown_product"});
    if(!X_CLIENT_ID) return json(res,503,{ok:false,blocker:"X_CLIENT_ID_NOT_CONFIGURED",callback_url:callbackUrl(req)});
    const state=base64url(crypto.randomBytes(24)),verifier=base64url(crypto.randomBytes(48));
    const challenge=base64url(crypto.createHash("sha256").update(verifier).digest());
    sessions.set(state,{verifier,created:Date.now(),product});
    const q=new URLSearchParams({response_type:"code",client_id:X_CLIENT_ID,redirect_uri:callbackUrl(req),scope:"tweet.read tweet.write users.read offline.access media.write",state,code_challenge:challenge,code_challenge_method:"S256"});
    res.writeHead(302,{location:`https://x.com/i/oauth2/authorize?${q}`});return res.end();
  }
  if(req.method==="GET"&&u.pathname==="/oauth/x/callback"){
    const state=u.searchParams.get("state"),code=u.searchParams.get("code"),s=sessions.get(state);
    if(!state||!code||!s||Date.now()-s.created>600000) return json(res,400,{ok:false,error:"invalid_or_expired_oauth_state"});
    try{const t=await tokenExchange({grant_type:"authorization_code",code,redirect_uri:callbackUrl(req),code_verifier:s.verifier,client_id:X_CLIENT_ID});await (await authorization()).authorize(s.product,t);sessions.delete(state);res.writeHead(302,{location:"/"});return res.end();}
    catch(e){return json(res,502,failReceipt("oauth_callback",e));}
  }
  if(req.method==="GET"&&u.pathname==="/oauth/linkedin/start"){
    const product=u.searchParams.get("product")||"EMRADAR";if(!PRODUCTS.includes(product))return json(res,400,{ok:false,error:"unknown_product"});
    const oauth=createLinkedInOAuth({clientId:LINKEDIN_CLIENT_ID,clientSecret:LINKEDIN_CLIENT_SECRET,redirectUri:linkedinRedirectUrl(req),scopes:process.env.LINKEDIN_SCOPES,sessions,saveAuthorization:saveLinkedInAuth});
    const result=oauth.authorizationRedirect(product);if(result.location){res.writeHead(result.status,{location:result.location,"cache-control":"no-store"});return res.end();}return json(res,result.status,result.body);
  }
  if(req.method==="GET"&&u.pathname==="/oauth/linkedin/callback"){
    const oauth=createLinkedInOAuth({clientId:LINKEDIN_CLIENT_ID,clientSecret:LINKEDIN_CLIENT_SECRET,redirectUri:linkedinRedirectUrl(req),scopes:process.env.LINKEDIN_SCOPES,sessions,saveAuthorization:saveLinkedInAuth});
    const result=await oauth.callback(Object.fromEntries(u.searchParams));if(result.location){res.writeHead(result.status,{location:result.location,"cache-control":"no-store"});return res.end();}return json(res,result.status,result.body);
  }
  if(req.method==='POST'&&u.pathname==='/PRODUCT_INPUT'){
    try{const envelope=JSON.parse(await readBody(req));const result=await (await productIntake()).receive(envelope,req.headers['x-product-signature']);return json(res,200,result);}catch(e){return json(res,409,{ok:false,status:'BLOCKED',reason:e.message});}
  }
  if(req.method==='POST'&&u.pathname==='/SCHEDULED_CYCLE'){
    try{await verifySchedulerToken(String(req.headers.authorization||'').replace(/^Bearer /,''));if(process.env.MARKETING_AUTONOMOUS!=='true')return json(res,200,{status:'SCHEDULER_DISABLED',result:null,feedback:null});const result=await (await marketingEngine()).tick();return json(res,200,result);}
    catch(e){return json(res,409,{ok:false,status:'BLOCKED',reason:e.message});}
  }
  if(u.pathname==='/PUBLICATION_REVIEW'&&['GET','POST'].includes(req.method)){
    if(!authorizedPublicationReview(req))return json(res,403,{ok:false,status:'BLOCKED',reason:'OWNER_PUBLICATION_REVIEW_AUTH_REQUIRED'});
    try{
      if(req.method==='GET'){
        const id=u.searchParams.get('proposal_id');if(!id||!/^[a-f0-9]{64}$/.test(id))return json(res,400,{ok:false,reason:'PROPOSAL_ID_REQUIRED'});
        const proposal=await new RedisStore(await store()).get('publication_review:'+id);
        return json(res,proposal?200:404,proposal||{ok:false,reason:'PUBLICATION_REVIEW_NOT_FOUND'});
      }
      const decision=JSON.parse(await readBody(req));
      if(!/^[a-f0-9]{64}$/.test(decision?.proposal_id||'')||!/^[a-f0-9]{64}$/.test(decision?.review_hash||''))return json(res,400,{ok:false,reason:'PROPOSAL_AND_REVIEW_HASH_REQUIRED'});
      return json(res,200,await (await marketingEngine()).approvePublication(decision));
    }catch(e){return json(res,409,{ok:false,status:'BLOCKED',reason:e.message});}
  }
  if(req.method==="POST"&&["/RUN_MARKETING","/COLLECT_PERFORMANCE","/CYCLE"].includes(u.pathname)){
    if(!authorizedRequest(req))return json(res,403,{ok:false,status:"BLOCKED",reason:"ENGINE_AUTHORIZATION_REQUIRED"});
    let input;try{input=JSON.parse(await readBody(req));}catch{return json(res,400,{ok:false,error:"invalid JSON"});}
    try{const engine=await marketingEngine();const result=u.pathname==='/CYCLE'?await engine.tick():u.pathname==="/RUN_MARKETING"?await engine.run(input):await engine.feedback(input.receipt_id);return json(res,200,result);}
    catch(e){return json(res,409,{ok:false,status:"BLOCKED",reason:e.message});}
  }
  if(req.method==="GET"&&u.pathname==="/receipts/latest"){
    if(!authorizedRequest(req))return json(res,403,{ok:false,reason:"ENGINE_AUTHORIZATION_REQUIRED"});
    try{return json(res,200,await new RedisStore(await store()).get('latest_receipt')||{status:"NO_RECEIPT",measurement_state:"UNKNOWN"});}catch(e){return json(res,503,{ok:false,reason:e.message});}
  }
  return json(res,404,{ok:false,error:"not_found"});
});
server.listen(PORT,()=>{
  console.log("EMRADAR X executor listening");
  runDiscoveryPreview({port:PORT,token:process.env.MARKETING_ENGINE_TOKEN}).catch(e=>console.error('X_DISCOVERY_PREVIEW '+JSON.stringify({status:'BLOCKED',blocker:e.message})));
  runPendingSourceRelease().then(()=>runPendingCampaign()).catch(e=>console.error('MARKETING_CAMPAIGN_LAUNCH '+JSON.stringify({status:'BLOCKED',blocker:e.message})));
});

async function runPendingSourceRelease(){
  if(!process.env.MARKETING_PENDING_SOURCE_RELEASE_JSON)return;
  const pending=JSON.parse(process.env.MARKETING_PENDING_SOURCE_RELEASE_JSON);
  const sourceUrl=/^https:\/\/emerging-markets-radar\.onrender\.com\/(data\/checkpoints\/discovery-2026-10-03\.json|verification\/downstream-release-attestation-2026-10-03\.json)$/;
  if(pending?.product!=='EMRADAR'||pending?.sequence!==2||!sourceUrl.test(pending.scan_url)||!sourceUrl.test(pending.attestation_url))throw new Error('PENDING_SOURCE_RELEASE_INVALID');
  const [scanResponse,attestationResponse]=await Promise.all([fetch(pending.scan_url),fetch(pending.attestation_url)]);
  if(!scanResponse.ok||!attestationResponse.ok)throw new Error('AUTHORITATIVE_SOURCE_FETCH_FAILED');
  const scanBytes=Buffer.from(await scanResponse.arrayBuffer()),attestation=await attestationResponse.json();
  if(crypto.createHash('sha256').update(scanBytes).digest('hex')!==pending.scan_sha256||attestation.source_sha256!==pending.scan_sha256||attestation.product!=='EMRADAR'||attestation.snapshot_date!=='2026-10-03'||attestation.publication_state!=='PUBLISHED'||attestation.downstream_release_allowed!==true||attestation.campaign_authority?.campaign_id!=='EMRADAR_2026_10_03_LAUNCH'||attestation.campaign_authority?.external_publication_allowed!==false)throw new Error('AUTHORITATIVE_SOURCE_ATTESTATION_MISMATCH');
  const required=['evidence','editorial','brand','risk','publication'];
  if(!required.every(g=>attestation.native_gates?.[g]==='PASS'))throw new Error('AUTHORITATIVE_SOURCE_GATES_INCOMPLETE');
  const scan=JSON.parse(scanBytes),source=emradarSource(scan,{release_approved:true,evidence:true,editorial:true});source.native_gates=attestation.native_gates;
  const envelope={product:'EMRADAR',sequence:2,source},key=JSON.parse(process.env.MARKETING_SOURCE_KEYS_JSON||'{}').EMRADAR;
  if(!key)throw new Error('SOURCE_NOT_REGISTERED');
  const result=await (await productIntake()).receive(envelope,signSource(envelope,key));
  console.log('MARKETING_SOURCE_RELEASE '+JSON.stringify(result));
}

async function runPendingCampaign(){
  console.log('MARKETING_CAMPAIGN_DIAGNOSTIC '+JSON.stringify({stage:'ENTER'}));
  if(!process.env.MARKETING_PENDING_CAMPAIGN_JSON)return;
  const input=JSON.parse(process.env.MARKETING_PENDING_CAMPAIGN_JSON);
  if(input?.product!=='EMRADAR'||!/^EMRADAR_[A-Z0-9_]{8,80}$/.test(input?.campaign_id||''))throw new Error('PENDING_CAMPAIGN_INPUT_INVALID');
  const s=new RedisStore(await store()),key='campaign_launch:'+input.campaign_id;
  console.log('MARKETING_CAMPAIGN_DIAGNOSTIC '+JSON.stringify({stage:'READ_STATE',campaign_id:input.campaign_id}));
  let prior=await s.get(key);const sourceRecord=await s.get('source:'+input.product);
  console.log('MARKETING_CAMPAIGN_DIAGNOSTIC '+JSON.stringify({stage:'STATE_READY',campaign_id:input.campaign_id,prior_status:prior?.status||null,source_sequence:sourceRecord?.sequence||null}));
  if(prior?.status==='IN_FLIGHT'&&Date.now()-Date.parse(prior.started_at)>60000){
    console.log('MARKETING_CAMPAIGN_RECOVERY '+JSON.stringify({campaign_id:input.campaign_id,status:'CHECKING_RECEIPTS'}));
    const receipts=await s.get('receipt_index')||[];
    if(receipts.some(r=>r.campaign_id===input.campaign_id&&['PUBLISHED','IN_FLIGHT','AMBIGUOUS'].includes(r.execution_status)))throw new Error('AMBIGUOUS_PUBLICATION_RECOVERY_REQUIRED');
    const proposalKeys=await s.client.keys('marketing:graph:publication_review:*');
    for(const proposalKey of proposalKeys){const proposal=JSON.parse(await s.client.get(proposalKey));if(proposal?.input?.campaign_id===input.campaign_id){const result={product:input.product,campaign_id:input.campaign_id,status:'AWAITING_REVIEW',blocker:'PUBLICATION_REVIEW_REQUIRED',review:{proposal_id:proposal.proposal_id,review_hash:proposal.review_hash,decision:'AWAITING_REVIEW',expires_at:proposal.expires_at,product:proposal.product,signal_state:proposal.signal_state,destination:proposal.destination,format:proposal.format,copy:proposal.copy,evidence_refs:proposal.evidence_refs}};await s.put(key,{status:'COMPLETE',input,recovered_at:new Date().toISOString(),result});console.log('MARKETING_CAMPAIGN_LAUNCH '+JSON.stringify(result));return;}}
    const history=await s.get(key+':history')||[];history.push({...prior,status:'INTERRUPTED_BEFORE_PUBLICATION'});await s.put(key+':history',history.slice(-20));
    await s.client.del('marketing:graph:lock:engine');await s.put(key,null);prior=null;
    console.log('MARKETING_CAMPAIGN_RECOVERY '+JSON.stringify({campaign_id:input.campaign_id,status:'STALE_LOCK_CLEARED'}));
  }
  const priorSequence=prior?.result?.receipt?.source_receipt?.sequence||0;
  const currentSequence=sourceRecord?.sequence||0;
  const resumable=prior?.status==='COMPLETE'&&prior?.result?.status==='BLOCKED'&&currentSequence>priorSequence;
  if(prior&&!resumable)return console.log('MARKETING_CAMPAIGN_LAUNCH '+JSON.stringify({status:'ALREADY_PROCESSED',campaign_id:input.campaign_id,result:prior}));
  if(resumable){const history=await s.get(key+':history')||[];history.push(prior);await s.put(key+':history',history.slice(-20));}
  await s.put(key,{status:'IN_FLIGHT',input,started_at:new Date().toISOString()});
  try{
    console.log('MARKETING_CAMPAIGN_LAUNCH '+JSON.stringify({status:'STARTED',campaign_id:input.campaign_id,source_sequence:currentSequence}));
    const result=await (await marketingEngine()).run(input);
    await s.put(key,{status:'COMPLETE',input,completed_at:new Date().toISOString(),result});
    console.log('MARKETING_CAMPAIGN_LAUNCH '+JSON.stringify(result));
  }catch(error){
    const blocked={status:'BLOCKED',input,blocked_at:new Date().toISOString(),blocker:error.message};
    await s.put(key,blocked);console.error('MARKETING_CAMPAIGN_LAUNCH '+JSON.stringify(blocked));
  }
}

// No per-request polling loop. Every bounded tick loads the trusted current source
// package, so new product revisions can enter without a human triggering each run.
if(process.env.MARKETING_AUTONOMOUS==='true'){
  let ticking=false;
  const interval=Math.max(60000,Number(process.env.MARKETING_CYCLE_INTERVAL_MS)||300000);
  setInterval(async()=>{if(ticking)return;ticking=true;try{await (await marketingEngine()).tick();}catch(e){console.error('Marketing scheduler blocked:',e.message);}finally{ticking=false;}},interval).unref();
}
