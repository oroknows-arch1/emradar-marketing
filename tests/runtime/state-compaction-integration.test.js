import test from 'node:test';
import assert from 'node:assert/strict';
import {createClient} from 'redis';
import {RedisStore} from '../../runtime/store.js';
test('Valkey 8 full-store repair is atomic, lossless and enables normal writes',{skip:!process.env.TEST_REDIS_URL},async()=>{
 const c=createClient({url:process.env.TEST_REDIS_URL});await c.connect();
 try{
  const value={asset:{base64:'exact-saved-png'.repeat(300000),copy:'exact copy'},review_hash:'approved-hash',history:['preserve']};
  await c.set('marketing:graph:publication_review:oom-fixture',JSON.stringify(value));
  const info=await c.info('memory'),used=Number(info.match(/used_memory:(\d+)/)[1]);
  await c.configSet('maxmemory',String(Math.floor(used*.8)));await c.configSet('maxmemory-policy','noeviction');
  await assert.rejects(c.set('normal-write','blocked'),/OOM/);
  const s=new RedisStore(c),r=await s.compact();assert.equal(r.records,1);assert(r.saved_bytes>3000000);
  assert.deepEqual(await s.get('publication_review:oom-fixture'),value);
  await s.put('owner_override:proof',{status:'COMPLETE'});assert.equal((await s.get('owner_override:proof')).status,'COMPLETE');
  assert.equal((await s.compact()).records,0);
 }finally{await c.configSet('maxmemory','0');await c.quit();}
});
