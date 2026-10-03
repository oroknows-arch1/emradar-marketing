import crypto from 'node:crypto';
import fs from 'node:fs/promises';

export const discoveryTestId='EMRADAR_X_DISCOVERY_2026_10_03_V0_1';
export const sourceCommit='9429ada7c2f7a59c3b662d077551c46d0d1e5f03';
const sourceBlob='0bc26fe071ede84f389c0ae345afac945d6f951a';
const hash=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const topics=[
  ['trans-caspian-middle-corridor-integration',/middle corridor|trans.caspian|tc.gate/i],
  ['thailand-power-semiconductor-backend-ecosystem',/infineon.*(?:thailand|bangkok)|(?:thailand|bangkok).*infineon/i],
  ['arctic-seasonal-shipping-expansion',/northern sea route|arctic.*shipping/i],
  ['dakhla-desalination-agriculture-expansion',/dakhla.*(?:desalin|agricultur)|(?:desalin|agricultur).*dakhla/i],
  ['india-auto-supplier-maintenance-capacity',/suzuki.*(?:supplier|week|maintenance)/i]
];
const queries=[
  '("Middle Corridor" OR "Trans Caspian" OR (Infineon (Thailand OR Bangkok))) -is:retweet -is:reply lang:en',
  '("Northern Sea Route" OR (Dakhla (desalination OR agriculture)) OR (Suzuki (supplier OR maintenance))) -is:retweet -is:reply lang:en'
];
const fields='author_id,created_at,conversation_id,referenced_tweets,public_metrics';
function fail(reason){throw new Error(reason);}

async function read(c,e,path,params,maxMicroUsd) {
  const ledger=c.discoveryLedger;
  if(ledger.requests>=12||ledger.reserved_micro_usd+maxMicroUsd>750000)fail('X_DISCOVERY_TEST_COST_OR_REQUEST_BOUND');
  // Reserve before sending. A timeout or failed response never releases the reservation.
  ledger.requests++;ledger.reserved_micro_usd+=maxMicroUsd;
  await e.store.put('x_discovery:budget:'+discoveryTestId,ledger);
  try {
    const result=await e.adapters.X.discovery.read(path,params);
    const posts=result.data.data?.length||0,users=result.data.includes?.users?.length||0;
    const maximumFromResponse=posts*5000+users*10000;
    if(maximumFromResponse>maxMicroUsd)fail('X_DISCOVERY_RESPONSE_RESOURCE_BOUND');
    ledger.returned_resource_micro_usd+=maximumFromResponse;
    c.reads.push({path,params,http_status:200,rate:result.rate,observed_at:result.observed_at,posts,users,reserved_micro_usd:maxMicroUsd});
    if(result.rate.remaining==='0')c.rateExhausted=true;
    await e.store.put('x_discovery:budget:'+discoveryTestId,ledger);
    return result.data;
  } catch(error){c.api_error=error.details||{reason:error.message};throw error;}
}

export const organicWorkers={
  async emradar_finding(c,e) {
    if(c.input.test_id!==discoveryTestId||c.input.max_usd!==1)fail('X_DISCOVERY_SPECIFIC_OWNER_AUTHORITY_REQUIRED');
    if(!e.adapters.X?.discovery?.read)fail('X_DISCOVERY_CONNECTOR_NOT_IMPLEMENTED');
    const bytes=await fs.readFile(new URL('../tests/evidence/discovery-2026-10-03.json',import.meta.url));
    const actual=crypto.createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`),bytes])).digest('hex');
    if(actual!==sourceBlob)fail('X_DISCOVERY_SOURCE_BLOB_CHANGED');
    c.scan=JSON.parse(bytes);
    if(c.scan.snapshot_date!=='2026-10-03'||c.scan.records.length!==5)fail('X_DISCOVERY_SOURCE_INVALID');
    c.source={commit:sourceCommit,artifact:'data/checkpoints/discovery-2026-10-03.json',blob:actual,artifact_publication_state:c.scan.publication_state};
    // This source commit precedes the publication-marker update. Preserve its exact contents.
    // The discovery test does not grant source release or change marketing truth.
    const prior=await e.store.get('x_discovery:budget:'+discoveryTestId);
    if(prior)fail('X_DISCOVERY_TEST_ALREADY_RESERVED_USE_SAVED_PREVIEW');
    c.discoveryLedger={test_id:discoveryTestId,authorized_max_micro_usd:1000000,enforced_max_micro_usd:750000,requests:0,reserved_micro_usd:0,returned_resource_micro_usd:0,actual_billed_usd:'UNKNOWN'};
    await e.store.put('x_discovery:budget:'+discoveryTestId,c.discoveryLedger);
    c.reads=[];
  },
  async x_discovery(c,e) {
    c.posts=[];
    for(const query of queries){
      if(c.rateExhausted)fail('X_DISCOVERY_RATE_LIMIT_EXHAUSTED');
      const page=await read(c,e,'/2/tweets/search/recent',{query,max_results:10,'tweet.fields':fields,expansions:'author_id','user.fields':'name,username'},150000);
      const users=new Map((page.includes?.users||[]).map(u=>[u.id,u]));
      for(const post of page.data||[]){
        const author=users.get(post.author_id);
        const matched=topics.find(([,pattern])=>pattern.test(post.text));
        if(!matched||!author?.username||!/^\d{1,19}$/.test(post.id)||c.posts.some(p=>p.id===post.id))continue;
        if(post.referenced_tweets?.length||post.conversation_id!==post.id)continue;
        const age=Date.now()-Date.parse(post.created_at);
        if(!Number.isFinite(age)||age<0||age>7*86400000)continue;
        c.posts.push({...post,author:{id:author.id,name:author.name,username:author.username},finding_id:matched[0],url:`https://x.com/${author.username}/status/${post.id}`});
      }
    }
    c.posts=c.posts.sort((a,b)=>Date.parse(b.created_at)-Date.parse(a.created_at)).slice(0,5);
  },
  async conversation_baseline(c,e) {
    for(const post of c.posts){
      if(c.rateExhausted)fail('X_DISCOVERY_RATE_LIMIT_EXHAUSTED');
      const replies=await read(c,e,'/2/tweets/search/recent',{query:`conversation_id:${post.id} -is:retweet`,max_results:10,'tweet.fields':'created_at,conversation_id'},50000);
      post.baseline={root:post.text,recent_replies:(replies.data||[]).filter(p=>p.id!==post.id),complete:!replies.meta?.next_token,scope:'Public posts returned by recent-search at observation time; deleted, protected or unindexed replies remain unknown.'};
      post.baseline.hash=hash(post.baseline);
    }
  },
  async discovery_relevance_gate(c) {
    c.candidates=c.posts.map(post=>({post,finding:c.scan.records.find(f=>f.id===post.finding_id),decision:'DO_NOT_REPLY',reason:'INFORMATION_DELTA_NOT_YET_VERIFIED',information_delta:null,proposed_reply:null,uncertainty:[]}));
  },
  async information_delta_gate(c) {
    // Text absence alone does not establish a semantic information gap.
    // Only a review bound to the exact fetched conversation and exact source evidence can pass.
    for(const row of c.candidates){
      row.decision='DO_NOT_REPLY';row.information_delta=null;row.proposed_reply=null;
      const assessment=c.input.assessments?.find(a=>a.post_id===row.post.id);
      row.uncertainty=[...row.finding.contradictions,...row.finding.missing_evidence,row.post.baseline.scope];
      if(!row.post.baseline.complete){row.reason='CONVERSATION_TRUNCATED';continue;}
      if(!assessment||assessment.baseline_hash!==row.post.baseline.hash||assessment.meaningful!==true||!assessment.reason?.trim()){row.reason='SEMANTIC_INFORMATION_DELTA_UNVERIFIED';continue;}
      const evidence=row.finding.evidence[assessment.evidence_index];
      if(!evidence)fail('DISCOVERY_DELTA_EVIDENCE_OUT_OF_SCOPE');
      const baseline=[row.post.text,...row.post.baseline.recent_replies.map(p=>p.text)].join('\n');
      if(baseline.includes(evidence.fact)||baseline.includes(evidence.url)){row.reason='EVIDENCE_ALREADY_PRESENT';continue;}
      row.evidence=evidence;row.information_delta=assessment.reason;row.decision='REPLY';row.reason='SOURCE_BOUND_INFORMATION_DELTA_REVIEW';
    }
  },
  async reply_draft(c) {
    for(const row of c.candidates)if(row.decision==='REPLY'){
      const copy=`EMRADAR ${row.finding.status}: ${row.evidence.fact}`;
      if(copy.length>280){row.decision='DO_NOT_REPLY';row.reason='SOURCE_FACT_REQUIRES_EDITORIAL_COMPRESSION';continue;}
      row.proposed_reply=copy;
    }
  },
  async discovery_evidence_gate(c,e) {
    for(const row of c.candidates){
      if(row.decision==='REPLY'&&(!row.finding.evidence.includes(row.evidence)||row.proposed_reply!==`EMRADAR ${row.finding.status}: ${row.evidence.fact}`||/\b(buy|sell|hold)\b/i.test(row.proposed_reply)))fail('DISCOVERY_REPLY_EVIDENCE_OR_EDITORIAL_BOUND');
      if(c.rateExhausted)fail('X_DISCOVERY_RATE_LIMIT_EXHAUSTED');
      const result=await read(c,e,'/2/tweets',{ids:row.post.id,'tweet.fields':fields},5000);
      const verified=result.data?.find(p=>p.id===row.post.id);
      if(!verified||verified.text!==row.post.text||verified.author_id!==row.post.author.id||verified.created_at!==row.post.created_at)fail('X_DISCOVERY_POST_DELETED_OR_CHANGED');
      row.post.existence_verification={method:'authenticated_native_post_lookup',http_status:200,verified_at:new Date().toISOString(),url_resolution:'NOT_YET_BROWSER_VERIFIED'};
    }
  },
  async human_preview(c) {c.status='HUMAN_PREVIEW';},
  async discovery_stop(c) {c.no_engagement=true;}
};
