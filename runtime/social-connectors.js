const required=(value,reason)=>{if(!value)throw new Error(reason);return value;};
const json=async(response,platform)=>{
  const data=await response.json().catch(()=>({}));
  if(!response.ok){const error=new Error(`${platform}_API_FAILED_${response.status}`);error.status=response.status;error.retry_at=Number(response.headers.get('retry-after')||0)*1000+Date.now();throw error;}
  return data;
};
const graphemes=value=>[...new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(value)].length;

export function blueskyConnector({service='https://bsky.social',identifier,appPassword,fetchImpl=fetch}={}){
  const base=String(service).replace(/\/$/,'');
  const configured=()=>!!(base&&identifier&&appPassword);
  const session=async()=>{
    required(configured(),'BLUESKY_AUTH_NOT_CONFIGURED');
    const response=await fetchImpl(`${base}/xrpc/com.atproto.server.createSession`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({identifier,password:appPassword})});
    const data=await json(response,'BLUESKY');
    required(data.accessJwt&&data.did&&data.handle,'BLUESKY_SESSION_RECEIPT_INCOMPLETE');
    return data;
  };
  return {
    id:'BLUESKY',cost:'ZERO',formats:['text'],configured,
    validate(asset){if(graphemes(asset.copy)>300||Buffer.byteLength(asset.copy,'utf8')>3000)throw new Error('BLUESKY_COPY_LIMIT_EXCEEDED');},
    async publish(asset,key){
      this.validate(asset);const auth=await session();const createdAt=new Date().toISOString();
      const response=await fetchImpl(`${base}/xrpc/com.atproto.repo.createRecord`,{method:'POST',headers:{authorization:`Bearer ${auth.accessJwt}`,'content-type':'application/json','idempotency-key':key},body:JSON.stringify({repo:auth.did,collection:'app.bsky.feed.post',record:{$type:'app.bsky.feed.post',text:asset.copy,createdAt}})});
      const data=await json(response,'BLUESKY');const uri=required(data.uri,'BLUESKY_PUBLICATION_RECEIPT_MISSING_URI');const rkey=uri.split('/').at(-1);
      return {status:'PUBLISHED',id:uri,url:`https://bsky.app/profile/${encodeURIComponent(auth.handle)}/post/${encodeURIComponent(rkey)}`,cost_usd:0,platform_receipt:{uri,cid:data.cid||null,handle:auth.handle}};
    },
    async collect(receipt){
      const auth=await session();const response=await fetchImpl(`${base}/xrpc/app.bsky.feed.getPosts?uris=${encodeURIComponent(receipt.external_id)}`,{headers:{authorization:`Bearer ${auth.accessJwt}`}});const data=await json(response,'BLUESKY');const post=data.posts?.[0];
      if(!post)return {status:'UNKNOWN',source:'Bluesky getPosts',observed_at:new Date().toISOString(),metrics:{},cost_usd:0};
      const metrics={};for(const [name,value] of Object.entries({likes:post.likeCount,reposts:post.repostCount,replies:post.replyCount,quotes:post.quoteCount}))if(Number.isFinite(value)&&value>=0)metrics[name]={value,unit:'count',scope:'bluesky_public_metrics'};
      return {status:Object.keys(metrics).length?'AVAILABLE':'UNKNOWN',source:'Bluesky app.bsky.feed.getPosts',observed_at:new Date().toISOString(),metrics,cost_usd:0};
    }
  };
}

export function mastodonConnector({server,accessToken,fetchImpl=fetch}={}){
  const base=String(server||'').replace(/\/$/,'');
  const configured=()=>!!(base&&accessToken);
  return {
    id:'MASTODON',cost:'ZERO',formats:['text'],configured,
    validate(asset){if(!asset.copy?.trim())throw new Error('MASTODON_COPY_REQUIRED');},
    async publish(asset,key){
      required(configured(),'MASTODON_AUTH_NOT_CONFIGURED');this.validate(asset);
      const body=new URLSearchParams({status:asset.copy,visibility:'public'});
      const response=await fetchImpl(`${base}/api/v1/statuses`,{method:'POST',headers:{authorization:`Bearer ${accessToken}`,'idempotency-key':key,'content-type':'application/x-www-form-urlencoded'},body});
      const data=await json(response,'MASTODON');required(data.id&&data.url,'MASTODON_PUBLICATION_RECEIPT_INCOMPLETE');
      return {status:'PUBLISHED',id:String(data.id),url:data.url,cost_usd:0,platform_receipt:{id:String(data.id),uri:data.uri||null,url:data.url}};
    },
    async collect(receipt){
      required(configured(),'MASTODON_AUTH_NOT_CONFIGURED');const response=await fetchImpl(`${base}/api/v1/statuses/${encodeURIComponent(receipt.external_id)}`,{headers:{authorization:`Bearer ${accessToken}`}});const data=await json(response,'MASTODON');
      const metrics={};for(const [name,value] of Object.entries({replies:data.replies_count,reblogs:data.reblogs_count,favourites:data.favourites_count}))if(Number.isFinite(value)&&value>=0)metrics[name]={value,unit:'count',scope:'mastodon_public_metrics'};
      return {status:Object.keys(metrics).length?'AVAILABLE':'UNKNOWN',source:'Mastodon status API',observed_at:new Date().toISOString(),metrics,cost_usd:0};
    }
  };
}

export function linkedinConnector({accessToken,organizationUrn,apiVersion,fetchImpl=fetch}={}){
  const configured=()=>!!(accessToken&&/^urn:li:organization:\d+$/.test(organizationUrn||'')&&/^\d{6}$/.test(apiVersion||''));
  const headers=()=>({authorization:`Bearer ${accessToken}`,'content-type':'application/json','x-restli-protocol-version':'2.0.0','linkedin-version':apiVersion});
  return {
    id:'LINKEDIN',cost:'ZERO',formats:['text'],configured,
    validate(asset){if(!asset.copy?.trim())throw new Error('LINKEDIN_COPY_REQUIRED');},
    async publish(asset){
      required(configured(),'LINKEDIN_AUTH_NOT_CONFIGURED');this.validate(asset);
      const response=await fetchImpl('https://api.linkedin.com/rest/posts',{method:'POST',headers:headers(),body:JSON.stringify({author:organizationUrn,commentary:asset.copy,visibility:'PUBLIC',distribution:{feedDistribution:'MAIN_FEED',targetEntities:[],thirdPartyDistributionChannels:[]},lifecycleState:'PUBLISHED',isReshareDisabledByAuthor:false})});
      if(!response.ok){await json(response,'LINKEDIN');}
      const id=required(response.headers.get('x-restli-id'),'LINKEDIN_PUBLICATION_RECEIPT_MISSING_ID');
      return {status:'PUBLISHED',id,url:`https://www.linkedin.com/feed/update/${id}`,cost_usd:0,platform_receipt:{id,organization:organizationUrn,api_version:apiVersion}};
    },
    async collect(receipt){
      required(configured(),'LINKEDIN_AUTH_NOT_CONFIGURED');const response=await fetchImpl(`https://api.linkedin.com/rest/posts/${encodeURIComponent(receipt.external_id)}?viewContext=AUTHOR`,{headers:headers()});const data=await json(response,'LINKEDIN');
      return {status:data?.id?'AVAILABLE':'UNKNOWN',source:'LinkedIn Posts API read-back',observed_at:new Date().toISOString(),metrics:{published_readback:{value:data?.id===receipt.external_id?1:0,unit:'boolean',scope:'linkedin_publication'}},cost_usd:0};
    }
  };
}

export const socialAdapter=connector=>({
  cost:connector.cost,
  formats:connector.formats,
  authorized:async()=>connector.configured(),
  validate:asset=>connector.validate?.(asset),
  publish:(asset,key)=>connector.publish(asset,key),
  collect:receipt=>connector.collect(receipt)
});
