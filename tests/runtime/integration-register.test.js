import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const register=JSON.parse(await fs.readFile(new URL('../../state/integration-register.json',import.meta.url),'utf8'));
const distribution=JSON.parse(await fs.readFile(new URL('../../state/distribution-map.json',import.meta.url),'utf8'));

test('integration register has one canonical record for every approved core platform',()=>{
  assert.deepEqual(register.platforms.map(p=>p.id),['X','LINKEDIN','BLUESKY','THREADS','MASTODON','REDDIT']);
  assert.equal(new Set(register.platforms.map(p=>p.id)).size,register.platforms.length);
  for(const platform of register.platforms)assert(register.status_lifecycle.includes(platform.status),platform.id);
});

test('tested integrations are backed by distribution evidence',()=>{
  for(const platform of register.platforms.filter(p=>['TESTED','AUTONOMOUS'].includes(p.status))){
    assert(platform.evidence?.live_receipt,platform.id);
    const route=distribution.routes.find(r=>r.id===platform.evidence.route_id);
    assert(route,platform.id);
    assert.equal(route.receipt,platform.evidence.live_receipt);
    assert.equal(route.status,'LIVE_EXECUTION_VERIFIED');
  }
});

test('register contains no secret-bearing fields and reddit is never bulk automatic',()=>{
  const forbidden=/password|access_token|refresh_token|client_secret|recovery_code|phone_number|private_email/i;
  const walk=value=>{if(Array.isArray(value))return value.forEach(walk);if(value&&typeof value==='object')for(const [key,child] of Object.entries(value)){assert(!forbidden.test(key),key);walk(child);}};
  walk(register);
  const reddit=register.platforms.find(p=>p.id==='REDDIT');
  assert.equal(reddit.distribution_mode,'REVIEW_REQUIRED_PER_COMMUNITY');
  assert.match(reddit.hard_rule,/NO_RELEVANT_ROUTE/);
});
