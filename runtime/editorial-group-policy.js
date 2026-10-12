import crypto from 'node:crypto';
import policy from '../config/editorial-review-policy.json' with {type:'json'};
import {emailEquivalenceKey,equivalentEmailGroups} from './campaign-review-html.js';
export const editorialReviewPolicy=Object.freeze(policy);
export function editorialEvidence(scan,formation=scan.formation){
 return {source_revision:scan.source_revision,formation_id:formation.id,formation_state:formation.state,causal_chain:formation.causal_chain,evidence:formation.evidence,strengthening_evidence:formation.strengthening_evidence,weakening_evidence:formation.weakening_evidence,break_conditions:formation.break_conditions,uncertainty:formation.uncertainty,companies:formation.companies||[],tickers:formation.tickers||[]};
}
export function plannedEmailIdentity(asset,scan){
 const key=emailEquivalenceKey({asset,binding:{evidence:editorialEvidence(scan)}});
 return key===null?null:crypto.createHash('sha256').update(key).digest('hex');
}
export function verifyEmailGroupLimit(proposals){
 const count=equivalentEmailGroups(proposals).filter(g=>g.email).length;
 if(count>policy.max_email_groups)throw Error('EDITORIAL_EMAIL_GROUP_LIMIT_EXCEEDED');
 return count;
}
