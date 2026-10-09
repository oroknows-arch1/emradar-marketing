// Pure regression probe. No network, store, campaign admission or delivery.
// Source: retained 5 October Sierra Gorda fixture; never today's scan.
import reference from '../tests/runtime/sierra-gorda-correspondence-reference.json' with {type:'json'};
import directory from '../state/open-route-directory.json' with {type:'json'};
import {humanReadyEmail,validateHumanEmail,emailVersion} from './editorial-email.js';
import crypto from 'node:crypto';
export function correspondenceProbe(){
 const route=structuredClone(directory.destinations.find(d=>d.destination_id==='INTERNATIONAL-MINING-EDITORIAL'));
 const signal={id:reference.id,revision:'TEST_ONLY_2026_10_05',state:reference.status,evidence:reference.evidence.map((_,i)=>'SG'+i),source_facts:reference.evidence.map((f,i)=>({id:'SG'+i,text:f.fact,url:f.url})),source_uncertainty:[...reference.contradictions,...reference.chain_evolution.unresolved_evidence]};
 const correspondence={reason:'Would this be suitable as an article or research contribution for International Mining?',development:'Our 5 October scan identified Sierra Gorda’s grinding expansion as FORMING.',insight:'What stood out was the work between approving investment and delivering additional usable productive capacity through construction, equipment delivery and commissioning.',proposition:'We are developing an evidence-backed contribution around the fourth grinding line’s path through construction, commissioning and ramp-up — while keeping unresolved costs, output and commodity-price exposure explicit.',question:'Would this be suitable as an article or research contribution for International Mining?',next_step:'If useful, I can send a concise finished draft with sources for review.'};
 const qualifications=signal.source_uncertainty.map((text,source_index)=>({text,source_index}));
 const body=[correspondence.development+' '+correspondence.insight,correspondence.proposition,correspondence.question,correspondence.next_step].join('\n\n');
 const proposition={subject:'Sierra Gorda: the work between investment and more copper',body,correspondence,language:'en',signal_state:signal.state,evidence_refs:signal.evidence,qualifications,claims:[{text:correspondence.development,evidence_refs:['SG0']},{text:correspondence.insight,evidence_refs:['SG1']}],capability_claims:[{text:correspondence.next_step,capability:'campaign_specific_finished_sourced_draft'}]};
 const identity={approved:true,name:'Sean Walker',address:'sean@emradar.net'};
 const email=humanReadyEmail({proposition,signal,route,identity,product:'EMRADAR'});
 const gate=validateHumanEmail(email,signal,route,identity);
 return {status:gate.status,version:emailVersion,worker:'human_ready_email',mode:'TEST_ONLY_NOT_SENT',external_actions:0,artifact_hash:crypto.createHash('sha256').update(JSON.stringify(email)).digest('hex'),email,signal,route,identity};
}

