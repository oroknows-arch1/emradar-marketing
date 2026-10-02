import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPair,exportJWK,SignJWT,createLocalJWKSet} from 'jose';
import {verifySchedulerToken,schedulerAudience} from '../../runtime/scheduler-auth.js';

const issuer='https://token.actions.githubusercontent.com';
const repository='oroknows-arch1/emradar-marketing';
test('scheduler admits only the signed main-branch workflow with intended audience',async()=>{
  const {privateKey,publicKey}=await generateKeyPair('RS256');
  const jwks=createLocalJWKSet({keys:[{...await exportJWK(publicKey),kid:'test',alg:'RS256',use:'sig'}]});
  const claims={repository,ref:'refs/heads/main',workflow_ref:`${repository}/.github/workflows/marketing-cycle.yml@refs/heads/main`,event_name:'schedule',run_id:'123'};
  const sign=(payload,aud=schedulerAudience)=>new SignJWT(payload).setProtectedHeader({alg:'RS256',kid:'test'}).setIssuer(issuer).setAudience(aud).setSubject(`repo:${repository}:ref:refs/heads/main`).setIssuedAt().setExpirationTime('5m').sign(privateKey);
  assert.equal((await verifySchedulerToken(await sign(claims),{jwks})).run_id,'123');
  await assert.rejects(verifySchedulerToken(await sign(claims,'wrong'),{jwks}));
  await assert.rejects(verifySchedulerToken(await sign({...claims,workflow_ref:`${repository}/.github/workflows/other.yml@refs/heads/main`}),{jwks}),/SCHEDULER_IDENTITY_REJECTED/);
  await assert.rejects(verifySchedulerToken(await sign({...claims,event_name:'pull_request'}),{jwks}),/SCHEDULER_IDENTITY_REJECTED/);
  await assert.rejects(verifySchedulerToken('not-a-token',{jwks}));
});
