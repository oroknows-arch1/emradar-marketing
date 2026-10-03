import test from 'node:test';
import assert from 'node:assert/strict';
import {createXAuthorization} from '../../runtime/x-authorization.js';

class MemoryKeyValue {
  values=new Map();
  async get(key){return this.values.get(key)||null;}
  async set(key,value){this.values.set(key,value);}
}

test('X authorization is restored by a fresh process without exposing secrets',async()=>{
  const client=new MemoryKeyValue();
  const first=createXAuthorization({client,clientId:'client',exchange:async()=>assert.fail('refresh not expected'),clock:()=>1000});
  await first.authorize('EMRADAR',{access_token:'access-secret',refresh_token:'refresh-secret',expires_in:7200,scope:'tweet.write offline.access'});

  const restarted=createXAuthorization({client,clientId:'client',exchange:async()=>assert.fail('refresh not expected'),clock:()=>2000});
  const restored=await restarted.current('EMRADAR');
  assert.equal(restored.access_token,'access-secret');
  assert.equal(restored.refresh_token,'refresh-secret');
  assert.equal(JSON.stringify({runtime_authorized:!!restored.access_token}),'{"runtime_authorized":true}');
  assert.doesNotMatch(JSON.stringify({runtime_authorized:!!restored.access_token}),/access-secret|refresh-secret/);
});

test('expired authorization refreshes and persists the rotated token',async()=>{
  const client=new MemoryKeyValue();
  const first=createXAuthorization({client,clientId:'client',clock:()=>1000,exchange:async()=>assert.fail('refresh not expected')});
  await first.authorize('EMRADAR',{access_token:'old-access',refresh_token:'old-refresh',expires_in:1});

  const restarted=createXAuthorization({client,clientId:'client',clock:()=>70000,exchange:async body=>{
    assert.equal(body.refresh_token,'old-refresh');
    return {access_token:'new-access',refresh_token:'new-refresh',expires_in:7200};
  }});
  assert.equal((await restarted.current('EMRADAR')).access_token,'new-access');
  const nextProcess=createXAuthorization({client,clientId:'client',clock:()=>71000,exchange:async()=>assert.fail('second refresh not expected')});
  assert.equal((await nextProcess.current('EMRADAR')).refresh_token,'new-refresh');
});

test('existing product-scoped X grant migrates to the account-level key',async()=>{
  const client=new MemoryKeyValue();
  await client.set('marketing:x:authorized:atlasoquence',JSON.stringify({access_token:'existing-access',refresh_token:'existing-refresh',expires_at:999999}));
  const restarted=createXAuthorization({client,clientId:'client',clock:()=>1000,exchange:async()=>assert.fail('refresh not expected')});
  assert.equal((await restarted.current('EMRADAR')).access_token,'existing-access');
  const persisted=JSON.parse(await client.get('marketing:x:authorized'));
  assert.equal(persisted.refresh_token,'existing-refresh');
});
