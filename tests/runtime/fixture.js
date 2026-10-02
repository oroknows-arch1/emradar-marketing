import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {GraphEngine} from '../../runtime/graph.js';
import {FileStore} from '../../runtime/store.js';
import {localAdapter} from '../../runtime/adapters.js';
export const product=()=>({product_identity:'TEST_PRODUCT',release_approved:true,review:{evidence:true,brand:true,editorial:true,risk:true},brand_system:'Plain, sourced, uncertainty visible',uncertainty_state_model:['FORMING','UNKNOWN'],max_attempts:2,signals:[{id:'test-signal',revision:'r1',state:'FORMING',evidence:['E1'],approved_copy:['TEST_PRODUCT — FORMING. This is a local delivery test; audience response is UNKNOWN.']}],destinations:['local-a','local-b'].map(id=>({id,platform:'LOCAL',signal_ids:['test-signal'],formats:['svg','text'],relevance:0,baseline:{id:'LOCAL_TEST_BASELINE',valid_until:'2099-01-01'},delta:{signal_revision:'r1',meaningful:true,evidence_ids:['E1']},permission:{approved:true,valid_until:'2099-01-01',signal_revision:'r1'}}))});
export async function fixture(options={}){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'marketing-graph-'));const p=product();const store=new FileStore(path.join(dir,'state'));const adapter=localAdapter(path.join(dir,'destination'));return {dir,p,store,adapter,engine:new GraphEngine({store,products:{TEST_PRODUCT:p},adapters:{LOCAL:adapter},...options}),input:{product:'TEST_PRODUCT',campaign_id:'SAFE_TEST_1'}};}
