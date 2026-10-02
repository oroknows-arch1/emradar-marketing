import crypto from 'node:crypto';
import {routeWorkUnit} from '../vendor/vcharness/runtime/routing/router.js';
import {createRuntimeProviderRegistry as canonicalRegistry} from '../vendor/vcharness/runtime/routing/registry.js';
export {routeWorkUnit};
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
function config(){const url=process.env.MARKETING_HARNESS_EXECUTOR_URL;const token=process.env.MARKETING_HARNESS_EXECUTOR_TOKEN;if(!url||!token)throw new Error('HARNESS_PROVIDER_TRANSPORT_CREDENTIALS_REQUIRED');if(!url.startsWith('https://'))throw new Error('HARNESS_TRANSPORT_TLS_REQUIRED');return {url:url.replace(/\/$/,''),token};}
async function request(path,body){const c=config();const r=await fetch(c.url+path,{method:'POST',headers:{authorization:'Bearer '+c.token,'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(60000)});if(!r.ok)throw new Error('HARNESS_TRANSPORT_HTTP_'+r.status);return r.json();}
export async function createRuntimeProviderRegistry(){
  // The canonical Moonshot registry probe spends tokens. Do not invoke it outside
  // the graph's paid cost gate. Available providers must be attested by transport.
  const canonical=await canonicalRegistry({});const live=await request('/registry',{});
  return canonical.map(p=>{const a=live.providers?.find(x=>x.providerId===p.providerId&&x.modelId===p.modelId);return {...p,enabled:p.enabled&&a?.approved===true&&a?.connected===true,health:a?.connected?'available':'unavailable'};});
}
export const quoteMarketingWorkUnit=(unit,context)=>request('/quote',{unit,context,contract:'elastic-routing-v0.1',include_verification:true,max_attempts:2,currency:'AUD'});
export const executeMarketingWorkUnit=input=>request('/execute',input);
export async function verifyMarketingWorkUnit(input){
  const proof=await request('/verify',input);
  if(proof.input_hash!==input.context.input_hash||proof.output_hash!==hash(input.result)||proof.billing?.actual!==true||proof.billing.currency!=='AUD'||!proof.billing.receipt_id)throw new Error('HARNESS_VERIFICATION_OR_BILLING_UNKNOWN');
  return proof;
}
