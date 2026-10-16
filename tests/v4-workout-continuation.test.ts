import {test,expect} from 'vitest';
import {restoreV4WorkoutReminderLink} from '../convex/v4ReminderContext';
import {completeV4ReminderDay,expandV4} from '../convex/v4Action';
import {applyLabResponse,freshLabState} from '../convex/labModel';
const start=Date.parse('2026-10-16T10:00:00Z');
function fixture(){
 const request={messageId:'request',role:'user',text:'Remind me of my workout at 7 am tomorrow',at:start,canSave:true};
 const detail={messageId:'detail',role:'user',text:'Mobility and stretching',at:start+60000,canSave:true};
 const answer={messageId:'answer',role:'user',text:'7 am',at:start+120000,canSave:true};
 const state=freshLabState(start);state.access.mode='active_paid';state.onboardingIntroduced=true;
 state.records=[{id:'activity',kind:'task',label:detail.text,text:detail.text,sourceMessageId:detail.messageId,evidence:detail.text,reportedAt:detail.at,date:null,time:null,targetNumber:null,state:'planned',parentId:null}];
 state.tasks=[{id:'clarify:detail',topic:'conversation clarification',sourceMessageId:'detail',targetId:null,question:'What time should I remind you tomorrow?'}];
 const c:any={state,now:answer.at,reminderDeliveryConfigured:true,sources:[request,detail,answer],history:[request,{role:'assistant',text:'What kind of workout should I remind you about?'},detail,{role:'assistant',text:'What time should I remind you tomorrow?'},answer]};
 const p=expandV4({introduced:true,reply:'What day?',actions:[],tasks:state.tasks},answer.messageId,answer.text);
 return {c,p,a:{messageId:answer.messageId,text:answer.text}};
}
test('workout description continuation retains original reminder authority, date and clock',()=>{
 const {c,p,a}=fixture();expect(restoreV4WorkoutReminderLink(c,a)).toBe(true);p.open_tasks=c.state.tasks;
 expect(completeV4ReminderDay(p,c,a)).toBe(true);
 const result=applyLabResponse(c.state,p,c.sources,c.now,a.messageId);
 expect(result.state.reminders).toHaveLength(1);
 expect(result.state.reminders[0]).toMatchObject({targetId:'activity',dueAt:Date.parse('2026-10-17T01:30:00Z'),time:'07:00'});
 expect(result.state.tasks).toEqual([]);
});
test('tomorrow retains the original receipt day across midnight',()=>{
 const {c,p,a}=fixture();c.now=Date.parse('2026-10-16T18:31:00Z');c.sources[0].at=Date.parse('2026-10-16T18:29:00Z');c.sources[1].at=Date.parse('2026-10-16T18:29:30Z');c.sources[2].at=c.now;
 expect(restoreV4WorkoutReminderLink(c,a)).toBe(true);p.open_tasks=c.state.tasks;expect(completeV4ReminderDay(p,c,a)).toBe(true);
 expect(applyLabResponse(c.state,p,c.sources,c.now,a.messageId).state.reminders[0].dueAt).toBe(Date.parse('2026-10-17T01:30:00Z'));
});
test.each(['blocked request','blocked detail','quote','unrelated intervening message','two targets','two questions','already scheduled','changed clock','recurring','expired','safety','storage withdrawn','multiple requests','past due'])('does not recover an unsafe or ambiguous %s',kind=>{
 const {c,a}=fixture();
 if(kind==='blocked request')c.sources[0].canSave=false;
 if(kind==='blocked detail')c.sources[1].canSave=false;
 if(kind==='quote')Object.assign(a,{quotedMessageId:'elsewhere'});
 if(kind==='unrelated intervening message')c.history.splice(3,0,{role:'user',text:'Something else'});
 if(kind==='two targets')c.state.records.push({...c.state.records[0],id:'second'});
 if(kind==='two questions')c.state.tasks.push({...c.state.tasks[0],id:'second'});
 if(kind==='already scheduled')c.state.reminders.push({targetId:'activity',state:'scheduled'});
 if(kind==='changed clock')a.text='8 am';
 if(kind==='recurring')c.sources[0].text+=' every day';
 if(kind==='expired')c.state.access.mode='expired';
 if(kind==='safety')c.state.control.safetyPaused=true;
 if(kind==='storage withdrawn')c.state.control.storage=false;
 if(kind==='multiple requests')c.sources[0].text+=' and remind me to shop';
 if(kind==='past due')c.now=Date.parse('2026-10-18T12:00:00Z');
 const before=structuredClone(c.state);expect(restoreV4WorkoutReminderLink(c,a)).toBe(false);expect(c.state).toEqual(before);
});
