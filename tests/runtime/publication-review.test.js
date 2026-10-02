import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {fixture} from './fixture.js';
import {GraphEngine} from '../../runtime/graph.js';

async function externalFixture(){
  const f=await fixture();for(const d of f.p.destinations)d.platform='TEST_EXTERNAL';
  f.engine=new GraphEngine({store:f.store,products:{TEST_PRODUCT:f.p},adapters:{TEST_EXTERNAL:f.adapter}});
  return f;
}

test('external publication waits for exact owner review, then resumes graph and learns',async()=>{
  const f=await externalFixture();const candidate=await f.engine.run(f.input);
  assert.equal(candidate.status,'AWAITING_REVIEW');
  assert.equal(candidate.receipt.execution_status,'AWAITING_REVIEW');
  assert(candidate.nodes.some(n=>n.node==='publication_review'&&n.status==='PASS'));
  assert(!candidate.nodes.some(n=>n.node==='execute'));
  assert.equal(candidate.learning_after.version,0);
  await assert.rejects(fs.readdir(f.dir+'/destination'),{code:'ENOENT'});
  const proposal=await f.store.get('publication_review:'+candidate.review.proposal_id);
  assert.equal(proposal.copy,candidate.review.copy);
  await assert.rejects(f.engine.approvePublication({proposal_id:proposal.proposal_id,review_hash:'changed'}),/PUBLICATION_REVIEW_EXPIRED_OR_CHANGED/);
  const published=await f.engine.approvePublication({proposal_id:proposal.proposal_id,review_hash:proposal.review_hash});
  assert.equal(published.status,'PASS');assert.equal(published.receipt.execution_status,'PUBLISHED');assert.equal(published.review.decision,'APPROVED');assert.equal(published.receipt.publication_review.review_hash,proposal.review_hash);
  assert.equal(published.outcome.measurements.content_verified.value,1);assert.equal(published.learning_after.version,1);
  const again=await f.engine.run({...f.input,campaign_id:'NEXT_CYCLE'});
  assert.equal(again.receipt.id,published.receipt.id);assert.equal((await fs.readdir(f.dir+'/destination')).length,1);
  assert(again.selection.options[0].learned>candidate.selection.options[0].learned);
});

test('owner approval for old product truth cannot authorize changed copy or source revision',async()=>{
  const f=await externalFixture();const before=await f.engine.run(f.input);
  f.p.signals[0].revision='r2';f.p.signals[0].approved_copy=['TEST_PRODUCT — FORMING. Updated reviewed fact.'];
  for(const d of f.p.destinations){d.delta.signal_revision='r2';d.permission.signal_revision='r2';}
  const after=await f.engine.approvePublication(before.review);
  assert.equal(after.status,'AWAITING_REVIEW');assert.notEqual(after.review.proposal_id,before.review.proposal_id);
  await assert.rejects(fs.readdir(f.dir+'/destination'),{code:'ENOENT'});
});
