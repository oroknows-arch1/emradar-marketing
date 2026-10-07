import nodemailer from 'nodemailer';
import net from 'node:net';
import {emailVersion,correspondentName} from './editorial-email.js';

export const expectedEditorialSender='oroknows@gmail.com';
export const editorialSenderStatus=()=>({expected:expectedEditorialSender,authenticated_user:sender()||null,password_present:!!password(),gate:sender()===expectedEditorialSender&&!!password()?'PASS':'BLOCKED'});
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
  if(editorialSenderStatus().gate!=='PASS')throw new Error('EDITORIAL_AUTHENTICATED_SENDER_MISMATCH');
  if(relay())return relayRequest('verify');
  await transport().verify();return {status:'PASS',authenticated_user:sender(),transport:'DIRECT_GMAIL_SMTP'};
}
const transport=()=>nodemailer.createTransport({
  service:'gmail',
  auth:{user:sender(),pass:password()}
});

export const editorialSenderIdentity=()=>({name:correspondentName,address:sender(),approved:editorialSenderStatus().gate==='PASS'});

export function reviewedMail(asset,route){
  if(editorialSenderStatus().gate!=='PASS')throw new Error('EDITORIAL_AUTHENTICATED_SENDER_MISMATCH');
  const email=asset?.email;
  if(!email||email.to!==route.public_contact_point||email.from.name!==correspondentName||email.from.address!==sender()||asset.copy!==`Subject: ${email.subject}\n\n${email.body}`||/[\r\n]/.test(email.subject))throw new Error('EXACT_REVIEWED_EMAIL_REQUIRED');
  return {from:email.from,to:email.to,subject:email.subject,text:email.body};
}

export const editorialRouteSupported=route=>String(route?.access_method||'').toLowerCase().includes('email');
export const editorialRouteAuthorized=async()=>editorialSenderStatus().gate==='PASS';

export async function sendEditorialEmail({idempotency_key,product,asset,route}){
  if(!await editorialRouteAuthorized())throw new Error('EDITORIAL_GMAIL_AUTHORIZATION_REQUIRED');
  if(!editorialRouteSupported(route))throw new Error('EDITORIAL_EMAIL_ROUTE_REQUIRED');
  const to=String(route.public_contact_point||'').trim();
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to))throw new Error('EDITORIAL_EMAIL_CONTACT_INVALID');
  const mail=reviewedMail(asset,route);
  const info=relay()?await relayRequest('submit',{mail,idempotency_key}):await transport().sendMail({
    ...mail,
    headers:{'X-EMRADAR-Idempotency-Key':idempotency_key}
  });
  if(!info.messageId||!info.accepted?.includes(to))throw new Error('EDITORIAL_GMAIL_DELIVERY_NOT_ACCEPTED');
  return {id:info.messageId,status:'ACCEPTED',receipt:{message_id:info.messageId,accepted:[...info.accepted],rejected:[...(info.rejected||[])],idempotency_key}};
}

export async function collectEditorialOutcome(receipt){
  if(editorialSenderStatus().gate!=='PASS')throw new Error('EDITORIAL_AUTHENTICATED_SENDER_MISMATCH');
  if(!relay())return {source:'GMAIL_READ_TRANSPORT_UNAVAILABLE',metrics:{},collection:{status:'BLOCKED',reason:'EXISTING_PAID_RELAY_REQUIRED'}};
  return relayRequest('collect',{receipt:{id:receipt.id,message_id:receipt.provider_receipt?.message_id,recipient:receipt.recipient,submitted_at:receipt.timestamp,publication_domain:receipt.publication_domain}});
}
