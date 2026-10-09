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
    }
  };
}

function assertScan(scan){
  if(scan?.publication_state!=='PUBLISHED'||!scan.source_revision||!scan.formation?.id||!scan.formation.state)fail('PUBLISHED_SCAN_REQUIRED');
  const f=scan.formation;
  if(!Array.isArray(f.causal_chain)||!Array.isArray(f.evidence)||!f.evidence.length||!Array.isArray(f.uncertainty)||!Array.isArray(f.strengthening_evidence)||!Array.isArray(f.weakening_evidence)||!Array.isArray(f.break_conditions))fail('SCAN_EVIDENCE_CONTRACT_INVALID');
  if(f.recommendation||/\b(?:BUY|HOLD|SELL)\b/i.test(JSON.stringify(f)))fail('INVESTMENT_RECOMMENDATION_FORBIDDEN');
}

function routeExecutable(route){
  return route?.editorial_relevance===true&&route.evidence_suitable===true&&route.endpoint?.verification_state==='VERIFIED'&&route.delivery?.supported===true&&route.connector?.authorized===true&&route.finished_contribution_supported===true;
}
const routeDecision=(value,scan,route)=>typeof value==='function'?value(scan,route)===true:value===true;

function reviewView(p){
  return {proposal_id:p.proposal_id,review_hash:p.review_hash,destination:p.destination,evidence_summary:p.evidence_summary,asset:p.asset,required_visual_or_attachment:p.required_visual_or_attachment,route:p.route,delivery_capability:p.delivery_capability,uncertainty:p.uncertainty,controls:['APPROVE','REJECT']};
}

export class StreamlinedMarketingEngineV2 {
  constructor({store,destinations=[],transports={},assetBuilder,maxSteps=64,campaignLimitAud=5,monthLimitAud=50}){
    this.store=store;this.destinations=destinations;this.transports=transports;this.assetBuilder=assetBuilder;this.maxSteps=maxSteps;this.campaignLimitAud=campaignLimitAud;this.monthLimitAud=monthLimitAud;
  }

  async prepare({campaign_id,scan}){
    assertScan(scan);
    return this.store.locked('v2:campaign:'+campaign_id,async()=>{
      const scanHash=hash(scan),prior=await this.store.get('v2:campaign:'+campaign_id);
      if(prior&&prior.scan_hash!==scanHash)fail('CAMPAIGN_SOURCE_CHANGED');
      if(prior?.status==='AWAITING_OWNER_REVIEW'||prior?.status==='COMPLETE')return prior;
      const trace=[{node:'SCAN',status:'PASS',at:now()}],matches=[],opportunities=[],dispositions=[];
      for(const route of this.destinations){
        const evaluated={...route,editorial_relevance:routeDecision(route.editorial_relevance,scan,route),evidence_suitable:routeDecision(route.evidence_suitable,scan,route)};
        const relevant=evaluated.editorial_relevance&&evaluated.evidence_suitable;
        if(!relevant){dispositions.push({destination:route.id,status:'NOT_RELEVANT'});continue;}
        if(!routeExecutable(evaluated)){opportunities.push({destination:route.id,status:'RESEARCH_OPPORTUNITY',reason:'ROUTE_NOT_EXECUTABLE'});dispositions.push({destination:route.id,status:'UNSUPPORTED'});continue;}
        matches.push(evaluated);dispositions.push({destination:route.id,status:'EXECUTABLE'});
      }
      trace.push({node:'MATCH',status:'PASS',executable:matches.length,research_opportunities:opportunities.length,at:now()});
      const proposals=[];
      for(const route of matches){
        if(trace.length>=this.maxSteps)fail('STEP_BOUND');
        const asset=await this.assetBuilder({scan:structuredClone(scan),route:structuredClone(route)});
        if(!asset?.subject||!asset?.body||asset.to!==route.endpoint.address||asset.delivery_method!==route.delivery.method)fail('FINISHED_ASSET_REQUIRED');
        if(/\b(?:BUY|HOLD|SELL)\b/i.test(asset.subject+' '+asset.body))fail('INVESTMENT_RECOMMENDATION_FORBIDDEN');
        const evidenceBinding={source_revision:scan.source_revision,formation_state:scan.formation.state,causal_chain:scan.formation.causal_chain,evidence:scan.formation.evidence,strengthening_evidence:scan.formation.strengthening_evidence,weakening_evidence:scan.formation.weakening_evidence,break_conditions:scan.formation.break_conditions,uncertainty:scan.formation.uncertainty,companies:scan.formation.companies||[],tickers:scan.formation.tickers||[]};
        const deliveryKey=hash([scan.formation.id,scan.source_revision,route.id,asset.delivery_method]);
        const binding={campaign_id,scan_hash:scanHash,evidence:evidenceBinding,destination:route,asset};
        const reviewHash=hash(binding),proposalId=hash([deliveryKey,reviewHash]);
        const proposal={proposal_id:proposalId,review_hash:reviewHash,delivery_key:deliveryKey,campaign_id,status:'AWAITING_OWNER_REVIEW',destination:route.id,evidence_summary:asset.evidence_summary,asset,required_visual_or_attachment:asset.required_visual_or_attachment||'NONE',route:{method:route.delivery.method,recipient:route.endpoint.address,verification:route.endpoint.verification_state},delivery_capability:'VERIFIED_EXECUTABLE',uncertainty:[...scan.formation.uncertainty],binding,created_at:now()};
        await this.store.put('v2:review:'+proposalId,proposal);proposals.push(reviewView(proposal));
      }
      trace.push({node:'PREPARE',status:'PASS',count:proposals.length,at:now()},{node:'VERIFY',status:'PASS',count:proposals.length,at:now()},{node:'OWNER_REVIEW',status:'WAITING',at:now()});
      const record={engine:'EMRADAR_MARKETING_ENGINE_V2',campaign_id,scan_hash:scanHash,source_revision:scan.source_revision,status:'AWAITING_OWNER_REVIEW',proposals,opportunities,route_dispositions:dispositions,trace,external_actions:0,updated_at:now()};
      await this.store.put('v2:campaign:'+campaign_id,record);return record;
    });
  }

  async decide({proposal_id,review_hash,decision}){
    if(!['APPROVE','REJECT'].includes(decision))fail('OWNER_DECISION_REQUIRED');
    return this.store.locked('v2:decision:'+proposal_id,async()=>{
      const proposal=await this.store.get('v2:review:'+proposal_id);
      if(!proposal||proposal.review_hash!==review_hash||hash(proposal.binding)!==review_hash)fail('REVIEW_ASSET_CHANGED');
      const prior=await this.store.get('v2:decision:'+proposal_id);
      if(prior){if(prior.decision!==decision)fail('OWNER_DECISION_IMMUTABLE');return prior;}
      const record={proposal_id,review_hash,decision,authority:'OWNER',decided_at:now()};
      await this.store.put('v2:decision:'+proposal_id,record);
      if(decision==='APPROVE')await this.store.put('v2:work:'+proposal_id,{proposal_id,review_hash,delivery_key:proposal.delivery_key,campaign_id:proposal.campaign_id,status:'QUEUED',attempts:0,created_at:now()});
      proposal.status=decision==='APPROVE'?'OWNER_APPROVED':'REJECTED';await this.store.put('v2:review:'+proposal_id,proposal);return record;
    });
  }

  async distribute({limit=8}={}){
    return this.store.leased('v2:distribution',async()=>{
      const results=[];
      for(const key of (await this.store.keys('v2:work:')).sort()){
        if(results.length>=limit)break;
        const work=await this.store.get(key);if(work?.status!=='QUEUED')continue;
        const proposal=await this.store.get('v2:review:'+work.proposal_id),decision=await this.store.get('v2:decision:'+work.proposal_id);
        if(!proposal||decision?.decision!=='APPROVE'||decision.review_hash!==proposal.review_hash||hash(proposal.binding)!==proposal.review_hash){work.status='BLOCKED';work.error='APPROVAL_BINDING_INVALID';await this.store.put(key,work);results.push(work);continue;}
        const old=await this.store.get('receipt:'+proposal.delivery_key)||await this.store.get('v2:receipt:'+proposal.delivery_key);
        if(finalDelivery.has(old?.execution_status)){work.status=old.execution_status;work.receipt_id=old.id;await this.store.put(key,work);results.push({proposal_id:proposal.proposal_id,status:work.status,receipt:old,duplicate:true});continue;}
        const transport=this.transports[proposal.asset.delivery_method];
        if(!transport?.send){work.status='FAILED';work.error='TRANSPORT_UNAVAILABLE';await this.store.put(key,work);results.push(work);continue;}
        const quote=await transport.quote?.(proposal.asset)??{currency:'AUD',max_cost_aud:'UNKNOWN'};
        const month=calendarMonth(),ledger=await this.store.get('v2:spend:'+month)||{month,actual_aud:0,campaigns:{}};
        const campaignSpent=ledger.campaigns[proposal.campaign_id]||0;
        if(quote.currency!=='AUD'||!Number.isFinite(quote.max_cost_aud)){work.status='BLOCKED';work.error='OWNER_AUTHORIZATION_REQUIRED_UNKNOWN_SPEND';await this.store.put(key,work);results.push(work);continue;}
        if(campaignSpent+quote.max_cost_aud>this.campaignLimitAud||ledger.actual_aud+quote.max_cost_aud>this.monthLimitAud){work.status='BLOCKED';work.error='SPENDING_LIMIT_EXCEEDED';await this.store.put(key,work);results.push(work);continue;}
        const inFlight={id:proposal.delivery_key,proposal_id:proposal.proposal_id,review_hash:proposal.review_hash,delivery_hash:hash(proposal.asset),campaign_id:proposal.campaign_id,destination:proposal.destination,idempotency_key:proposal.delivery_key,execution_status:'IN_FLIGHT',attempts:work.attempts+1,timestamp:now(),provider_receipt:null};
        if(!await this.store.claimReceipt('v2:receipt:'+proposal.delivery_key,inFlight)){const existing=await this.store.get('v2:receipt:'+proposal.delivery_key);work.status=existing?.execution_status||'AMBIGUOUS';await this.store.put(key,work);results.push({proposal_id:proposal.proposal_id,status:work.status,receipt:existing,duplicate:true});continue;}
        work.status='IN_FLIGHT';work.attempts=inFlight.attempts;await this.store.put(key,work);
        let receipt=inFlight;
        try{
          const sent=await transport.send({asset:structuredClone(proposal.asset),idempotency_key:proposal.delivery_key,approval:{proposal_id:proposal.proposal_id,review_hash:proposal.review_hash}});
          if(!sent?.id||sent.status!=='ACCEPTED')fail('PROVIDER_ACCEPTANCE_REQUIRED');
          receipt={...inFlight,execution_status:'SUBMITTED',external_id:String(sent.id),provider_receipt:sent.receipt||null,actual_cost_aud:sent.actual_cost_aud??quote.max_cost_aud,timestamp:now()};
          const cost=receipt.actual_cost_aud;if(!Number.isFinite(cost)||cost<0)fail('PROVIDER_COST_RECEIPT_REQUIRED');
          ledger.actual_aud+=cost;ledger.campaigns[proposal.campaign_id]=campaignSpent+cost;await this.store.put('v2:spend:'+month,ledger);
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
}
