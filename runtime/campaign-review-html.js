import crypto from 'node:crypto';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const show=value=>typeof value==='string'?value:JSON.stringify(value,null,2);
const finalReviewStatuses=new Set(['OWNER_APPROVED','REJECTED','SUBMITTED','PUBLISHED','IN_FLIGHT','AMBIGUOUS']);
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
// Only known greeting names and these recipient-organisation templates are personalisation.
// All claims, topics, source bindings, attachments and other saved wording remain in the key.
function emailEquivalenceKey(p){
 const a=p.asset||{},email=a.email||p.email,method=a.delivery_method;
 if(!email?.subject||typeof email.body!=='string'||method&&method!=='EMAIL'||p.platform==='X'||a.mime?.startsWith('image/')||a.article)return null;
 const destination=p.binding?.destination||{},delivery=a.delivery||{};
 const name=delivery.recipient_identity?.name||destination.delivery_record?.recipient_identity?.name;
 const organisation=destination.organisation||delivery.organisation;
 function paragraph(value,encoded=false,greeting=true){
  const n=encoded?esc(name):name,o=encoded?esc(organisation):organisation;
  if(n&&greeting)for(const prefix of ['Hi ','Hello ','Dear '])if(value===prefix+n+',')return prefix+'{recipient},';
  if(o){
   const templates=[
    ["I'm getting in touch because ","'s coverage of ",' provides a useful context for this development.'],
    ['Les escribo porque la cobertura de ',' sobre ',' ofrece un contexto pertinente para este desarrollo.']
   ];
   for(const parts of templates){const [before,after,end]=encoded?parts.map(esc):parts;
    if(value.startsWith(before+o+after)&&value.endsWith(end))return before+'{organisation}'+value.slice((before+o).length);
   }
   for(const [before,after] of [
    ['Would an evidence-led article or research contribution developing this angle be useful for ','?'],
    ['¿Les sería útil un artículo o una contribución de investigación que desarrolle este enfoque para ','?']
   ])if(value===(encoded?esc(before):before)+o+after)return (encoded?esc(before):before)+'{organisation}'+after;
  }
  return value;
 }
 function normalise(value){
  if(Array.isArray(value))return value.map(normalise);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,v])=>[key,normalise(v)]));
  if(typeof value!=='string')return value;
  if(value.includes('<p')){let index=0;return value.replace(/(<p\b[^>]*>)([^<]*)(<\/p>)/g,(_,open,text,close)=>open+paragraph(text,true,index++===0)+close);}
  const lines=value.split('\n'),greeting=lines[0].startsWith('Subject: ')?2:0;
  return lines.map((line,i)=>paragraph(line,false,i===greeting)).join('\n');
 }
 const {delivery:ignoredDelivery,to:ignoredTo,recipient_status:ignoredStatus,...asset}=a;
 const {to:ignoredRecipient,features,...envelope}=email;
 if(features){const {email_length_words:ignoredLength,...rest}=features;envelope.features=rest;}
 asset.email=envelope;
 return JSON.stringify(canonical({asset:normalise(asset),evidence:p.binding?.evidence||p.evidence_binding||p.evidence_refs,source_receipt:p.source_receipt}));
}
export function equivalentEmailGroups(proposals){
 const groups=new Map();
 proposals.forEach((p,i)=>{const equivalent=emailEquivalenceKey(p),key=equivalent===null?'individual:'+i:equivalent;
  if(!groups.has(key))groups.set(key,{id:crypto.createHash('sha256').update(key).digest('hex'),email:equivalent!==null,proposals:[]});groups.get(key).proposals.push(p);
 });
 return [...groups.values()].map(group=>({...group,proposals:group.proposals.slice().sort((a,b)=>String(a.proposal_id||'').localeCompare(String(b.proposal_id||'')))}));
}
export function campaignReviewHtml(record,campaign,{decisionPath='/PUBLICATION_REVIEW',v2=false}={}){
 const proposals=Array.isArray(record?.proposals)?record.proposals:[];
 const renderProposal=(p,i,controls=true)=>{
   const a=p.asset||{},email=a.email||p.email||{},copy=email.body||a.copy||p.copy||'',decision=record.owner_decisions?.[p.proposal_id],decided=finalReviewStatuses.has(decision?.status||p.status),disabled=decided?' disabled':'';
   const brandedHtml=typeof email.html==='string'&&email.html.trim()?email.html:null;
   const letterhead=brandedHtml?'<iframe title="Saved branded email preview" sandbox="" loading="lazy" referrerpolicy="no-referrer" style="width:100%;height:760px;border:1px solid #cad3df;border-radius:8px;background:#fff" srcdoc="'+esc(brandedHtml)+'"></iframe>':'';
   const warnings=(p.preview_warnings||[]).map(w=>'<li>'+esc(w.reason||show(w))+'</li>').join('');
   return '<article><h2>'+esc(i+1)+'. '+esc(p.destination||p.input?.destination_id||'Destination')+'</h2><p class="meta">'+esc(p.platform||'')+' · '+esc(p.review_state||p.status||'Saved proposal')+'</p>'+
   ((email.subject||a.subject)?'<h3>'+esc(email.subject||a.subject)+'</h3>':'')+
   (a.article?'<h3>'+esc(a.article.title)+'</h3><pre>'+esc(a.article.body)+'</pre><p>'+a.article.source_links.map(l=>'<a href="'+esc(l.url)+'">'+esc(l.source)+'</a>').join(' · ')+'</p>':'')+
   (letterhead||(copy?'<pre>'+esc(show(copy))+'</pre>':'<p class="warning">No rendered copy saved for this proposal.</p>'))+
   (a.mime==='image/png'&&typeof a.base64==='string'?'<img alt="Exact saved X PNG" style="width:100%;height:auto" src="data:image/png;base64,'+esc(a.base64)+'">':'')+
   (a.visual?.url?'<p><a href="'+esc(a.visual.url)+'">Visual asset</a></p>':'')+
   (warnings?'<h3>Review warnings</h3><ul>'+warnings+'</ul>':'')+
   (letterhead?'<details><summary>Exact saved email text</summary><pre>'+esc(show(copy))+'</pre></details>':'')+
   '<p>Recipient / submission: '+esc(email.to||a.delivery?.public_contact_point||'UNVERIFIED')+' · '+esc(a.delivery?.public_submission_url||'UNVERIFIED')+'</p>'+
   (controls?'<div class="decisions" data-settled="'+decided+'" data-id="'+esc(p.proposal_id)+'" data-hash="'+esc(p.review_hash)+'"><button data-decision="'+(v2?'APPROVE':'APPROVED')+'"'+disabled+'>'+(p.evidence_support_status?'Approve assessment (no delivery)':'Approve exact publication asset')+'</button> <button data-decision="'+(v2?'REJECT':'REJECTED')+'"'+disabled+'>Reject</button><input class="reason" aria-label="Decision reason" placeholder="Reason for rejection"><p class="result" role="status">'+esc(decision?.status||'Awaiting your decision')+(decision?.distribution?' · Delivery: '+esc(decision.distribution.status)+(decision.distribution.error?' · '+esc(decision.distribution.error):''):'')+'</p></div>':'')+
   '<details><summary>Evidence, IDs and full saved proposal</summary><pre>'+esc(JSON.stringify(p,null,2))+'</pre></details></article>';
 };
 const groups=equivalentEmailGroups(proposals),emailGroups=groups.filter(g=>g.email).length;
 const items=groups.map((group,i)=>{
  if(!group.email)return renderProposal(group.proposals[0],i);
  const members=group.proposals,settled=p=>finalReviewStatuses.has(record.owner_decisions?.[p.proposal_id]?.status||p.status),disabled=members.every(settled)?' disabled':'';
  return '<section class="email-group" data-group="'+group.id+'"><h2>Email group '+(i+1)+' · '+members.length+' saved proposals</h2>'+renderProposal(members[0],i,false)+
   '<h3>Every destination and recipient</h3><ul>'+members.map(p=>'<li>'+esc(p.destination||p.input?.destination_id)+' — '+esc(p.asset?.email?.to||p.email?.to||p.asset?.to||p.asset?.delivery?.public_contact_point||'UNVERIFIED')+' · '+esc(p.delivery_capability||p.status||'Saved proposal')+' <span data-member-status="'+esc(p.proposal_id)+'">'+esc(record.owner_decisions?.[p.proposal_id]?.status||p.status||'Awaiting your decision')+'</span>'+((p.preview_warnings||[]).length?' · warnings: '+esc(p.preview_warnings.map(w=>w.reason||show(w)).join('; ')):'')+'</li>').join('')+'</ul>'+
   '<p>Group decisions apply only to undecided members. Existing approvals and rejections stay unchanged.</p><button data-group-decision="'+(v2?'APPROVE':'APPROVED')+'"'+disabled+'>APPROVE GROUP</button> <button data-group-decision="'+(v2?'REJECT':'REJECTED')+'"'+disabled+'>REJECT GROUP</button><input class="group-reason" aria-label="Group rejection reason" placeholder="Reason for group rejection"><p class="group-result" role="status"></p>'+
   '<details class="members"><summary>Expand individual emails, evidence, warnings and decisions ('+members.length+')</summary>'+members.map((p,j)=>renderProposal(p,j)).join('')+'</details></section>';
 }).join('');
 const accounted=(record?.route_dispositions||[]).map(d=>'<article><h2>'+esc(d.publication||d.destination)+'</h2><p>'+esc(d.preparation_status||d.status)+' · score '+esc(d.route_score)+'</p><p>'+esc(d.route_reason||'')+'</p><p>'+esc(d.reason||'')+'</p><p>Contact: '+esc(d.contact||'UNVERIFIED')+' · submission: '+esc(d.submission||'UNVERIFIED')+'</p>'+(!proposals.some(p=>p.destination===d.destination)?'<p class="warning">No complete publication asset yet. Approval stays unavailable until evidence checks pass.</p>':'')+'<details><summary>Matching, evidence limitations and transport status</summary><pre>'+esc(JSON.stringify(d,null,2))+'</pre></details></article>').join('');
 const status=record?.status||'UNKNOWN';
 const warning=v2?'PUBLICATION_REVIEW. Nothing is sent before owner approval. Approval automatically distributes an executable exact asset; review-only routes remain unsent.':'PUBLICATION_REVIEW. No campaign distribution has been authorized. Approving a publication asset uses the existing automatic distribution path; approving an evidence limitation records owner assessment without delivery.';
 return '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>EMRADAR campaign review</title><style>body{font:16px/1.55 system-ui,sans-serif;max-width:800px;margin:auto;padding:18px;background:#10151d;color:#edf2f7}h1{font-size:1.65rem}article{background:#1b2430;border:1px solid #384453;border-radius:14px;padding:18px;margin:18px 0}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:14px/1.5 ui-monospace,monospace}h2{font-size:1.2rem}.meta{color:#b6c4d6}.warning{color:#ffcc8d}details{margin-top:18px;border-top:1px solid #394454;padding-top:12px}summary{cursor:pointer}button,input{font:inherit;min-height:44px;padding:10px;max-width:100%;margin:6px 0;box-sizing:border-box}button{cursor:pointer;white-space:normal}input{width:100%}a{color:#8ac8ff}</style><main><h1>EMRADAR · Campaign review</h1><p>'+esc(campaign||record?.campaign_id||'Latest campaign')+'</p><p><strong>Saved status:</strong> '+esc(status)+' · <strong>Saved proposals:</strong> '+proposals.length+' · <strong>Distinct email groups:</strong> '+emailGroups+'</p><p class="warning">'+warning+'</p>'+ '<div id="authentication"><label>Owner credential <input id="credential" type="password" autocomplete="off" placeholder="Existing review token"></label><p id="auth-status" role="status">Enter once. Your owner session is reused for approval and rejection.</p></div>'+ (items||'<article>No saved proposals found in this package.</article>')+'<h2>Every registered destination</h2>'+accounted+'<details><summary>Full package and missing-asset diagnostics</summary><pre>'+esc(JSON.stringify(record,null,2))+'</pre></details></main>' + `<script>
let authenticated=false;
const authBox=document.getElementById('authentication'),tokenField=document.getElementById('credential'),authStatus=document.getElementById('auth-status');
const sessionReady=fetch('/PUBLICATION_REVIEW/session',{credentials:'same-origin'}).then(r=>r.json()).then(v=>{authenticated=v.authenticated;if(authenticated)authBox.hidden=true;else if(!v.configured)authStatus.textContent='Owner authentication is not configured on the service.';}).catch(()=>{});
async function authenticate(){await sessionReady;if(authenticated)return;const token=tokenField.value.trim().replace(/^Bearer\\s+/i,'');if(!token)throw Error('Enter your existing owner credential once.');const r=await fetch('/PUBLICATION_REVIEW/session',{method:'POST',credentials:'same-origin',headers:{Authorization:'Bearer '+token}});const v=await r.json();if(!r.ok)throw Error(v.reason==='OWNER_REVIEW_AUTH_CONFIGURATION_MISSING'?'Owner authentication is not configured on the service.':'Owner credential was not accepted. No decision was saved.');authenticated=true;tokenField.value='';authBox.hidden=true;}
tokenField.addEventListener('change',()=>authenticate().catch(e=>authStatus.textContent=e.message));
const inFlight=new Map(),runningGroups=new Set();
function updateGroup(group){if(!group||runningGroups.has(group))return;const complete=[...group.querySelectorAll('.decisions')].every(d=>d.dataset.settled==='true');group.querySelectorAll('button[data-group-decision]').forEach(b=>b.disabled=complete);}
async function saveDecision(d,decision,reason){
 if(d.dataset.settled==='true')return {skipped:true};
 if(inFlight.has(d.dataset.id)){await inFlight.get(d.dataset.id);return {skipped:true};}
 const out=d.querySelector('.result'),buttons=d.querySelectorAll('button');buttons.forEach(b=>b.disabled=true);
 const pending=(async()=>{try{await authenticate();const r=await fetch('${decisionPath}',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({proposal_id:d.dataset.id,review_hash:d.dataset.hash,decision,reason})});const v=await r.json();if(!r.ok)throw Error(v.reason||'Decision was not saved.');
 d.dataset.settled='true';const delivery=v.automatic_distribution||v.distribution_status;out.textContent=(v.status||v.decision)+(delivery?' · Delivery: '+(delivery.status||delivery)+(delivery.receipt?.error?' · '+delivery.receipt.error:''):'');
 const group=d.closest('.email-group');if(group){const label=group.querySelector('[data-member-status="'+d.dataset.id+'"]');if(label)label.textContent=out.textContent;}return {saved:true};
 }catch(e){out.textContent=e.message;buttons.forEach(b=>b.disabled=false);throw e;}finally{inFlight.delete(d.dataset.id);updateGroup(d.closest('.email-group'));}})();
 inFlight.set(d.dataset.id,pending);return pending;
}
document.querySelectorAll('button[data-decision]').forEach(b=>b.onclick=async()=>{
 if(b.disabled)return;const d=b.closest('.decisions'),out=d.querySelector('.result'),reason=d.querySelector('.reason').value;
 if(['APPROVE','APPROVED'].includes(b.dataset.decision)&&!confirm('Approve this exact saved asset or assessment?'))return;
 if(['REJECT','REJECTED'].includes(b.dataset.decision)&&!reason.trim()){out.textContent='Enter a rejection reason.';return;}
 try{await saveDecision(d,b.dataset.decision,reason);}catch{};
});
document.querySelectorAll('button[data-group-decision]').forEach(b=>b.onclick=async()=>{
 const group=b.closest('.email-group');if(b.disabled||runningGroups.has(group))return;
 const out=group.querySelector('.group-result'),reason=group.querySelector('.group-reason').value;
 if(['APPROVE','APPROVED'].includes(b.dataset.groupDecision)&&!confirm('Approve every undecided exact asset in this group for its listed recipient?'))return;
 if(['REJECT','REJECTED'].includes(b.dataset.groupDecision)&&!reason.trim()){out.textContent='Enter a group rejection reason.';return;}
 runningGroups.add(group);group.querySelectorAll('button[data-group-decision]').forEach(button=>button.disabled=true);
 let saved=0,skipped=0,failed=0;
 try{for(const d of group.querySelectorAll('.decisions')){try{const result=await saveDecision(d,b.dataset.groupDecision,reason);if(result.skipped)skipped++;else saved++;}catch{failed++;}}
 out.textContent=saved+' saved; '+skipped+' already decided; '+failed+' failed.'+(failed?' Expand individual results; retry this group to resume failed members.':'');if(failed)group.querySelector('.members').open=true;
 }finally{runningGroups.delete(group);updateGroup(group);}
});
</script></html>`;
}
