import {usageLimitFailure} from './usageLimits';
// Metadata only. Never inspect/return message text, provider response bodies or keys.
export function verificationFailureKind(error:unknown,reason:string|undefined){
 if(usageLimitFailure(error))return 'quota' as const;
 if(reason?.includes('hourly'))return 'quota' as const;
 let item:any=error;
 for(let depth=0;item&&depth<4;depth++,item=item.cause){
  if(item.statusCode===429)return 'provider_rate_limit' as const;
  if(['AbortError','TimeoutError'].includes(item.name)||['ETIMEDOUT','ECONNRESET','ENOTFOUND'].includes(item.code))return 'provider_timeout' as const;
 }
 return reason==='rejected'?'model_or_provider_rejected' as const:'validation' as const;
}

// Only fixed labels, bounded numeric status and booleans enter operational logs.
// The provider's message/body can contain the woman's text or credentials.
export function verificationFailureMetadata(error:unknown,phase:string,reason:string|undefined){
 let item:any=error,status:number|null=null,invalidSchema=false,outputLimit=false;
 for(let depth=0;item&&depth<4;depth++,item=item.cause){
  if(Number.isInteger(item.statusCode)&&item.statusCode>=400&&item.statusCode<=599)status=item.statusCode;
  invalidSchema ||= typeof item.message==='string'&&/invalid schema/i.test(item.message);
  outputLimit ||= item.finishReason==='length';
 }
 const validationRules:Record<string,string>={'Incomplete commitment meanings':'commitment_coverage','Conflicting stock-only purpose':'stock_scope','Unexpected stock-only meaning':'stock_extra_meaning','Unverified translation':'translation','Conflicting grocery meaning':'grocery_state','Incomplete grocery meanings':'grocery_coverage','Unattested grocery meaning':'grocery_attestation','Unavailable grocery meaning':'grocery_ownership','Ungrounded English span':'evidence_span','Conflicting source purpose':'source_purpose'};
 const validationRule=reason?validationRules[reason]:undefined;
 return {...(validationRule?{validationRule}:{}),phase:['receive','normalize','verify','decode','apply'].includes(phase)?phase:'unknown',kind:verificationFailureKind(error,reason),providerStatus:status,invalidSchema,outputLimit};
}
