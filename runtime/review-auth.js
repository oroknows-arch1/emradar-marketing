import crypto from 'node:crypto';
const cookieName='emradar_review';
const lifetime=30*24*60*60;
const equal=(a,b)=>typeof a==='string'&&typeof b==='string'&&Buffer.byteLength(a)===Buffer.byteLength(b)&&crypto.timingSafeEqual(Buffer.from(a),Buffer.from(b));
export function createReviewAuth({secret,origin,clock=()=>Date.now()}){
 const key=()=>typeof secret==='function'?secret():secret;
 const signature=value=>crypto.createHmac('sha256',key()).update('publication-review:'+value).digest('base64url');
 const bearer=req=>!!key()&&equal(req.headers.authorization,'Bearer '+key());
 const session=(req,campaign)=>{
  if(!key())return false;
  const value=String(req.headers.cookie||'').split(';').map(v=>v.trim()).find(v=>v.startsWith(cookieName+'='))?.slice(cookieName.length+1)||'';
  const parts=value.split('.'),[expiry,nonce]=parts,sig=parts.at(-1),scope=parts.length===4?parts[2]:null;
  if(![3,4].includes(parts.length))return false;
  if(scope&&campaign&&scope!==Buffer.from(campaign).toString('base64url'))return false;
  if(!/^\d+$/.test(expiry)||! /^[a-f0-9]{32}$/.test(nonce||'')||Number(expiry)*1000<=clock()||Number(expiry)*1000>clock()+lifetime*1000)return false;
  return equal(sig,signature(parts.slice(0,-1).join('.')));
 };
 const establishOwnerSession=(res,campaign)=>{
   if(!key())return false;
   const value=Math.floor(clock()/1000+lifetime)+'.'+crypto.randomBytes(16).toString('hex')+(campaign?'.'+Buffer.from(campaign).toString('base64url'):'');
   res.setHeader('Set-Cookie',cookieName+'='+value+'.'+signature(value)+'; Path=/; Max-Age='+lifetime+'; HttpOnly; Secure; SameSite=Strict');
   return true;
 };
 return {
  establishOwnerSession,
  configured:()=>!!key(),
  authorized:(req,campaign)=>bearer(req)||(session(req,campaign)&&(['GET','HEAD'].includes(req.method)||req.headers.origin===origin(req))),
  establish(req,res){
   if(!bearer(req))return false;
   return establishOwnerSession(res);
  }
 };
}
