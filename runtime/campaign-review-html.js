const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const show=value=>typeof value==='string'?value:JSON.stringify(value,null,2);
export function campaignReviewHtml(record,campaign){
 const proposals=Array.isArray(record?.proposals)?record.proposals:[];
 const items=proposals.map((p,i)=>{
   const a=p.asset||{},email=a.email||p.email||{},copy=email.body||a.copy||p.copy||'';
   const warnings=(p.preview_warnings||[]).map(w=>'<li>'+esc(w.reason||show(w))+'</li>').join('');
   return '<article><h2>'+esc(i+1)+'. '+esc(p.destination||p.input?.destination_id||'Destination')+'</h2><p class="meta">'+esc(p.platform||'')+' · '+esc(p.review_state||p.status||'Saved proposal')+'</p>'+
   (email.subject?'<h3>'+esc(email.subject)+'</h3>':'')+
   (copy?'<pre>'+esc(show(copy))+'</pre>':'<p class="warning">No rendered copy saved for this proposal.</p>')+
   (a.visual?.url?'<p><a href="'+esc(a.visual.url)+'">Visual asset</a></p>':'')+
   (warnings?'<h3>Review warnings</h3><ul>'+warnings+'</ul>':'')+
   '<details><summary>Evidence, IDs and full saved proposal</summary><pre>'+esc(JSON.stringify(p,null,2))+'</pre></details></article>';
 }).join('');
 const status=record?.status||'UNKNOWN';
 return '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>EMRADAR campaign review</title><style>body{font:16px/1.55 system-ui,sans-serif;max-width:800px;margin:auto;padding:18px;background:#10151d;color:#edf2f7}h1{font-size:1.65rem}article{background:#1b2430;border:1px solid #384453;border-radius:14px;padding:18px;margin:18px 0}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:14px/1.5 ui-monospace,monospace}h2{font-size:1.2rem}.meta{color:#b6c4d6}.warning{color:#ffcc8d}details{margin-top:18px;border-top:1px solid #394454;padding-top:12px}summary{cursor:pointer}a{color:#8ac8ff}</style><main><h1>EMRADAR · Campaign review</h1><p>'+esc(campaign||record?.campaign_id||'Latest campaign')+'</p><p><strong>Saved status:</strong> '+esc(status)+' · <strong>Saved proposals:</strong> '+proposals.length+'</p><p class="warning">Read-only preview. BLOCKED or incomplete means production is not approved. Nothing on this page sends or publishes.</p>'+ (items||'<article>No saved proposals found in this package.</article>')+'<details><summary>Full package and missing-asset diagnostics</summary><pre>'+esc(JSON.stringify(record,null,2))+'</pre></details></main></html>';
}
