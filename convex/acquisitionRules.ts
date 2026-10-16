// Only a complete entry command is canonicalised; never strip health or control text.
export function joinAdSource(text:string):string|null {
 const match=/^join\s+[—–-]\s*([a-z0-9][a-z0-9_-]{0,31})[.!]?$/i.exec(text.trim());
 return match?match[1].toLowerCase():null;
}

// Only an ad ID is needed for private source reporting. Discard the remaining
// referral object, including personal click IDs, URLs, copy and media.
export function metaReferralAdId(referral:unknown):string|null {
 if(!referral||typeof referral!=='object')return null;
 const r=referral as Record<string,unknown>;
 return r.source_type==='ad'&&typeof r.source_id==='string'&&/^[1-9]\d{0,31}$/.test(r.source_id)?r.source_id:null;
}
export function privateAdSource(adId:unknown):string|null {
 return typeof adId==='string'&&/^[1-9]\d{0,31}$/.test(adId)?'meta_ad:'+adId:null;
}
