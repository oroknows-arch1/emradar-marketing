import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';
import {FileStore} from '../../runtime/store.js';
import {recoverOctober10Capacity} from '../../runtime/v2-capacity-recovery.js';

test('capacity recovery deletes only superseded October 10 per-finding X records',async()=>{const store=new FileStore(await mkdtemp(path.join(os.tmpdir(),'v2-capacity-'))),campaign_id='EMRADAR_2026_10_10_LAUNCH',old={campaign_id,destination:'EMRADAR-X-OROKNOWS',asset:{base64:'large'}},keep=[['v2:review:email',{campaign_id,destination:'EDITOR',asset:{email:true}}],['v2:review:x-consolidated',{...old,asset:{consolidated_scan:true}}],['v2:review:history',{campaign_id:'EMRADAR_2026_10_09_LAUNCH',destination:'EMRADAR-X-OROKNOWS'}],['v2:decision:approved',{decision:'APPROVE'}],['receipt:sent',{execution_status:'SUBMITTED'}]];await store.put('v2:review:x-old',old);for(const [key,value] of keep)await store.put(key,value);const result=await recoverOctober10Capacity(store);assert.equal(result.deleted_records,1);assert.equal(await store.get('v2:review:x-old'),null);for(const [key,value] of keep)assert.deepEqual(await store.get(key),value);assert.equal(result.external_actions,0);});
