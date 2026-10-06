// Pure regression probe. No network, store, campaign admission or delivery.
// Source: retained 5 October Sierra Gorda fixture; never today's scan.
import reference from '../tests/runtime/sierra-gorda-correspondence-reference.json' with {type:'json'};
import directory from '../state/open-route-directory.json' with {type:'json'};
import {humanReadyEmail,validateHumanEmail,emailVersion} from './editorial-email.js';
import crypto from 'node:crypto';
export function correspondenceProbe(){
 const route=directory.destinations.find(d=>d.destination_id==='INTERNATIONAL-MINING-EDITORIAL');
 const signal={id:reference.id,revision:'TEST_ONLY_2026_10_05',state:reference.status,evidence:reference.evidence.map((_,i)=>'SG'+i),source_facts:reference.evidence.map((f,i)=>({id:'SG'+i,text:f.fact,url:f.url})),source_uncertainty:[...reference.contradictions,...reference.chain_evolution.unresolved_evidence]};
 const correspondence={reason:"I'm contacting International Mining because this is a processing and project-execution story.",development:'Sierra Gorda has launched a US$725 million fourth grinding line project.',insight:"What stood out is the gap between approving the investment and delivering more copper. South32 expects about 30% higher copper-equivalent production from FY31; the extra production has yet to be delivered.",proposition:"I'd suggest a contribution looking at how the new line moves from investment approval to working capacity, rather than treating the announcement as extra production already delivered.",question:'Would this angle be useful for International Mining?'};
 const qualifications=[{source_index:0,text:'The ceremony comes before the main works scheduled for early 2027.'},{source_index:1,text:'The output is still forecast, and returns remain exposed to copper and molybdenum prices.'},{source_index:2,text:'Construction milestones'},{source_index:3,text:'final cost'},{source_index:4,text:'commissioning and ramp'},{source_index:5,text:'realised copper-equivalent output'}];
 const uncertainty='Construction milestones, final cost, commissioning and ramp, and realised copper-equivalent output remain unconfirmed.';
 const body=[correspondence.reason,correspondence.development,correspondence.insight,qualifications[0].text,qualifications[1].text,uncertainty,correspondence.proposition,correspondence.question].join('\n\n');
 const proposition={subject:'Sierra Gorda: the work between investment and more copper',body,correspondence,language:'en',signal_state:signal.state,evidence_refs:signal.evidence,qualifications,claims:[{text:correspondence.development,evidence_refs:['SG0']},{text:correspondence.insight,evidence_refs:['SG1']}],capability_claims:[]};
 const identity={approved:true,name:'Sean Walker',address:'oroknows@gmail.com'};
 const email=humanReadyEmail({proposition,signal,route,identity,product:'EMRADAR'});
 const gate=validateHumanEmail(email,signal,route,identity);
 return {status:gate.status,version:emailVersion,worker:'human_ready_email',mode:'TEST_ONLY_NOT_SENT',external_actions:0,artifact_hash:crypto.createHash('sha256').update(JSON.stringify(email)).digest('hex'),email,signal,route,identity};
}
