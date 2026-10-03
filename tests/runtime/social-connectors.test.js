import test from 'node:test';
import assert from 'node:assert/strict';
import {blueskyConnector,linkedinConnector,mastodonConnector,socialAdapter} from '../../runtime/social-connectors.js';
import {integrationStatus} from '../../runtime/integration-status.js';

const response=(body,status=200)=>({ok:status>=200&&status<300,status,headers:new Headers(),json:async()=>body});

test('Bluesky creates a source-bound text record and returns a canonical receipt',async()=>{
  const calls=[];const fetchImpl=async(url,options={})=>{calls.push({url,options});if(url.endsWith('createSession'))return response({accessJwt:'secret',did:'did:plc:test',handle:'emradar.test'});return response({uri:'at://did:plc:test/app.bsky.feed.post/rkey1',cid:'cid1'});};
  const connector=blueskyConnector({identifier:'emradar.test',appPassword:'not-real',fetchImpl});
  const receipt=await connector.publish({format:'text',copy:'EMRADAR — FORMING'},'publication-key');
  assert.equal(receipt.id,'at://did:plc:test/app.bsky.feed.post/rkey1');
  assert.equal(receipt.url,'https://bsky.app/profile/emradar.test/post/rkey1');
  const body=JSON.parse(calls[1].options.body);assert.equal(body.repo,'did:plc:test');assert.equal(body.record.$type,'app.bsky.feed.post');assert.equal(body.record.text,'EMRADAR — FORMING');
  assert.equal(calls[1].options.headers['idempotency-key'],'publication-key');
});

test('Bluesky rejects over-limit copy before any network call',async()=>{
  let calls=0;const connector=blueskyConnector({identifier:'id',appPassword:'pw',fetchImpl:async()=>{calls++;}});
  await assert.rejects(connector.publish({copy:'x'.repeat(301)},'key'),/BLUESKY_COPY_LIMIT_EXCEEDED/);assert.equal(calls,0);
});

test('Mastodon sends a public idempotent status and returns the native URL',async()=>{
  const calls=[];const connector=mastodonConnector({server:'https://social.example/',accessToken:'not-real',fetchImpl:async(url,options)=>{calls.push({url,options});return response({id:'42',url:'https://social.example/@emradar/42',uri:'tag:42'});}});
  const receipt=await connector.publish({format:'text',copy:'EMRADAR — CONFIRMED'},'same-action');
  assert.equal(receipt.url,'https://social.example/@emradar/42');assert.equal(calls[0].options.headers['idempotency-key'],'same-action');assert.equal(calls[0].options.body.get('visibility'),'public');
});

test('LinkedIn creates an organization post with required version headers and receipt',async()=>{
  const calls=[];const headers=new Headers({'x-restli-id':'urn:li:share:123'});const connector=linkedinConnector({accessToken:'not-real',organizationUrn:'urn:li:organization:5515715',apiVersion:'202609',fetchImpl:async(url,options)=>{calls.push({url,options});return {ok:true,status:201,headers,json:async()=>({})};}});
  const receipt=await connector.publish({format:'text',copy:'EMRADAR — FORMING'});
  assert.equal(receipt.id,'urn:li:share:123');assert.equal(receipt.url,'https://www.linkedin.com/feed/update/urn:li:share:123');
  assert.equal(calls[0].options.headers['linkedin-version'],'202609');assert.equal(calls[0].options.headers['x-restli-protocol-version'],'2.0.0');
  const body=JSON.parse(calls[0].options.body);assert.equal(body.author,'urn:li:organization:5515715');assert.equal(body.distribution.feedDistribution,'MAIN_FEED');
});

test('social adapter reports authorization from configuration without exposing credentials',async()=>{
  const adapter=socialAdapter(mastodonConnector({server:'https://social.example',accessToken:'not-real',fetchImpl:async()=>response({})}));
  assert.equal(await adapter.authorized('EMRADAR'),true);assert.deepEqual(adapter.formats,['text']);assert.equal(adapter.cost,'ZERO');
});

test('integration status distinguishes implemented, configured, authorized and unavailable',()=>{
  const platforms=integrationStatus({BLUESKY_IDENTIFIER:'emradar.test',BLUESKY_APP_PASSWORD:'set'},{xAuthorized:false});
  const bluesky=platforms.find(p=>p.id==='BLUESKY');const linkedin=platforms.find(p=>p.id==='LINKEDIN');const x=platforms.find(p=>p.id==='X');
  assert.equal(bluesky.connector,'IMPLEMENTED');assert.equal(bluesky.runtime_authorized,true);assert.equal(bluesky.blocker,null);
  assert.equal(linkedin.connector,'IMPLEMENTED');assert.equal(linkedin.blocker,'CONNECTOR_CONFIGURATION_MISSING');assert(linkedin.missing_configuration.includes('LINKEDIN_ACCESS_TOKEN'));
  assert.equal(x.runtime_authorized,false);assert(x.missing_configuration.includes('X_CLIENT_ID'));
  assert(!JSON.stringify(platforms).includes('not-real'));
});
