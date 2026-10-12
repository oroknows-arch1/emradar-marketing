import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const server=fs.readFileSync(new URL('../../server.js',import.meta.url),'utf8');

test('V2 approval wakes the existing distribution executor without touching rejected work',()=>{
  assert.match(server,/const result=await runtime\.decide\(input\);[\s\S]*?if\(input\.decision==='APPROVE'\)setImmediate\(\(\)=>v2DistributionCycle\('OWNER_APPROVAL'\)/);
  assert.doesNotMatch(server,/if\(input\.decision==='REJECT'\)setImmediate/);
});

test('V2 recovers persisted approvals on startup and every 60 seconds, behind external distribution gate',()=>{
  assert.match(server,/if\(process\.env\.MARKETING_V2_DISTRIBUTION_ENABLED==='true'\)\{[\s\S]*?setImmediate\(wake\);[\s\S]*?setInterval\(wake,60000\)\.unref\(\)/);
  assert.match(server,/async function v2DistributionCycle\(trigger\)\{[\s\S]*?MARKETING_V2_DISTRIBUTION_ENABLED!=='true'[\s\S]*?v2DistributionPromise[\s\S]*?v2Runtime\(\)\)\.distribute\(\)/);
});
