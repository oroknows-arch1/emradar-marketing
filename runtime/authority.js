import authority from '../config/owner-authority.json' with {type:'json'};
export {authority};
export function applyAuthority(policies){
  const result=structuredClone(policies);
  for(const p of Object.values(result)){
    p.source_release_authority=authority.source_release;
    p.provider_authority=authority.providers;
    p.spending_envelope=authority.spending;
    // Owner authority permits automatic operation; it does not opt every
    // product into an external campaign or bypass its release policy.
    p.autonomous={...p.autonomous,enabled:p.autonomous?.enabled===true};
    // Permission to release is not evidence that native gates actually passed.
  }
  return result;
}
export function nativeReleasePassed(source){return source?.native_gates&&authority.source_release.required_gates.every(k=>source.native_gates[k]==='PASS');}
