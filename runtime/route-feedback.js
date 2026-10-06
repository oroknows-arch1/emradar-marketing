import {formationFromSignal,openRouteScout} from './open-route-scout.js';
import directory from '../state/open-route-directory.json' with {type:'json'};
import {historicalRoutingInput} from './outcomes.js';
import {nativeXCopy} from './x-copy.js';
export async function evaluateX({store,product,signal,adapter,accountStatus,campaign_id}){
  const checks={integration_available:!!adapter,runtime_authorized:false,evidence:false,relevance:false,format_suitability:!!adapter?.formats?.includes('text'),permission:false,cost:false};
  let authorization={status:'UNAVAILABLE'};
  try{authorization=accountStatus?await accountStatus():{status:await adapter?.authorized?.('EMRADAR')?'CURRENT_RUNTIME_AUTHORIZATION':'UNAVAILABLE'};checks.runtime_authorized=['CURRENT_RUNTIME_AUTHORIZATION','REFRESHED_RUNTIME_AUTHORIZATION'].includes(authorization.status);}catch(e){authorization={status:'OWNER_REAUTHORIZATION_REQUIRED',reason:e.message};}
  if(accountStatus&&checks.runtime_authorized)checks.runtime_authorized=String(authorization.scope||'').split(' ').includes('tweet.write');
  checks.evidence=product?.release_approved===true&&['evidence','editorial','brand','risk'].every(k=>product.review?.[k]===true)&&signal?.evidence?.length>0&&product.uncertainty_state_model?.includes(signal.state);
  const formation=formationFromSignal(signal),memory=await store.get('routing_memory');
  const history=historicalRoutingInput(memory,{destination:'EMRADAR-X-OROKNOWS',platform:'X',evidence_state:signal.state});
  const routes=openRouteScout({formation,directory,learning:{'EMRADAR-X-OROKNOWS':{score:history.adjustment}},authorizedAccounts:checks.runtime_authorized?['EMRADAR-X-OROKNOWS']:[]});
  const route=routes.discovered.find(d=>d.destination_id==='EMRADAR-X-OROKNOWS');
  checks.relevance=route?.prepare_eligible===true&&route.route_score>=0.7;
  checks.permission=!!route&&route.submission_requirements==='Exact PUBLICATION_REVIEW before external action';
  let formatReason=null;try{nativeXCopy(signal);}catch(e){checks.format_suitability=false;formatReason=e.message;}
  // Unknown billing cannot be promoted to a zero-cost route. No paid probing.
  checks.cost=adapter?.cost==='ZERO';
  const reasons=Object.entries(checks).filter(([,pass])=>!pass).map(([name])=>({integration_available:'X_INTEGRATION_UNAVAILABLE',runtime_authorized:'X_RUNTIME_AUTHORIZATION_UNVERIFIED',evidence:'SOURCE_EVIDENCE_GATE_FAILED',relevance:'DESTINATION_RELEVANCE_OR_ACCESS_FAILED',format_suitability:'X_NATIVE_FORMAT_UNAVAILABLE',permission:'X_PUBLICATION_PERMISSION_REQUIRED',cost:'ACTUAL_COST_BOUND_UNKNOWN'}[name]));
  const result={campaign_id:campaign_id||null,formation_id:signal.id,signal_revision:signal.revision,evidence_state:signal.state,destination:'EMRADAR-X-OROKNOWS',state:reasons.length?'X_NOT_SELECTED':'X_SELECTED',reason:reasons[0]||'ALL_NATIVE_ROUTE_GATES_PASS_EXACT_PUBLICATION_REVIEW_REQUIRED',reasons,checks,format_reason:formatReason,authorization,route_score:route?.route_score||null,learning_input:history,publication_authority:'EXACT_OWNER_REVIEW_REQUIRED',distribution_cost:checks.cost?{currency:'AUD',amount:0}:'UNKNOWN',visual:'NONE_NO_APPROVED_IMAGE_IN_SOURCE',at:new Date().toISOString()};
  const key='route_evaluation:EMRADAR:'+signal.id+':'+signal.revision;
  const historyKey=key+':history',events=await store.get(historyKey)||[];events.push(result);await store.put(historyKey,events);await store.put(key,result);const index=await store.get('route_evaluation_index')||[];if(!index.includes(key)){index.push(key);await store.put('route_evaluation_index',index);}return result;
}
