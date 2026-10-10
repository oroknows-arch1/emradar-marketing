import directory from '../state/open-route-directory.json' with {type:'json'};
import brand from './email-brand.cjs';
import crypto from 'node:crypto';
import sharp from 'sharp';

const values=value=>(Array.isArray(value)?value:[]).map(v=>String(v).toLowerCase());
const overlap=(a,b)=>values(a).some(x=>values(b).includes(x)||x==='all');
const words=value=>String(value||'').toLowerCase().match(/[a-z0-9]+/g)||[];
const significant=value=>words(value).filter(w=>w.length>3&&!['africa','global','industry','market','markets'].includes(w));
const relevant=(scan,route)=>{
  if(overlap(scan.formation.industries,route.industries)||overlap(scan.formation.geography,route.geography))return true;
  const source=[scan.formation.title,...(scan.formation.industries||[]),...(scan.formation.causal_chain||[]),...(scan.formation.evidence||[]).map(e=>e.claim)].join(' ').toLowerCase();
  return [...(route.relevant_beat_topic||[]),...(route.industries||[])].some(term=>{const tokens=significant(term);return tokens.length>0&&tokens.every(token=>source.includes(token));});
};
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const scanLabel=value=>{const [y,m,d]=String(value||'').split('-').map(Number),months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];return y&&m&&d?`${d} ${months[m-1]}`:'daily scan';};
const consolidatedCopy=(scan,formations)=>{
  const counts=[...new Set(formations.map(f=>f.state))].sort().map(state=>`${formations.filter(f=>f.state===state).length} ${state}`).join(', '),prefix=`EMRADAR ${scanLabel(scan.snapshot_date)}: ${counts}. `,suffix=' Evidence remains bounded by the published sources; execution and scale may remain uncertain. emradar.net',titles=[];
  for(const formation of formations){const title=String(formation.title||formation.id).replace(/\s+/g,' ').trim();if((prefix+titles.concat(title).join('; ')+suffix).length<=280)titles.push(title);}
  const copy=prefix+(titles.length?titles.join('; ')+'.':'')+suffix;if(copy.length>280)throw Error('CONSOLIDATED_X_CONTRACT_INVALID');return copy;
};

export const destinations=directory.destinations
  .filter(route=>String(route.verification_state||'').startsWith('VERIFIED'))
  .map(route=>{
    const x=route.destination_id==='EMRADAR-X-OROKNOWS',verifiedEmail=route.verification_state==='VERIFIED'&&/email/i.test(route.access_method||'')&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(route.public_contact_point||''),manual=/form|portal|workflow|manual/i.test([route.access_method,route.public_submission_url].join(' ')),method=x?'X':verifiedEmail?'EMAIL':'MANUAL';
    const recipient_status=verifiedEmail?'VERIFIED_RECIPIENT':manual?'MANUAL_SUBMISSION_REQUIRED':/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(route.public_contact_point||'')?'UNVERIFIED_RECIPIENT':'TRANSPORT_UNAVAILABLE';
    return {id:route.destination_id,organisation:route.organisation||route.destination_name,industries:route.industries||[],geography:route.geography||[],relevant_beat_topic:route.relevant_beat_topic||[],editorial_relevance:(scan,current)=>x||relevant(scan,current),evidence_suitable:scan=>scan.formation.evidence.length>0,endpoint:{address:route.public_contact_point||route.public_submission_url||'UNAVAILABLE',verification_state:route.verification_state,recipient_status},delivery:{method,supported:verifiedEmail||x},connector:{authorized:verifiedEmail||x},finished_contribution_supported:true,delivery_record:{...route,recipient_status}};
  });

export async function assetBuilder({scan,route}){
  const formation=scan.formation,organisation=route.organisation;
  const evidence=formation.evidence.slice(0,3).map(e=>e.claim||e.text).filter(Boolean);if(!evidence.length)throw new Error('FINISHED_ASSET_EVIDENCE_REQUIRED');
  if(route.delivery.method==='X'){
    const formations=scan.formations||[formation],copy=consolidatedCopy(scan,formations),rows=formations.map(f=>`${f.state} · ${f.title||f.id}`),height=Math.max(700,260+rows.length*66),footer=height-80,svg=`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="${height}"><rect width="1200" height="${height}" fill="#031728"/><rect x="54" y="52" width="10" height="78" fill="#59dfb6"/><g font-family="DejaVu Sans,sans-serif"><text x="88" y="82" font-size="34" fill="#ffffff" font-weight="700">EMRADAR</text><text x="88" y="119" font-size="18" fill="#59dfb6" letter-spacing="2">EMERGING MARKET INTELLIGENCE · ${escape(String(scan.snapshot_date||'DAILY SCAN').toUpperCase())}</text>${rows.map((row,i)=>`<text x="64" y="${190+i*66}" font-size="24" fill="#ffffff">${escape(row)}</text>`).join('')}<text x="64" y="${footer}" font-size="20" fill="#b9c9d6">Evidence is bounded by the published sources</text><text x="64" y="${footer+42}" font-size="20" fill="#59dfb6">emradar.net · sean@emradar.net</text></g></svg>`,bytes=await sharp(Buffer.from(svg)).png().toBuffer();
    const asset={subject:`X post: EMRADAR ${scan.snapshot_date||'daily'} scan`,body:copy,to:route.endpoint.address,delivery_method:'X',copy,evidence_summary:formations.map(f=>`${f.id}:${f.state}`).join('; '),required_visual_or_attachment:'IMAGE_REQUIRED',format:'image',mime:'image/png',base64:bytes.toString('base64'),sha256:hash(bytes),svg,width:1200,height,lineage:{source_revision:scan.source_revision,formation_ids:formations.map(f=>f.id),evidence_refs:formations.flatMap(f=>f.evidence.map(e=>e.id))},generated:true,reviewed:false,combined_review_artifact:true,consolidated_scan:true,delivery:{...route.delivery_record}};
    return asset;
  }
  const subject=`Contribution idea: ${formation.title||formation.id}`;
  const body=[route.delivery_record.recipient_identity?.name?`Hi ${route.delivery_record.recipient_identity.name},`:'Hello,',`I’m Sean Walker, working on EMRADAR. Our published scan classifies ${formation.title||formation.id} as ${formation.state}.`,evidence.join(' '),`The uncertainty remains explicit: ${formation.uncertainty.join(' ')}`,`Would this evidence-backed contribution be useful for ${organisation}?`,'Regards,\nSean Walker\nEMRADAR'].join('\n\n');
  const delivery={...route.delivery_record},email=route.delivery.method==='EMAIL'?brand.brand({to:route.endpoint.address,subject,body,features:{}}):null;
  return {subject,...(email?{email}:{}),body:email?.body||body,to:email?.to||route.endpoint.address,delivery_method:route.delivery.method,copy:`Subject: ${subject}\n\n${email?.body||body}`,delivery,evidence_summary:evidence.join(' '),required_visual_or_attachment:'NONE',recipient_status:route.endpoint.recipient_status};
}
