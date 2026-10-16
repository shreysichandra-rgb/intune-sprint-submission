import {test,expect} from 'vitest';
import {z} from 'zod';
import {labResponse,labWireResponse} from '../convex/labModel';
test('provider action schema requires every property, allowing explicit null for unused context sources',()=>{
 const schema:any=z.toJSONSchema(labWireResponse);
 const item=schema.properties.actions.items;
 expect([...item.required].sort()).toEqual(Object.keys(item.properties).sort());
 expect(item.required).toContain('dateSourceRecordId');expect(item.required).toContain('timeSourceMessageId');
});
test('backend contract remains compatible with earlier proposals without optional context sources',()=>{
 const raw={onboarding:{introduced:true},reply:'Hello.',clarification:null,actions:[],open_tasks:[],safety:{intent:'none',sourceMessageId:null,evidence:null,reason:null}};
 expect(labResponse.parse(raw)).toEqual(raw);expect(labWireResponse.parse(raw)).toEqual(raw);
});

test('provider proposals still require owned source grounding for every save',async()=>{
 const {applyLabResponse,freshLabState}=await import('../convex/labModel');const now=Date.parse('2026-10-14T08:00:00+05:30');
 const response={onboarding:{introduced:true},reply:'Kept the target.',clarification:null,actions:[{type:'save',useSourceText:null,sourceMessageId:'m2',evidence:'55 to 65 grams daily',targetId:null,tempId:'target',kind:'food',label:'55 to 65 grams daily',text:'55 to 65 grams daily',datePhrase:null,timePhrase:null,dateSourceRecordId:null,timeSourceMessageId:null,targetNumber:null,state:'planned',parentId:null,permissionEvidence:null,repeat:null}],open_tasks:[],safety:{intent:'none',sourceMessageId:null,evidence:null,reason:null}};
 const sources=[{messageId:'m1',text:'My protein target',role:'user',at:now,canSave:true},{messageId:'m2',text:'55 to 65 grams daily',role:'user',at:now,canSave:true}];
 const parsed=labWireResponse.parse(response);expect(applyLabResponse({...freshLabState(now),onboardingIntroduced:true},parsed,sources,now,'m2').state.records[0]).toMatchObject({kind:'food',text:'55 to 65 grams daily',targetNumber:null});
 const ungrounded=structuredClone(parsed);ungrounded.actions[0].label='protein target';expect(()=>applyLabResponse({...freshLabState(now),onboardingIntroduced:true},ungrounded,sources,now,'m2')).toThrow('unsupported text');
});
