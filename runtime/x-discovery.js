// Read-only extension of the existing X connector. No publishing capability here.
export function xDiscoveryConnector({currentAuth,fetchImpl=fetch,clock=()=>Date.now()}) {
  return {
    async read(path,params) {
      if(!['/2/tweets/search/recent','/2/tweets'].includes(path))throw new Error('X_DISCOVERY_ENDPOINT_NOT_ALLOWED');
      const auth=await currentAuth('EMRADAR');
      if(!auth?.access_token)throw new Error('ACCOUNT_AUTHORIZATION_REQUIRED');
      const url=new URL(path,'https://api.x.com');
      for(const [key,value] of Object.entries(params))url.searchParams.set(key,String(value));
      const response=await fetchImpl(url,{method:'GET',redirect:'error',signal:AbortSignal.timeout(20000),headers:{authorization:`Bearer ${auth.access_token}`}});
      const data=await response.json();
      const rate=Object.fromEntries(['limit','remaining','reset'].map(k=>[k,response.headers.get('x-rate-limit-'+k)]));
      if(!response.ok){const e=new Error('X_DISCOVERY_HTTP_'+response.status);e.details={http_status:response.status,title:data.title||null,detail:data.detail||null,errors:data.errors||null,rate};throw e;}
      if(data.errors?.length){const e=new Error('X_DISCOVERY_PARTIAL_RESPONSE');e.details={errors:data.errors,rate};throw e;}
      return {data,rate,observed_at:new Date(clock()).toISOString()};
    }
  };
}
