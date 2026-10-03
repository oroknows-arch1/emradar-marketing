import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

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
