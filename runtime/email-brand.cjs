'use strict';
// Canonical presentation: one reviewed text body, deterministic HTML.
const identity=Object.freeze({name:'Sean Walker',address:'sean@emradar.net',reply_to:'sean@emradar.net',website:'emradar.net',role:'EMRADAR | Research & Editorial'});
const version='connected-earth-v1';
const banner_sha256='5ff3edcfe20c6c4e9dd6d81fb96b430d476d7b1cac3df3ed0ecdcdd1c887ee8b';
const banner='https://emerging-markets-radar.onrender.com/assets/connected-earth-email-v1.jpg';
const signature=[identity.name,identity.role,'Tracking how world changes create market opportunities and real-world consequences.',identity.address,identity.website].join('\n');
const disclaimer='This email is from EMRADAR Research & Editorial. It contains independent analysis based on publicly available information. It is not financial advice. Please consider your own evaluation and due diligence.';
const tail=signature+'\n\n'+disclaimer;
const esc=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function correspondence(body){if(!body.endsWith(tail))throw Error('EMAIL_BRAND_TEXT_REQUIRED');return body.slice(0,-tail.length)+identity.name+'\nEMRADAR';}
function render(body){
 correspondence(body);
 const intro=body.slice(0,-tail.length);
 const paragraphs=intro.split('\n\n').map(p=>'<p style="margin:0 0 16px;line-height:1.6">'+esc(p).replace(/\n/g,'<br>')+'</p>').join('');
 return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#fff;color:#142038;font-family:Arial,sans-serif"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td style="padding:24px"><table role="presentation" width="600" cellspacing="0" cellpadding="0" style="width:100%;max-width:600px"><tr><td>'+paragraphs+'<p style="line-height:1.6;margin:0 0 20px"><strong style="font-size:18px">'+esc(identity.name)+'</strong><br><span style="color:#0862f7">'+esc(identity.role)+'</span><br>'+esc(signature.split('\n')[2])+'<br><a href="mailto:'+identity.address+'">'+identity.address+'</a><br><a href="https://'+identity.website+'">'+identity.website+'</a></p><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#031728;color:#fff"><tr><td style="padding:16px 20px"><strong style="font-size:28px">EMRADAR</strong><br><span style="font-size:11px;letter-spacing:1px">EMERGING MARKET INTELLIGENCE</span></td></tr><tr><td><img src="'+banner+'" width="600" height="180" alt="EMRADAR connected Earth — Africa, Europe and Middle East" style="display:block;width:100%;max-width:600px;height:auto;border:0"></td></tr></table><p style="font-size:11px;color:#5c6980;line-height:1.5;margin:16px 0 0">'+esc(disclaimer)+'</p></td></tr></table></td></tr></table></body></html>';
}
function brand(email){
 const ending='Sean Walker\nEMRADAR';
 if(!email.body.endsWith(ending))throw Error('EMAIL_CORRESPONDENCE_REQUIRED');
 email.body=email.body.slice(0,-ending.length)+tail;
 email.from={name:identity.name,address:identity.address};email.reply_to=identity.reply_to;
 email.brand_version=version;email.banner_sha256=banner_sha256;email.html=render(email.body);email.visual='CONNECTED_EARTH';
 if(email.features)email.features.email_length_words=email.body.trim().split(/\s+/).length;
 return email;
}
function envelope(email){
 if(email.brand_version!==version||email.banner_sha256!==banner_sha256||email.from?.name!==identity.name||email.from?.address!==identity.address||email.reply_to!==identity.reply_to||email.html!==render(email.body))throw Error('EXACT_REVIEWED_BRAND_REQUIRED');
 return {from:email.from,to:email.to,subject:email.subject,text:email.body,replyTo:identity.reply_to,html:email.html};
}
module.exports={identity,version,banner,banner_sha256,signature,disclaimer,brand,render,correspondence,envelope};
