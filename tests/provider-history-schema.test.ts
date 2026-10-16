import {test,expect} from 'vitest';
import {extractionInput,decodeSources,sourceUnits} from '../convex/conversationInput';
import {validateEnvelope} from '../convex/conversationProtocol';
import {normalizedSources,normalizationInput} from '../convex/semanticBridge';
const text='I had my hip surgery in March 2022 after several months of discomfort while walking around my home. I do physiotherapy twice a week on Tuesday morning. My periods are irregular. My last period was August 8.';
const translations=normalizationInput(text,true).sources.map(s=>({...s,english:s.text,observation:false,risk:'none' as const,purpose:'other' as const}));
function enums(value:any):number{return !value||typeof value!=='object'?0:(Array.isArray(value.enum)?value.enum.length:0)+Object.values(value).reduce<number>((sum,v)=>sum+enums(v),0);}
test('ordinary onboarding history stays within the provider total enum budget',()=>{
 const input=extractionInput(text,{pilotMode:'v3'},translations);
 expect(enums(input.providerSchema.jsonSchema)).toBeLessThanOrEqual(1000);
});
test('compact provider labels still reject invented wording before records are saved',()=>{
 const text='My doctor said physiotherapy twice a week';const sources=normalizedSources({u0:{english:text,observation:false,risk:'none',purpose:'plan'}},normalizationInput(text,true).sources);const input=extractionInput(text,{pilotMode:'v3'},sources);
 const answer=(activity:string)=>({v:2,verified:{u0:true},meanings:{u0:[{k:'plan',activity,n:2,a:text}]}});
 expect(input.schema.safeParse(answer('physiotherapy')).success).toBe(true);
 expect(input.schema.safeParse(answer('running')).success).toBe(false);
 expect(()=>validateEnvelope(text,decodeSources(answer('running'),sources,Date.parse('2026-10-09T08:00:00Z'),'Asia/Kolkata',text,sources))).toThrow('Ungrounded plan');
});

test('weekday schedule remains one source with its shared time',()=>{const text='I go to physiotherapy at 10am on Tuesday, Thursday and Saturday.';expect(sourceUnits(text)).toHaveLength(1);expect(sourceUnits(text)[0].text).toBe(text);});

test('onboarding cannot update a saved task when no task exists',()=>{const text='I finished an appointment yesterday';const sources=normalizedSources({u0:{english:text,observation:false,risk:'none',purpose:'other'}},normalizationInput(text,true).sources);const input=extractionInput(text,{pilotMode:'v3',responsibilities:[]},sources);expect(input.schema.safeParse({v:2,verified:{u0:true},meanings:{u0:[{k:'item_update',target:null,state:'completed',replacement:null,a:text}]}}).success).toBe(false);});
