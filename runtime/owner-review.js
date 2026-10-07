import crypto from 'node:crypto';
const cookieName='__Host-emradar-review';
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const digest=value=>crypto.createHash('sha256').update(value).digest();
const equal=(a,b)=>crypto.timingSafeEqual(digest(a),digest(b));
const campaignPattern=/^EMRADAR_[A-Z0-9_]{8,80}$/;
const headers={'cache-control':'no-store','content-security-policy':"default-src 'none'; style-src 'unsafe-inline'; img-src data:; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",'referrer-policy':'no-referrer','x-content-type-options':'nosniff'};
function page(content){return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>EMRADAR review</title><style>body{font:16px system-ui;max-width:900px;margin:auto;padding:24px;background:#10151b;color:#f1f4f8}a{color:#a8d7ff}input,button{font:inherit;padding:12px;margin:8px 0}pre{white-space:pre-wrap;overflow-wrap:anywhere}section{border:1px solid #48525e;border-radius:12px;padding:20px;margin:20px 0}img{max-width:100%}summary{cursor:pointer}</style></head><body><h1>EMRADAR publication review</h1><p>Viewing only. This page cannot approve, reject or distribute.</p>${content}</body></html>`;}
export function createOwnerReview({password,getPackage,limitAttempt,now=Date.now}){
 const sign=(value,secret)=>crypto.createHmac('sha256',secret).update('owner-review-read-only-v1:'+value).digest('hex');
 const valid=(req,secret)=>{
  const token=String(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(cookieName+'='))?.slice(cookieName.length+1)||'';
  const match=token.match(/^(\d{13})\.([a-f0-9]{32})\.([a-f0-9]{64})$/);
  return !!match&&Number(match[1])>now()&&Number(match[1])<=now()+8*3600000&&equal(match[3],sign(match[1]+'.'+match[2],secret));
 };
 return async(req,res,u)=>{
  const respond=(status,body,type='text/html; charset=utf-8',extra={})=>{res.writeHead(status,{...headers,'content-type':type,...extra});res.end(body);};
  const json=(status,value)=>respond(status,JSON.stringify(value),'application/json');
  const login=message=>page(`${message?'<p>'+escape(message)+'</p>':''}<form method="post" action="/owner-review/login"><label>Owner review password<br><input type="password" name="password" autocomplete="current-password" required maxlength="1024"></label><br><button>View saved reviews</button></form>`);
  try{
   const secret=password();
   if(!secret)return json(503,{reason:'OWNER_REVIEW_PASSWORD_NOT_CONFIGURED'});
   if(u.pathname==='/owner-review/login'){
    if(req.method==='GET')return respond(200,login());
    if(req.method!=='POST')return json(405,{reason:'METHOD_NOT_ALLOWED'});
    const origin=req.headers.origin;
    if(origin!==`https://${req.headers.host}`||!String(req.headers['content-type']||'').startsWith('application/x-www-form-urlencoded'))return json(403,{reason:'SAME_ORIGIN_FORM_REQUIRED'});
    if(!await limitAttempt())return json(429,{reason:'LOGIN_RATE_LIMITED'});
    let body='',size=0;
    for await(const chunk of req){size+=chunk.length;if(size>8192)return json(413,{reason:'LOGIN_INPUT_TOO_LARGE'});body+=chunk.toString();}
    const supplied=new URLSearchParams(body).get('password')||'';
    if(!supplied||!equal(supplied,secret))return respond(401,login('Password not accepted.'));
    const payload=String(now()+8*3600000)+'.'+crypto.randomBytes(16).toString('hex');
    return respond(303,'','text/plain',{'location':'/owner-review','set-cookie':`${cookieName}=${payload}.${sign(payload,secret)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=28800`});
   }
   if(!['/owner-review','/owner-review/package'].includes(u.pathname))return json(404,{reason:'NOT_FOUND'});
   if(req.method!=='GET')return json(405,{reason:'READ_ONLY_OWNER_ACCESS'});
   if(!valid(req,secret)){
    if(u.pathname==='/owner-review')return respond(200,login());
    return json(403,{reason:'OWNER_PUBLICATION_REVIEW_AUTH_REQUIRED'});
   }
   const campaign=u.searchParams.get('campaign_id');
   if(campaign&&!campaignPattern.test(campaign))return json(400,{reason:'CAMPAIGN_ID_INVALID'});
   const pkg=await getPackage(campaign);
   if(!pkg)return json(404,{reason:'REVIEW_PACKAGE_NOT_FOUND'});
   if(u.pathname==='/owner-review/package')return json(200,pkg);
   const sections=(pkg.proposals||[]).map(p=>{
    const a=p.asset||{},email=a.email||{};
    const image=a.format==='image'&&['image/png','image/jpeg'].includes(a.mime)&&typeof a.base64==='string'&&/^[A-Za-z0-9+/=\r\n]+$/.test(a.base64)?`<img alt="Reviewed visual asset" src="data:${a.mime};base64,${a.base64}">`:'';
    const metadata={destination:p.destination,platform:p.platform,reason_for_fit:p.reason_for_fit||p.destination_reason||a.delivery?.reason_for_fit||null,transport:a.delivery,evidence_state:p.signal_state,evidence_refs:p.evidence_refs,permission_state:p.permission_state||'EXACT_OWNER_REVIEW_REQUIRED',cost_state:p.distribution_cost_state||p.cost_state,cost:p.cost,review_state:p.review_state||p.status};
    return `<section><h2>${escape(p.destination)}</h2><h3>${escape(email.subject||a.title||p.title||'Review copy')}</h3><pre>${escape(email.body||a.copy||p.copy)}</pre>${image}<pre>${escape(JSON.stringify(metadata,null,2))}</pre><details><summary>Complete saved artifact</summary><pre>${escape(JSON.stringify(p,null,2))}</pre></details></section>`;
   }).join('');
   return respond(200,page(`<h2>${escape(pkg.campaign_id)}</h2><p>Saved state: ${escape(pkg.status)} · Proposed destinations: ${(pkg.proposals||[]).length}</p><p><a href="/owner-review/package?campaign_id=${encodeURIComponent(pkg.campaign_id)}">Complete review package (JSON)</a></p>${sections}<details><summary>Source, routing and blockers</summary><pre>${escape(JSON.stringify({...pkg,proposals:undefined},null,2))}</pre></details>`));
  }catch{return json(503,{reason:'OWNER_REVIEW_TEMPORARILY_UNAVAILABLE'});}
 };
}
