import {test,expect} from 'vitest';
import {operatorPhonePermitted as allowed} from '../convex/operatorPhoneGate';
const now=1000,env={CONVEX_SITE_URL:'https://disciplined-mammoth-312.convex.site',INTUNE_SYNTHETIC_TRANSPORT:'0',INTUNE_CONVERSATION_GATE:'candidate',INTUNE_OPERATOR_PHONE:'+12025550190',INTUNE_OPERATOR_PHONE_EXPIRES:'3601000'};
test('test transport admits exactly one live operator lease',()=>{
 expect(allowed('+12025550190',env,now)).toBe(true);
 expect(allowed('+12025550191',env,now)).toBe(false);
 for(const patch of [{INTUNE_OPERATOR_PHONE:undefined},{INTUNE_OPERATOR_PHONE_EXPIRES:undefined},{INTUNE_OPERATOR_PHONE_EXPIRES:'NaN'},{INTUNE_OPERATOR_PHONE_EXPIRES:'3601001'},{INTUNE_CONVERSATION_GATE:'off'}])expect(allowed('+12025550190',{...env,...patch},now)).toBe(false);
 expect(allowed('+12025550190',env,3601000)).toBe(false);
});
test('existing synthetic and non-test transport are unchanged',()=>{
 expect(allowed('+12025550191',{...env,INTUNE_SYNTHETIC_TRANSPORT:'1'},now)).toBe(true);
 expect(allowed('+12025550191',{...env,CONVEX_SITE_URL:'https://other.convex.site'},now)).toBe(true);
});

test('explicit cohort configuration admits exactly five named phones without the founder lease',()=>{
 const phones=Array.from({length:5},(_,i)=>'+1202555019'+i),cohort={...env,INTUNE_OPERATOR_PHONE_EXPIRES:'1',INTUNE_PILOT_COHORT_ENABLED:'1',INTUNE_PILOT_COHORT_PHONES:JSON.stringify(phones)};
 for(const phone of phones)expect(allowed(phone,cohort,now)).toBe(true);
 expect(allowed('+12025550195',cohort,now)).toBe(false);
 expect(allowed('+12025550191',{...cohort,INTUNE_PILOT_COHORT_ENABLED:'0'},now)).toBe(false);
 expect(allowed('+12025550191',{...cohort,INTUNE_CONVERSATION_GATE:'off'},now)).toBe(false);
});
test('malformed, overlarge and duplicate cohort lists admit nobody without an operator lease',()=>{
 for(const list of ['not-json','{}','[]',JSON.stringify(['*']),JSON.stringify(['+12025550190','+12025550190']),JSON.stringify(Array.from({length:6},(_,i)=>'+1202555019'+i))])expect(allowed('+12025550190',{...env,INTUNE_OPERATOR_PHONE_EXPIRES:'1',INTUNE_PILOT_COHORT_ENABLED:'1',INTUNE_PILOT_COHORT_PHONES:list},now)).toBe(false);
});
test('cohort gate never changes ordinary production transport',()=>{
 expect(allowed('+12025550195',{...env,CONVEX_SITE_URL:'https://graceful-ptarmigan-19.convex.site',INTUNE_PILOT_COHORT_ENABLED:'1',INTUNE_PILOT_COHORT_PHONES:'[]'},now)).toBe(true);
});
