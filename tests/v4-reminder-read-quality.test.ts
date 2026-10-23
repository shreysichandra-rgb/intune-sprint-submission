import {test,expect} from 'vitest';
import {applyLabResponse} from '../convex/labModel';
import {expandV4} from '../convex/v4Action';
const now=Date.parse('2026-10-21T06:00:00Z');
const state:any={onboardingIntroduced:true,profile:{name:null,timezone:'Asia/Kolkata'},access:{mode:'active_paid',startedAt:now-1000,endsAt:now+86400000},control:{tracking:'active',storage:true,safetyPaused:false},records:[{id:'packing',kind:'task',label:'packing list',text:'charger and notebook',sourceMessageId:'first',evidence:'charger and notebook',reportedAt:now-1000,date:null,time:null,state:'planned',parentId:null,targetNumber:null}],tasks:[],reminders:[{id:'reminder',targetId:'packing',title:'packing list',dueAt:now+86400000,time:'18:45',repeat:'once',permission:'remind me',sourceMessageId:'first',state:'scheduled',deliveries:[]}]};
const sources:any=[{messageId:'read',text:'What time is my packing reminder?',role:'user',at:now,canSave:true}];
const response=(reply:string,targetId='reminder')=>expandV4({introduced:true,reply,actions:[{type:'retrieve',targetId,evidence:sources[0].text}]},'read');
test('owned reminder retrieval accepts its exact saved time with a paraphrased title, without creating another reminder',()=>{
 const r=applyLabResponse(state,response('Your packing reminder is set for 6:45 pm IST tomorrow.'),sources,now,'read');expect(r.state.reminders).toEqual(state.reminders);expect(r.outcomes).toEqual([{type:'retrieve',status:'read',targetId:'reminder'}]);
});
test('a reminder lookup cannot fabricate a time, claim a new write or read an unknown ID',()=>{
 expect(()=>applyLabResponse(state,response('Your packing reminder is set for 7:45 pm.'),sources,now,'read')).toThrow();
 expect(()=>applyLabResponse(state,response('I have set your packing reminder for 6:45 pm.'),sources,now,'read')).toThrow();
 expect(()=>applyLabResponse(state,response('Your packing reminder is set for 6:45 pm.','foreign'),sources,now,'read')).toThrow();
});
test('a grounded update addressed to an owned reminder preserves one reminder and its day, even if AI used create instead of correct',async()=>{
 const {normalizeV4ReminderReplacement}=await import('../convex/v4Action');
 const text='Make that 6:45 pm instead.',src:any={messageId:'change',text,role:'user',at:now,canSave:true};
 const original=structuredClone(state);original.reminders[0].time='18:15';
 const p=expandV4({introduced:true,reply:'Your packing reminder is updated to 6:45 pm.',actions:[{type:'reminder',targetId:'reminder',timePhrase:'6:45 pm',repeat:'once',evidence:text,permissionEvidence:text}]},'change');
 normalizeV4ReminderReplacement(p,{state:original,sources:[src]},{messageId:'change',text});
 const r=applyLabResponse(original,p,[src],now,'change');expect(r.state.reminders).toHaveLength(1);expect(r.state.reminders[0].time).toBe('18:45');expect(r.state.reminders[0].repeat).toBe('once');
});
