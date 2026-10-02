import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {emradarSource,ProductIntake,signSource} from '../runtime/intake.js';
import {GraphEngine} from '../runtime/graph.js';
import {FileStore} from '../runtime/store.js';
const snapshot=JSON.parse(await fs.readFile('tests/evidence/emradar-source-snapshot.json','utf8'));
const store=new FileStore(await fs.mkdtemp(path.join(os.tmpdir(),'native-source-proof-')));
const policies={EMRADAR:{product_identity:'EMRADAR',review:{brand:true,risk:true},brand_system:'EMRADAR evidence-first',uncertainty_state_model:['UNKNOWN','INVESTIGATE','FORMING','CONFIRMED','WATCH/NO SIGNAL'],destinations:[],copy_policy:{extractive_template_approved:true}}};
const source=emradarSource(snapshot); // No unverified release/review authority is created.
const intake=new ProductIntake({store,policies,sourceKeys:{EMRADAR:'local-proof-only'}});
const envelope={product:'EMRADAR',sequence:1,source};
const handoff=await intake.receive(envelope,signSource(envelope,'local-proof-only'));
const engine=new GraphEngine({store,products:await intake.products(),adapters:{}});
const run=await engine.run({product:'EMRADAR',campaign_id:'NATIVE_SOURCE_SAFE_BLOCKED_PROOF',signal_id:source.signals[0].id});
const proof={source_repository:'oroknows-arch1/emerging-markets-radar',source_path:'data/discovery.json',source_blob_sha:'17e88db31f2868c1459eedebd11c253d9b0567a0',scope:'REAL_NATIVE_SOURCE_READ_LOCAL_GRAPH_BLOCKED_NO_EXTERNAL_PUBLICATION',handoff,run,pass:run.receipt.execution_status==='BLOCKED'&&run.receipt.signal_state==='CONFIRMED'&&run.blocker==='SOURCE_REVIEW_OR_RELEASE_REQUIRED'&&run.receipt.api_cost_usd===0};
await fs.writeFile('tests/evidence/native-source-handoff.json',JSON.stringify(proof,null,2)+'\n');console.log(JSON.stringify({pass:proof.pass,source_signals:source.signals.map(s=>({id:s.id,state:s.state})),handoff_status:handoff.status,receipt:run.receipt.id,blocker:run.blocker,cost_usd:run.receipt.api_cost_usd},null,2));if(!proof.pass)process.exitCode=1;
