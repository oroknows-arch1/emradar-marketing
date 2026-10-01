import http from "node:http";
import crypto from "node:crypto";
import { URL, URLSearchParams } from "node:url";

const PORT=Number(process.env.PORT||10000);
const X_CLIENT_ID=process.env.X_CLIENT_ID||"";
const X_CLIENT_SECRET=process.env.X_CLIENT_SECRET||"";
const PUBLIC_BASE_URL=(process.env.PUBLIC_BASE_URL||"").replace(/\/$/,"");
const sessions=new Map();
const receipts=[];

const json=(res,status,body)=>{res.writeHead(status,{"content-type":"application/json","cache-control":"no-store"});res.end(JSON.stringify(body));};
const base64url=b=>Buffer.from(b).toString("base64url");
const callbackUrl=req)=>`${PUBLIC_BASE_URL||`https://${req.headers.host}`}/oauth/x/callback`;

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
  if(req.method==="GET"&&u.pathname==="/health") return json(res,200,{ok:true,service:"EMRADAR_X_ONE_BUTTON_EXECUTOR_V0_1",x_authorized:[...sessions.values()].some(s=>s.access_token),publish_enabled:false,cost_gate:{additional_spend_without_owner_approval:0}});
  if(req.method==="GET"&&u.pathname==="/oauth/x/start"){
    if(!X_CLIENT_ID) return json(res,503,{ok:false,blocker:"X_CLIENT_ID_NOT_CONFIGURED",callback_url:callbackUrl(req)});
    const state=base64url(crypto.randomBytes(24)),verifier=base64url(crypto.randomBytes(48));
    const challenge=base64url(crypto.createHash("sha256").update(verifier).digest());
    sessions.set(state,{verifier,created:Date.now()});
    const q=new URLSearchParams({response_type:"code",client_id:X_CLIENT_ID,redirect_uri:callbackUrl(req),scope:"tweet.read tweet.write users.read offline.access media.write",state,code_challenge:challenge,code_challenge_method:"S256"});
    res.writeHead(302,{location:`https://x.com/i/oauth2/authorize?${q}`});return res.end();
  }
  if(req.method==="GET"&&u.pathname==="/oauth/x/callback"){
    const state=u.searchParams.get("state"),code=u.searchParams.get("code"),s=sessions.get(state);
    if(!state||!code||!s||Date.now()-s.created>600000) return json(res,400,{ok:false,error:"invalid_or_expired_oauth_state"});
    try{const t=await tokenExchange({grant_type:"authorization_code",code,redirect_uri:callbackUrl(req),code_verifier:s.verifier,client_id:X_CLIENT_ID});sessions.set("authorized",{...t,authorized_at:new Date().toISOString()});sessions.delete(state);return json(res,200,{ok:true,status:"X_AUTHORIZED",next:"RUN_MARKETING"});}
    catch(e){return json(res,502,failReceipt("oauth_callback",e));}
  }
  if(req.method==="POST"&&u.pathname==="/RUN_MARKETING"){
    const auth=sessions.get("authorized");
    if(!auth?.access_token) return json(res,403,failReceipt("permission_gate","X authorization required"));
    try{
      const raw=await readBody(req), input=raw.length?JSON.parse(raw):{};
      if(input.product!=="EMRADAR") return json(res,400,failReceipt("product_contract","product must be EMRADAR"));
      if(input.additional_spend_usd&&Number(input.additional_spend_usd)>0) return json(res,403,failReceipt("cost_gate","additional spend requires owner approval"));
      if(input.novelty_gate!=="PASS"||input.editorial_quality_gate!=="PASS"||input.asset_exists_gate!=="PASS") return json(res,409,failReceipt("hard_gate","novelty, editorial quality and asset existence must all PASS"));
      if(!input.text||!input.asset_base64||!input.asset_sha256) return json(res,400,failReceipt("asset_gate","text, asset_base64 and asset_sha256 required"));
      const asset=Buffer.from(input.asset_base64,"base64"),hash=crypto.createHash("sha256").update(asset).digest("hex");
      if(hash!==input.asset_sha256) return json(res,409,failReceipt("asset_hash","asset hash mismatch"));
      const form=new FormData();form.set("media",new Blob([asset],{type:input.asset_mime||"image/png"}),input.asset_filename||"asset.png");form.set("media_category","tweet_image");
      const media=await xFetch("https://api.x.com/2/media/upload",auth.access_token,{method:"POST",body:form});
      const mediaId=media?.data?.id||media?.media_id_string||media?.id;
      if(!mediaId) throw new Error("X media receipt missing media id");
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
