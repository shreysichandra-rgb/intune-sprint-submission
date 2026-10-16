import {sourceUnits} from './conversationInput';
// Backend-owned consent recognition. This never reads prior/private messages.
// Call only after whole-message interpretation, safety and access validation.
export function directStorageRequest(text:string){
 if(storageDeclined(text))return false;
 return sourceUnits(text,true).some(s=>/^(?:(?:ok|okay)[,.]?\s+)?(?:(?:please|can you|could you|will you|i want you to|i would like you to)\s+)?(?:remember|remind me|save|record|log|note|track|keep track of|keep this|keep my|organise|organize|help me (?:organise|organize|remember|track|keep track of))\b/i.test(s.text));
}
export function directTrackingEnabled(){return process.env.INTUNE_PILOT_MODE==='v3'&&process.env.INTUNE_DIRECT_TRACKING==='1';}

export function storageDeclined(text:string){return /\b(?:do not|don't|don’t|never|stop)\b.{0,32}\b(?:save|remember|record|log|keep|track)\b/i.test(text);}
