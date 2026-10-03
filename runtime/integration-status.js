import fs from 'node:fs/promises';

const register=JSON.parse(await fs.readFile(new URL('../state/integration-register.json',import.meta.url),'utf8'));
const requirements={
  X:['X_CLIENT_ID','KEY_VALUE_URL'],
  LINKEDIN:['LINKEDIN_CLIENT_ID','LINKEDIN_CLIENT_SECRET','LINKEDIN_ORGANIZATION_URN','LINKEDIN_API_VERSION','KEY_VALUE_URL'],
  BLUESKY:['BLUESKY_IDENTIFIER','BLUESKY_APP_PASSWORD'],
  THREADS:['THREADS_APP_ID','THREADS_APP_SECRET'],
  MASTODON:['MASTODON_SERVER','MASTODON_ACCESS_TOKEN'],
  REDDIT:['REDDIT_CLIENT_ID','REDDIT_CLIENT_SECRET']
};

export function integrationStatus(env=process.env,{xAuthorized=false,linkedinAuthorized=!!env.LINKEDIN_ACCESS_TOKEN}={}){
  return register.platforms.map(platform=>{
    const required=requirements[platform.id]||[];
    const missing=required.filter(name=>!env[name]);
    const implemented=['X','LINKEDIN','BLUESKY','MASTODON'].includes(platform.id);
    const runtime_authorized=platform.id==='X'?xAuthorized:platform.id==='LINKEDIN'?linkedinAuthorized:implemented&&!missing.length;
    return {
      id:platform.id,
      recorded_status:platform.status,
      account:platform.account,
      connector:implemented?'IMPLEMENTED':'NOT_IMPLEMENTED',
      configuration:missing.length?'MISSING':'PRESENT',
      missing_configuration:missing,
      runtime_authorized,
      distribution_mode:platform.distribution_mode,
      blocker:!implemented?'CONNECTOR_NOT_IMPLEMENTED':missing.length?'CONNECTOR_CONFIGURATION_MISSING':!runtime_authorized?'ACCOUNT_AUTHORIZATION_REQUIRED':null
    };
  });
}
