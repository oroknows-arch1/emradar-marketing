import test from 'node:test';
import assert from 'node:assert/strict';
import {createLinkedInOAuth,linkedinCallbackUrl,LINKEDIN_TOKEN_URL} from '../../runtime/linkedin-oauth.js';

const config=overrides=>({clientId:'client-id',clientSecret:'super-secret',redirectUri:'https://engine.example/oauth/linkedin/callback',saveAuthorization:async()=>{},...overrides});

test('LinkedIn authorization redirect includes the exact callback and an unpredictable state',()=>{
  const result=createLinkedInOAuth(config()).authorizationRedirect();const url=new URL(result.location);
  assert.equal(result.status,302);assert.equal(url.origin+url.pathname,'https://www.linkedin.com/oauth/v2/authorization');
  assert.equal(url.searchParams.get('redirect_uri'),'https://engine.example/oauth/linkedin/callback');assert(url.searchParams.get('state').length>=40);
});

test('LinkedIn callback exchanges and persists authorization without returning secrets',async()=>{
  const saved=[];let request;const oauth=createLinkedInOAuth(config({fetchImpl:async(url,options)=>{request={url,options};return {ok:true,status:200,json:async()=>({access_token:'access-secret',refresh_token:'refresh-secret',expires_in:60})};},saveAuthorization:async(product,auth)=>saved.push({product,auth})}));
  const state=new URL(oauth.authorizationRedirect('EMRADAR').location).searchParams.get('state');const result=await oauth.callback({state,code:'authorization-code'});
  assert.equal(result.status,302);assert.equal(result.location,'/');assert.equal(request.url,LINKEDIN_TOKEN_URL);assert.equal(saved[0].auth.access_token,'access-secret');
  assert(!JSON.stringify(result).includes('secret'));assert(!JSON.stringify(result).includes('authorization-code'));
});

test('LinkedIn callback rejects missing or invalid state without exchanging a code',async()=>{
  let calls=0;const oauth=createLinkedInOAuth(config({fetchImpl:async()=>{calls++;}}));
  assert.equal((await oauth.callback({code:'code'})).body.error,'invalid_or_expired_oauth_state');assert.equal((await oauth.callback({state:'wrong',code:'code'})).status,400);assert.equal(calls,0);
});

test('LinkedIn callback reports provider errors without disclosing their values',async()=>{
  const oauth=createLinkedInOAuth(config());const state=new URL(oauth.authorizationRedirect().location).searchParams.get('state');
  const result=await oauth.callback({state,error:'access_denied',error_description:'contains-sensitive-provider-detail'});
  assert.deepEqual(result.body,{ok:false,error:'linkedin_authorization_denied'});assert(!JSON.stringify(result).includes('sensitive'));
});

test('LinkedIn OAuth reports missing configuration and exposes only the callback URL',()=>{
  const callback=linkedinCallbackUrl({publicBaseUrl:'https://emradar-x-executor.onrender.com/'});const result=createLinkedInOAuth({redirectUri:callback}).authorizationRedirect();
  assert.equal(callback,'https://emradar-x-executor.onrender.com/oauth/linkedin/callback');assert.equal(result.status,503);assert.equal(result.body.callback_url,callback);assert(!JSON.stringify(result).includes('clientSecret'));
});

test('LinkedIn failed token exchange does not disclose code, client secret, or provider body',async()=>{
  const oauth=createLinkedInOAuth(config({fetchImpl:async()=>({ok:false,status:401,json:async()=>({error_description:'provider-secret'})})}));const state=new URL(oauth.authorizationRedirect().location).searchParams.get('state');
  const output=JSON.stringify(await oauth.callback({state,code:'one-time-code'}));for(const secret of ['super-secret','one-time-code','provider-secret'])assert(!output.includes(secret));
});
