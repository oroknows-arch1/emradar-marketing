import directory from '../state/open-route-directory.json' with {type:'json'};
import brand from './email-brand.cjs';
import crypto from 'node:crypto';
import sharp from 'sharp';
import {validateCorrespondenceText,validateSpanishCorrespondence} from './correspondence-quality.js';
import {editorialContext,produceEditorial} from './editorial-copy.js';
import {humanReadyEmail} from './editorial-email.js';

const values=value=>(Array.isArray(value)?value:[]).map(v=>String(v).toLowerCase());
const overlap=(a,b)=>values(a).some(x=>values(b).includes(x)||x==='all');
const words=value=>String(value||'').toLowerCase().match(/[a-z0-9]+/g)||[];
const significant=value=>words(value).filter(w=>w.length>3&&!['africa','global','industry','market','markets'].includes(w));
export const relevanceAssessment=(scan,route)=>{
  if(overlap(scan.formation.industries,route.industries)||overlap(scan.formation.geography,route.geography))return true;
  const source=[scan.formation.title,...(scan.formation.industries||[]),...(scan.formation.causal_chain||[]),...(scan.formation.evidence||[]).map(e=>e.claim)].join(' ').toLowerCase();
  const sourceTokens=new Set(significant(source));
  const routeTokens=new Set([...(route.relevant_beat_topic||[]),...(route.industries||[])].flatMap(significant));
  const shared=[...routeTokens].filter(token=>sourceTokens.has(token));
  return shared.length>=2||routeTokens.size===1&&shared.length===1;
};
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const scanLabel=value=>{const [y,m,d]=String(value||'').split('-').map(Number),months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];return y&&m&&d?`${d} ${months[m-1]}`:'daily scan';};
const consolidatedCopy=(scan,formations)=>{
  const counts=[...new Set(formations.map(f=>f.state))].sort().map(state=>`${formations.filter(f=>f.state===state).length} ${state}`).join(', '),prefix=`EMRADAR ${scanLabel(scan.snapshot_date)}: ${counts}. `,suffix=' Evidence remains bounded by the published sources; execution and scale may remain uncertain. emradar.net',titles=[];
  for(const formation of formations){const title=String(formation.title||formation.id).replace(/\s+/g,' ').trim();if((prefix+titles.concat(title).join('; ')+suffix).length<=280)titles.push(title);}
  const copy=prefix+(titles.length?titles.join('; ')+'.':'')+suffix;if(copy.length>280)throw Error('CONSOLIDATED_X_CONTRACT_INVALID');return copy;
};
const editorialVersion='human-correspondence-v2';
const spanishTitles={'south-africa-free-state-industrialisation':'industrialización y manufactura verde','africa-yuan-payment-rails':'pagos transfronterizos y financiamiento comercial','us-dfc-africa-strategic-equity':'financiamiento de desarrollo e inversión estratégica','china-local-government-infrastructure-fiscal-push':'finanzas soberanas e infraestructura','africa-cross-border-industrial-capital-access':'integración de mercados de capitales','sadc-afdb-regional-project-finance':'financiamiento de infraestructura regional'};
const naturalList=(items,language='en')=>{const values=[...new Set((items||[]).filter(Boolean))].slice(0,2);if(values.length<2)return values[0]|| (language==='es-CL'?'el desarrollo económico':'economic development');return values.join(language==='es-CL'?' y ':' and ');};
const sentence=value=>{const text=String(value||'').trim();return !text||/[.!?]$/u.test(text)?text:text+'.';};
const october10Copy={
  'south-africa-free-state-industrialisation':{
    en:{development:'South Africa has launched a Free State industrial programme with Chinese investors around the Maluti-a-Phofung SEZ. The announced projects include a renewable-energy investment valued at about R100 billion and a R5.5 billion electric-vehicle plant.',insight:'The important question is whether these announcements can become a functioning manufacturing cluster with local suppliers, rather than remaining launch-stage commitments.',uncertainty:'Financial close, grid connection, serviced land, permits, customers and execution are not yet established, while the job and capacity figures remain forecasts.'},
    'es-CL':{development:'Sudáfrica lanzó en el Estado Libre un programa industrial con inversionistas chinos en torno a la zona económica especial de Maluti-a-Phofung. Los proyectos anunciados incluyen una inversión en energía renovable valorada en unos R100.000 millones y una planta de vehículos eléctricos de R5.500 millones.',insight:'La pregunta central es si estos anuncios pueden convertirse en un polo manufacturero operativo con proveedores locales, en lugar de permanecer como compromisos en etapa de lanzamiento.',uncertainty:'Aún no están confirmados el cierre financiero, la conexión a la red, los terrenos habilitados, los permisos, los clientes ni la ejecución; las cifras de empleo y capacidad siguen siendo proyecciones.'}
  },
  'africa-yuan-payment-rails':{
    en:{development:'Ecobank has said it plans to join China’s CIPS network for yuan transactions, extending a mechanism already used indirectly by parts of the group and by other African banks.',insight:'The development could lower friction in Africa–China settlement and create new trade-finance and foreign-exchange services, but network access alone does not prove adoption or cost savings.',uncertainty:'The go-live date, transaction volumes, pricing and whether participation will be direct or indirect remain unresolved.'},
    'es-CL':{development:'Ecobank dijo que planea incorporarse a la red china CIPS para transacciones en yuanes, ampliando un mecanismo que ya utilizan indirectamente partes del grupo y otros bancos africanos.',insight:'El desarrollo podría reducir fricciones en los pagos entre África y China y abrir nuevos servicios de financiamiento comercial y divisas, pero el acceso a la red por sí solo no demuestra adopción ni ahorro de costos.',uncertainty:'Siguen sin resolverse la fecha de entrada en operación, los volúmenes, los precios y si la participación será directa o indirecta.'}
  },
  'us-dfc-africa-strategic-equity':{
    en:{development:'The US International Development Finance Corporation says it plans to use more direct equity in Africa, including critical minerals, after receiving expanded authority and approving an investment in digital-infrastructure group WIOCC.',insight:'This could create a more patient source of capital for strategic African assets and draw in private co-investors, while also giving policy objectives a larger role in investment selection.',uncertainty:'The next investments, pricing, ownership stakes, governance terms and level of private co-investment have not been established.'},
    'es-CL':{development:'La Corporación Financiera de Desarrollo Internacional de Estados Unidos dice que planea utilizar más inversión directa de capital en África, incluidos los minerales críticos, tras ampliar sus facultades y aprobar una inversión en el grupo de infraestructura digital WIOCC.',insight:'Esto podría crear una fuente de capital más paciente para activos estratégicos africanos y atraer coinversión privada, aunque también daría mayor peso a los objetivos de política pública en la selección de inversiones.',uncertainty:'Aún no se conocen las próximas inversiones, los precios, las participaciones, las condiciones de gobernanza ni el nivel de coinversión privada.'}
  },
  'china-local-government-infrastructure-fiscal-push':{
    en:{development:'China’s finance ministry has allocated 550 billion yuan of unused local-government debt limits, with reporting indicating support for local finances and infrastructure and 300 billion yuan earmarked for county and district operations.',insight:'The measure may support equipment, materials and construction demand, but its economic effect depends on how much reaches additional, viable projects rather than operating budgets.',uncertainty:'Provincial allocations, project lists, incremental capital spending and the private-sector response are not yet clear.'},
    'es-CL':{development:'El Ministerio de Finanzas de China asignó 550.000 millones de yuanes de límites de deuda local no utilizados; la información disponible indica apoyo a las finanzas locales y la infraestructura, con 300.000 millones destinados a operaciones de condados y distritos.',insight:'La medida puede respaldar la demanda de equipos, materiales y construcción, pero su efecto económico dependerá de cuánto llegue a proyectos adicionales y viables, en vez de financiar presupuestos operativos.',uncertainty:'Aún no están claras las asignaciones provinciales, las listas de proyectos, la inversión incremental ni la respuesta del sector privado.'}
  },
  'africa-cross-border-industrial-capital-access':{
    en:{development:'The Nigerian Exchange has opened the N2.15 trillion Dangote Refinery offer, while Kenya has approved a GDR route for eligible investors and other markets are considering country-specific access.',insight:'The offer is testing whether a large African industrial asset can attract cross-border ownership, but the workarounds also expose fragmented regulation, custody, settlement and foreign-exchange arrangements.',uncertainty:'Final proceeds, the country mix of subscriptions, the listing date and whether this becomes reusable market infrastructure remain unknown.'},
    'es-CL':{development:'La Bolsa de Nigeria abrió la oferta de N2,15 billones de Dangote Refinery, mientras Kenia aprobó una vía mediante certificados de depósito globales para inversionistas elegibles y otros mercados evalúan accesos nacionales.',insight:'La oferta pone a prueba si un gran activo industrial africano puede atraer propiedad transfronteriza, pero las soluciones parciales también revelan fragmentación regulatoria, de custodia, liquidación y divisas.',uncertainty:'Aún se desconocen los fondos finales, la distribución de suscripciones por país, la fecha de cotización y si esto se convertirá en infraestructura de mercado reutilizable.'}
  },
  'sadc-afdb-regional-project-finance':{
    en:{development:'SADC and the African Development Bank have held a strategic mission covering regional integration, industrialisation, infrastructure and sustainable finance, building on existing corridor and resilience programmes.',insight:'The opportunity is to connect project preparation with finance for cross-border infrastructure, but repeated institutional commitments matter only if they shorten development cycles and mobilise executable projects.',uncertainty:'The priority project list, preparation funding, approval dates, procurement and private co-finance remain unspecified.'},
    'es-CL':{development:'La SADC y el Banco Africano de Desarrollo realizaron una misión estratégica sobre integración regional, industrialización, infraestructura y financiamiento sostenible, apoyándose en programas existentes de corredores y resiliencia.',insight:'La oportunidad consiste en conectar la preparación de proyectos con el financiamiento de infraestructura transfronteriza, pero los compromisos institucionales solo importarán si acortan los ciclos de desarrollo y movilizan proyectos ejecutables.',uncertainty:'Siguen sin especificarse la lista de proyectos prioritarios, el financiamiento de preparación, las fechas de aprobación, las compras y la coinversión privada.'}
  }
};
const sourceSentence=value=>{
 const text=String(value||'').replace(/\s+/g,' ').trim();
 if(!text||/(?:^|\n)(?:Evidence|World change|Formation|Causal chain|Unresolved)\s*:|\b(?:FORMING|INVESTIGATE|CONFIRMED|UNKNOWN)\b/u.test(text))throw Error('EDITORIAL_SOURCE_PROSE_REQUIRED');
 // Complete source statements stand alone. Noun phrases are identified as
 // reported subjects, never appended after "whether" or "translate into".
 const complete=/\b(?:is|are|was|were|has|have|had|will|can|could|plans?|said|says|announced|launched|approved|began|opened|finances?|funds?|remain[s]?|requires?|depends?|reports?)\b/iu.test(text);
 return complete?sentence(text):'The reported development concerns '+text.charAt(0).toLowerCase()+text.slice(1).replace(/[.!?]+$/u,'')+'.';
};
const fallbackCopy=(formation,language)=>{
 // Untranslated evidence cannot safely become Spanish correspondence.
 // A language-qualified editorial interpretation is required for that route.
 if(language!=='en')throw Error('EDITORIAL_SOURCE_LOCALIZATION_REQUIRED');
 const facts=(formation.evidence||[]).map(e=>e.claim||e.text).filter(Boolean);
 if(!facts.length)throw Error('FINISHED_ASSET_EVIDENCE_REQUIRED');
 const development=[...new Set(facts)].slice(0,2).map(sourceSentence).join(' ');
 const unresolved=formation.uncertainty||[],full=[],fragments=[];
 for(const item of unresolved){
  const text=String(item).trim();
  if(/[.!?]$/u.test(text))full.push(sourceSentence(text));
  else fragments.push(text.charAt(0).toLowerCase()+text.slice(1));
 }
 const uncertainty=[...full,fragments.length?'The available evidence does not yet establish '+fragments.join('; ')+'.':''].filter(Boolean).join(' ');
 const variant=parseInt(hash(formation.id).slice(0,2),16)%2;
 const insight=variant?'The distinction worth examining is what the reported development establishes, and what still needs evidence before its wider effects can be assessed.':'A useful contribution would separate the reported development from the wider effects that remain unproven.';
 return {development,insight,uncertainty};
};
const editorialCopy=(formation,language)=>october10Copy[formation.id]?.[language]||fallbackCopy(formation,language);

// Reuse the established writer, independent proof and branded renderer.
// The graph's configured work callback retains model/cost authority. This
// adapter never creates a provider, calls a relay or substitutes a translation.
async function spanishEditorialAsset({scan,route,editorialWork}){
 if(typeof editorialWork!=='function')throw Error('EDITORIAL_SOURCE_LOCALIZATION_REQUIRED');
 const formation=scan.formation,record={...route.delivery_record,organisation:route.organisation,destination_class:'latam_trade_publication'},signal={
  id:formation.id,revision:scan.source_revision,state:formation.state,
  evidence:formation.evidence.map(e=>e.id),
  source_facts:formation.evidence.map(e=>({id:e.id,text:e.claim||e.text,url:e.url,source:e.source})),
  source_uncertainty:[...formation.uncertainty],causal_chain:structuredClone(formation.causal_chain),source_snapshot:scan.snapshot_date
 };
 const context=editorialContext({signal,input:{campaign_id:scan.campaign_id},product:{brand_system:brand.version},route:{id:route.id,destination:{route_record:record}},route_plan:{proposed_assets:[]}});
 context.instructions+=' Every external sentence and the subject must be natural Spanish. Source evidence may be English or Spanish; keep original facts and uncertainty verbatim internally. Translate their meaning, not schema labels. No English sentence fragments in Spanish prose.';
 context.input_hash=crypto.createHash('sha256').update(JSON.stringify(context)).digest('hex');
 const output=await produceEditorial(context,async(request,attempt)=>{
  const value=await editorialWork(request,attempt),proof=value?.proof;
  if(!value?.result)throw Error('HARNESS_OUTPUT_NOT_VERIFIED');
  const outputHash=crypto.createHash('sha256').update(JSON.stringify(value.result)).digest('hex');
  if(proof?.status!=='VERIFIED'||proof.input_hash!==request.input_hash||proof.output_hash!==outputHash)throw Error('HARNESS_OUTPUT_NOT_VERIFIED');
  validateSpanishCorrespondence(value.result.subject+'\n'+value.result.body,{names:[route.organisation,record.recipient_identity?.name]});
  return value;
 });
 const email=humanReadyEmail({proposition:output.result,signal,route:record,identity:{...brand.identity,approved:true},product:'EMRADAR'});
 if(!email)throw Error('EDITORIAL_SPANISH_EMAIL_ROUTE_REQUIRED');
 const editorial_binding={source_revision:scan.source_revision,formation_id:formation.id,evidence_refs:[...signal.evidence],source_uncertainty:[...formation.uncertainty]};
 const asset={subject:email.subject,email,body:email.body,to:email.to,delivery_method:route.delivery.method,copy:'Subject: '+email.subject+'\n\n'+email.body,delivery:{...route.delivery_record},evidence_summary:signal.source_facts.map(f=>f.text).join(' '),required_visual_or_attachment:'NONE',recipient_status:route.endpoint.recipient_status,editorial_version:editorialVersion,editorial_binding};
 validateEditorialAsset({asset,scan,route});return asset;
}
export function validateEditorialAsset({asset,scan,route}){
  if(route.delivery.method==='X')return true;
  const email=asset?.email,plain=email&&brand.correspondence(email.body),organisation=route.organisation;
  if(asset.editorial_version!==editorialVersion||!email||email.subject!==asset.subject||email.to!==asset.to||!plain.includes(organisation)||!plain.includes('Sean Walker')||!/[?？]/u.test(plain)||!/(?:article|research contribution|artículo|contribución de investigación)/iu.test(plain))throw new Error('EDITORIAL_EMAIL_CORRESPONDENCE_INCOMPLETE');
  if(/Our published scan classifies|The uncertainty remains explicit|(?:^|\n)(?:Evidence|Unresolved|Causal chain|Sources?)\s*:|\b(?:FORMING|INVESTIGATE)\b/u.test(plain))throw new Error('INTERNAL_RESEARCH_FIELDS_EXPOSED');
  validateCorrespondenceText(plain);
  if(email.language==='es-CL'&&email.proposition)validateSpanishCorrespondence(email.subject+'\n'+plain,{names:[organisation,route.delivery_record?.recipient_identity?.name]});
  brand.envelope(email);
  if(!scan.formation.evidence?.length||asset.editorial_binding?.source_revision!==scan.source_revision||asset.editorial_binding?.formation_id!==scan.formation.id)throw new Error('EDITORIAL_CLAIM_BINDING_REQUIRED');
  return true;
}

export const destinations=directory.destinations
  .filter(route=>String(route.verification_state||'').startsWith('VERIFIED'))
  .map(route=>{
    const x=route.destination_id==='EMRADAR-X-OROKNOWS',verifiedEmail=route.verification_state==='VERIFIED'&&/email/i.test(route.access_method||'')&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(route.public_contact_point||''),manual=/form|portal|workflow|manual/i.test([route.access_method,route.public_submission_url].join(' ')),method=x?'X':verifiedEmail?'EMAIL':'MANUAL';
    const recipient_status=verifiedEmail?'VERIFIED_RECIPIENT':manual?'MANUAL_SUBMISSION_REQUIRED':/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(route.public_contact_point||'')?'UNVERIFIED_RECIPIENT':'TRANSPORT_UNAVAILABLE';
    return {id:route.destination_id,organisation:route.organisation||route.destination_name,industries:route.industries||[],geography:route.geography||[],relevant_beat_topic:route.relevant_beat_topic||[],editorial_relevance:(scan,current)=>x||relevanceAssessment(scan,current),evidence_suitable:scan=>scan.formation.evidence.length>0,endpoint:{address:route.public_contact_point||route.public_submission_url||'UNAVAILABLE',verification_state:route.verification_state,recipient_status},delivery:{method,supported:verifiedEmail||x},connector:{authorized:verifiedEmail||x},finished_contribution_supported:true,delivery_record:{...route,recipient_status}};
  });

export async function assetBuilder({scan,route,editorialWork}){
  const formation=scan.formation,organisation=route.organisation;
  const evidence=formation.evidence.slice(0,3).map(e=>e.claim||e.text).filter(Boolean);if(!evidence.length)throw new Error('FINISHED_ASSET_EVIDENCE_REQUIRED');
  if(route.delivery.method==='X'){
    const formations=scan.formations||[formation],copy=consolidatedCopy(scan,formations),rows=formations.map(f=>`${f.state} · ${f.title||f.id}`),height=Math.max(700,260+rows.length*66),footer=height-80,svg=`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="${height}"><rect width="1200" height="${height}" fill="#031728"/><rect x="54" y="52" width="10" height="78" fill="#59dfb6"/><g font-family="DejaVu Sans,sans-serif"><text x="88" y="82" font-size="34" fill="#ffffff" font-weight="700">EMRADAR</text><text x="88" y="119" font-size="18" fill="#59dfb6" letter-spacing="2">EMERGING MARKET INTELLIGENCE · ${escape(String(scan.snapshot_date||'DAILY SCAN').toUpperCase())}</text>${rows.map((row,i)=>`<text x="64" y="${190+i*66}" font-size="24" fill="#ffffff">${escape(row)}</text>`).join('')}<text x="64" y="${footer}" font-size="20" fill="#b9c9d6">Evidence is bounded by the published sources</text><text x="64" y="${footer+42}" font-size="20" fill="#59dfb6">emradar.net · sean@emradar.net</text></g></svg>`,bytes=await sharp(Buffer.from(svg)).png().toBuffer();
    const asset={subject:`X post: EMRADAR ${scan.snapshot_date||'daily'} scan`,body:copy,to:route.endpoint.address,delivery_method:'X',copy,evidence_summary:formations.map(f=>`${f.id}:${f.state}`).join('; '),required_visual_or_attachment:'IMAGE_REQUIRED',format:'image',mime:'image/png',base64:bytes.toString('base64'),sha256:hash(bytes),svg,width:1200,height,lineage:{source_revision:scan.source_revision,formation_ids:formations.map(f=>f.id),evidence_refs:formations.flatMap(f=>f.evidence.map(e=>e.id))},generated:true,reviewed:false,combined_review_artifact:true,consolidated_scan:true,delivery:{...route.delivery_record}};
    return asset;
  }
  const language=route.delivery_record.accepted_formats?.includes('latam_editor_pitch')?'es-CL':'en';
  if(language==='es-CL')return spanishEditorialAsset({scan,route,editorialWork});
  const compact=route.delivery_record.accepted_formats?.includes('financial_guest_view_pitch'),copy=editorialCopy(formation,language),topics=naturalList(route.relevant_beat_topic,language),name=route.delivery_record.recipient_identity?.name;
  const subject=language==='es-CL'?`Propuesta editorial: ${spanishTitles[formation.id]||formation.title||formation.id}`:`Contribution idea: ${formation.title||formation.id}`;
  const greeting=language==='es-CL'?(name?`Hola ${name},`:'Hola,'):(name?`Hi ${name},`:'Hello,');
  const introduction=language==='es-CL'?'Soy Sean Walker, de EMRADAR.':compact?"I'm Sean Walker, working on EMRADAR.":"I'm Sean Walker, working on EMRADAR, where we examine how changes in the real economy affect industries and markets.";
  const reason=language==='es-CL'?`Les escribo porque la cobertura de ${organisation} sobre ${topics} ofrece un contexto pertinente para este desarrollo.`:`I'm getting in touch because ${organisation}'s coverage of ${topics} provides a useful context for this development.`;
  const proposition=language==='es-CL'?`Un artículo o una contribución de investigación podría examinar este desarrollo, sus implicaciones para ${topics} y las condiciones necesarias para que se convierta en un resultado efectivo.`:`An article or research contribution could examine this development, its implications for ${topics}, and the conditions needed to turn it into a realised outcome.`;
  const question=language==='es-CL'?`¿Les sería útil un artículo o una contribución de investigación que desarrolle este enfoque para ${organisation}?`:`Would an evidence-led article or research contribution developing this angle be useful for ${organisation}?`;
  const paragraphs=compact?[greeting,introduction,copy.development,copy.insight,copy.uncertainty,question]:[greeting,introduction,reason,copy.development,copy.insight,copy.uncertainty,proposition,question];
  const body=[...paragraphs,language==='es-CL'?'Saludos,\nSean Walker\nEMRADAR':'Regards,\nSean Walker\nEMRADAR'].join('\n\n');
  const delivery={...route.delivery_record},email=brand.brand({version:editorialVersion,to:route.endpoint.address,subject,body,language,features:{version:editorialVersion,destination_specific_reason:reason,development:copy.development,angle:copy.insight,question,source_revision:scan.source_revision}}),editorial_binding={source_revision:scan.source_revision,formation_id:formation.id,evidence_refs:formation.evidence.map(item=>item.id),source_uncertainty:[...formation.uncertainty]};
  const asset={subject,email,body:email.body,to:email.to,delivery_method:route.delivery.method,copy:`Subject: ${subject}\n\n${email.body}`,delivery,evidence_summary:evidence.join(' '),required_visual_or_attachment:'NONE',recipient_status:route.endpoint.recipient_status,editorial_version:editorialVersion,editorial_binding};
  validateEditorialAsset({asset,scan,route});return asset;
}


// Deterministic local preview only; Spanish model work reserves an individual
// slot until the existing verified writer produces its exact correspondence.
export async function assetPlanner({scan,route}){
 if(route.delivery.method==='X')return null;
 if(route.delivery_record.accepted_formats?.includes('latam_editor_pitch'))return {blocked_reason:'EDITORIAL_SOURCE_LOCALIZATION_REQUIRED'};
 return {asset:await assetBuilder({scan,route})};
}
