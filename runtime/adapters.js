import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {pathToFileURL} from 'node:url';

const editorialFormats=['editorial_pitch','finished_manuscript','newsroom_tip','latam_editor_pitch','visual_asset','contact_form'];

// The transport performs only the final reviewed delivery. Permission, evidence,
// editorial and identity decisions remain owned by the existing graph.
export function editorialOutreachAdapter({sendEmail,submitForm,collectOutcome,authorized=async()=>true,routeSupported=()=>true}={}) {
  const routeMethod=route=>String(route?.access_method||'').toLowerCase();
  const supportsRoute=route=>routeSupported(route)&&((routeMethod(route).includes('email')&&typeof sendEmail==='function')||(routeMethod(route).includes('form')&&typeof submitForm==='function'));
  return {
    cost:'ZERO',formats:editorialFormats,authorized,supportsRoute,
    async validate(asset){
      const d=asset?.delivery;
      if(!d?.destination_id||!d?.access_method||!d?.evidence_source_url)throw new Error('EDITORIAL_ROUTE_BINDING_REQUIRED');
      if(!supportsRoute(d))throw new Error('EDITORIAL_OUTREACH_CAPABILITY_UNAVAILABLE');
      if(routeMethod(d).includes('email')&&!d.public_contact_point)throw new Error('EDITORIAL_EMAIL_CONTACT_REQUIRED');
      if(routeMethod(d).includes('form')&&!d.public_submission_url)throw new Error('EDITORIAL_FORM_URL_REQUIRED');
    },
    async publish(asset,key,product){
      await this.validate(asset);
      const operation=routeMethod(asset.delivery).includes('email')?sendEmail:submitForm;
      const result=await operation({idempotency_key:key,product,asset,route:asset.delivery});
      if(!result?.id||!['SUBMITTED','DELIVERED','ACCEPTED'].includes(result.status))throw new Error('EDITORIAL_DELIVERY_RECEIPT_MISSING');
      return {id:String(result.id),url:result.url||null,status:'SUBMITTED',delivery_status:result.status,cost_usd:0,provider_receipt:result.receipt||null};
    },
    async collect(receipt){
      if(typeof collectOutcome!=='function')return {status:'UNKNOWN',source:'EDITORIAL_OUTCOME_NOT_CONNECTED',observed_at:new Date().toISOString(),metrics:{},cost_usd:0};
      const result=await collectOutcome(receipt);const metrics={};
      for(const [name,value] of Object.entries(result?.metrics||{}))if(Number.isFinite(value)&&value>=0)metrics[name]={value,unit:'boolean',scope:'editorial_outreach'};
      return {status:Object.keys(metrics).length?'AVAILABLE':'UNKNOWN',source:result?.source||'editorial_outreach_followup',observed_at:new Date().toISOString(),metrics,cost_usd:0};
    }
  };
}

export async function loadEditorialOutreach(modulePath){
  if(!modulePath)return null;
  const module=await import(pathToFileURL(path.resolve(modulePath)).href);
  return editorialOutreachAdapter({sendEmail:module.sendEditorialEmail,submitForm:module.submitEditorialForm,collectOutcome:module.collectEditorialOutcome,authorized:module.editorialRouteAuthorized,routeSupported:module.editorialRouteSupported});
}

// Real safe test destination. Actual exclusive file creation and read-back, no fake metrics.
export function localAdapter(directory) {
  return {
    cost:'ZERO', formats:['text','svg'],
    async publish(a,key) {
      await fs.mkdir(directory,{recursive:true});const file=path.join(directory,key+'.json');
      try {await fs.writeFile(file,JSON.stringify(a),{flag:'wx'});}catch(e){if(e.code!=='EEXIST')throw e;const prior=JSON.parse(await fs.readFile(file,'utf8'));if(JSON.stringify(prior)!==JSON.stringify(a))throw new Error('LOCAL_IDEMPOTENCY_CONFLICT');}
      return {id:key,url:'file://'+file,status:'PUBLISHED',cost_usd:0};
    },
    async collect(r) {
      const bytes=await fs.readFile(path.join(directory,r.external_id+'.json'));
      return {status:'AVAILABLE',source:'local_file_readback',observed_at:new Date().toISOString(),metrics:{delivered_bytes:{value:bytes.length,unit:'bytes',scope:'local_delivery'},content_verified:{value:crypto.createHash('sha256').update(bytes).digest('hex')===r.delivery_hash?1:0,unit:'boolean',scope:'local_delivery'}},cost_usd:0};
    }
  };
}
// Uses the existing authenticated X upload/publication functions. Never invents billing.
export function xAdapter({publish,fetchMetrics,authorized,discovery}) {
  return {
    cost:'UNKNOWN', formats:['text','image'], authorized, publishCalls:asset=>asset.format==='image'?4:1,
    publish, ...(discovery?{discovery}:{}),
    async collect(r) {
      const data=await fetchMetrics(r.external_id,r.product);
      const metrics={};
      for(const [name,value] of Object.entries(data?.data?.public_metrics||{}))if(Number.isFinite(value)&&value>=0)metrics[name]={value,unit:'count',scope:'x_public_metrics'};
      return {status:Object.keys(metrics).length?'AVAILABLE':'UNKNOWN',source:'X_API_v2_public_metrics',observed_at:new Date().toISOString(),metrics,cost_usd:'UNKNOWN'};
    }
  };
}
