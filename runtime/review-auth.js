import crypto from 'node:crypto';
const cookieName='emradar_review';
const lifetime=30*24*60*60;
const equal=(a,b)=>typeof a==='string'&&typeof b==='string'&&Buffer.byteLength(a)===Buffer.byteLength(b)&&crypto.timingSafeEqual(Buffer.from(a),Buffer.from(b));
export function createReviewAuth({secret,origin,clock=()=>Date.now()}){
 const key=()=>typeof secret==='function'?secret():secret;
 const signature=value=>crypto.createHmac('sha256',key()).update('publication-review:'+value).digest('base64url');
 const bearer=req=>!!key()&&equal(req.headers.authorization,'Bearer '+key());
 const session=req=>{
  if(!key())return false;
  const value=String(req.headers.cookie||'').split(';').map(v=>v.trim()).find(v=>v.startsWith(cookieName+'='))?.slice(cookieName.length+1)||'';
  const [expiry,nonce,sig,...extra]=value.split('.');
  if(extra.length||!/^\d+$/.test(expiry)||! /^[a-f0-9]{32}$/.test(nonce||'')||Number(expiry)*1000<=clock()||Number(expiry)*1000>clock()+lifetime*1000)return false;
  return equal(sig,signature(expiry+'.'+nonce));
 };
 return {
  configured:()=>!!key(),
  authorized:req=>bearer(req)||(session(req)&&(['GET','HEAD'].includes(req.method)||req.headers.origin===origin(req))),
  establish(req,res){
   if(!bearer(req))return false;
   const value=Math.floor(clock()/1000+lifetime)+'.'+crypto.randomBytes(16).toString('hex');
   res.setHeader('Set-Cookie',cookieName+'='+value+'.'+signature(value)+'; Path=/; Max-Age='+lifetime+'; HttpOnly; Secure; SameSite=Strict');
   return true;
  }
 };
}
