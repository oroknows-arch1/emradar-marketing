import directory from '../state/open-route-directory.json' with {type:'json'};
import brand from './email-brand.cjs';

const values=value=>(Array.isArray(value)?value:[]).map(v=>String(v).toLowerCase());
const overlap=(a,b)=>values(a).some(x=>values(b).includes(x)||x==='all');
const relevant=(scan,route)=>overlap(scan.formation.industries,route.industries)||overlap(scan.formation.geography,route.geography);

export const destinations=directory.destinations
  .filter(route=>route.verification_state==='VERIFIED'&&/email/i.test(route.access_method||'')&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(route.public_contact_point||''))
  .map(route=>({id:route.destination_id,organisation:route.organisation||route.destination_name,industries:route.industries||[],geography:route.geography||[],editorial_relevance:(scan,current)=>relevant(scan,current),evidence_suitable:scan=>scan.formation.evidence.length>0,endpoint:{address:route.public_contact_point,verification_state:'VERIFIED'},delivery:{method:'EMAIL',supported:true},connector:{authorized:true},finished_contribution_supported:true,delivery_record:route}));

export async function assetBuilder({scan,route}){
  const formation=scan.formation,organisation=route.organisation;
  const evidence=formation.evidence.slice(0,3).map(e=>e.claim||e.text).filter(Boolean);if(!evidence.length)throw new Error('FINISHED_ASSET_EVIDENCE_REQUIRED');
  const subject=`Contribution idea: ${formation.title||formation.id}`;
  const body=[route.delivery_record.recipient_identity?.name?`Hi ${route.delivery_record.recipient_identity.name},`:'Hello,',`I’m Sean Walker, working on EMRADAR. Our published scan classifies ${formation.title||formation.id} as ${formation.state}.`,evidence.join(' '),`The uncertainty remains explicit: ${formation.uncertainty.join(' ')}`,`Would this evidence-backed contribution be useful for ${organisation}?`,'Regards,\nSean Walker\nEMRADAR'].join('\n\n');
  const email=brand.brand({to:route.endpoint.address,subject,body,features:{}}),delivery={...route.delivery_record};
  return {subject,email,body:email.body,to:email.to,delivery_method:'EMAIL',copy:`Subject: ${subject}\n\n${email.body}`,delivery,evidence_summary:evidence.join(' '),required_visual_or_attachment:'NONE'};
}
