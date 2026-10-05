import nodemailer from 'nodemailer';

const sender=()=>process.env.EDITORIAL_GMAIL_USER;
const password=()=>process.env.EDITORIAL_GMAIL_APP_PASSWORD;
const transport=()=>nodemailer.createTransport({
  service:'gmail',
  auth:{user:sender(),pass:password()}
});

export const editorialRouteSupported=route=>String(route?.access_method||'').toLowerCase().includes('email');
export const editorialRouteAuthorized=async()=>!!(sender()&&password());

export async function sendEditorialEmail({idempotency_key,product,asset,route}){
  if(!await editorialRouteAuthorized())throw new Error('EDITORIAL_GMAIL_AUTHORIZATION_REQUIRED');
  if(!editorialRouteSupported(route))throw new Error('EDITORIAL_EMAIL_ROUTE_REQUIRED');
  const to=String(route.public_contact_point||'').trim();
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to))throw new Error('EDITORIAL_EMAIL_CONTACT_INVALID');
  const subject=`${product}: ${asset.copy.split('\n')[0].slice(0,120)}`;
  const info=await transport().sendMail({
    from:`EMRADAR <${sender()}>`,to,subject,text:asset.copy,
    headers:{'X-EMRADAR-Idempotency-Key':idempotency_key}
  });
  if(!info.messageId||!info.accepted?.includes(to))throw new Error('EDITORIAL_GMAIL_DELIVERY_NOT_ACCEPTED');
  return {id:info.messageId,status:'ACCEPTED',receipt:{message_id:info.messageId,accepted:[...info.accepted],rejected:[...(info.rejected||[])],idempotency_key}};
}

export async function collectEditorialOutcome(){
  return {source:'GMAIL_OUTCOME_NOT_CONNECTED',metrics:{}};
}
