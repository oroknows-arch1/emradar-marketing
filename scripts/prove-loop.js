import fs from 'node:fs/promises';
import path from 'node:path';
import {fixture} from '../tests/runtime/fixture.js';
const f=await fixture();
const first=await f.engine.run(f.input);
const duplicate=await f.engine.run({...f.input,campaign_id:'SAFE_TEST_DUPLICATE'});
f.p.signals[0].revision='r2';for(const d of f.p.destinations){d.delta.signal_revision='r2';d.permission.signal_revision='r2';}
const next=await f.engine.run({...f.input,campaign_id:'SAFE_TEST_NEXT'});
const trace={scope:'REAL_LOCAL_FILE_EXECUTION_NO_EXTERNAL_PUBLICATION',first,duplicate,next,pass:first.status==='PASS'&&next.status==='PASS'&&first.outcome.measurements.content_verified.value===1&&first.learning_after.version===next.selection.learning_version&&next.selection.options[0].learned>first.selection.options[0].learned&&duplicate.receipt.id===first.receipt.id,financial_cost_usd:0};
await fs.mkdir('tests/evidence/delivery',{recursive:true});for(const file of await fs.readdir(path.join(f.dir,'destination')))await fs.copyFile(path.join(f.dir,'destination',file),path.join('tests/evidence/delivery',file));await fs.writeFile('tests/evidence/closed-loop.json',JSON.stringify(trace,null,2)+'\n');
console.log(JSON.stringify({pass:trace.pass,nodes:first.nodes.map(n=>n.node),first_receipt:first.receipt.id,measured_bytes:first.outcome.measurements.delivered_bytes.value,learning:first.learning_after.version,next_consumed:next.selection.learning_version,first_score:first.selection.options[0].score,next_score:next.selection.options[0].score,duplicate_prevented:duplicate.receipt.id===first.receipt.id,test_directory:f.dir},null,2));
if(!trace.pass)process.exitCode=1;
