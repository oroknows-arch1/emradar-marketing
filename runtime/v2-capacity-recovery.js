const campaign='EMRADAR_2026_10_10_LAUNCH';
const parseMemory=info=>Object.fromEntries(String(info||'').split('\n').map(line=>line.trim()).filter(line=>line&&!line.startsWith('#')&&line.includes(':')).map(line=>{const i=line.indexOf(':');return [line.slice(0,i),line.slice(i+1)];}));

async function memory(store){
  if(!store.client?.sendCommand)return {used_memory_bytes:'UNKNOWN',maxmemory_bytes:'UNKNOWN',policy:'UNKNOWN'};
  const values=parseMemory(await store.client.sendCommand(['INFO','MEMORY']));
  return {used_memory_bytes:Number(values.used_memory)||'UNKNOWN',maxmemory_bytes:Number(values.maxmemory)||'UNKNOWN',policy:values.maxmemory_policy||'UNKNOWN'};
}

export async function recoverOctober10Capacity(store){
  const before=await memory(store),deleted=[];let recovered_bytes=0;
  for(const key of await store.keys('v2:review:')){
    const record=await store.get(key);
    if(record?.campaign_id!==campaign||record.destination!=='EMRADAR-X-OROKNOWS'||record.asset?.consolidated_scan===true)continue;
    recovered_bytes+=Buffer.byteLength(JSON.stringify(record));
    await store.del(key);deleted.push(key);
  }
  for(const key of await store.keys('v2:visual:')){
    const record=await store.get(key);
    if(record?.campaign_id!==campaign||record.consolidated_scan===true)continue;
    recovered_bytes+=Buffer.byteLength(JSON.stringify(record));
    await store.del(key);deleted.push(key);
  }
  const after=await memory(store);
  if(after.policy!=='UNKNOWN'&&after.policy!=='noeviction')throw Error('REDIS_NOEVICTION_REQUIRED');
  return {status:'CAPACITY_RECOVERED',campaign_id:campaign,before,after,deleted_records:deleted.length,deleted_keys:deleted,recovered_bytes,external_actions:0};
}
