import http from "node:http";
import scanControl from "./config/scan-control.json" with {type:"json"};
import {evaluateX} from "./runtime/route-feedback.js";
import {historicalRoutingInput,outcomeHistory,appendOutcome} from "./runtime/outcomes.js";
import crypto from "node:crypto";
import { URL, URLSearchParams } from "node:url";
import { createClient } from "redis";
import fs from 'node:fs/promises';
import { GraphEngine } from './runtime/graph.js';
import { RedisStore } from './runtime/store.js';
import {ProductIntake,loadPolicies,emradarSource,signSource} from './runtime/intake.js';
import {applyAuthority} from './runtime/authority.js';
import {loadHarness} from './runtime/harness.js';
import { xAdapter, localAdapter, loadEditorialOutreach } from './runtime/adapters.js';
import {blueskyConnector,linkedinConnector,mastodonConnector,socialAdapter} from './runtime/social-connectors.js';
import {integrationStatus} from './runtime/integration-status.js';
import {verifySchedulerToken} from './runtime/scheduler-auth.js';
import {createXAuthorization} from './runtime/x-authorization.js';
import {xDiscoveryConnector} from './runtime/x-discovery.js';
import {runDiscoveryPreview} from './scripts/run-x-discovery-preview.js';
import {createLinkedInOAuth,linkedinCallbackUrl} from './runtime/linkedin-oauth.js';
import {editorialSenderStatus,probeEditorialNetwork,verifyEditorialAuthentication} from './runtime/editorial-outreach-gmail.js';

const PORT=Number(process.env.PORT||10000);
const X_CLIENT_ID=process.env.X_CLIENT_ID||"";
const X_CLIENT_SECRET=process.env.X_CLIENT_SECRET||"";
const LINKEDIN_CLIENT_ID=process.env.LINKEDIN_CLIENT_ID||"";
const LINKEDIN_CLIENT_SECRET=process.env.LINKEDIN_CLIENT_SECRET||"";
const PUBLIC_BASE_URL=(process.env.PUBLIC_BASE_URL||"").replace(/\/$/,"");
const KEY_VALUE_URL=process.env.KEY_VALUE_URL||"";
const sessions=new Map();
let kv=null,kvConnecting=null;
async function store(){
  if(!KEY_VALUE_URL) throw new Error("KEY_VALUE_URL_NOT_CONFIGURED");
  if(!kv){kv=createClient({url:KEY_VALUE_URL});kv.on("error",e=>console.error("Key Value error",e.message));}
  if(!kv.isOpen){if(!kvConnecting)kvConnecting=kv.connect().finally(()=>{kvConnecting=null;});await kvConnecting;}
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
  const editorialOutreach=await loadEditorialOutreach(process.env.MARKETING_EDITORIAL_OUTREACH_MODULE);if(editorialOutreach)adapters.OPEN_ROUTE=editorialOutreach;
  if(process.env.MARKETING_TEST_DIRECTORY)adapters.LOCAL=localAdapter(process.env.MARKETING_TEST_DIRECTORY);
  return new GraphEngine({store:new RedisStore(await store()),products,adapters,harness:await loadHarness(process.env.MARKETING_HARNESS_MODULE),xAccountStatus:async()=>{const auth=await currentAuth('EMRADAR');return {status:auth?.access_token&&(!auth.expires_at||auth.expires_at>Date.now())?(auth.refreshed_at?'REFRESHED_RUNTIME_AUTHORIZATION':'CURRENT_RUNTIME_AUTHORIZATION'):'OWNER_REAUTHORIZATION_REQUIRED',expires_at:auth?.expires_at?new Date(auth.expires_at).toISOString():null,refreshed_at:auth?.refreshed_at||null,scope:auth?.scope||'UNKNOWN',provider_revocation_check:'NOT_PROBED_UNKNOWN_API_COST'};}});
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
  if(req.method==="GET"&&u.pathname==="/health"){const states=Object.fromEntries(await Promise.all(PRODUCTS.map(async p=>[p,!!(await currentAuth(p).catch(()=>null))?.access_token])));return json(res,200,{ok:true,service:"MARKETING_ENGINE_X_EXECUTOR_V0_2",runtime_commit:process.env.RENDER_GIT_COMMIT||"UNKNOWN",products:states,auth_store:KEY_VALUE_URL?"persistent":"memory_only",editorial_outreach_configured:!!process.env.MARKETING_EDITORIAL_OUTREACH_MODULE,cost_gate:{additional_spend_without_owner_approval:0,api_billing:"UNKNOWN"}});}
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
    try{const envelope=JSON.parse(await readBody(req));if(scanControl.hold_new_scans&&envelope.product==='EMRADAR')return json(res,423,{reason:'NEXT_SCAN_HELD_BY_OWNER'});const result=await (await productIntake()).receive(envelope,req.headers['x-product-signature']);return json(res,200,result);}catch(e){return json(res,409,{ok:false,status:'BLOCKED',reason:e.message});}
  }
  if(req.method==='POST'&&u.pathname==='/SCHEDULED_CYCLE'){
    try{await verifySchedulerToken(String(req.headers.authorization||'').replace(/^Bearer /,''));const result=await (await marketingEngine()).tick();return json(res,200,result);}
    catch(e){return json(res,409,{ok:false,status:'BLOCKED',reason:e.message});}
  }
  if(u.pathname==='/OUTCOME_REVIEW'&&['GET','POST'].includes(req.method)){
    if(!authorizedPublicationReview(req))return json(res,403,{reason:'OWNER_PUBLICATION_REVIEW_AUTH_REQUIRED'});
    try{
      const engine=await marketingEngine(),s=engine.store;
      if(req.method==='GET'){
        const receiptId=u.searchParams.get('receipt_id');
        if(receiptId&&!/^[a-f0-9]{64}$/.test(receiptId))throw new Error('RECEIPT_ID_INVALID');
        const ids=receiptId?[receiptId]:await s.get('outcome_index')||[];
        const memory=await s.get('routing_memory');
        const records=[];
        for(const id of ids){const receipt=await s.get('receipt:'+id);if(receipt)records.push({receipt,outcome:await s.get('outcome:'+id),history:await outcomeHistory(s,id),attempt_history:await s.get('receipt_history:'+id)||[],recovery:await s.get('delivery_recovery:'+id),cost_receipts:await Promise.all((await s.get('campaign_cost_index:'+receipt.campaign_id)||[]).map(run=>s.get('campaign_cost:'+run)))});}
        return json(res,200,{records,performance_analysis:await s.get('performance_analysis'),routing_memory:memory,hypothetical_next_routing_input:historicalRoutingInput(memory,{destination:u.searchParams.get('destination')||'REUTERS-BREAKINGVIEWS-GUEST',platform:'OPEN_ROUTE',evidence_state:'FORMING'}),scan_control:scanControl,source_receipt:await s.get('source_receipt:EMRADAR'),closed_loop_proof:await s.get('closed_loop_proof')});
      }
      const input=JSON.parse(await readBody(req));
      if(input.action==='COLLECT'){
        if(!Array.isArray(input.receipt_ids)||input.receipt_ids.length<1||input.receipt_ids.length>4||input.receipt_ids.some(id=>!/^[a-f0-9]{64}$/.test(id)))throw new Error('BOUNDED_RECEIPT_IDS_REQUIRED');
        const before=[];for(const id of input.receipt_ids)before.push(JSON.stringify(await s.get('receipt:'+id)));const sourceBefore=JSON.stringify(await s.get('source_receipt:EMRADAR'));
        const results=[];for(const id of input.receipt_ids)results.push(await engine.feedback(id));
        const memory=await s.get('routing_memory'),proof={at:new Date().toISOString(),receipt_ids:input.receipt_ids,nodes:results.map(v=>v.trace.map(n=>({node:n.node,status:n.status}))),receipt_parity:[],source_receipt_unchanged:sourceBefore===JSON.stringify(await s.get('source_receipt:EMRADAR')),scan_processed:false,external_publications:0,learning_reference:memory?.analysis_reference,hypothetical_next_input:historicalRoutingInput(memory,{destination:'REUTERS-BREAKINGVIEWS-GUEST',platform:'OPEN_ROUTE',evidence_state:'FORMING'})};for(let i=0;i<input.receipt_ids.length;i++)proof.receipt_parity.push(before[i]===JSON.stringify(await s.get('receipt:'+input.receipt_ids[i])));await s.put('closed_loop_proof',proof);
        return json(res,200,{results,external_publications:0,scan_processed:false});
      }
      if(input.action==='X_EVALUATE'){
        if(!/^[a-f0-9]{64}$/.test(input.proposal_id||''))throw new Error('PROPOSAL_ID_INVALID');
        const p=await s.get('publication_review:'+input.proposal_id),product=engine.products[p?.product];
        const signal=product?.signals.find(v=>v.id===p.signal_id&&v.revision===p.signal_revision);
        if(!signal||JSON.stringify(product.source_receipt)!==JSON.stringify(p.source_receipt))throw new Error('SAVED_APPROVED_SOURCE_UNAVAILABLE');
        const result=await s.locked('engine',()=>evaluateX({store:s,product,signal,adapter:engine.adapters.X,accountStatus:engine.xAccountStatus,campaign_id:p.input.campaign_id}));
        return json(res,200,{result,previous_route_plan:await s.get('route_plan:'+p.product+':'+signal.id+':'+signal.revision),existing_x_receipts:(await s.get('receipt_index')||[]).filter(r=>r.platform==='X'&&r.signal_id===signal.id&&r.signal_revision===signal.revision),external_publications:0,scan_processed:false});
      }
      if(input.action==='PUBLICATION_CANDIDATE'){
        const r=await s.get('receipt:'+input.receipt_id);if(!r?.proposal_id||typeof input.url!=='string')throw new Error('RECEIPT_AND_CANDIDATE_REQUIRED');
        const p=await s.get('publication_review:'+r.proposal_id),host=new URL(p.asset.delivery.evidence_source_url).hostname.replace(/^www\./,'');
        const target=new URL(input.url);if(target.protocol!=='https:'||target.hostname.replace(/^www\./,'')!==host||target.port||target.username||target.password)throw new Error('VERIFIED_PUBLICATION_DOMAIN_REQUIRED');
        await s.locked('engine',async()=>{const key='publication_candidates:'+r.id,candidates=await s.get(key)||[];if(!candidates.some(c=>c.url===input.url)){if(candidates.length>=3)throw new Error('PUBLICATION_CANDIDATE_BOUND');candidates.push({url:input.url,at:new Date().toISOString(),origin:'OWNER_CANDIDATE_NOT_PUBLICATION_PROOF'});await s.put(key,candidates);}});
        return json(res,200,{status:'CANDIDATE_QUEUED',external_publications:0});
      }
      if(input.action==='REPLY_CLASSIFICATION'){
        if(!['EDITOR_INTEREST','MORE_INFORMATION_REQUESTED','REJECTED'].includes(input.state)||typeof input.explicit_statement!=='string'||!input.explicit_statement.trim()||input.explicit_statement.length>1000)throw new Error('EXPLICIT_REVIEWED_STATEMENT_REQUIRED');
        const history=await outcomeHistory(s,input.receipt_id),reply=history.find(e=>e.state==='RESPONSE_RECEIVED'&&e.evidence.reply_message_id===input.reply_message_id);
        if(!reply)throw new Error('MATCHED_REPLY_REQUIRED');
        const event={state:input.state,at:reply.at,evidence:{...reply.evidence,type:'OWNER_REVIEWED_EXPLICIT_REPLY_STATEMENT',classification:'EXPLICIT_REVIEWED_STATEMENT',explicit_statement:input.explicit_statement,reviewed_by:'OWNER',reviewed_at:new Date().toISOString()}};
        await s.locked('engine',()=>appendOutcome(s,input.receipt_id,event));
        return json(res,200,{status:'EVIDENCE_RECORDED',result:await engine.feedback(input.receipt_id),external_publications:0});
      }
      throw new Error('OUTCOME_ACTION_NOT_ALLOWED');
    }catch(e){return json(res,409,{reason:e.message});}
  }
  if(req.method==='GET'&&u.pathname==='/PUBLICATION_REVIEW/delivery-status'){
    if(!authorizedPublicationReview(req))return json(res,403,{ok:false,reason:'OWNER_PUBLICATION_REVIEW_AUTH_REQUIRED'});
    const id=u.searchParams.get('proposal_id');if(!/^[a-f0-9]{64}$/.test(id||''))return json(res,400,{reason:'PROPOSAL_ID_REQUIRED'});
    try{
      const s=new RedisStore(await store());let proposal=await s.get('publication_review:'+id);
      if(!proposal)return json(res,404,{reason:'PUBLICATION_REVIEW_NOT_FOUND'});
      if(proposal.replacement_proposal_id)proposal=await s.get('publication_review:'+proposal.replacement_proposal_id)||proposal;
      const receipt=await s.get('receipt:'+proposal.publication_key),approval=await s.get('publication_approval:'+proposal.proposal_id);
      const pending=await s.get('pending:'+proposal.product+':'+proposal.signal_id+':'+proposal.signal_revision);
      return json(res,200,{proposal_id:proposal.proposal_id,review_hash:proposal.review_hash,reviewed_sender:proposal.asset?.email?.from||null,sender:editorialSenderStatus(),approval:approval||null,receipt:receipt||null,idempotency:{key:proposal.publication_key,pending:pending||null},...(u.searchParams.get('smtp_probe')==='true'?{network:await probeEditorialNetwork()}: {})});
    }catch(e){return json(res,409,{reason:e.message});}
  }
  if(req.method==='GET'&&u.pathname==='/PUBLICATION_REVIEW/sender-check'){
    if(!authorizedPublicationReview(req))return json(res,403,{reason:'OWNER_PUBLICATION_REVIEW_AUTH_REQUIRED'});
    try{return json(res,200,await verifyEditorialAuthentication());}catch(e){return json(res,409,{status:'BLOCKED',reason:e.message,code:e.code||null,command:e.command||null,sender:editorialSenderStatus()});}
  }
  if(req.method==='POST'&&u.pathname==='/PUBLICATION_REVIEW/recover-connection-timeout'){
    if(!authorizedPublicationReview(req))return json(res,403,{reason:'OWNER_PUBLICATION_REVIEW_AUTH_REQUIRED'});
    try{
      const input=JSON.parse(await readBody(req)),s=new RedisStore(await store());
      const result=await s.locked('engine',async()=>{
        const p=await s.get('publication_review:'+input.proposal_id),r=p&&await s.get('receipt:'+p.publication_key);
        if(!p||p.review_hash!==input.review_hash||!r||r.execution_status!=='AMBIGUOUS'||r.error!=='Connection timeout'||r.external_id||r.provider_receipt||r.delivery_hash!==crypto.createHash('sha256').update(JSON.stringify(p.asset)).digest('hex'))throw new Error('DELIVERY_AMBIGUITY_NOT_RESOLVED');
        const evidence={classification:'CONFIRMED_NOT_SENT',reason:'Nodemailer connection timeout occurs before SMTP session and message submission',classified_at:new Date().toISOString(),prior_receipt:r};
        await s.put('delivery_recovery:'+p.publication_key,evidence);
        await s.put('receipt:'+p.publication_key,{...r,execution_status:'FAILED',recovery:{classification:evidence.classification,reason:evidence.reason,classified_at:evidence.classified_at}});
        const key='pending:'+p.product+':'+p.signal_id+':'+p.signal_revision,pending=await s.get(key);
        if(pending?.receipt_id===p.publication_key)await s.put(key,null);
        return {classification:evidence.classification,proposal_id:p.proposal_id,external_actions:0};
      });return json(res,200,result);
    }catch(e){return json(res,409,{reason:e.message});}
  }
  if(req.method==='POST'&&u.pathname==='/PUBLICATION_REVIEW/revise'){
    if(!authorizedPublicationReview(req))return json(res,403,{ok:false,status:'BLOCKED',reason:'OWNER_PUBLICATION_REVIEW_AUTH_REQUIRED'});
    try{const revision=JSON.parse(await readBody(req));if(!/^[a-f0-9]{64}$/.test(revision?.proposal_id||'')||!/^[a-f0-9]{64}$/.test(revision?.review_hash||''))return json(res,400,{reason:'PROPOSAL_AND_REVIEW_HASH_REQUIRED'});return json(res,200,await (await marketingEngine()).revisePublication(revision));}
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
      if(decision.decision==='REJECTED')return json(res,200,await (await marketingEngine()).rejectPublication(decision));
      if(decision.decision&&decision.decision!=='APPROVED')return json(res,400,{ok:false,reason:'INVALID_PUBLICATION_DECISION'});
      return json(res,200,await (await marketingEngine()).approvePublication(decision));
    }catch(e){return json(res,409,{ok:false,status:'BLOCKED',reason:e.message});}
  }
  if(req.method==="POST"&&["/RUN_MARKETING","/COLLECT_PERFORMANCE","/CYCLE"].includes(u.pathname)){
    if(!authorizedRequest(req))return json(res,403,{ok:false,status:"BLOCKED",reason:"ENGINE_AUTHORIZATION_REQUIRED"});
    let input;try{input=JSON.parse(await readBody(req));}catch{return json(res,400,{ok:false,error:"invalid JSON"});}
    try{const engine=await marketingEngine();const result=u.pathname==='/CYCLE'?await engine.tick():u.pathname==="/RUN_MARKETING"?await engine.run(input):await engine.feedback(input.receipt_id);return json(res,200,result);}
    catch(e){return json(res,409,{ok:false,status:"BLOCKED",reason:e.message});}
  }
  if(req.method==='GET'&&u.pathname==='/cost-receipts'){
    if(!authorizedRequest(req))return json(res,403,{ok:false,reason:'ENGINE_AUTHORIZATION_REQUIRED'});
    const s=new RedisStore(await store()),id=u.searchParams.get('run_id'),campaign=u.searchParams.get('campaign_id');
    if(id)return json(res,200,await s.get('campaign_cost:'+id)||{status:'NOT_FOUND'});
    if(!campaign)return json(res,400,{reason:'RUN_OR_CAMPAIGN_ID_REQUIRED'});
    const ids=await s.get('campaign_cost_index:'+campaign)||[];
    const receipts=await Promise.all(ids.map(id=>s.get('campaign_cost:'+id)));
    const unknown=receipts.some(r=>r?.cost_state==='UNKNOWN'),known=receipts.reduce((sum,r)=>sum+(r?.known_subtotal_aud||0),0);
    return json(res,200,{campaign_id:campaign,currency:'AUD',receipts,total:!receipts.length||unknown?'UNKNOWN':known,known_subtotal_aud:known,cost_state:!receipts.length||unknown?'UNKNOWN':known===0?'ZERO':receipts.some(r=>r.cost_state==='CALCULATED')?'CALCULATED':'ACTUAL'});
  }
  if(req.method==="GET"&&u.pathname==="/receipts/latest"){
    if(!authorizedRequest(req))return json(res,403,{ok:false,reason:"ENGINE_AUTHORIZATION_REQUIRED"});
    try{return json(res,200,await new RedisStore(await store()).get('latest_receipt')||{status:"NO_RECEIPT",measurement_state:"UNKNOWN"});}catch(e){return json(res,503,{ok:false,reason:e.message});}
  }
  return json(res,404,{ok:false,error:"not_found"});
});
server.listen(PORT,()=>{
  console.log("EMRADAR X executor listening");
  if(!scanControl.hold_new_scans)runDiscoveryPreview({port:PORT,token:process.env.MARKETING_ENGINE_TOKEN}).catch(e=>console.error('X_DISCOVERY_PREVIEW '+JSON.stringify({status:'BLOCKED',blocker:e.message})));
  (scanControl.hold_new_scans?Promise.resolve():runPendingSourceRelease().then(()=>runPendingCampaign(kv))).catch(e=>console.error('MARKETING_CAMPAIGN_LAUNCH '+JSON.stringify({status:'BLOCKED',blocker:e.message})));
});

async function runPendingSourceRelease(){
  if(!process.env.MARKETING_PENDING_SOURCE_RELEASE_JSON)return;
  const pending=JSON.parse(process.env.MARKETING_PENDING_SOURCE_RELEASE_JSON);
  const date='\\d{4}-\\d{2}-\\d{2}';
  const scanUrl=new RegExp('^https://emerging-markets-radar\\.onrender\\.com/data/checkpoints/discovery-('+date+')\\.json$');
  const attestationUrl=new RegExp('^https://emerging-markets-radar\\.onrender\\.com/verification/downstream-release-attestation-('+date+')\\.json$');
  const scanMatch=typeof pending?.scan_url==='string'&&pending.scan_url.match(scanUrl);
  const attestationMatch=typeof pending?.attestation_url==='string'&&pending.attestation_url.match(attestationUrl);
  if(pending?.product!=='EMRADAR'||!Number.isInteger(pending?.sequence)||pending.sequence<1||!scanMatch||!attestationMatch||scanMatch[1]!==attestationMatch[1])throw new Error('PENDING_SOURCE_RELEASE_INVALID');
  const [scanResponse,attestationResponse]=await Promise.all([fetch(pending.scan_url),fetch(pending.attestation_url)]);
  if(!scanResponse.ok||!attestationResponse.ok)throw new Error('AUTHORITATIVE_SOURCE_FETCH_FAILED');
  const scanBytes=Buffer.from(await scanResponse.arrayBuffer()),attestation=await attestationResponse.json();
  const snapshotDate=scanMatch[1],expectedCampaign='EMRADAR_'+snapshotDate.replaceAll('-','_')+'_LAUNCH';
  if(crypto.createHash('sha256').update(scanBytes).digest('hex')!==pending.scan_sha256||attestation.source_sha256!==pending.scan_sha256||attestation.product!=='EMRADAR'||attestation.snapshot_date!==snapshotDate||attestation.publication_state!=='PUBLISHED'||attestation.downstream_release_allowed!==true||attestation.campaign_authority?.campaign_id!==expectedCampaign||attestation.campaign_authority?.external_publication_allowed!==false||attestation.campaign_authority?.required_stop!=='PUBLICATION_REVIEW')throw new Error('AUTHORITATIVE_SOURCE_ATTESTATION_MISMATCH');
  const required=['evidence','editorial','brand','risk','publication'];
  if(!required.every(g=>attestation.native_gates?.[g]==='PASS'))throw new Error('AUTHORITATIVE_SOURCE_GATES_INCOMPLETE');
  const scan=JSON.parse(scanBytes);
  if(scan.snapshot_date!==snapshotDate||scan.publication_state!=='PUBLISHED')throw new Error('AUTHORITATIVE_SCAN_STATE_MISMATCH');
  const source=emradarSource(scan,{release_approved:true,evidence:true,editorial:true});source.native_gates=attestation.native_gates;
  const envelope={product:'EMRADAR',sequence:pending.sequence,source},key=JSON.parse(process.env.MARKETING_SOURCE_KEYS_JSON||'{}').EMRADAR;
  if(!key)throw new Error('SOURCE_NOT_REGISTERED');
  const result=await (await productIntake()).receive(envelope,signSource(envelope,key));
  console.log('MARKETING_SOURCE_RELEASE '+JSON.stringify(result));
}

async function runPendingCampaign(connectedClient=null){
  console.log('MARKETING_CAMPAIGN_DIAGNOSTIC '+JSON.stringify({stage:'ENTER'}));
  if(!process.env.MARKETING_PENDING_CAMPAIGN_JSON)return;
  const input=JSON.parse(process.env.MARKETING_PENDING_CAMPAIGN_JSON);
  if(input?.product!=='EMRADAR'||!/^EMRADAR_[A-Z0-9_]{8,80}$/.test(input?.campaign_id||''))throw new Error('PENDING_CAMPAIGN_INPUT_INVALID');
  const s=new RedisStore(connectedClient||await store()),key='campaign_launch:'+input.campaign_id;
  console.log('MARKETING_CAMPAIGN_DIAGNOSTIC '+JSON.stringify({stage:'READ_STATE',campaign_id:input.campaign_id}));
  let prior=await s.get(key);const sourceRecord=await s.get('source:'+input.product);
  console.log('MARKETING_CAMPAIGN_DIAGNOSTIC '+JSON.stringify({stage:'STATE_READY',campaign_id:input.campaign_id,prior_status:prior?.status||null,source_sequence:sourceRecord?.sequence||null}));
  if(prior?.status==='IN_FLIGHT'&&Date.now()-Date.parse(prior.started_at)>60000){
    console.log('MARKETING_CAMPAIGN_RECOVERY '+JSON.stringify({campaign_id:input.campaign_id,status:'CHECKING_RECEIPTS'}));
    const receipts=await s.get('receipt_index')||[];
    if(receipts.some(r=>r.campaign_id===input.campaign_id&&['PUBLISHED','SUBMITTED','IN_FLIGHT','AMBIGUOUS'].includes(r.execution_status)))throw new Error('AMBIGUOUS_PUBLICATION_RECOVERY_REQUIRED');
    const proposalKeys=await s.client.keys('marketing:graph:publication_review:*');
    for(const proposalKey of proposalKeys){const proposal=JSON.parse(await s.client.get(proposalKey));if(proposal?.input?.campaign_id===input.campaign_id){const result={product:input.product,campaign_id:input.campaign_id,status:'AWAITING_REVIEW',blocker:'PUBLICATION_REVIEW_REQUIRED',review:{proposal_id:proposal.proposal_id,review_hash:proposal.review_hash,decision:'AWAITING_REVIEW',expires_at:proposal.expires_at,product:proposal.product,signal_state:proposal.signal_state,destination:proposal.destination,format:proposal.format,copy:proposal.copy,evidence_refs:proposal.evidence_refs}};await s.put(key,{status:'COMPLETE',input,recovered_at:new Date().toISOString(),result});console.log('MARKETING_CAMPAIGN_LAUNCH '+JSON.stringify(result));return;}}
    const history=await s.get(key+':history')||[];history.push({...prior,status:'INTERRUPTED_BEFORE_PUBLICATION'});await s.put(key+':history',history.slice(-20));
    await s.client.del('marketing:graph:lock:engine');await s.put(key,null);prior=null;
    console.log('MARKETING_CAMPAIGN_RECOVERY '+JSON.stringify({campaign_id:input.campaign_id,status:'STALE_LOCK_CLEARED'}));
  }
  const priorSequence=prior?.result?.receipt?.source_receipt?.sequence||0;
  const currentSequence=sourceRecord?.sequence||0;
  const correctedSignal=prior?.status==='COMPLETE'&&prior?.result?.status==='BLOCKED'&&!!input.signal_id&&prior.input?.signal_id!==input.signal_id;
  const harnessRemovedRetry=prior?.status==='COMPLETE'&&prior?.result?.blocker==='HARNESS_DISPATCH_NOT_CONNECTED';
  const registeredRouteRetry=prior?.status==='COMPLETE'&&prior?.result?.blocker==='NO_VERIFIED_EXECUTABLE_DESTINATION';
  const deterministicCopyRetry=prior?.status==='COMPLETE'&&prior?.result?.blocker==='COPY_TEMPLATE_APPROVAL_REQUIRED';
  const resumable=prior?.status==='COMPLETE'&&prior?.result?.status==='BLOCKED'&&(currentSequence>priorSequence||correctedSignal||harnessRemovedRetry||registeredRouteRetry||deterministicCopyRetry);
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
if(process.env.MARKETING_AUTONOMOUS==='true'||scanControl.hold_new_scans){
  let ticking=false;
  const interval=Math.max(60000,Number(process.env.MARKETING_CYCLE_INTERVAL_MS)||300000);
  setInterval(async()=>{if(ticking)return;ticking=true;try{await (await marketingEngine()).tick();}catch(e){console.error('Marketing scheduler blocked:',e.message);}finally{ticking=false;}},interval).unref();
}
