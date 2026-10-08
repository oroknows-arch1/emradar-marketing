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
