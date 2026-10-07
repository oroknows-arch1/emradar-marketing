import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import nodemailer from 'nodemailer';
import brand from '../../runtime/email-brand.cjs';
import {correspondenceProbe} from '../../runtime/correspondence-probe.js';
import {validateHumanEmail} from '../../runtime/editorial-email.js';
import {reviewedMail,editorialSenderIdentity,editorialRouteAuthorized} from '../../runtime/editorial-outreach-gmail.js';
import {GraphEngine,digest} from '../../runtime/graph.js';
import {fixture} from './fixture.js';

test('canonical signature and both alternatives preserve destination-specific reviewed correspondence',()=>{
 const p=correspondenceProbe(),e=p.email;
 assert.equal(p.external_actions,0);assert.equal(validateHumanEmail(e,p.signal,p.route,p.identity).status,'PASS');
 assert.deepEqual(e.from,{name:'Sean Walker',address:'sean@emradar.net'});assert.equal(e.reply_to,'sean@emradar.net');
 assert(e.body.includes(brand.signature));assert(e.body.endsWith(brand.disclaimer));assert.equal(e.html,brand.render(e.body));
 for(const part of ['development','insight','proposition','question','next_step']){assert(e.body.includes(e.proposition.correspondence[part]));assert(e.html.includes(e.proposition.correspondence[part]));}
 assert(e.html.includes(brand.banner));assert.match(e.html,/width="600" height="180"/);
 assert.doesNotMatch(e.body+e.html,/linkedin|portrait|sean\.walker@|emradar\.au|oroknows@gmail\.com/i);
 assert.equal(editorialSenderIdentity().address,'sean@emradar.net');
});
test('HTML is escaped and cannot be independently edited after review',()=>{
 const e=correspondenceProbe().email,route={public_contact_point:e.to};
 const asset={email:e,copy:`Subject: ${e.subject}\n\n${e.body}`};
 assert.equal(reviewedMail(asset,route).text,e.body);
 e.html+='<p>unreviewed message</p>';assert.throws(()=>reviewedMail(asset,route),/EXACT_REVIEWED_BRAND/);
 assert(brand.render('<script>bad</script>\n\n'+brand.signature+'\n\n'+brand.disclaimer).includes('&lt;script&gt;'));
});
test('real MIME assembly produces multipart alternative with canonical From and Reply-To without network',async()=>{
 const e=correspondenceProbe().email;
 const transport=nodemailer.createTransport({streamTransport:true,buffer:true,newline:'unix'});
 const result=await transport.sendMail(brand.envelope(e)),mime=result.message.toString();
 assert.match(mime,/multipart\/alternative/);assert.match(mime,/text\/plain/);assert.match(mime,/text\/html/);
 assert.match(mime,/From: Sean Walker <sean@emradar.net>/);assert.match(mime,/Reply-To: sean@emradar.net/);
 assert.equal(result.envelope.from,'sean@emradar.net');
});
test('PUBLICATION_REVIEW binds rendered HTML, plain text, identity and source and stops before distribution',async()=>{
 const p=correspondenceProbe(),f=await fixture(),email=p.email,asset={format:'editor_pitch',email,delivery:p.route,copy:`Subject: ${email.subject}\n\n${email.body}`};
 let sends=0;const engine=new GraphEngine({store:f.store,products:{},adapters:{OPEN_ROUTE:{publish:()=>{sends++;throw Error('NO_NETWORK');}}}});
 const c={input:{product:'EMRADAR',campaign_id:'BRAND_REGRESSION_ONLY',stop_at:'PUBLICATION_REVIEW'},signal:p.signal,email,capability_claim_gate:{status:'PASS'},route:{id:p.route.destination_id,format:'editor_pitch',destination:{id:p.route.destination_id,platform:'OPEN_ROUTE',route_record:p.route,permission:{approved:true}}},asset,variant:{id:'brand-test'},truth_hash:'regression-source',product:{source_receipt:{digest:'regression'}},adapter:{cost:'ZERO'},state:{version:1},trace:[],run_id:'brand-test',read_only:true,status:'RUNNING'};
 c.truth_hash=digest(c.product);await engine.traverse(c,'publication_review');assert.equal(c.status,'AWAITING_REVIEW',c.blocker);assert.equal(sends,0);
 const proposal=await f.store.get('publication_review:'+c.review.proposal_id);assert.deepEqual(proposal.asset,asset);
 assert.equal(proposal.review_hash,digest({product_truth:c.truth_hash,signal_revision:p.signal.revision,asset,destination:proposal.review_binding.destination,source_receipt:c.product.source_receipt}));
 assert.notEqual(digest({...asset,email:{...email,html:email.html+'changed'}}),digest(asset));
 await engine.traverse({...c,trace:[],review:{decision:'AWAITING_REVIEW'}},'execute');assert.equal(sends,0);
});
test('missing canonical authentication blocks send even when legacy Gmail credentials exist',async()=>{
 const saved={...process.env};delete process.env.EMRADAR_EMAIL_RELAY_URL;delete process.env.EDITORIAL_SMTP_PASSWORD;
 process.env.EDITORIAL_GMAIL_USER='oroknows@gmail.com';process.env.EDITORIAL_GMAIL_APP_PASSWORD='fixture';
 try{assert.equal(await editorialRouteAuthorized(),false);}finally{for(const k of Object.keys(process.env))if(!(k in saved))delete process.env[k];Object.assign(process.env,saved);}
});
