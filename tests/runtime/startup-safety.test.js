import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const source=await fs.readFile(new URL('../../server.js',import.meta.url),'utf8');
const start=source.indexOf('server.listen(PORT,()=>{'),end=source.indexOf('\n});\n\nasync function runPendingSourceRelease()',start),startup=source.slice(start,end+4);
async function boot(result){
 const calls={campaign:0,notifications:0,preflight:0};
 const campaign=()=>{calls.campaign++;throw Error('CAMPAIGN_SIDE_EFFECT_FORBIDDEN');};
 const context={PORT:0,KEY_VALUE_URL:'',cutoverState:{status:'STARTING'},console:{log(){},error(){}},server:{listen(_port,fn){fn();}},setInterval(){return {unref(){}};},notifyReadyReviews:async()=>{calls.notifications++;},v2Preflight:async()=>{calls.preflight++;if(result instanceof Error)throw result;return result;},store:campaign,recoverOctoberCampaignsToV2:campaign,recoverV2ReviewCoverage:campaign,repairV2EditorialReview:campaign,v2Runtime:campaign,normalCycle:campaign,distributionCycle:campaign};
 vm.runInNewContext(startup,context);await new Promise(resolve=>setImmediate(resolve));return {calls,context};
}
test('normal startup observes readiness and notifications but executes zero campaigns',async()=>{
 const result={status:'PASS',external_submissions:0},f=await boot(result);
 assert.equal(f.calls.campaign,0);assert.equal(f.calls.preflight,1);assert.equal(f.calls.notifications,1);assert.equal(f.context.cutoverState.status,'PASS');
 assert.doesNotMatch(startup,/recoverOctoberCampaignsToV2|recoverV2ReviewCoverage|repairV2EditorialReview|\.distribute\(|normalCycle\(|distributionCycle\(|2026_10_10/);
});
test('BLOCKED preflight returns without recovery, preparation or distribution',async()=>{
 const f=await boot({status:'BLOCKED',reason:'FIXTURE_BLOCKED',external_submissions:0});assert.equal(f.calls.campaign,0);assert.equal(f.context.cutoverState.status,'BLOCKED');assert.match(startup,/if\(result\.status==='BLOCKED'\)return/);
});
test('preflight failure stays blocked and cannot execute campaigns',async()=>{
 const f=await boot(Error('FIXTURE_PREFLIGHT_UNAVAILABLE'));assert.equal(f.calls.campaign,0);assert.equal(f.context.cutoverState.status,'BLOCKED');assert.equal(f.context.cutoverState.external_submissions,0);
});
function scheduled({authorized=true}={}){
 const begin=source.indexOf("  if(req.method==='POST'&&u.pathname==='/SCHEDULED_CYCLE')"),finish=source.indexOf("  if(u.pathname==='/OUTCOME_REVIEW'",begin),block=source.slice(begin,finish),calls=[];
 const context={verifySchedulerToken:async token=>{calls.push('verify');assert.equal(token,'fixture');if(!authorized)throw Error('AUTH_REQUIRED');},normalCycle:async()=>{calls.push('prepare');return {preparation:{status:'AWAITING_OWNER_REVIEW'}};},v2Runtime:async()=>({distribute:async()=>{calls.push('approved-distribution');return [{status:'SIMULATED'}];}}),json:(_res,status,body)=>({status,body})};
 vm.runInNewContext('handler=async(req,res,u)=>{'+block+'}',context);return {calls,run:()=>context.handler({method:'POST',headers:{authorization:'Bearer fixture'}},{},{pathname:'/SCHEDULED_CYCLE'})};
}
test('explicit authorised scheduler retains preparation and approved distribution handoff',async()=>{
 const f=scheduled(),response=await f.run();assert.equal(response.status,200);assert.deepEqual(f.calls,['verify','prepare','approved-distribution']);assert.equal(response.body.v2_distribution[0].status,'SIMULATED');
});
test('unauthorised scheduler cannot invoke preparation or distribution',async()=>{
 const f=scheduled({authorized:false}),response=await f.run();assert.equal(response.status,409);assert.deepEqual(f.calls,['verify']);
});
