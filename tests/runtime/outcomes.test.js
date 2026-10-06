import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './fixture.js';
import {FileStore} from '../../runtime/store.js';
import {appendOutcome,normalizeOutcome,outcomeHistory,analyseOutcomes,learnRouting,historicalRoutingInput} from '../../runtime/outcomes.js';
import {evaluateX} from '../../runtime/route-feedback.js';
import {checkPublication} from '../../runtime/publication-outcomes.js';
const receipt=()=>({id:'a'.repeat(64),product:'EMRADAR',campaign_id:'SG',signal_id:'SG',signal_revision:'R',signal_state:'FORMING',destination:'editor',platform:'OPEN_ROUTE',route_key:'EMRADAR:SG:editor:text',timestamp:'2026-10-05T22:26:18.251Z',execution_status:'SUBMITTED',delivery_status:'ACCEPTED',recipient:'editor@example.com',external_id:'<original@gmail.com>',provider_receipt:{message_id:'<original@gmail.com>',accepted:['editor@example.com']},delivery_hash:'unchanged',provider_cost:{currency:'AUD',amount:0}});
test('receipt anchors survive restart; acceptance never becomes interest or publication; history appends idempotently',async()=>{
 const f=await fixture(),r=receipt(),before=JSON.stringify(r);
 const a=await normalizeOutcome(f.store,r,{source:'UNAVAILABLE',metrics:{},observed_at:'2026-10-06T00:00:00Z'});
 assert.equal(a.provider_acceptance_state,'PROVIDER_ACCEPTED');assert.equal(a.outcome_state,'UNKNOWN');assert.equal(JSON.stringify(r),before);
 const restarted=new FileStore(f.store.directory);
 const p={metrics:{},observed_at:'2026-10-06T01:00:00Z',collection:{status:'CHECKED',complete:true,reference:'check:1',checks:['read_only']}};
 const b=await normalizeOutcome(restarted,r,p);assert.equal(b.outcome_state,'NO_OBSERVED_OUTCOME');assert(!b.history.some(e=>e.state==='REJECTED'));const count=b.history.length;
 await normalizeOutcome(restarted,r,p);assert.equal((await outcomeHistory(restarted,r.id)).length,count);
 assert(await restarted.get('outcome:'+r.id));
});
test('matched responses and bounces require evidence and cannot inflate to PUBLISHED; absence preserves prior positive evidence',async()=>{
 const f=await fixture(),r=receipt();
 await assert.rejects(appendOutcome(f.store,r.id,{state:'PUBLISHED',at:r.timestamp,evidence:{type:'GMAIL_SMTP_ACCEPTANCE',reference:'receipt'}}),/PUBLICATION_PAGE/);
 await assert.rejects(appendOutcome(f.store,r.id,{state:'REJECTED',at:r.timestamp,evidence:{type:'NO_REPLY',reference:'check'}}),/EXPLICIT_EDITORIAL/);
 await assert.rejects(appendOutcome(f.store,r.id,{state:'BOUNCED',at:r.timestamp,evidence:{type:'UNMATCHED',reference:'message'}}),/MATCHED_FAILURE/);
 await assert.rejects(normalizeOutcome(f.store,r,{events:[{state:'RESPONSE_RECEIVED',at:r.timestamp,evidence:{type:'MATCHED_GMAIL_REPLY_HEADERS',reference:'message',matched_original_message_id:'<unrelated@gmail.com>'}}]}),/MESSAGE_MISMATCH/);
 const b=await normalizeOutcome(f.store,r,{metrics:{},events:[{state:'RESPONSE_RECEIVED',at:r.timestamp,evidence:{type:'MATCHED_GMAIL_REPLY_HEADERS',reference:'gmail:123',reply_message_id:'<reply@gmail.com>',matched_original_message_id:r.external_id}}]});assert.equal(b.outcome_state,'RESPONSE_RECEIVED');
 const later=await normalizeOutcome(f.store,r,{metrics:{},collection:{status:'CHECKED',complete:true,reference:'later'}});assert.equal(later.outcome_state,'RESPONSE_RECEIVED');
});
test('analysis and learning retain cost, provenance, sample size and uncertainty; hypothetical routing reads neutral evidence',async()=>{
 const f=await fixture(),r=receipt();await normalizeOutcome(f.store,r,{metrics:{}});
 const analysis=await analyseOutcomes(f.store),memory=await learnRouting(f.store,analysis),input=historicalRoutingInput(memory,{destination:'editor',platform:'OPEN_ROUTE',evidence_state:'FORMING'});
 assert.equal(input.signals.length,1);assert.equal(input.signals[0].sample_size,1);assert.equal(input.signals[0].kind,'INSUFFICIENT_EVIDENCE');assert.equal(input.signals[0].provenance,analysis.reference);assert.equal(input.adjustment,0);assert.equal(input.exploration_preserved,true);assert.equal(Object.values(analysis.groups)[0].costs[0].distribution.amount,0);
});
test('X always produces a persisted selected/rejected reason; unknown-cost route never calls publication',async()=>{
 const f=await fixture(),signal={id:'SG',revision:'R',state:'FORMING',evidence:['e'],source_facts:[{id:'e',text:'Construction began; output is forecast.'}],causal_chain:{industries:['Copper mining']},source_uncertainty:['Realised output unknown']};const product={...f.p,signals:[signal]};let publishes=0;
 const adapter={cost:'UNKNOWN',formats:['text'],authorized:async()=>true,publish:async()=>publishes++};
 const result=await evaluateX({store:f.store,product,signal,adapter});assert.equal(result.state,'X_NOT_SELECTED');assert(result.reasons.includes('ACTUAL_COST_BOUND_UNKNOWN'));assert.equal(publishes,0);assert.equal((await f.store.get('route_evaluation:EMRADAR:SG:R')).evidence_state,'FORMING');
 adapter.cost='ZERO';const selected=await evaluateX({store:f.store,product,signal,adapter});assert.equal(selected.state,'X_SELECTED');assert.equal(selected.publication_authority,'EXACT_OWNER_REVIEW_REQUIRED');assert.equal(publishes,0);
 const analysis=await analyseOutcomes(f.store),memory=await learnRouting(f.store,analysis);assert.equal(memory.route_evaluations.length,1);
});
test('publication discovery requires verified domain, exact artifact attribution and publication date',async()=>{
 const body='EMRADAR evidence-led analysis. '.repeat(8),proposal={asset:{delivery:{evidence_source_url:'https://example.com/contact'},email:{body}}},r=receipt();
 const fetchPage=async()=>new Response('<article>Similar Sierra Gorda story</article>',{headers:{'content-type':'text/html'}});
 assert.equal((await checkPublication({proposal,receipt:r,url:'https://example.com/article',fetchPage})).state,'UNKNOWN');
 await assert.rejects(checkPublication({proposal,receipt:r,url:'https://localhost/private',fetchPage}),/DOMAIN/);
 const actual=await checkPublication({proposal,receipt:r,url:'https://example.com/article',fetchPage:async()=>new Response(`<article>${body}</article><script type="application/ld+json">{"datePublished":"2026-10-06T00:00:00Z"}</script>`,{headers:{'content-type':'text/html'}})});assert.equal(actual.state,'PUBLISHED');assert(actual.evidence.page_hash);
});
