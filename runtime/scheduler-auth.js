import {createRemoteJWKSet,jwtVerify} from 'jose';

const issuer='https://token.actions.githubusercontent.com';
const audience='https://emradar-x-executor.onrender.com/SCHEDULED_CYCLE';
const repository='oroknows-arch1/emradar-marketing';
const workflow=`${repository}/.github/workflows/marketing-cycle.yml@refs/heads/main`;
const remoteKeys=createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks`));

export async function verifySchedulerToken(token,{jwks=remoteKeys}={}){
  if(typeof token!=='string'||token.length>8192)throw new Error('SCHEDULER_AUTHORIZATION_REQUIRED');
  const {payload}=await jwtVerify(token,jwks,{issuer,audience,algorithms:['RS256']});
  if(payload.repository!==repository||payload.ref!=='refs/heads/main'||payload.sub!==`repo:${repository}:ref:refs/heads/main`||payload.workflow_ref!==workflow||!['schedule','workflow_dispatch'].includes(payload.event_name))throw new Error('SCHEDULER_IDENTITY_REJECTED');
  return {repository:payload.repository,run_id:payload.run_id,event_name:payload.event_name};
}
export const schedulerAudience=audience;
