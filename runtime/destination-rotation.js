import crypto from 'node:crypto';
const hash=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const X='EMRADAR-X-OROKNOWS';
const normal=v=>String(v||'').normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const ignored=new Set(['global','africa','african','industry','industries','market','markets','economic','economy','verified','reported','milestone','development','announced','projects','project','with','from','that','this','have','will','were']);
const tokens=v=>new Set(normal(v).split(' ').filter(w=>w.length>3&&!ignored.has(w)).map(w=>w.replace(/(?:ing|es|s)$/u,'').replace(/e$/u,'')));
const shared=(a,b)=>[...tokens(a)].some(t=>tokens(b).has(t));
const truth=formation=>(formation.evidence||[]).map(e=>e.claim||e.text||'').join(' ');
const decision=(v,scan,route)=>typeof v==='function'?v(scan,route)===true:v===true;
const unique=values=>[...new Set(values)].sort();
const routeHash=route=>hash({id:route.id,endpoint:route.endpoint,delivery:route.delivery,record:route.delivery_record,industries:route.industries,topics:route.relevant_beat_topic});
export function credibleDestination(route){
 if(route.endpoint?.verification_state!=='VERIFIED')return false;
 if(route.delivery?.method==='EMAIL')return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(route.endpoint.address||'');
 if(route.delivery?.method!=='MANUAL')return false;
 try{return new URL(route.delivery_record?.public_submission_url).protocol==='https:';}catch{return false;}
}
export function pitchIdentity(formation){
 return {state:formation.state,causal_chain:unique((formation.causal_chain||[]).map(v=>normal(typeof v==='string'?v:JSON.stringify(v)))),claims:unique((formation.evidence||formation.source_facts||[]).map(e=>normal(e.claim||e.text)).filter(Boolean)),uncertainty:unique((formation.uncertainty||formation.source_uncertainty||[]).map(normal)),strengthening:unique((formation.strengthening_evidence||[]).map(normal)),weakening:unique((formation.weakening_evidence||[]).map(normal)),break_conditions:unique((formation.break_conditions||[]).map(normal))};
}
export function substantiallySamePitch(a,b){
 if(!a?.claims?.length||!b?.claims?.length)return false;
 if(hash({...a,claims:[]})!==hash({...b,claims:[]}))return false;
 if(hash(a.claims)===hash(b.claims))return true;
 const left=new Set(a.claims.join(' ').split(' ')),right=new Set(b.claims.join(' ').split(' ')),numbers=v=>unique([...v].filter(w=>/^\d+$/.test(w)));
 if(hash(numbers(left))!==hash(numbers(right)))return false;
 const intersection=[...left].filter(w=>right.has(w)).length;
 return intersection/new Set([...left,...right]).size>=0.9;
}
function categories(formation,route){
 const facts=truth(formation),domain=[...(route.industries||[]),...(route.relevant_beat_topic||[])].filter(v=>normal(v)!=='all');
 if(domain.length&&!domain.some(v=>shared(v,facts)))return [];
 const labels=(formation.industries||[]).filter(label=>shared(label,facts)||((route.industries||[]).some(v=>normal(v)===normal(label))&&domain.some(v=>shared(v,facts))));
 if(labels.length)return unique(labels.map(normal));
 const supported=domain.filter(v=>shared(v,facts));
 if(supported.length)return unique(supported.map(normal));
 // Explicit relevance on an unclassified route is an existing matching
 // contract. Its category still comes from the evidence, never its geography.
 if(!domain.length&&route.editorial_relevance===true){const topic=[...tokens(facts)].slice(0,3).join(' ');return topic?[topic]:[];}
 return [];
}
async function history(store){
 const learning=await store.get('v2:learning'),outcomes=await Promise.all((await store.get('outcome_index')||[]).map(id=>store.get('outcome:'+id)));
 const receipts=await Promise.all([...(await store.keys('v2:receipt:')),...(await store.keys('receipt:'))].map(key=>store.get(key)));
 const plans=await Promise.all((await store.keys('v2:destination-selection:')).map(key=>store.get(key)));
 const stats=new Map(),pitches=new Map(),seen=new Set();
 const stat=id=>{if(!stats.has(id))stats.set(id,{contacts:0,selections:0,relationship:false,outcome:'UNKNOWN'});return stats.get(id);};
 for(const plan of plans.filter(Boolean))for(const item of plan.selected||[])if(item.destination_id!==X){stat(item.destination_id).selections++;if(item.pitch){if(!pitches.has(item.destination_id))pitches.set(item.destination_id,[]);pitches.get(item.destination_id).push(item.pitch);}}
 for(const [id,value] of Object.entries(learning?.destinations||{}))if(value.replies>0||value.publications>0){stat(id).relationship=true;stat(id).outcome='OBSERVED_POSITIVE';}
 for(const o of outcomes.filter(Boolean))if(o.destination&&['EDITOR_INTEREST','MORE_INFORMATION_REQUESTED','RESPONSE_RECEIVED','PUBLISHED'].includes(o.outcome_state)){stat(o.destination).relationship=true;stat(o.destination).outcome='OBSERVED_POSITIVE';}
 for(const r of receipts.filter(Boolean).sort((a,b)=>Number(!!(b.external_id||b.provider_receipt?.message_id||b.provider_receipt?.id))-Number(!!(a.external_id||a.provider_receipt?.message_id||a.provider_receipt?.id))||String(a.id||'').localeCompare(String(b.id||'')))){
  if(!r.destination||r.destination===X)continue;
  const confirmed=!!(r.external_id||r.provider_receipt?.message_id||r.provider_receipt?.id);
  const pending=['SUBMITTED','PUBLISHED','IN_FLIGHT','AMBIGUOUS'].includes(r.execution_status);
  if(!confirmed&&!pending)continue;
  const identity=r.idempotency_key||r.id;if(identity&&seen.has(identity))continue;if(identity)seen.add(identity);
  if(confirmed)stat(r.destination).contacts++;
  const p=r.proposal_id?await store.get('v2:review:'+r.proposal_id)||await store.get('publication_review:'+r.proposal_id):null;
  const evidence=p?.binding?.evidence||p?.asset?.email?.evidence_binding;
  if(evidence){const pitch=pitchIdentity({...evidence,state:evidence.formation_state||evidence.signal_state});if(!pitches.has(r.destination))pitches.set(r.destination,[]);pitches.get(r.destination).push(pitch);}
 }
 return {stats,pitches};
}

// A durable campaign plan is also the rotation history. No counters are
// incremented on retry, and observations/receipts are never rewritten.
export async function selectDestinations({store,campaign_id,scan,destinations,requireX=true}){
 if(!store?.locked||!store.keys||!store.get||!store.put)throw Error('DESTINATION_ROTATION_PERSISTENCE_REQUIRED');
 return store.locked('v2:destination-selection',async()=>{
  const key='v2:destination-selection:'+campaign_id,sourceHash=hash(scan),previous=await store.get(key);
  if(previous){
   if(previous.source_hash!==sourceHash)throw Error('DESTINATION_SELECTION_SOURCE_CHANGED');
   for(const entry of previous.selected){const route=destinations.find(r=>r.id===entry.destination_id);if(!route||routeHash(route)!==entry.route_hash)throw Error('SELECTED_DESTINATION_CHANGED');}
   return previous;
  }
  const x=destinations.find(r=>r.id===X);if(requireX&&!x)throw Error('MANDATORY_X_DESTINATION_MISSING');
  const {stats,pitches}=await history(store),formations=scan.formations||[scan.formation],candidates=[],dispositions=[],supportedCategories=new Set();
  for(const formation of formations)for(const route of destinations.filter(r=>r.id!==X)){
   const local={...scan,formation};delete local.formations;
   if(!formation.evidence?.length||!truth(formation).trim()||!decision(route.editorial_relevance,local,route)||!decision(route.evidence_suitable,local,route)){dispositions.push({destination:route.id,formation_id:formation.id,reason:'NO_EVIDENCE_SUPPORTED_RELEVANCE'});continue;}
   const supported=categories(formation,route);if(!supported.length){dispositions.push({destination:route.id,formation_id:formation.id,reason:'NO_EVIDENCE_SUPPORTED_CATEGORY'});continue;}
   for(const category of supported)supportedCategories.add(category);
   if(!credibleDestination(route)){dispositions.push({destination:route.id,formation_id:formation.id,reason:'NO_CREDIBLE_VERIFIED_ROUTE'});continue;}
   const pitch=pitchIdentity(formation);
   if((pitches.get(route.id)||[]).some(old=>substantiallySamePitch(pitch,old))){dispositions.push({destination:route.id,formation_id:formation.id,reason:'SUBSTANTIALLY_IDENTICAL_PREVIOUS_PITCH'});continue;}
   candidates.push({destination_id:route.id,formation_id:formation.id,categories:supported,route_hash:routeHash(route),pitch,observations:stats.get(route.id)||{contacts:0,selections:0,relationship:false,outcome:'UNKNOWN'}});
  }
  const categoryNames=[...supportedCategories].sort(),selected=[],ids=new Set(),counts=Object.fromEntries(categoryNames.map(c=>[c,0]));
  const order=(a,b)=>a.observations.contacts-b.observations.contacts||a.observations.selections-b.observations.selections||Number(b.observations.relationship)-Number(a.observations.relationship)||a.destination_id.localeCompare(b.destination_id)||a.formation_id.localeCompare(b.formation_id);
  function add(item,reason){if(!item||ids.has(item.destination_id)||selected.length>=30)return false;ids.add(item.destination_id);selected.push({...item,reason});for(const c of item.categories)counts[c]++;return true;}
  // Keep one suitable established relationship per category, then favour
  // under-contacted outlets. Evidence overlap can satisfy multiple categories.
  for(const category of categoryNames){if(counts[category])continue;add(candidates.filter(c=>c.categories.includes(category)&&c.observations.relationship).sort(order)[0],'PRESERVE_OBSERVED_EDITORIAL_RELATIONSHIP');}
  for(const target of [5,10])for(let round=0;round<target;round++)for(const category of categoryNames){
   if(counts[category]>=target)continue;
   add(candidates.filter(c=>c.categories.includes(category)&&!ids.has(c.destination_id)).sort(order)[0],'EVIDENCE_RELEVANCE_AND_UNDER_CONTACTED_ROTATION');
  }
  for(const candidate of candidates)if(!selected.some(s=>s.destination_id===candidate.destination_id&&s.formation_id===candidate.formation_id))dispositions.push({destination:candidate.destination_id,formation_id:candidate.formation_id,reason:ids.has(candidate.destination_id)?'CROSS_CATEGORY_DESTINATION_DEDUPLICATION':selected.length>=30?'CAMPAIGN_DESTINATION_CEILING':'CATEGORY_TARGET_REACHED'});
  if(x)selected.push({destination_id:X,formation_id:formations[0].id,categories:[],route_hash:routeHash(x),reason:'MANDATORY_X_SEPARATE_FROM_EXTERNAL_CEILING'});
  const record={version:1,campaign_id,source_hash:sourceHash,target_min:5,target_max:10,external_limit:30,external_count:ids.size,selected,categories:categoryNames.map(category=>({category,selected_count:counts[category],available_count:new Set(candidates.filter(c=>c.categories.includes(category)).map(c=>c.destination_id)).size,quota_forced:false})),dispositions,created_at:new Date().toISOString(),external_actions:0};
  await store.put(key,record);return record;
 });
}
