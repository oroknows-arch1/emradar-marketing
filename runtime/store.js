import {encodeState,decodeState,compactGraphState} from './state-compaction.js';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

// Both stores hold a lock throughout a graph cycle, including external side effects.
// Redis lock has no automatic expiry: a crashed ambiguous publication needs recovery,
// never an automatic retry that could publish twice.
export class FileStore {
  constructor(directory) { this.directory=directory; }
  async keys(prefix) {try{return (await fs.readdir(this.directory)).filter(n=>n.endsWith('.json')).map(n=>decodeURIComponent(n.slice(0,-5))).filter(k=>k.startsWith(prefix));}catch(e){if(e.code==='ENOENT')return [];throw e;}}
  async get(key) { try { return JSON.parse(await fs.readFile(path.join(this.directory,encodeURIComponent(key)+'.json'),'utf8')); } catch(e) { if(e.code==='ENOENT')return null;throw e; } }
  async put(key,value) { await fs.mkdir(this.directory,{recursive:true});const p=path.join(this.directory,encodeURIComponent(key)+'.json');const tmp=p+'.tmp';await fs.writeFile(tmp,JSON.stringify(value,null,2));await fs.rename(tmp,p); }
  async approveAndQueue(approvalKey,approval,workKey,work) {await this.put(approvalKey,{...approval,distribution_work:work});if(!await this.get(workKey))await this.put(workKey,work);}
  async claimReceipt(key,value) {const prior=await this.get(key);if(prior?.execution_status==='FAILED'&&prior.verified_unsent_recovery===true&&prior.attempts===0&&prior.proposal_id===value.proposal_id&&prior.review_hash===value.review_hash&&prior.delivery_hash===value.delivery_hash){await this.put(key,value);return true;}await fs.mkdir(this.directory,{recursive:true});try{await fs.writeFile(path.join(this.directory,encodeURIComponent(key)+'.json'),JSON.stringify(value),{flag:'wx'});return true;}catch(e){if(e.code==='EEXIST')return false;throw e;}}
  async leased(key,fn) {
    const p=path.join(this.directory,encodeURIComponent('lease:'+key)+'.lock');await fs.mkdir(this.directory,{recursive:true});
    try{const stat=await fs.stat(p);if(Date.now()-stat.mtimeMs>120000)await fs.unlink(p);}catch(e){if(e.code!=='ENOENT')throw e;}
    let handle;try{handle=await fs.open(p,'wx');}catch(e){if(e.code==='EEXIST')return [];throw e;}
    const timer=setInterval(()=>handle.utimes(new Date(),new Date()).catch(()=>{}),30000);timer.unref();
    try{return await fn();}finally{clearInterval(timer);await handle.close();await fs.unlink(p);}
  }
  async locked(key,fn) { await fs.mkdir(this.directory,{recursive:true});const p=path.join(this.directory,encodeURIComponent(key)+'.lock');let handle;try {handle=await fs.open(p,'wx');}catch(e){if(e.code==='EEXIST')throw new Error('RUN_IN_PROGRESS_OR_RECOVERY_REQUIRED');throw e;}try{return await fn();}finally{await handle.close();await fs.unlink(p);} }
}
export class RedisStore {
  constructor(client) {this.client=client;}
  async keys(prefix) {const result=[];for await(const batch of this.client.scanIterator({MATCH:'marketing:graph:'+prefix+'*',COUNT:100})){for(const key of (Array.isArray(batch)?batch:[batch]))result.push(key.slice('marketing:graph:'.length));}return result;}
  async get(key) { const value=await this.client.get('marketing:graph:'+key);return value?decodeState(value):null; }
  async put(key,value) {await this.client.set('marketing:graph:'+key,encodeState(key,value));}
  async compact() {return compactGraphState(this.client);}
  async approveAndQueue(approvalKey,approval,workKey,work) {await this.client.multi().set('marketing:graph:'+approvalKey,JSON.stringify({...approval,distribution_work:work})).set('marketing:graph:'+workKey,JSON.stringify(work),{NX:true}).exec();}
  async claimReceipt(key,value) {return !!await this.client.eval("local prior=redis.call('get',KEYS[1]); if not prior then redis.call('set',KEYS[1],ARGV[1]); return 1 end; local r=cjson.decode(prior); if r.execution_status=='FAILED' and r.verified_unsent_recovery==true and r.attempts==0 and r.proposal_id==cjson.decode(ARGV[1]).proposal_id and r.review_hash==cjson.decode(ARGV[1]).review_hash and r.delivery_hash==cjson.decode(ARGV[1]).delivery_hash then redis.call('set',KEYS[1],ARGV[1]); return 1 end; return 0",{keys:['marketing:graph:'+key],arguments:[JSON.stringify(value)]});}
  async leased(key,fn) {
    const k='marketing:graph:lease:'+key,token=crypto.randomUUID();
    if(!await this.client.set(k,token,{NX:true,PX:120000}))return [];
    const timer=setInterval(()=>this.client.eval("if redis.call('get',KEYS[1])==ARGV[1] then return redis.call('pexpire',KEYS[1],120000) else return 0 end",{keys:[k],arguments:[token]}).catch(()=>{}),30000);timer.unref();
    try{return await fn();}finally{clearInterval(timer);await this.client.eval("if redis.call('get',KEYS[1])==ARGV[1] then return redis.call('del',KEYS[1]) else return 0 end",{keys:[k],arguments:[token]});}
  }
  async locked(key,fn) {const k='marketing:graph:lock:'+key;const token=crypto.randomUUID();if(!await this.client.set(k,token,{NX:true}))throw new Error('RUN_IN_PROGRESS_OR_RECOVERY_REQUIRED');
    const token_hash=crypto.createHash('sha256').update(token).digest('hex');
    const heartbeat=async()=>{if(await this.client.get(k)===token)await this.put('lock_owner:'+key,{token_hash,heartbeat_at:new Date().toISOString()});};
    let timer;
    try{if(key==='engine'){await heartbeat();timer=setInterval(()=>heartbeat().catch(()=>{}),30000);timer.unref();}return await fn();}
    finally{if(timer)clearInterval(timer);await this.client.eval("if redis.call('get',KEYS[1])==ARGV[1] then return redis.call('del',KEYS[1]) else return 0 end",{keys:[k],arguments:[token]});}
  }
}
