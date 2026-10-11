// Checks the complete correspondence, before review hashes are calculated.
// Source facts remain evidence; they are never grammatical template slots.
export function validateCorrespondenceText(text){
 const body=String(text||'').replace(/\r\n/g,'\n').trim();
 if(!body)throw Error('EMAIL_CORRESPONDENCE_EMPTY');
 if(/(?:^|\n)\s*(?:Evidence|Unresolved|Causal chain|World change|Formation|Sources?|Insight|Proposition|Development|Reason|Question)\s*:|\b(?:UNKNOWN|INVESTIGATE|FORMING|CONFIRMED|WATCH\/NO SIGNAL)\b/u.test(body))throw Error('INTERNAL_RESEARCH_FIELDS_EXPOSED');
 if(/(?:translate into|traducirse en|remains unresolved is|falta confirmar)\s+[A-ZÁÉÍÓÚ][^.!?\n]*\b(?:is|are|was|were|has|have|will|can|could|financing|es|son|está|están)\b/u.test(body)||/\b(?:into|whether|because|en|si)\s*[.!?]|\b(?:is is|the the|whether whether)\b/iu.test(body))throw Error('EMAIL_MALFORMED_SENTENCE_JOIN');
 if(/\b(?:translate into|traducirse en|remains unresolved is)\b/iu.test(body))throw Error('EMAIL_TEMPLATE_SEAM');
 const paragraphs=body.split(/\n\s*\n/).map(p=>p.trim()).filter(Boolean);
 const prose=paragraphs.filter(p=>p.length>45);
 if(new Set(prose).size!==prose.length)throw Error('EMAIL_DUPLICATED_FRAGMENT');
 for(const p of prose)if(/(?:\b(?:and|or|because|whether|into|which)|[,;:])\s*$/iu.test(p))throw Error('EMAIL_INCOMPLETE_CLAUSE');
 return true;
}
