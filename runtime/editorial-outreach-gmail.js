import nodemailer from 'nodemailer';
import net from 'node:net';

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
const transport=()=>nodemailer.createTransport({
  service:'gmail',
  auth:{user:sender(),pass:password()}
});

export const editorialSenderIdentity=()=>({name:'EMRADAR',address:sender(),approved:editorialSenderStatus().gate==='PASS'});

export function reviewedMail(asset,route){
  if(editorialSenderStatus().gate!=='PASS')throw new Error('EDITORIAL_AUTHENTICATED_SENDER_MISMATCH');
  const email=asset?.email;
  if(!email||email.version!=='human-ready-email-v1'||asset.capability_claim_gate?.status!=='PASS'||email.to!==route.public_contact_point||email.from.name!=='EMRADAR'||email.from.address!==sender()||asset.copy!==`Subject: ${email.subject}\n\n${email.body}`||/[\r\n]/.test(email.subject))throw new Error('EXACT_REVIEWED_EMAIL_REQUIRED');
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
  const info=await transport().sendMail({
    ...mail,
    headers:{'X-EMRADAR-Idempotency-Key':idempotency_key}
  });
  if(!info.messageId||!info.accepted?.includes(to))throw new Error('EDITORIAL_GMAIL_DELIVERY_NOT_ACCEPTED');
  return {id:info.messageId,status:'ACCEPTED',receipt:{message_id:info.messageId,accepted:[...info.accepted],rejected:[...(info.rejected||[])],idempotency_key}};
}

export async function collectEditorialOutcome(){
  return {source:'GMAIL_OUTCOME_NOT_CONNECTED',metrics:{}};
}
