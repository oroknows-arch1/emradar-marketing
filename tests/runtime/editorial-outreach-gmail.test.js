import test from 'node:test';
import assert from 'node:assert/strict';
import {editorialRouteSupported,editorialRouteAuthorized} from '../../runtime/editorial-outreach-gmail.js';

test('canonical SMTP requires host, matching mailbox and password',async()=>{
 const saved={...process.env};delete process.env.EMRADAR_EMAIL_RELAY_URL;
 try{delete process.env.EDITORIAL_SMTP_PASSWORD;assert.equal(await editorialRouteAuthorized(),false);
 Object.assign(process.env,{EDITORIAL_SMTP_HOST:'smtp.example.test',EDITORIAL_SMTP_PORT:'465',EDITORIAL_SMTP_SECURE:'true',EDITORIAL_SMTP_USER:'sean@emradar.net',EDITORIAL_SMTP_PASSWORD:'fixture'});assert.equal(await editorialRouteAuthorized(),true);
 process.env.EDITORIAL_SMTP_USER='oroknows@gmail.com';assert.equal(await editorialRouteAuthorized(),false);
 }finally{for(const k of Object.keys(process.env))if(!(k in saved))delete process.env[k];Object.assign(process.env,saved);}
});

test('Gmail transport supports verified email routes but not public forms',()=>{
  assert.equal(editorialRouteSupported({access_method:'public editorial email'}),true);
  assert.equal(editorialRouteSupported({access_method:'public feedback/tip-off form'}),false);
});


test('signed V2 relay request carries persisted approval and exact reviewed envelope',async()=>{
 const {sendEditorialEmail}=await import('../../runtime/editorial-outreach-gmail.js'),{default:brand}=await import('../../runtime/email-brand.cjs'),{default:crypto}=await import('node:crypto');
 const hash=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex'),saved={...process.env},oldFetch=globalThis.fetch;
 try{
 Object.assign(process.env,{EMRADAR_EMAIL_RELAY_URL:'https://orok-studios-api.onrender.com',EMRADAR_EMAIL_RELAY_TOKEN:'fixture'});
 const email=brand.brand({to:'editor@example.test',subject:'Exact subject',body:'Hello,\n\nExact approved correspondence.\n\nSean Walker\nEMRADAR'}),route={access_method:'verified email',public_contact_point:email.to},asset={email,copy:`Subject: ${email.subject}\n\n${email.body}`,delivery:route},binding={campaign_id:'EMRADAR_2026_10_10_LAUNCH',asset},review_hash=hash(binding),delivery_key='stable-key',proposal_id=hash([delivery_key,review_hash]);
 const proposal={proposal_id,review_hash,delivery_key,binding,asset,status:'OWNER_APPROVED'},approval={proposal_id,review_hash,decision:'APPROVE',authority:'OWNER',decided_at:'2026-10-10T00:00:00Z'},approvalBinding={version:'EMRADAR_OWNER_APPROVED_DELIVERY_V2',proposal,approval};let submits=0;
 globalThis.fetch=async(url,request)=>{
 if(url.endsWith('/status'))return {ok:true,json:async()=>({status:'CONFIGURED'})};
 submits++;const payload=JSON.parse(request.body);assert.equal(request.headers.authorization,'Bearer fixture');assert.deepEqual(payload.mail,brand.envelope(email));assert.deepEqual(payload.binding,approvalBinding);assert.equal(payload.idempotency_key,delivery_key);assert.equal(payload.signature,crypto.createHmac('sha256','fixture').update('EMRADAR_OWNER_APPROVED_DELIVERY_V1\n'+JSON.stringify({mail:payload.mail,idempotency_key:delivery_key,binding:approvalBinding})).digest('hex'));return {ok:true,json:async()=>({messageId:'receipt',accepted:[email.to]})};
 };
 const request={idempotency_key:delivery_key,product:'EMRADAR',asset,route,approvalBinding};assert.equal((await sendEditorialEmail(request)).id,'receipt');assert.equal(submits,1);
 await assert.rejects(()=>sendEditorialEmail({...request,approvalBinding:{...approvalBinding,approval:{...approval,decision:'REJECT'}}}),/OWNER_APPROVED_EMAIL_BINDING_REQUIRED/);assert.equal(submits,1);
 }finally{globalThis.fetch=oldFetch;for(const k of Object.keys(process.env))if(!(k in saved))delete process.env[k];Object.assign(process.env,saved);}
});
