import {pathToFileURL} from 'node:url';
import path from 'node:path';
import crypto from 'node:crypto';
import {billingDetail} from './campaign-costs.js';
const hash=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');

// This bridge calls the canonical Harness router/registry, not a competing router.
// No configured executor is an explicit blocker, never a pretend model invocation.
export class HarnessBridge {
  constructor({routeWorkUnit,registry,execute,verify,quote}){this.router=routeWorkUnit;this.registry=registry;this.execute=execute;this.verify=verify;this.quote=quote;}
  async work(unit,context){
    if(!this.router||!this.registry||!this.execute||!this.verify)throw new Error('HARNESS_DISPATCH_NOT_CONNECTED');
    const decision=this.router(unit,await this.registry());
    if(decision.contractVersion!=='elastic-routing-v0.1'||decision.workUnitId!==unit.workUnitId||decision.humanApprovalRequired||decision.lane==='human-gate')throw new Error('HARNESS_REQUIRED_APPROVAL_OR_CAPABILITY');
    const ceiling=Math.min(2,Math.max(1,decision.attemptCeiling));
    let last;const billings=[];
    const aggregate=()=>{const d=billingDetail({calls:billings});return {actual:d.state==='ACTUAL'||d.state==='ZERO',currency:'AUD',amount:d.amount_aud,receipt_id:hash(billings),provider:billings[0]?.provider||'openai',service:'verified_marketing_work',calls:billings};};
    for(let attempt=1;attempt<=ceiling;attempt++){
      try{
        const result=context.prepared_correspondence?structuredClone(context.prepared_correspondence):await this.execute({unit,decision,context,attempt});
        const proof=await this.verify({unit,decision,context,result});
        billings.push(proof?.billing);
        // Editorial fit is the owner's decision; independently verified facts still bind the draft.
        if(context.editorial_authority?.suitability==='OWNER_ONLY'&&proof?.input_hash===context.input_hash&&proof?.output_hash===hash(result)&&proof?.evidence_refs?.length&&['factual_entailment','uncertainty_preserved','originality','capability_inventory','human_correspondence'].every(k=>proof.editorial_checks?.[k]==='PASS')&&Object.entries(proof.editorial_checks).filter(([k])=>k!=='destination_fit').every(([,v])=>v==='PASS'))proof.status='VERIFIED';
        if(context.owner_preview&&proof?.status!=='VERIFIED'&&proof?.input_hash===context.input_hash&&proof?.output_hash===hash(result)&&proof?.evidence_refs?.length)return {result,proof:{...proof,billing:aggregate()},decision,attempts:attempt,preview_warnings:[{gate:'worker_verification',reason:'HARNESS_OUTPUT_NOT_VERIFIED'}],preview_only:true};
        if(proof?.status!=='VERIFIED'||proof.input_hash!==context.input_hash||proof.output_hash!==hash(result)||!proof.evidence_refs?.length)throw new Error('HARNESS_OUTPUT_NOT_VERIFIED');
        return {result,proof:{...proof,billing:aggregate()},decision,attempts:attempt};
      }catch(e){const retry=e.safe_retry&&e.billing?.actual;if(billings.length<attempt)billings.push(e.billing||null);e.billing=aggregate();last=e;if(!retry)throw e;}
    }
    throw last;
  }
}
export async function loadHarness(modulePath){
  if(!modulePath)return null;
  const m=await import(pathToFileURL(path.resolve(modulePath)).href);
  if(typeof m.routeWorkUnit!=='function'||typeof m.createRuntimeProviderRegistry!=='function'||typeof m.executeMarketingWorkUnit!=='function'||typeof m.verifyMarketingWorkUnit!=='function')throw new Error('HARNESS_MODULE_INTERFACE_INCOMPLETE');
  return new HarnessBridge({routeWorkUnit:m.routeWorkUnit,registry:m.createRuntimeProviderRegistry,execute:m.executeMarketingWorkUnit,verify:m.verifyMarketingWorkUnit,quote:m.quoteMarketingWorkUnit});
}
export const marketingWorkUnit=(node,product,complexity='medium')=>({workUnitId:product+':'+node,goal:'Bounded '+node+' for the registered marketing product',complexity,separable:false,risk:'low',dataSensitivity:'project',evidenceRequired:true,verificationRequired:true,requiredTools:[],aiRequired:true});
