import crypto from 'node:crypto';
const hash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const esc=value=>value.replace(/'/g,'&#39;');
export function groupedReviewFixture(){
 const campaign_id='EMRADAR_2026_10_11_LAUNCH';
 const proposals=Array.from({length:69},(_,i)=>{
  const group=i%4,name='Editor',organisation='Publication',to='editor'+i+'@example.test',destination='DESTINATION-'+i;
  const reason="I'm getting in touch because "+organisation+"'s coverage of topic "+group+' provides a useful context for this development.';
  const body='Hi '+name+',\n\n'+reason+'\n\nClaim '+group+': a published milestone, with scale still uncertain.\n\nWould an evidence-led article or research contribution developing this angle be useful for '+organisation+'?\n\nSean Walker\nEMRADAR';
  const email={from:{name:'Sean Walker',address:'sean@emradar.net'},to,subject:'Research contribution '+group,body,html:'<html><body>'+body.split('\n\n').map(p=>'<p>'+esc(p)+'</p>').join('')+'</body></html>',features:{destination_specific_reason:reason,email_length_words:body.split(/\s+/).length}};
  const asset=i===68?{delivery_method:'X',copy:'Exact saved X text',mime:'image/png',base64:'c2F2ZWQ=',subject:'X post'}:{delivery_method:'EMAIL',subject:email.subject,body,email,copy:'Subject: '+email.subject+'\n\n'+body,to,delivery:{destination_id:destination,public_contact_point:to,access_method:'verified email',recipient_identity:{name},evidence_source_url:'https://example.test/contact'},evidence_summary:'Published milestone '+group};
  const binding={campaign_id,asset,destination:{id:destination,organisation,endpoint:{address:to}},evidence:{source_revision:'published-october-11',claims:['Claim '+group],references:['source-'+group]}};
  const review_hash=hash(binding),delivery_key=hash(['fixture',i]),proposal_id=hash([delivery_key,review_hash]);
  return {proposal_id,review_hash,delivery_key,campaign_id,destination,status:'AWAITING_OWNER_REVIEW',delivery_capability:'VERIFIED_EXECUTABLE',asset,binding,preview_warnings:i===0?[{reason:'Uncertainty retained'}]:[]};
 });
 return {campaign_id,status:'AWAITING_OWNER_REVIEW',proposals,owner_decisions:{}};
}

