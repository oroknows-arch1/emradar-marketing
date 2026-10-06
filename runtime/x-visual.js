import crypto from 'node:crypto';
import sharp from 'sharp';
const hash=v=>crypto.createHash('sha256').update(v).digest('hex');
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const wrap=text=>String(text).split(/\s+/).reduce((rows,word)=>{if(!rows.length||rows.at(-1).length+word.length+1>70)rows.push(word);else rows[rows.length-1]+=' '+word;return rows;},[]);
export async function evidenceVisual(signal,sourceReceipt){
  if(!signal.evidence?.length||!signal.source_facts?.some(f=>signal.evidence.includes(f.id)))throw Error('X_VISUAL_SOURCE_REQUIRED');
  const blocks=[{label:'WORLD CHANGE',texts:signal.causal_chain?.world_change||[]},{label:'BOTTLENECK / SCARCITY',texts:signal.causal_chain?.bottleneck_or_scarcity||[]},{label:'CONSEQUENCES',texts:signal.causal_chain?.consequences||[]},{label:'UNRESOLVED',texts:signal.source_uncertainty||[]}].filter(b=>b.texts.length);
  if(!blocks.length)blocks.push({label:'SOURCE EVIDENCE',texts:signal.source_facts.filter(f=>signal.evidence.includes(f.id)).map(f=>f.text)});
  const rows=blocks.flatMap(b=>[{text:b.label,label:true},...b.texts.flatMap(t=>wrap(t).map(text=>({text,label:false}))),{text:'',label:false}]);
  if(rows.length>110)throw Error('X_VISUAL_LAYOUT_BOUND_EXCEEDED');
  const height=190+rows.length*32;
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="${height}"><rect width="1200" height="${height}" fill="#101e2b"/><rect x="48" y="48" width="8" height="64" fill="#59dfb6"/><g font-family="DejaVu Sans,sans-serif"><text x="80" y="75" font-size="30" fill="#59dfb6">EMRADAR · ${escape(signal.state)}</text><text x="80" y="110" font-size="18" fill="#b9c9d6">${escape(signal.source_snapshot||'')} · Evidence-led formation</text>${rows.map((r,i)=>`<text x="64" y="${168+i*32}" font-size="${r.label?19:25}" fill="${r.label?'#59dfb6':'#ffffff'}">${escape(r.text)}</text>`).join('')}<text x="64" y="${height-22}" font-size="16" fill="#b9c9d6">Source evidence and uncertainty preserved · Review before publication</text></g></svg>`;
  const bytes=await sharp(Buffer.from(svg)).png().toBuffer();
  if(bytes.length>5*1024*1024)throw Error('X_VISUAL_MEDIA_SIZE_EXCEEDED');
  return {format:'image',mime:'image/png',base64:bytes.toString('base64'),sha256:hash(bytes),reviewed:false,generated:true,method:'DETERMINISTIC_SOURCE_EVIDENCE_CARD_V1',svg,width:1200,height,lineage:{signal_id:signal.id,signal_revision:signal.revision,signal_state:signal.state,source_receipt:sourceReceipt||null,evidence_refs:[...signal.evidence],source_hash:hash(JSON.stringify(signal)),blocks}};
}
export function validateCombinedX(asset,signal,sourceReceipt){
  if(!asset?.copy?.trim()||asset.format!=='image'||asset.mime!=='image/png'||!asset.base64||!asset.sha256)throw Error('X_COPY_AND_VISUAL_REQUIRED');
  if(hash(Buffer.from(asset.base64,'base64'))!==asset.sha256)throw Error('X_VISUAL_HASH_MISMATCH');
  if(asset.lineage?.source_hash!==hash(JSON.stringify(signal))||JSON.stringify(asset.lineage.source_receipt)!==JSON.stringify(sourceReceipt||null)||asset.lineage.signal_state!==signal.state)throw Error('X_VISUAL_SOURCE_BINDING_REQUIRED');
  return true;
}
