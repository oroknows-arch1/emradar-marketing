import http from "node:http";
import crypto from "node:crypto";
import { URL, URLSearchParams } from "node:url";
import { createClient } from "redis";

const PORT=Number(process.env.PORT||10000);
const X_CLIENT_ID=process.env.X_CLIENT_ID||"";
const X_CLIENT_SECRET=process.env.X_CLIENT_SECRET||"";
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
const productKey=p=>String(p||"EMRADAR").toLowerCase();
async function saveAuth(product,auth){const s=await store();await s.set(`marketing:x:authorized:${productKey(product)}`,JSON.stringify(auth));}
async function loadAuth(product){try{const s=await store(),raw=await s.get(`marketing:x:authorized:${productKey(product)}`);return raw?JSON.parse(raw):null;}catch(e){console.error("Key Value load failed",e.message);return null;}}
async function currentAuth(product="EMRADAR"){
  let auth=sessions.get(`authorized:${productKey(product)}`)||await loadAuth(product);
  if(!auth?.access_token) return null;
  if(auth.expires_at&&Date.now()>=auth.expires_at-60000&&auth.refresh_token){
    const t=await tokenExchange({grant_type:"refresh_token",refresh_token:auth.refresh_token,client_id:X_CLIENT_ID});
    auth={...auth,...t,authorized_at:auth.authorized_at||new Date().toISOString(),refreshed_at:new Date().toISOString(),expires_at:Date.now()+(Number(t.expires_in||7200)*1000)};
    sessions.set(`authorized:${productKey(product)}`,auth);await saveAuth(product,auth);
  }
  return auth;
}
const receipts=[];

const json=(res,status,body)=>{res.writeHead(status,{"content-type":"application/json","cache-control":"no-store"});res.end(JSON.stringify(body));};
const base64url=b=>Buffer.from(b).toString("base64url");
const callbackUrl=(req)=>`${PUBLIC_BASE_URL||`https://${req.headers.host}`}/oauth/x/callback`;
const html=(res,body)=>{res.writeHead(200,{"content-type":"text/html; charset=utf-8","cache-control":"no-store"});res.end(body);};

async function tokenExchange(body){
  const headers={"content-type":"application/x-www-form-urlencoded"};
  if(X_CLIENT_SECRET) headers.authorization="Basic "+Buffer.from(`${X_CLIENT_ID}:${X_CLIENT_SECRET}`).toString("base64");
  const r=await fetch("https://api.x.com/2/oauth2/token",{method:"POST",headers,body:new URLSearchParams(body)});
  const data=await r.json(); if(!r.ok) throw new Error(`X token exchange failed (${r.status})`); return data;
}
async function xFetch(url,token,options={}){
  const r=await fetch(url,{...options,headers:{authorization:`Bearer ${token}`,...(options.headers||{})}});
  const data=await r.json().catch(()=>({})); if(!r.ok) throw new Error(`X API failed (${r.status})`); return data;
}
async function readBody(req){const chunks=[];for await(const c of req)chunks.push(c);return Buffer.concat(chunks);}
function failReceipt(stage,error){const receipt={ok:false,stage,timestamp:new Date().toISOString(),error:String(error?.message||error).slice(0,240)};receipts.push(receipt);return receipt;}

const server=http.createServer(async(req,res)=>{
  const u=new URL(req.url,`http://${req.headers.host}`);
  if(req.method==="GET"&&u.pathname==="/"){const states=await Promise.all(PRODUCTS.map(async p=>[p,!!(await currentAuth(p).catch(()=>null))?.access_token]));return html(res,`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Marketing Engine</title><style>body{font-family:system-ui;margin:0;background:#0b0d10;color:#f4f4f4}main{max-width:760px;margin:auto;padding:40px 20px}h1{font-size:32px}.sub{color:#9aa3ad}.grid{display:grid;gap:16px;margin-top:32px}.card{border:1px solid #2b3037;border-radius:16px;padding:22px;background:#12161b}.row{display:flex;justify-content:space-between;align-items:center;gap:16px}.status{color:#9aa3ad}.on{color:#9fe3b1}a,button{display:inline-block;margin-top:18px;padding:11px 14px;border-radius:9px;border:1px solid #3b424c;background:#fff;color:#111;text-decoration:none;font-weight:650}.secondary{background:transparent;color:#fff}</style></head><body><main><h1>Marketing Engine</h1><div class="sub">Products, connections and execution.</div><div class="grid">${states.map(([p,on])=>`<section class="card"><div class="row"><div><h2>${p}</h2><div class="status">X <span class="${on?"on":""}">● ${on?"Connected":"Not connected"}</span></div></div><div>Adapter ● Ready</div></div><a href="/oauth/x/start?product=${encodeURIComponent(p)}">${on?"Reconnect X":"Connect X"}</a> <a class="secondary" href="/product?name=${encodeURIComponent(p)}">Open product</a></section>`).join("")}</div><a class="secondary" href="/onboarding">+ Add product</a></main></body></html>`);}
  if(req.method==="GET"&&u.pathname==="/onboarding") return html(res,`<!doctype html><html><body style="font-family:system-ui;max-width:680px;margin:50px auto;padding:20px"><h1>Add product</h1><p>The first onboarding contract captures identity, source of truth, channels, rules and goal. Atlasoquence is already registered through its adapter.</p><p><a href="/">Back to products</a></p></body></html>`);
  if(req.method==="GET"&&u.pathname==="/product"){const p=u.searchParams.get("name");if(!PRODUCTS.includes(p))return json(res,404,{ok:false,error:"unknown_product"});const auth=await currentAuth(p).catch(()=>null);return html(res,`<!doctype html><html><body style="font-family:system-ui;max-width:680px;margin:50px auto;padding:20px"><a href="/">← Products</a><h1>${p}</h1><p>Adapter: Ready</p><p>X: ${auth?.access_token?"Connected":"Not connected"}</p><p>Additional spend: owner approval required</p><p>Execution endpoint: POST /RUN_MARKETING</p></body></html>`);}
  if(req.method==="GET"&&u.pathname==="/health"){const states=Object.fromEntries(await Promise.all(PRODUCTS.map(async p=>[p,!!(await currentAuth(p).catch(()=>null))?.access_token])));return json(res,200,{ok:true,service:"MARKETING_ENGINE_X_EXECUTOR_V0_2",products:states,auth_store:KEY_VALUE_URL?"persistent":"memory_only",cost_gate:{additional_spend_without_owner_approval:0}});}
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
    try{const t=await tokenExchange({grant_type:"authorization_code",code,redirect_uri:callbackUrl(req),code_verifier:s.verifier,client_id:X_CLIENT_ID});const auth={...t,authorized_at:new Date().toISOString(),expires_at:Date.now()+(Number(t.expires_in||7200)*1000)};await saveAuth(s.product,auth);sessions.set(`authorized:${productKey(s.product)}`,auth);sessions.delete(state);res.writeHead(302,{location:"/"});return res.end();}
    catch(e){return json(res,502,failReceipt("oauth_callback",e));}
  }
  if(req.method==="POST"&&u.pathname==="/RUN_MARKETING"){
    let input={};try{const raw=await readBody(req);input=raw.length?JSON.parse(raw):{};}catch(e){return json(res,400,failReceipt("input","invalid JSON"));}
    if(!PRODUCTS.includes(input.product)) return json(res,400,failReceipt("product_contract","unknown product"));
    const auth=await currentAuth(input.product);
    if(!auth?.access_token) return json(res,403,failReceipt("permission_gate","X authorization required"));
    try{
      if(input.additional_spend_usd&&Number(input.additional_spend_usd)>0) return json(res,403,failReceipt("cost_gate","additional spend requires owner approval"));
      if(input.novelty_gate!=="PASS"||input.editorial_quality_gate!=="PASS"||input.asset_exists_gate!=="PASS") return json(res,409,failReceipt("hard_gate","novelty, editorial quality and asset existence must all PASS"));
      if(!input.text||!input.asset_base64||!input.asset_sha256) return json(res,400,failReceipt("asset_gate","text, asset_base64 and asset_sha256 required"));
      const asset=Buffer.from(input.asset_base64,"base64"),hash=crypto.createHash("sha256").update(asset).digest("hex");
      if(hash!==input.asset_sha256) return json(res,409,failReceipt("asset_hash","asset hash mismatch"));
      const mediaType=input.asset_mime||"image/png";
      const init=await xFetch("https://api.x.com/2/media/upload/initialize",auth.access_token,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({media_type:mediaType,total_bytes:asset.length,media_category:"tweet_image"})});
      const mediaId=init?.data?.id||init?.data?.media_id||init?.media_id_string||init?.id;
      if(!mediaId) throw new Error("X media initialize receipt missing media id");
      const appendForm=new FormData();appendForm.set("segment_index","0");appendForm.set("media",new Blob([asset],{type:mediaType}),input.asset_filename||"asset.png");
      await xFetch(`https://api.x.com/2/media/upload/${mediaId}/append`,auth.access_token,{method:"POST",body:appendForm});
      await xFetch(`https://api.x.com/2/media/upload/${mediaId}/finalize`,auth.access_token,{method:"POST"});
      const post=await xFetch("https://api.x.com/2/tweets",auth.access_token,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({text:input.text,media:{media_ids:[String(mediaId)]}})});
      const postId=post?.data?.id;if(!postId) throw new Error("X publication receipt missing post id");
      const receipt={ok:true,platform:"X",post_id:postId,post_url:`https://x.com/i/web/status/${postId}`,published_at:new Date().toISOString(),asset_hash:hash,additional_cost_usd:0,measurement_state:"UNKNOWN",learning_handoff:"READY"};
      receipts.push(receipt);return json(res,200,receipt);
    }catch(e){return json(res,502,failReceipt("publish",e));}
  }
  if(req.method==="GET"&&u.pathname==="/receipts/latest") return json(res,200,receipts.at(-1)||{measurement_state:"UNKNOWN",status:"NO_RECEIPT"});
  return json(res,404,{ok:false,error:"not_found"});
});
server.listen(PORT,()=>console.log("EMRADAR X executor listening"));
