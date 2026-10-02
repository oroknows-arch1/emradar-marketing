import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

// Both stores hold a lock throughout a graph cycle, including external side effects.
// Redis lock has no automatic expiry: a crashed ambiguous publication needs recovery,
// never an automatic retry that could publish twice.
export class FileStore {
  constructor(directory) { this.directory=directory; }
  async get(key) { try { return JSON.parse(await fs.readFile(path.join(this.directory,encodeURIComponent(key)+'.json'),'utf8')); } catch(e) { if(e.code==='ENOENT')return null;throw e; } }
  async put(key,value) { await fs.mkdir(this.directory,{recursive:true});const p=path.join(this.directory,encodeURIComponent(key)+'.json');const tmp=p+'.tmp';await fs.writeFile(tmp,JSON.stringify(value,null,2));await fs.rename(tmp,p); }
  async locked(key,fn) { await fs.mkdir(this.directory,{recursive:true});const p=path.join(this.directory,encodeURIComponent(key)+'.lock');let handle;try {handle=await fs.open(p,'wx');}catch(e){if(e.code==='EEXIST')throw new Error('RUN_IN_PROGRESS_OR_RECOVERY_REQUIRED');throw e;}try{return await fn();}finally{await handle.close();await fs.unlink(p);} }
}
export class RedisStore {
  constructor(client) {this.client=client;}
  async get(key) { const value=await this.client.get('marketing:graph:'+key);return value?JSON.parse(value):null; }
  async put(key,value) {await this.client.set('marketing:graph:'+key,JSON.stringify(value));}
  async locked(key,fn) {const k='marketing:graph:lock:'+key;const token=crypto.randomUUID();if(!await this.client.set(k,token,{NX:true}))throw new Error('RUN_IN_PROGRESS_OR_RECOVERY_REQUIRED');try{return await fn();}finally{await this.client.eval("if redis.call('get',KEYS[1])==ARGV[1] then return redis.call('del',KEYS[1]) else return 0 end",{keys:[k],arguments:[token]});}}
}
