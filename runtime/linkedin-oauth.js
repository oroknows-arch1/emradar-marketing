import crypto from 'node:crypto';
import {URLSearchParams} from 'node:url';

export const LINKEDIN_CALLBACK_PATH='/oauth/linkedin/callback';
export const LINKEDIN_AUTHORIZE_URL='https://www.linkedin.com/oauth/v2/authorization';
export const LINKEDIN_TOKEN_URL='https://www.linkedin.com/oauth/v2/accessToken';

export function linkedinCallbackUrl({publicBaseUrl,host}){
  const base=String(publicBaseUrl||`https://${host||''}`).replace(/\/$/,'');
  return `${base}${LINKEDIN_CALLBACK_PATH}`;
}

export function createLinkedInOAuth({clientId,clientSecret,redirectUri,scopes='openid profile email w_member_social',sessions=new Map(),fetchImpl=fetch,saveAuthorization,now=()=>Date.now()}={}){
  const configured=()=>!!(clientId&&clientSecret&&redirectUri&&saveAuthorization);
  return {
    authorizationRedirect(product='EMRADAR'){
      if(!configured())return {ok:false,status:503,body:{ok:false,blocker:'LINKEDIN_OAUTH_NOT_CONFIGURED',callback_url:redirectUri}};
      const state=crypto.randomBytes(32).toString('base64url');
      sessions.set(state,{created:now(),product});
      const query=new URLSearchParams({response_type:'code',client_id:clientId,redirect_uri:redirectUri,state,scope:scopes});
      return {ok:true,status:302,location:`${LINKEDIN_AUTHORIZE_URL}?${query}`};
    },
    async callback(params={}){
      const state=params.state,code=params.code,session=state?sessions.get(state):null;
      if(params.error){if(state)sessions.delete(state);return {ok:false,status:400,body:{ok:false,error:'linkedin_authorization_denied'}};}
      if(!state||!code||!session||now()-session.created>600000){if(state)sessions.delete(state);return {ok:false,status:400,body:{ok:false,error:'invalid_or_expired_oauth_state'}};}
      if(!configured())return {ok:false,status:503,body:{ok:false,blocker:'LINKEDIN_OAUTH_NOT_CONFIGURED'}};
      sessions.delete(state);
      try{
        const response=await fetchImpl(LINKEDIN_TOKEN_URL,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',code,client_id:clientId,client_secret:clientSecret,redirect_uri:redirectUri})});
        const data=await response.json().catch(()=>({}));
        if(!response.ok||!data.access_token)throw new Error(`LinkedIn token exchange failed (${response.status})`);
        await saveAuthorization(session.product,{...data,authorized_at:new Date(now()).toISOString(),expires_at:now()+(Number(data.expires_in||5184000)*1000)});
        return {ok:true,status:302,location:'/'};
      }catch{return {ok:false,status:502,body:{ok:false,error:'linkedin_oauth_exchange_failed'}};}
    }
  };
}
