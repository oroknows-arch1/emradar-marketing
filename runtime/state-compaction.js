import {deflateSync,inflateSync} from 'node:zlib';
// A storage representation only. Exact decoded JSON, assets and hashes survive.
const field='__emradar_deflate_v1';
const eligible=k=>/^(run:|review_package|publication_review:|harness_stage:|editorial_copy:|learning$|routing_memory$|performance_analysis|campaign_cost:|outcome:|outcome_history:|receipt_index$|source:|route_plan:|discovery:)/.test(k);
export const decodeState=raw=>{const v=JSON.parse(raw);return v&&typeof v[field]==='string'?JSON.parse(inflateSync(Buffer.from(v[field],'base64')).toString('utf8')):v;};
export function encodeState(key,value){
 const raw=JSON.stringify(value);if(!eligible(key)||Buffer.byteLength(raw)<4096)return raw;
 const packed=JSON.stringify({[field]:deflateSync(Buffer.from(raw)).toString('base64')});
 return Buffer.byteLength(packed)<Buffer.byteLength(raw)?packed:raw;
}
// Only shrinking replacements can run at capacity. No delete/eviction, no
// generic OOM bypass for graph writes. Compare-and-set preserves concurrent work.
export const shrinkScript="#!lua flags=allow-oom\nlocal old=redis.call('get',KEYS[1]); if old~=ARGV[1] or string.len(ARGV[2])>=string.len(old) then return 0 end; redis.call('set',KEYS[1],ARGV[2],'KEEPTTL'); return 1";
export async function compactGraphState(client,{limit=64,scanLimit=1000}={}){
 const candidates=[];let scanned=0;
 for await(const batch of client.scanIterator({MATCH:'marketing:graph:*',COUNT:100})){
  for(const key of Array.isArray(batch)?batch:[batch]){
   if(++scanned>scanLimit)break;
   if(!eligible(key.slice('marketing:graph:'.length)))continue;
   const raw=await client.get(key);if(!raw||Buffer.byteLength(raw)<4096)continue;
   const value=decodeState(raw),packed=encodeState(key.slice('marketing:graph:'.length),value);
   if(Buffer.byteLength(packed)<Buffer.byteLength(raw)&&JSON.stringify(decodeState(packed))===JSON.stringify(value))candidates.push({key,raw,packed});
  }
  if(scanned>=scanLimit)break;
 }
 let saved_bytes=0,records=0;
 for(const {key,raw,packed} of candidates.sort((a,b)=>b.raw.length-a.raw.length).slice(0,limit)){
  if(await client.eval(shrinkScript,{keys:[key],arguments:[raw,packed]})){records++;saved_bytes+=Buffer.byteLength(raw)-Buffer.byteLength(packed);}
 }
 return {status:'LOSSLESS_COMPACTION',records,saved_bytes,scanned,external_actions:0};
}
