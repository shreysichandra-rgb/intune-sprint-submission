// Only handles a direct answer to the server-owned preferred-name question.
// Mixed messages continue through the normal interpretation and safety checks.
export function preferredNameAnswer(text:string):string|null {
 const raw=text.trim().replace(/[.!]+$/,'');
 const explicit=explicitPreferredNameRequest(raw);
 const name=raw.replace(/^(?:my name is|you can call me|call me|i\s+am|i\s+m|i['’]m)\s+/i,'').trim();
 if(!name||name.length>80||/^(?:yes|no|ok|okay|confirm|haan|hi|hello|hey|thanks|thankyou|skip|pause|resume|stop|start|delete|join|pay|checkout|summary|help|record|plan|reminder|nausea|fatigue|pain|anxiety|dizziness|bleeding|insomnia|tired|fatigued|bloated|unwell|sick|sad|alone|fine|okay|happy|well|hungry|confused|struggling|worried|stressed)$/i.test(name))return null;
 if(!explicit&&/^(?:this|that|these|those|it|above|same|done|today|yesterday|tomorrow|later|again|sure|fine|correct|actually)$/i.test(name))return null;
 const word="[\\p{L}\\p{M}]+(?:['’.-][\\p{L}\\p{M}]+)*";
 return new RegExp(explicit?`^${word}(?: ${word}){0,3}$`:`^${word}$`,'u').test(name)?name:null;
}

export function explicitNameIntroduction(text:string){return /^(?:my name is|you can call me|call me|i\s+am|i\s+m|i['’]m)\s+/i.test(text.trim());}
export function explicitPreferredNameRequest(text:string){return /^(?:my name is|you can call me|call me)\s+/i.test(text.trim());}
