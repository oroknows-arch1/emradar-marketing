import test from 'node:test';
import assert from 'node:assert/strict';
import {campaignReviewHtml} from '../../runtime/campaign-review-html.js';

test('saved email HTML appears in isolated branded preview without changing saved content',()=>{
 const email={subject:'Exact subject',body:'Exact approved correspondence',html:'<html><body><h1>EMRADAR</h1><p>Exact approved correspondence</p></body></html>'};
 const record={status:'BLOCKED',proposals:[{destination:'Editorial desk',asset:{email}}]};
 const before=JSON.stringify(record);
 const output=campaignReviewHtml(record,'EMRADAR_2026_10_07_LAUNCH');
 assert.match(output,/iframe title="Saved branded email preview"/);
 assert.match(output,/sandbox=""/);
 assert.match(output,/srcdoc="&lt;html&gt;/);
 assert.match(output,/Exact saved email text/);
 assert.match(output,/Exact subject/);
 assert.equal(JSON.stringify(record),before);
});
test('unbranded emails retain exact text fallback and do not invent a letterhead',()=>{
 const output=campaignReviewHtml({proposals:[{asset:{email:{body:'Original body'}}}]},'EMRADAR_2026_10_08_LAUNCH');
 assert.match(output,/Original body/);
 assert.doesNotMatch(output,/<iframe/);
});
test('V2 review states automatic post-approval distribution and locks final outcomes',()=>{
 const record={proposals:[{proposal_id:'a'.repeat(64),review_hash:'b'.repeat(64),asset:{email:{body:'Exact V2 body'}}},{proposal_id:'c'.repeat(64),review_hash:'d'.repeat(64),asset:{email:{body:'Already sent'}}}],owner_decisions:{['c'.repeat(64)]:{status:'SUBMITTED'}}};
 const output=campaignReviewHtml(record,'EMRADAR_2026_10_09_LAUNCH',{decisionPath:'/V2/PUBLICATION_REVIEW',v2:true});
 assert.match(output,/Nothing is sent before owner approval/);assert.match(output,/automatically distributes an executable exact asset/);assert.match(output,/data-decision="APPROVE"/);assert.match(output,/data-decision="REJECT"/);assert.match(output,/fetch\('\/V2\/PUBLICATION_REVIEW'/);assert.match(output,/data-id="c{64}"[^>]*[\s\S]*?<button data-decision="APPROVE" disabled/);
});
