import crypto from 'node:crypto';
import {calendarMonth} from './spending.js';

const hash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const now=()=>new Date().toISOString();
const fail=reason=>{throw new Error(reason);};
const finalDelivery=new Set(['SUBMITTED','PUBLISHED','AMBIGUOUS','IN_FLIGHT']);

export const V2_GRAPH=Object.freeze([
  'SCAN','MATCH','PREPARE','VERIFY','OWNER_REVIEW','DISTRIBUTE','RECORD','LEARN'
]);
export const V2_WORKERS=Object.freeze({
  SCAN:'validate published source and preserve evidence',
  MATCH:'separate relevance from executable route capability',
  PREPARE:'produce one destination-specific finished asset',
  VERIFY:'bind source, route, uncertainty, recipient and exact bytes',
  OWNER_REVIEW:'persist approve or reject against the review hash',
  DISTRIBUTE:'execute approved destinations independently and idempotently',
  RECORD:'persist provider receipt before downstream work',
  LEARN:'record outcomes and re-enter replies without restarting campaigns'
});

// Compatibility boundary for the existing Purelymail-compatible editorial
// adapter. V2 does not own credentials, sender identity, or provider setup.
export function existingEditorialTransport(adapter){
  return {
    quote:async()=>({currency:'AUD',max_cost_aud:0}),
    async send({asset,idempotency_key,approval}){
      if(!adapter?.publish)fail('TRANSPORT_UNAVAILABLE');
      const result=await adapter.publish(asset,idempotency_key,'EMRADAR',{proposal:{proposal_id:approval.proposal_id,review_hash:approval.review_hash,asset},approval});
      if(result.status!=='SUBMITTED')fail('PROVIDER_ACCEPTANCE_REQUIRED');
      return {id:result.id,status:'ACCEPTED',receipt:result.provider_receipt,actual_cost_aud:0};
    },
    collect:receipt=>adapter.collect(receipt)
  };
}

// Compatibility boundary for the existing authenticated X adapter. Unknown
// provider spend remains fail-closed in V2 until separately authorised.
export function existingXTransport(adapter){
  return {
    quote:async()=>({currency:'AUD',max_cost_aud:'UNKNOWN',owner_authorized_unknown_spend:true,accounting:'OBSERVE_ACTUAL'}),
    async send({asset,idempotency_key}){
      if(!adapter?.publish||!await adapter.authorized?.('EMRADAR'))fail('TRANSPORT_UNAVAILABLE');
      const result=await adapter.publish(asset,idempotency_key,'EMRADAR');
      if(result.status!=='PUBLISHED'||!result.id)fail('PROVIDER_ACCEPTANCE_REQUIRED');
      return {id:result.id,status:'ACCEPTED',receipt:{provider:'X',status:result.status,url:result.url||null},actual_cost_aud:result.actual_cost_aud};
    },
    collect:receipt=>adapter.collect(receipt)
  };
}

function assertScan(scan){
  const formations=scan?.formations||[scan?.formation];
  if(scan?.publication_state!=='PUBLISHED'||!scan.source_revision||!formations.length)fail('PUBLISHED_SCAN_REQUIRED');
  for(const f of formations){
    if(!f?.id||!f.state||!Array.isArray(f.causal_chain)||!Array.isArray(f.evidence)||!f.evidence.length||!Array.isArray(f.uncertainty)||!Array.isArray(f.strengthening_evidence)||!Array.isArray(f.weakening_evidence)||!Array.isArray(f.break_conditions))fail('SCAN_EVIDENCE_CONTRACT_INVALID');
    if(f.recommendation||/\b(?:BUY|HOLD|SELL)\b/i.test(JSON.stringify(f)))fail('INVESTMENT_RECOMMENDATION_FORBIDDEN');
  }
}

function routeExecutable(route){
  return route?.editorial_relevance===true&&route.evidence_suitable===true&&route.endpoint?.verification_state==='VERIFIED'&&route.delivery?.supported===true&&route.connector?.authorized===true&&route.finished_contribution_supported===true;
}
const routeDecision=(value,scan,route)=>typeof value==='function'?value(scan,route)===true:value===true;

function reviewView(p){
  return {proposal_id:p.proposal_id,review_hash:p.review_hash,formation_id:p.formation_id,formation_state:p.formation_state,destination:p.destination,evidence_summary:p.evidence_summary,evidence_binding:p.binding?.evidence,asset:p.asset,required_visual_or_attachment:p.required_visual_or_attachment,route:p.route,delivery_capability:p.delivery_capability,uncertainty:p.uncertainty,controls:['APPROVE','REJECT']};
}

export class StreamlinedMarketingEngineV2 {
  constructor({store,destinations=[],transports={},assetBuilder,maxSteps=Infinity,campaignLimitAud=5,monthLimitAud=50}){
    this.store=store;this.destinations=destinations;this.transports=transports;this.assetBuilder=assetBuilder;this.maxSteps=maxSteps;this.campaignLimitAud=campaignLimitAud;this.monthLimitAud=monthLimitAud;
  }

  async prepare({campaign_id,scan,expand_review=false,supersede_unapproved_editorial=false}){
    assertScan(scan);
    return this.store.locked('v2:campaign:'+campaign_id,async()=>{
      const scanHash=hash(scan),prior=await this.store.get('v2:campaign:'+campaign_id);
      if(prior&&prior.scan_hash!==scanHash)fail('CAMPAIGN_SOURCE_CHANGED');
      if(!expand_review&&(prior?.status==='AWAITING_OWNER_REVIEW'||prior?.status==='COMPLETE'))return prior;
      const formations=scan.formations||[scan.formation],trace=[{node:'SCAN',status:'PASS',formations:formations.length,at:now()}],matches=[],opportunities=[],dispositions=[];
      for(let index=0;index<formations.length;index++)for(const route of this.destinations){
        const formation=formations[index],scanWide=route.id==='EMRADAR-X-OROKNOWS';if(scanWide&&index>0)continue;
        const formationScan={...scan,formation};if(!scanWide)delete formationScan.formations;
        const evaluated={...route,editorial_relevance:routeDecision(route.editorial_relevance,formationScan,route),evidence_suitable:routeDecision(route.evidence_suitable,formationScan,route)};
        const relevant=evaluated.editorial_relevance&&evaluated.evidence_suitable;
        if(!relevant){dispositions.push({formation_id:formation.id,destination:route.id,status:'NOT_RELEVANT',reason:evaluated.evidence_suitable?'NO_EVIDENCE_SUPPORTED_BEAT_OR_GEOGRAPHY_MATCH':'PUBLISHED_EVIDENCE_UNSUITABLE'});continue;}
        const executable=routeExecutable(evaluated);
        if(!executable)opportunities.push({formation_id:formation.id,destination:route.id,status:'REVIEW_ONLY',reason:'TRANSPORT_UNAVAILABLE'});
        matches.push({route:evaluated,scan:formationScan,executable});dispositions.push({formation_id:formation.id,destination:route.id,status:executable?'EXECUTABLE':'REVIEW_ONLY'});
      }
      trace.push({node:'MATCH',status:'PASS',executable:matches.length,research_opportunities:opportunities.length,at:now()});
      const proposals=[],superseded=[],savedReviews=(await Promise.all((await this.store.keys('v2:review:')).map(key=>this.store.get(key)))).filter(p=>p?.campaign_id===campaign_id&&p.status!=='SUPERSEDED'),decisions=new Map((await Promise.all(savedReviews.map(async proposal=>[proposal.proposal_id,await this.store.get('v2:decision:'+proposal.proposal_id)]))).filter(([,decision])=>decision));
      for(const match of matches){
        const {route,scan:formationScan,executable}=match;
        if(Number.isFinite(this.maxSteps)&&trace.length>=this.maxSteps)fail('STEP_BOUND');
        const scanWide=route.id==='EMRADAR-X-OROKNOWS',formation=formationScan.formation,formationId=scanWide?'OCTOBER_10_SCAN':formation.id,deliveryKey=hash([formationId,scan.source_revision,route.id,route.delivery.method]);
        const reusable=savedReviews.find(p=>p.delivery_key===deliveryKey&&p.binding?.evidence?.source_revision===scan.source_revision&&Boolean(p.asset?.consolidated_scan)===scanWide&&(!supersede_unapproved_editorial||scanWide||decisions.has(p.proposal_id)||p.asset?.editorial_version==='human-correspondence-v2'));
        if(reusable){proposals.push(reviewView(reusable));continue;}
        const asset=await this.assetBuilder({scan:structuredClone(formationScan),route:structuredClone(route)});
        if(!asset?.subject||!asset?.body||asset.to!==route.endpoint.address||asset.delivery_method!==route.delivery.method)fail('FINISHED_ASSET_REQUIRED');
        if(/\b(?:BUY|HOLD|SELL)\b/i.test(asset.subject+' '+asset.body))fail('INVESTMENT_RECOMMENDATION_FORBIDDEN');
        const evidenceBinding={source_revision:scan.source_revision,formation_id:formation.id,formation_state:formation.state,causal_chain:formation.causal_chain,evidence:formation.evidence,strengthening_evidence:formation.strengthening_evidence,weakening_evidence:formation.weakening_evidence,break_conditions:formation.break_conditions,uncertainty:formation.uncertainty,companies:formation.companies||[],tickers:formation.tickers||[]};
        if(scanWide)evidenceBinding.formations=formations.map(f=>({id:f.id,state:f.state,evidence:f.evidence,uncertainty:f.uncertainty,causal_chain:f.causal_chain}));
        const binding={campaign_id,scan_hash:scanHash,evidence:evidenceBinding,destination:route,asset};
        const reviewHash=hash(binding),proposalId=hash([deliveryKey,reviewHash]);
        const replaced=[];
        if(supersede_unapproved_editorial&&!scanWide)for(const old of savedReviews.filter(p=>p.delivery_key===deliveryKey&&!decisions.has(p.proposal_id)&&p.proposal_id!==proposalId)){old.status='SUPERSEDED';old.superseded_reason='OWNER_REJECTED_DEFICIENT_EDITORIAL_CORRESPONDENCE';old.superseded_at=now();old.replaced_by=proposalId;await this.store.put('v2:review:'+old.proposal_id,old);replaced.push(old.proposal_id);superseded.push(old.proposal_id);}
        const proposal={proposal_id:proposalId,review_hash:reviewHash,delivery_key:deliveryKey,campaign_id,formation_id:formationId,formation_state:scanWide?'SCAN_WIDE':formation.state,status:'AWAITING_OWNER_REVIEW',destination:route.id,evidence_summary:asset.evidence_summary,asset,required_visual_or_attachment:asset.required_visual_or_attachment||'NONE',route:{method:route.delivery.method,recipient:route.endpoint.address,verification:route.endpoint.verification_state},delivery_capability:executable?'VERIFIED_EXECUTABLE':'UNAVAILABLE_REVIEW_ONLY',uncertainty:scanWide?formations.flatMap(f=>f.uncertainty):[...formation.uncertainty],binding,...(replaced.length?{replaces_proposal_ids:replaced}:{}),created_at:now()};
        await this.store.put('v2:review:'+proposalId,proposal);proposals.push(reviewView(proposal));
      }
      for(const saved of savedReviews.filter(proposal=>proposal.status!=='SUPERSEDED')){
        if(proposals.some(proposal=>proposal.proposal_id===saved.proposal_id))continue;
        proposals.push(reviewView(saved));
        const disposition=dispositions.find(item=>item.formation_id===saved.binding?.evidence?.formation_id&&item.destination===saved.destination);
        if(disposition){disposition.status=saved.status==='REJECTED'?'OWNER_REJECTED':saved.status==='OWNER_APPROVED'?'OWNER_APPROVED':'REVIEW_ONLY';disposition.reason='PERSISTED_REVIEW_PRESERVED';}
      }
      trace.push({node:'PREPARE',status:'PASS',count:proposals.length,at:now()},{node:'VERIFY',status:'PASS',count:proposals.length,at:now()},{node:'OWNER_REVIEW',status:'WAITING',at:now()});
      const record={engine:'EMRADAR_MARKETING_ENGINE_V2',campaign_id,scan_hash:scanHash,source_revision:scan.source_revision,status:'AWAITING_OWNER_REVIEW',findings:formations.map(f=>({id:f.id,state:f.state,title:f.title,evidence_count:f.evidence.length,uncertainty:f.uncertainty})),proposals,opportunities,route_dispositions:dispositions,trace,...(supersede_unapproved_editorial?{editorial_repair:{superseded_count:superseded.length,superseded_proposal_ids:superseded,approved_assets_preserved:decisions.size,external_actions:0}}:{}),external_actions:0,updated_at:now()};
      await this.store.put('v2:campaign:'+campaign_id,record);return record;
    });
  }

  async decide({proposal_id,review_hash,decision}){
    if(!['APPROVE','REJECT'].includes(decision))fail('OWNER_DECISION_REQUIRED');
    return this.store.locked('v2:decision:'+proposal_id,async()=>{
      const proposal=await this.store.get('v2:review:'+proposal_id);
      if(!proposal||proposal.review_hash!==review_hash||hash(proposal.binding)!==review_hash)fail('REVIEW_ASSET_CHANGED');
      const prior=await this.store.get('v2:decision:'+proposal_id);
      if(prior){
        if(prior.decision!==decision)fail('OWNER_DECISION_IMMUTABLE');
        if(decision==='APPROVE'&&proposal.delivery_capability==='VERIFIED_EXECUTABLE'&&!await this.store.get('v2:work:'+proposal_id))await this.store.put('v2:work:'+proposal_id,{proposal_id,review_hash,delivery_key:proposal.delivery_key,campaign_id:proposal.campaign_id,status:'QUEUED',attempts:0,created_at:now()});
        return prior;
      }
      const record={proposal_id,review_hash,decision,authority:'OWNER',decided_at:now()};
      if(decision==='APPROVE'&&proposal.delivery_capability==='VERIFIED_EXECUTABLE'){
        const work={proposal_id,review_hash,delivery_key:proposal.delivery_key,campaign_id:proposal.campaign_id,status:'QUEUED',attempts:0,created_at:now()};
        await this.store.approveAndQueue('v2:decision:'+proposal_id,record,'v2:work:'+proposal_id,work);
      }else await this.store.put('v2:decision:'+proposal_id,record);
      proposal.status=decision==='APPROVE'?'OWNER_APPROVED':'REJECTED';await this.store.put('v2:review:'+proposal_id,proposal);return record;
    });
  }

  async distribute({limit=8,proposal_ids=null,campaign_ids=null}={}){
    return this.store.leased('v2:distribution',async()=>{
      const results=[],selected=proposal_ids?new Set(proposal_ids):null,campaigns=campaign_ids?new Set(campaign_ids):null;
      for(const key of (await this.store.keys('v2:work:')).sort()){
        if(results.length>=limit)break;
        const work=await this.store.get(key);if(work?.status!=='QUEUED')continue;
        if(selected&&!selected.has(work.proposal_id))continue;
        if(campaigns&&!campaigns.has(work.campaign_id))continue;
        const proposal=await this.store.get('v2:review:'+work.proposal_id),decision=await this.store.get('v2:decision:'+work.proposal_id);
        if(!proposal||decision?.decision!=='APPROVE'||decision.review_hash!==proposal.review_hash||hash(proposal.binding)!==proposal.review_hash){work.status='BLOCKED';work.error='APPROVAL_BINDING_INVALID';await this.store.put(key,work);results.push(work);continue;}
        const old=await this.store.get('receipt:'+proposal.delivery_key)||await this.store.get('v2:receipt:'+proposal.delivery_key);
        if(finalDelivery.has(old?.execution_status)){work.status=old.execution_status;work.receipt_id=old.id;await this.store.put(key,work);results.push({proposal_id:proposal.proposal_id,status:work.status,receipt:old,duplicate:true});continue;}
        const transport=this.transports[proposal.asset.delivery_method];
        if(!transport?.send){work.status='FAILED';work.error='TRANSPORT_UNAVAILABLE';await this.store.put(key,work);results.push(work);continue;}
        const quote=await transport.quote?.(proposal.asset)??{currency:'AUD',max_cost_aud:'UNKNOWN'};
        const month=calendarMonth(),ledger=await this.store.get('v2:spend:'+month)||{month,actual_aud:0,campaigns:{}};
        const campaignSpent=ledger.campaigns[proposal.campaign_id]||0;
        const xUnknownSpendAuthorized=proposal.destination==='EMRADAR-X-OROKNOWS'&&proposal.asset.delivery_method==='X'&&quote.currency==='AUD'&&quote.owner_authorized_unknown_spend===true;
        if(quote.currency!=='AUD'||(!Number.isFinite(quote.max_cost_aud)&&!xUnknownSpendAuthorized)){work.status='BLOCKED';work.error='OWNER_AUTHORIZATION_REQUIRED_UNKNOWN_SPEND';await this.store.put(key,work);results.push(work);continue;}
        if(Number.isFinite(quote.max_cost_aud)&&(campaignSpent+quote.max_cost_aud>this.campaignLimitAud||ledger.actual_aud+quote.max_cost_aud>this.monthLimitAud)){work.status='BLOCKED';work.error='SPENDING_LIMIT_EXCEEDED';await this.store.put(key,work);results.push(work);continue;}
        const inFlight={id:proposal.delivery_key,proposal_id:proposal.proposal_id,review_hash:proposal.review_hash,delivery_hash:hash(proposal.asset),campaign_id:proposal.campaign_id,destination:proposal.destination,idempotency_key:proposal.delivery_key,execution_status:'IN_FLIGHT',attempts:work.attempts+1,timestamp:now(),provider_receipt:null};
        if(!await this.store.claimReceipt('v2:receipt:'+proposal.delivery_key,inFlight)){const existing=await this.store.get('v2:receipt:'+proposal.delivery_key);work.status=existing?.execution_status||'AMBIGUOUS';await this.store.put(key,work);results.push({proposal_id:proposal.proposal_id,status:work.status,receipt:existing,duplicate:true});continue;}
        work.status='IN_FLIGHT';work.attempts=inFlight.attempts;await this.store.put(key,work);
        let receipt=inFlight;
        try{
          const sent=await transport.send({asset:structuredClone(proposal.asset),idempotency_key:proposal.delivery_key,approval:{proposal_id:proposal.proposal_id,review_hash:proposal.review_hash}});
          if(!sent?.id||sent.status!=='ACCEPTED')fail('PROVIDER_ACCEPTANCE_REQUIRED');
          const observedCost=sent.actual_cost_aud??quote.max_cost_aud;
          receipt={...inFlight,execution_status:'SUBMITTED',external_id:String(sent.id),provider_receipt:sent.receipt||null,actual_cost_aud:Number.isFinite(observedCost)?observedCost:'UNKNOWN',cost_observation:Number.isFinite(observedCost)?'PROVIDER_REPORTED':'NOT_AVAILABLE',timestamp:now()};
          if(Number.isFinite(observedCost)){if(observedCost<0)fail('PROVIDER_COST_RECEIPT_REQUIRED');ledger.actual_aud+=observedCost;ledger.campaigns[proposal.campaign_id]=campaignSpent+observedCost;await this.store.put('v2:spend:'+month,ledger);}
          else if(!xUnknownSpendAuthorized)fail('PROVIDER_COST_RECEIPT_REQUIRED');
        }catch(error){receipt={...inFlight,execution_status:error.definitely_unsent===true?'FAILED':'AMBIGUOUS',error:error.message,timestamp:now()};}
        await this.store.put('v2:receipt:'+proposal.delivery_key,receipt);work.status=receipt.execution_status;work.receipt_id=receipt.id;work.completed_at=now();await this.store.put(key,work);
        await this.store.put('v2:feedback-work:'+receipt.id,{receipt_id:receipt.id,status:receipt.execution_status==='SUBMITTED'?'QUEUED':'WAITING',created_at:now()});results.push({proposal_id:proposal.proposal_id,status:work.status,receipt});
      }
      return results;
    });
  }

  async learn({receipt_id,events=[],collection={status:'AVAILABLE'}}){
    const receipt=await this.store.get('v2:receipt:'+receipt_id);if(!receipt)fail('RECEIPT_NOT_FOUND');
    const proposal=await this.store.get('v2:review:'+receipt.proposal_id),learning=await this.store.get('v2:learning')||{version:0,destinations:{},processed:{}};
    for(const event of events){
      const eventId=hash([receipt_id,event]);if(learning.processed[eventId])continue;learning.processed[eventId]=true;
      if(event.type==='EDITORIAL_REPLY'||event.type==='ASSET_REQUEST')await this.store.put('v2:preparation-work:'+eventId,{origin_receipt_id:receipt_id,proposal_id:proposal.proposal_id,status:'QUEUED',reason:event.type,payload:event.payload||null});
      if(event.type==='PUBLICATION_CONFIRMED'){if(!event.url)fail('PUBLICATION_EVIDENCE_REQUIRED');receipt.execution_status='PUBLISHED';receipt.publication={url:event.url,confirmed_at:event.at||now()};await this.store.put('v2:receipt:'+receipt_id,receipt);}
      const d=learning.destinations[proposal.destination]||{submissions:0,replies:0,publications:0,rejections:0,non_responses:0};
      if(event.type==='EDITORIAL_REPLY')d.replies++;if(event.type==='PUBLICATION_CONFIRMED')d.publications++;if(event.type==='REJECTED')d.rejections++;if(event.type==='NON_RESPONSE')d.non_responses++;learning.destinations[proposal.destination]=d;
    }
    const d=learning.destinations[proposal.destination]||{submissions:0,replies:0,publications:0,rejections:0,non_responses:0};
    if(!learning.processed['submission:'+receipt_id]&&['SUBMITTED','PUBLISHED'].includes(receipt.execution_status)){d.submissions++;learning.processed['submission:'+receipt_id]=true;learning.destinations[proposal.destination]=d;}
    learning.version++;learning.updated_at=now();await this.store.put('v2:learning',learning);
    await this.store.put('v2:feedback-work:'+receipt_id,{receipt_id,status:'OBSERVED',collection,updated_at:now()});
    return {receipt,learning,reentry_events:events.filter(e=>['EDITORIAL_REPLY','ASSET_REQUEST'].includes(e.type)).length};
  }

  async collect(receiptId){
    const receipt=await this.store.get('v2:receipt:'+receiptId);if(!receipt)fail('RECEIPT_NOT_FOUND');
    const proposal=await this.store.get('v2:review:'+receipt.proposal_id),transport=this.transports[proposal?.asset?.delivery_method];
    if(!transport?.collect)fail('OUTCOME_COLLECTION_UNAVAILABLE');
    const outcome=await transport.collect(receipt);
    return this.learn({receipt_id:receiptId,events:outcome.events||[],collection:outcome.collection||{status:outcome.status,source:outcome.source}});
  }
}
