import crypto from 'node:crypto';
import {HarnessBridge} from './harness.js';
import {routeWorkUnit} from '../vendor/vcharness/runtime/routing/router.js';
import {DEFAULT_PROVIDER_REGISTRY} from '../vendor/vcharness/runtime/routing/registry.js';
const hash=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
export const relayHarnessConfigured=(env=process.env)=>env.EMRADAR_EMAIL_RELAY_URL==='https://orok-studios-api.onrender.com'&&!!env.EMRADAR_EMAIL_RELAY_TOKEN;
export function createRelayHarness({store,env=process.env,fetcher=fetch}){
 if(!relayHarnessConfigured(env))return null;
 async function request(op,payload){
  const response=await fetcher(env.EMRADAR_EMAIL_RELAY_URL+'/emradar/harness/'+op,{method:'POST',headers:{authorization:'Bearer '+env.EMRADAR_EMAIL_RELAY_TOKEN,'content-type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(75000)});
  const result=await response.json();if(!response.ok){const e=Error(result.reason||'HARNESS_RELAY_HTTP_'+response.status);e.billing=result.billing;e.safe_retry=false;throw e;}return result;
 }
 // The existing signed source, graph lock and cost reservation own authority.
 // Durable stage intent prevents an ambiguous paid request being repeated.
 const stage=async(op,input)=>{
  const key='harness_stage:'+input.context.cost_reservation.id+':'+op,previous=await store.get(key);
  if(previous?.status==='COMPLETE')return previous.value;
  if(previous)throw Error('HARNESS_STAGE_AMBIGUOUS_REQUIRES_RECONCILIATION');
  await store.put(key,{status:'IN_FLIGHT',input_hash:hash(input),at:new Date().toISOString()});
  try{const value=await request(op,input);await store.put(key,{status:'COMPLETE',value});return value;}
  catch(e){await store.put(key,{status:'FAILED_OR_AMBIGUOUS',reason:e.message,billing:e.billing||null});throw e;}
 };
 return new HarnessBridge({routeWorkUnit,
  registry:async()=>{const live=await request('registry',{});return DEFAULT_PROVIDER_REGISTRY.map(p=>({...p,enabled:p.enabled&&live.providers?.some(x=>x.providerId===p.providerId&&x.modelId===p.modelId&&x.approved&&x.connected),health:'available'}));},
  quote:(unit,context)=>request('quote',{unit,context}),
  execute:async input=>(await stage('execute',input)).result,
  verify:async input=>{
   const execution=await store.get('harness_stage:'+input.context.cost_reservation.id+':execute');
   let proof;try{proof=await stage('verify',input);}catch(e){e.billing={calls:[execution.value.billing,e.billing||null]};throw e;}
   return {...proof,billing:{calls:[execution.value.billing,proof.billing]}};
  }
 });
}
