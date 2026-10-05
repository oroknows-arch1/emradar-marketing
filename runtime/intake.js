import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import {nativeReleasePassed} from './authority.js';

const hash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const signSource=(envelope,key)=>crypto.createHmac('sha256',key).update(JSON.stringify(envelope)).digest('hex');
// Product truth comes from the authenticated source; marketing authority stays in
// the trusted owner policy. Source input cannot grant publication, spend or brand rules.
export class ProductIntake {
  constructor({store,policies,sourceKeys}){this.store=store;this.policies=policies;this.sourceKeys=sourceKeys;}
  async receive(envelope,signature){
    const policy=this.policies[envelope?.product];const key=this.sourceKeys[envelope?.product];
    if(!policy||!key)throw new Error('SOURCE_NOT_REGISTERED');
    const expected=signSource(envelope,key);const supplied=String(signature||'');
    if(supplied.length!==expected.length||!crypto.timingSafeEqual(Buffer.from(supplied),Buffer.from(expected)))throw new Error('INVALID_SOURCE_SIGNATURE');
    if(!Number.isSafeInteger(envelope.sequence)||envelope.sequence<1||!envelope.source||!Array.isArray(envelope.source.signals))throw new Error('SOURCE_CONTRACT_INCOMPLETE');
    return this.store.locked('engine',async()=>{
      const old=await this.store.get('source:'+envelope.product);const digest=hash(envelope);
      if(old?.sequence===envelope.sequence&&old.digest===digest)return {status:'DUPLICATE_INPUT',digest};
      if(old&&envelope.sequence<=old.sequence)throw new Error('STALE_OR_CONFLICTING_SOURCE');
      const automatic=policy.source_release_authority?.automatic_after_native_gates===true;
      const passed=nativeReleasePassed(envelope.source);
      const source={signals:envelope.source.signals,native_gates:envelope.source.native_gates||null,release_approved:automatic?!!passed:envelope.source.release_approved===true,review:automatic?{evidence:!!passed,editorial:!!passed,brand:!!passed,risk:!!passed}:{evidence:envelope.source.review?.evidence===true,editorial:envelope.source.review?.editorial===true}};
      await this.store.put('source:'+envelope.product,{source,sequence:envelope.sequence,digest,received_at:new Date().toISOString()});
      const receipt={node:'product_context_intake',status:'ACCEPTED_SOURCE',product:envelope.product,sequence:envelope.sequence,digest,ignored_authority_fields:['budget','destinations','permissions','brand_system','autonomous'],next:'ingest'};
      await this.store.put('source_receipt:'+envelope.product,receipt);return receipt;
    });
  }
  async products(){
    const products=structuredClone(this.policies);
    for(const [name,p] of Object.entries(products)){
      const record=await this.store.get('source:'+name);if(!record)continue;
      p.signals=record.source.signals;p.release_approved=record.source.release_approved;
      p.review={...p.review,evidence:record.source.review.evidence,editorial:record.source.review.editorial};
      if(p.source_release_authority?.automatic_after_native_gates===true){p.review.brand=record.source.review.brand;p.review.risk=record.source.review.risk;}
      p.source_receipt={digest:record.digest,sequence:record.sequence};
    }
    return products;
  }
}
export async function loadPolicies(file,json){if(json)return JSON.parse(json);if(!file)throw new Error('TRUSTED_PRODUCT_POLICIES_REQUIRED');return JSON.parse(await fs.readFile(file,'utf8'));}

// A native scan is data, not permission. Unattested scan files remain release-blocked.
export function emradarSource(scan,attestation={}){
  if(!Array.isArray(scan?.records))throw new Error('EMRADAR_SCAN_INVALID');
  const allowed=new Set(['UNKNOWN','INVESTIGATE','FORMING','CONFIRMED','WEAKENING','BROKEN','WATCH/NO SIGNAL']);
  return {release_approved:attestation.release_approved===true,review:{evidence:attestation.evidence===true,editorial:attestation.editorial===true},signals:scan.records.map(r=>{
    if(!allowed.has(r.status))throw new Error('SOURCE_STATE_UNRECOGNISED');
    const facts=(r.evidence||[]).map(e=>({id:hash(e),text:e.fact,source:e.source||'UNKNOWN',url:e.url||null}));
    return {id:r.id,revision:hash(r),state:r.status,evidence:facts.map(f=>f.id),source_facts:facts,source_title:r.theme||r.id,source_location:r.location||'UNKNOWN',source_uncertainty:[...(r.contradictions||[]),...(r.chain_evolution?.unresolved_evidence||[])],causal_chain:r.causal_chain,chain_evolution:r.chain_evolution,source_snapshot:scan.snapshot_date,approved_copy:[]};
  })};
}
