// Redact text/metadata before persistence. Binary uploads stay private, never get public URLs.
export function redactLog(text:string){
 let out=text;
 for(const name of ['OPENAI_API_KEY','WHATSAPP_ACCESS_TOKEN','WHATSAPP_APP_SECRET','WHATSAPP_VERIFY_TOKEN','RAZORPAY_KEY_ID','RAZORPAY_KEY_SECRET','RAZORPAY_WEBHOOK_SECRET','MESSAGE_HTTP_SECRET','INTUNE_SYNTHETIC_SINK_KEY']){const secret=process.env[name];if(secret&&secret.length>=4)out=out.split(secret).join('[redacted]');}
 return out.replace(/(\/pilot\/checkout\.html)[#?][^\s<>]+/gi,'$1#[redacted]').replace(/Bearer\s+[^\s"<>]+/gi,'Bearer [redacted]').replace(/\b(?:sk-[A-Za-z0-9_-]{12,}|rzp_(?:live|test)_[A-Za-z0-9]+)\b/g,'[redacted]').replace(/((?:api[_ -]?key|api[_ -]?secret|password|webhook[_ -]?secret|access[_ -]?token)\s*[:=]\s*)[^\s,;]+/gi,'$1[redacted]');
}

export function redactTextAttachment(bytes:Uint8Array,mimeType:string,filename?:string){
 if(!mimeType.startsWith('text/')&&!/(?:json|xml|csv)/i.test(mimeType)&&!/[.](?:txt|csv|json|xml|log|yaml|yml|md)$/i.test(filename??''))return bytes;
 try{return new TextEncoder().encode(redactLog(new TextDecoder('utf-8',{fatal:true}).decode(bytes)));}catch{return bytes;}
}
