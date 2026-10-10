import directory from '../state/open-route-directory.json' with {type:'json'};
import brand from './email-brand.cjs';
import {nativeXCopy} from './x-copy.js';
import {evidenceVisual,validateCombinedX} from './x-visual.js';

const values=value=>(Array.isArray(value)?value:[]).map(v=>String(v).toLowerCase());
const overlap=(a,b)=>values(a).some(x=>values(b).includes(x)||x==='all');
const relevant=(scan,route)=>overlap(scan.formation.industries,route.industries)||overlap(scan.formation.geography,route.geography);

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
    const signal={id:formation.id,revision:scan.source_revision,state:formation.state,evidence:formation.evidence.map(e=>e.id),source_facts:formation.evidence.map(e=>({id:e.id,text:e.claim,url:e.url})),source_uncertainty:formation.uncertainty,causal_chain:formation.causal_chain_source||{},source_snapshot:scan.snapshot_date,approved_copy:[]};
    const native=nativeXCopy(signal),visual=await evidenceVisual(signal,{digest:scan.source_revision});
    const asset={subject:`X post: ${formation.title||formation.id}`,body:native.copy,to:route.endpoint.address,delivery_method:'X',copy:native.copy,evidence_summary:evidence.join(' '),required_visual_or_attachment:'IMAGE_REQUIRED',...visual,combined_review_artifact:true,delivery:{...route.delivery_record}};
    validateCombinedX(asset,signal,{digest:scan.source_revision});return asset;
  }
  const subject=`Contribution idea: ${formation.title||formation.id}`;
  const body=[route.delivery_record.recipient_identity?.name?`Hi ${route.delivery_record.recipient_identity.name},`:'Hello,',`I’m Sean Walker, working on EMRADAR. Our published scan classifies ${formation.title||formation.id} as ${formation.state}.`,evidence.join(' '),`The uncertainty remains explicit: ${formation.uncertainty.join(' ')}`,`Would this evidence-backed contribution be useful for ${organisation}?`,'Regards,\nSean Walker\nEMRADAR'].join('\n\n');
  const email=brand.brand({to:route.endpoint.address,subject,body,features:{}}),delivery={...route.delivery_record};
  return {subject,email,body:email.body,to:email.to,delivery_method:route.delivery.method,copy:`Subject: ${subject}\n\n${email.body}`,delivery,evidence_summary:evidence.join(' '),required_visual_or_attachment:'NONE'};
}
