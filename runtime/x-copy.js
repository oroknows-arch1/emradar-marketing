// Extractive native formatting: whole source fact plus source qualification
// clauses. Never shorten a fact, create a numerical claim, or promise a service.
const capabilityCheck=copy=>{if(/\b(?:EMRADAR|we)\s+(?:can|will|offer(?:s)?\s+to)\s+(?:provide|monitor|track|follow|investigate|update|cover)\b/i.test(copy))throw new Error('UNVERIFIED_X_CAPABILITY_CLAIM');return copy;};
export function nativeXCopy(signal){
  const approved=(signal.approved_copy||[]).find(copy=>copy.includes(signal.state)&&copy.length<=280);
  if(approved)return {copy:capabilityCheck(approved),evidence_refs:signal.evidence,method:'SOURCE_APPROVED_NATIVE_COPY'};
  const fact=signal.source_facts?.find(f=>signal.evidence.includes(f.id));
  if(!fact?.text||!signal.source_uncertainty?.length)throw new Error('X_SOURCE_FACT_AND_UNCERTAINTY_REQUIRED');
  const qualifications=signal.source_uncertainty.slice(0,2).map((text,index)=>({index,text:text.split(/[,;]/)[0].replace(/[.;]+$/,'')}));
  const copy=`EMRADAR — ${signal.state}\n\n${fact.text}\n\nUnresolved: ${qualifications.map(q=>q.text).join('; ')}`;
  if(copy.length>280)throw new Error('X_NATIVE_COPY_REQUIRES_SHORTER_APPROVED_FACT');
  capabilityCheck(copy);
  return {copy,evidence_refs:[fact.id],qualification_indexes:qualifications.map(q=>q.index),method:'EXTRACTIVE_NATIVE_X_V1'};
}
