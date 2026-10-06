import crypto from 'node:crypto';
const plain=s=>s.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,'').replace(/<[^>]*>/g,' ').replace(/&nbsp;|&#160;/g,' ').replace(/\s+/g,' ').trim();
// Discovery is bounded to supplied/matched reply candidate URLs on the verified
// publication domain. Search similarity never changes publication state.
export async function checkPublication({proposal,receipt,url,fetchPage=fetch}){
  const route=proposal?.asset?.delivery,allowed=new URL(route.evidence_source_url).hostname.replace(/^www\./,'');
  const target=new URL(url),host=target.hostname.replace(/^www\./,'');
  if(target.protocol!=='https:'||target.port||target.username||target.password||host!==allowed)throw new Error('VERIFIED_PUBLICATION_DOMAIN_REQUIRED');
  const response=await fetchPage(url,{redirect:'error',signal:AbortSignal.timeout(10000)});
  if(!response.ok||!response.headers.get('content-type')?.includes('text/html'))throw new Error('PUBLICATION_PAGE_UNAVAILABLE');
  const chunks=[];let size=0;for await(const chunk of response.body){size+=chunk.length;if(size>262144)throw new Error('PUBLICATION_PAGE_BOUND');chunks.push(chunk);}
  const html=Buffer.concat(chunks).toString(),text=plain(html),body=plain(proposal.asset.email?.body||proposal.copy||'');
  // Exact artifact attribution and article/date markup, rather than source-story similarity.
  const matched=body.length>=160&&text.includes(body)&&/\bEMRADAR\b/.test(text)&&/"@type"\s*:\s*"(?:NewsArticle|Article)"|<article\b/i.test(html);
  const date=html.match(/"datePublished"\s*:\s*"([^"]+)"/)?.[1];
  if(!matched||!date||!Number.isFinite(Date.parse(date))||Date.parse(date)<Date.parse(receipt.timestamp))return {state:'UNKNOWN',reason:'PUBLICATION_IDENTITY_OR_DATE_NOT_DEMONSTRATED',url,checked_at:new Date().toISOString()};
  return {state:'PUBLISHED',at:date,evidence:{type:'VERIFIED_PUBLICATION_PAGE',reference:url,url,page_hash:crypto.createHash('sha256').update(html).digest('hex'),artifact_match:true,publication_date:date}};
}
