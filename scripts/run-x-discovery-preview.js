import {discoveryTestId} from '../runtime/organic-discovery.js';

// One owner-authorized test, executed in the existing hosted environment.
// The fixed test ID and persistent graph reservation prevent repeat spending.
export async function runDiscoveryPreview({port,token,fetchImpl=fetch,log=console.log}) {
  if(!token){log('X_DISCOVERY_PREVIEW '+JSON.stringify({status:'BLOCKED',blocker:'ENGINE_AUTHORIZATION_REQUIRED'}));return;}
  const response=await fetchImpl(`http://127.0.0.1:${port}/X_DISCOVERY_PREVIEW`,{
    method:'POST',signal:AbortSignal.timeout(300000),headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},
    body:JSON.stringify({product:'EMRADAR',test_id:discoveryTestId,max_usd:1})
  });
  const result=await response.json();
  // Only public source/post information and safe API diagnostics; never credentials.
  log('X_DISCOVERY_PREVIEW_SUMMARY '+JSON.stringify({status:result.status,blocker:result.blocker,cost:result.cost,source:result.source,nodes:result.nodes,no_engagement:result.no_engagement,learning_unchanged:result.learning_unchanged,api_error:result.api_error}));
  for(const row of result.candidates||[])log('X_DISCOVERY_PREVIEW_CANDIDATE '+JSON.stringify(row));
  for(const read of result.reads||[])log('X_DISCOVERY_PREVIEW_READ '+JSON.stringify(read));
}
