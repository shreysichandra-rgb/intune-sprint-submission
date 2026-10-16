import {test,expect} from 'vitest';
import {verificationFailureMetadata} from '../convex/verificationDiagnostics';
test('provider diagnostics distinguish schema rejection without revealing private content',()=>{
 const result=verificationFailureMetadata({name:'private-name',statusCode:400,message:'Invalid schema: fictional private health message and secret',responseBody:'private body',data:{key:'private key'}},'verify','rejected');
 expect(result).toEqual({phase:'verify',kind:'model_or_provider_rejected',providerStatus:400,invalidSchema:true,outputLimit:false});expect(JSON.stringify(result)).not.toContain('private');
});
test('wrapped rate limits and truncated output produce bounded metadata only',()=>{
 expect(verificationFailureMetadata({cause:{statusCode:429}},'normalize','rejected')).toMatchObject({kind:'provider_rate_limit',providerStatus:429});
 expect(verificationFailureMetadata({finishReason:'length'},'verify','rejected')).toMatchObject({outputLimit:true});
 expect(verificationFailureMetadata({statusCode:'private'},'private phase','rejected')).toMatchObject({providerStatus:null,phase:'unknown'});
});


test('grocery diagnostics expose only a fixed rule label and never private exception text',()=>{
 expect(verificationFailureMetadata({message:'private grocery text and key'},'decode','Conflicting grocery meaning')).toMatchObject({validationRule:'grocery_state'});
 expect(JSON.stringify(verificationFailureMetadata({message:'private grocery text and key'},'decode','private rule'))).not.toContain('private');
});


test('stock scope diagnostics distinguish causes using fixed labels only',()=>{for(const [reason,label]of [['Conflicting stock-only purpose','stock_scope'],['Unexpected stock-only meaning','stock_extra_meaning']]){const result=verificationFailureMetadata({message:'private message or key'},'decode',reason);expect(result).toMatchObject({validationRule:label});expect(JSON.stringify(result)).not.toContain('private');}});
