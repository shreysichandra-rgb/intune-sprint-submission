// Exact standalone selections only. Mixed updates still need verified interpretation.
export function ordinalSelection(text:string):number|null {
 const match=text.trim().toLowerCase().match(/^(?:the |option |number )?(first|second|third|fourth|fifth|sixth|seventh|eighth|[1-8])(?: one| option)?[.!]?$/);
 if(!match)return null;const words=['first','second','third','fourth','fifth','sixth','seventh','eighth'];return /^\d$/.test(match[1])?Number(match[1]):words.indexOf(match[1])+1;
}
export function questionMatchesScope(p:any,scope:string):boolean {
 if(scope==='grocery'&&p.proposal?.mode==='grocery_state')return true;
 return (p.proposal?.ops??[]).some((op:any)=>scope==='plan'?['plan','complete','item_complete','item_correct'].includes(op.k):op.k==='item'&&(op.category===scope||scope==='grocery'&&op.category==='food'));
}

// Clear completion shorthand, never a denial or mixed message. Missing day stays missing.
export function completionShorthand(text:string):{day:string|null}|null {
 const match=text.trim().match(/^(?:done|finished)(?: (today|yesterday))?(?:[.!]|\s*[✅✔️])*$/i);return match?{day:match[1]?.toLowerCase()??null}:null;
}
