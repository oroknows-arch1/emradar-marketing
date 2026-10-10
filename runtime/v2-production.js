import directory from '../state/open-route-directory.json' with {type:'json'};
import brand from './email-brand.cjs';
import crypto from 'node:crypto';
import sharp from 'sharp';

const values=value=>(Array.isArray(value)?value:[]).map(v=>String(v).toLowerCase());
const overlap=(a,b)=>values(a).some(x=>values(b).includes(x)||x==='all');
const relevant=(scan,route)=>overlap(scan.formation.industries,route.industries)||overlap(scan.formation.geography,route.geography);
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));

export const destinations=directory.destinations
  .filter(route=>String(route.verification_state||'').startsWith('VERIFIED'))
  .map(route=>{
    const x=route.destination_id==='EMRADAR-X-OROKNOWS',email=/email/i.test(route.access_method||'')&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(route.public_contact_point||''),method=x?'X':email?'EMAIL':'MANUAL';
    return {id:route.destination_id,organisation:route.organisation||route.destination_name,industries:route.industries||[],geography:route.geography||[],editorial_relevance:(scan,current)=>x||relevant(scan,current),evidence_suitable:scan=>scan.formation.evidence.length>0,endpoint:{address:route.public_contact_point||route.public_submission_url||'UNAVAILABLE',verification_state:route.verification_state},delivery:{method,supported:email},connector:{authorized:email},finished_contribution_supported:true,delivery_record:route};
  });

export async function assetBuilder({scan,route}){
  const formation=scan.formation,organisation=route.organisation;
  const evidence=formation.evidence.slice(0,3).map(e=>e.claim||e.text).filter(Boolean);if(!evidence.length)throw new Error('FINISHED_ASSET_EVIDENCE_REQUIRED');
  if(route.delivery.method==='X'){
    const formations=scan.formations||[formation],copy='EMRADAR 10 Oct: 4 FORMING—Free State green industry; Africa–China yuan rails; DFC strategic equity; China local infrastructure. 2 INVESTIGATE—African capital-market integration; SADC/AfDB project finance. Evidence is early; execution and scale remain uncertain. emradar.net';
    if(copy.length>280||formations.length!==6)throw Error('CONSOLIDATED_X_CONTRACT_INVALID');
    const rows=formations.map(f=>`${f.state} · ${f.title||f.id}`),height=700,svg=`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="${height}"><rect width="1200" height="${height}" fill="#031728"/><rect x="54" y="52" width="10" height="78" fill="#59dfb6"/><g font-family="DejaVu Sans,sans-serif"><text x="88" y="82" font-size="34" fill="#ffffff" font-weight="700">EMRADAR</text><text x="88" y="119" font-size="18" fill="#59dfb6" letter-spacing="2">EMERGING MARKET INTELLIGENCE · 10 OCTOBER 2026</text>${rows.map((row,i)=>`<text x="64" y="${190+i*66}" font-size="24" fill="#ffffff">${escape(row)}</text>`).join('')}<text x="64" y="620" font-size="20" fill="#b9c9d6">Evidence is early · execution and scale remain uncertain</text><text x="64" y="662" font-size="20" fill="#59dfb6">emradar.net · sean@emradar.net</text></g></svg>`,bytes=await sharp(Buffer.from(svg)).png().toBuffer();
    const asset={subject:'X post: EMRADAR October 10 scan',body:copy,to:route.endpoint.address,delivery_method:'X',copy,evidence_summary:formations.map(f=>`${f.id}:${f.state}`).join('; '),required_visual_or_attachment:'IMAGE_REQUIRED',format:'image',mime:'image/png',base64:bytes.toString('base64'),sha256:hash(bytes),svg,width:1200,height,lineage:{source_revision:scan.source_revision,formation_ids:formations.map(f=>f.id),evidence_refs:formations.flatMap(f=>f.evidence.map(e=>e.id))},generated:true,reviewed:false,combined_review_artifact:true,consolidated_scan:true,delivery:{...route.delivery_record}};
    return asset;
  }
  const subject=`Contribution idea: ${formation.title||formation.id}`;
  const body=[route.delivery_record.recipient_identity?.name?`Hi ${route.delivery_record.recipient_identity.name},`:'Hello,',`I’m Sean Walker, working on EMRADAR. Our published scan classifies ${formation.title||formation.id} as ${formation.state}.`,evidence.join(' '),`The uncertainty remains explicit: ${formation.uncertainty.join(' ')}`,`Would this evidence-backed contribution be useful for ${organisation}?`,'Regards,\nSean Walker\nEMRADAR'].join('\n\n');
  const email=brand.brand({to:route.endpoint.address,subject,body,features:{}}),delivery={...route.delivery_record};
  return {subject,email,body:email.body,to:email.to,delivery_method:route.delivery.method,copy:`Subject: ${subject}\n\n${email.body}`,delivery,evidence_summary:evidence.join(' '),required_visual_or_attachment:'NONE'};
}
