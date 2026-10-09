import brand from './email-brand.cjs';
import crypto from 'node:crypto';
import nodemailer from 'nodemailer';
import net from 'node:net';
import {emailVersion,correspondentName} from './editorial-email.js';

export const expectedEditorialSender=brand.identity.address;
const smtpConfig=()=>({host:process.env.EDITORIAL_SMTP_HOST,port:Number(process.env.EDITORIAL_SMTP_PORT||465),secure:(process.env.EDITORIAL_SMTP_SECURE||'true')==='true',auth:{user:process.env.EDITORIAL_SMTP_USER,pass:process.env.EDITORIAL_SMTP_PASSWORD}});
const configured=()=>!!(smtpConfig().host&&smtpConfig().auth.user===expectedEditorialSender&&smtpConfig().auth.pass&&smtpConfig().secure&&smtpConfig().port===465);
export const editorialSenderStatus=()=>({expected:expectedEditorialSender,reply_to:brand.identity.reply_to,configured_user:configured()?expectedEditorialSender:null,authentication:'UNVERIFIED_UNTIL_PROVIDER_CHECK',smtp_configuration:configured()?'PRESENT':'MISSING',legacy_gmail_preserved:!!sender(),gate:configured()?'CONFIGURED':relay()?'RELAY_CHECK_REQUIRED':'BLOCKED'});
export async function editorialRouteStatus(){if(relay()){try{return await relayRequest('status');}catch(e){return {status:'BLOCKED',reason:e.message};}}return {status:configured()?'CONFIGURED':'BLOCKED',reason:configured()?null:'CANONICAL_SMTP_CONFIGURATION_REQUIRED',...editorialSenderStatus()};}
export const probeEditorialNetwork=()=>new Promise(resolve=>{
  const started=Date.now(),socket=net.createConnection({host:'smtp.gmail.com',port:465});
  let done=false;const finish=(status,error=null)=>{if(done)return;done=true;socket.destroy();resolve({host:'smtp.gmail.com',port:465,status,error,elapsed_ms:Date.now()-started});};
  socket.setTimeout(5000,()=>finish('BLOCKED_OR_UNREACHABLE','CONNECT_TIMEOUT'));
  socket.once('connect',()=>finish('CONNECTED'));socket.once('error',e=>finish('BLOCKED_OR_UNREACHABLE',e.code));
});

const sender=()=>process.env.EDITORIAL_GMAIL_USER;
const password=()=>process.env.EDITORIAL_GMAIL_APP_PASSWORD;
const relay=()=>process.env.EMRADAR_EMAIL_RELAY_URL;
async function relayRequest(operation,payload={}){
  if(relay()!=='https://orok-studios-api.onrender.com'||!process.env.EMRADAR_EMAIL_RELAY_TOKEN)throw new Error('APPROVED_PAID_EMAIL_RELAY_REQUIRED');
  const response=await fetch(relay()+'/emradar/email/'+operation,{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+process.env.EMRADAR_EMAIL_RELAY_TOKEN},body:JSON.stringify({user:sender(),password:password(),...payload}),signal:AbortSignal.timeout(45000)});
  const result=await response.json();if(!response.ok){const e=new Error(result.reason||'EMAIL_RELAY_FAILED');e.code=result.code;e.command=result.command;throw e;}return result;
}
export async function verifyEditorialAuthentication(){
  if(relay())return relayRequest('verify');
  if(!configured())throw new Error('CANONICAL_SMTP_CONFIGURATION_REQUIRED');
  await transport().verify();return {status:'PASS',authenticated_user:expectedEditorialSender,transport:'CANONICAL_EDITORIAL_SMTP'};
}
const transport=()=>nodemailer.createTransport(smtpConfig());

export const editorialSenderIdentity=()=>({...brand.identity,approved:true});

export function reviewedMail(asset,route){
 const email=asset?.email;
 if(!email||email.to!==route.public_contact_point||asset.copy!==`Subject: ${email.subject}\n\n${email.body}`||/[\r\n]/.test(email.subject))throw new Error('EXACT_REVIEWED_EMAIL_REQUIRED');
 return brand.envelope(email);
}

export const editorialRouteSupported=route=>String(route?.access_method||'').toLowerCase().includes('email');
export const editorialRouteAuthorized=async()=>(await editorialRouteStatus()).status==='CONFIGURED';

export async function sendEditorialEmail({idempotency_key,product,asset,route,approvalBinding}){
  if(!await editorialRouteAuthorized())throw new Error('CANONICAL_SMTP_AUTHORIZATION_REQUIRED');
  if(!editorialRouteSupported(route))throw new Error('EDITORIAL_EMAIL_ROUTE_REQUIRED');
  const to=String(route.public_contact_point||'').trim();
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to))throw new Error('EDITORIAL_EMAIL_CONTACT_INVALID');
  const mail=reviewedMail(asset,route);
  const binding=approvalBinding;
  if(relay()&&(!binding||binding.proposal.asset.email.to!==mail.to))throw new Error('OWNER_APPROVED_EMAIL_BINDING_REQUIRED');
  const signature=binding?crypto.createHmac('sha256',process.env.EMRADAR_EMAIL_RELAY_TOKEN).update('EMRADAR_OWNER_APPROVED_DELIVERY_V1\n'+JSON.stringify({mail,idempotency_key,binding})).digest('hex'):null;
  const info=relay()?await relayRequest('submit',{mail,idempotency_key,binding,signature}):await transport().sendMail({
    ...mail,
    headers:{'X-EMRADAR-Idempotency-Key':idempotency_key}
  });
  if(!info.messageId||!info.accepted?.includes(to))throw new Error('EDITORIAL_GMAIL_DELIVERY_NOT_ACCEPTED');
  return {id:info.messageId,status:'ACCEPTED',receipt:{message_id:info.messageId,accepted:[...info.accepted],rejected:[...(info.rejected||[])],idempotency_key}};
}

export async function collectEditorialOutcome(receipt){
  if(receipt.sender_identity?.address!==expectedEditorialSender&&(sender()!=='oroknows@gmail.com'||!password()))throw new Error('GMAIL_READ_AUTHORIZATION_REQUIRED');
  if(!relay())return {source:'GMAIL_READ_TRANSPORT_UNAVAILABLE',metrics:{},collection:{status:'BLOCKED',reason:'EXISTING_PAID_RELAY_REQUIRED'}};
  return relayRequest('collect',{receipt:{id:receipt.id,sender_identity:receipt.sender_identity,message_id:receipt.provider_receipt?.message_id,recipient:receipt.recipient,submitted_at:receipt.timestamp,publication_domain:receipt.publication_domain}});
}

