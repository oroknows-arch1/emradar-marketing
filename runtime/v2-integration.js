import crypto from 'node:crypto';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {RedisStore} from './store.js';
import {loadEditorialOutreach} from './adapters.js';
import {StreamlinedMarketingEngineV2,existingEditorialTransport} from './streamlined-engine-v2.js';

const fail=reason=>{throw new Error(reason);};
export function authorizedV2Owner(header,secret=process.env.MARKETING_PUBLICATION_REVIEW_TOKEN){
  const actual=String(header||''),expected='Bearer '+String(secret||'');
  return !!secret&&Buffer.byteLength(actual)===Buffer.byteLength(expected)&&crypto.timingSafeEqual(Buffer.from(actual),Buffer.from(expected));
}

async function configuration({integrationModule,integrationModulePath}){
  if(integrationModule)return integrationModule;
  if(!integrationModulePath)fail('V2_INTEGRATION_MODULE_NOT_CONFIGURED');
  return import(pathToFileURL(path.resolve(integrationModulePath)).href);
}

export async function createV2Runtime({store,redisClient,integrationModule,integrationModulePath=process.env.MARKETING_V2_INTEGRATION_MODULE,editorialAdapter,editorialModulePath=process.env.MARKETING_EDITORIAL_OUTREACH_MODULE}={}){
  const persistentStore=store||(redisClient?new RedisStore(redisClient):null);if(!persistentStore)fail('V2_PERSISTENT_STORE_REQUIRED');
  const config=await configuration({integrationModule,integrationModulePath});
  if(!Array.isArray(config.destinations)||typeof config.assetBuilder!=='function')fail('V2_INTEGRATION_CONTRACT_INVALID');
  const adapter=editorialAdapter||await loadEditorialOutreach(editorialModulePath);if(!adapter)fail('V2_APPROVED_EMAIL_ADAPTER_REQUIRED');
  const engine=new StreamlinedMarketingEngineV2({store:persistentStore,destinations:config.destinations,assetBuilder:config.assetBuilder,transports:{EMAIL:existingEditorialTransport(adapter)}});
  return {
    store:persistentStore,engine,
    prepare:input=>engine.prepare(input),
    async review(proposalId){return persistentStore.get('v2:review:'+proposalId);},
    async decide(input,authorization){if(!authorizedV2Owner(authorization))fail('OWNER_PUBLICATION_REVIEW_AUTH_REQUIRED');return engine.decide(input);},
    distribute:()=>engine.distribute(),
    feedback:input=>engine.learn(input)
  };
}
