const productKey=product=>String(product||'EMRADAR').toLowerCase();
const authKey=product=>`marketing:x:authorized:${productKey(product)}`;
const accountKey='marketing:x:authorized';

export function createXAuthorization({client,exchange,clientId,clock=()=>Date.now(),log=console.error}) {
  let cached=null;

  async function save(product,auth) {
    await client.set(accountKey,JSON.stringify(auth));
  }

  async function load(product='EMRADAR') {
    try {
      let raw=await client.get(accountKey);
      if(!raw) raw=await client.get(authKey(product));
      if(!raw&&product==='EMRADAR') raw=await client.get('emradar:x:authorized');
      if(!raw&&product==='EMRADAR') raw=await client.get(authKey('Atlasoquence'));
      if(raw&&!await client.get(accountKey)) await client.set(accountKey,raw);
      return raw?JSON.parse(raw):null;
    } catch(error) {
      log('X authorization store unavailable',error?.message||String(error));
      return null;
    }
  }

  async function current(product='EMRADAR') {
    let auth=cached||await load(product);
    if(!auth?.access_token) return null;
    if(auth.expires_at&&clock()>=auth.expires_at-60000&&auth.refresh_token) {
      const refreshed=await exchange({grant_type:'refresh_token',refresh_token:auth.refresh_token,client_id:clientId});
      auth={...auth,...refreshed,authorized_at:auth.authorized_at||new Date(clock()).toISOString(),refreshed_at:new Date(clock()).toISOString(),expires_at:clock()+(Number(refreshed.expires_in||7200)*1000)};
      cached=auth;
      await save(product,auth);
    }
    return auth;
  }

  async function authorize(product,token) {
    const auth={...token,authorized_at:new Date(clock()).toISOString(),expires_at:clock()+(Number(token.expires_in||7200)*1000)};
    await save(product,auth);
    cached=auth;
  }

  return {authorize,current};
}
