import {test,expect} from 'vitest';
import {freshLabState,reminderFieldSources,requestedReminderDue,linkReminderTasks,type Source} from '../convex/labModel';
const at=Date.parse('2026-10-11T15:30:00Z'); // 9 pm India
const request:Source={messageId:'request',text:'Remind me daily to log protein',role:'user',at:at-60000,canSave:true};
const answer:Source={messageId:'answer',text:'8 pm',role:'user',at,canSave:true};
function fields(requestOverride=request){const state=freshLabState(at);state.tasks=[{id:'reminder-pending:request',targetId:'log',sourceMessageId:'request',topic:'protein reminder',question:'What time?'}];return reminderFieldSources({sourceMessageId:'answer',targetId:'log'},state,[requestOverride,answer]);}
test('an explicitly requested daily reminder starts at the next clock when today has passed',()=>{
 const due=requestedReminderDue({repeat:'daily',timePhrase:'8 pm'},fields(),answer);
 expect(due.dueAt).toBe(Date.parse('2026-10-12T14:30:00Z'));expect(due.question).toBeNull();
});
test.each(['I track protein daily','Remind me to log protein'])('a preference or a one-off request cannot supply daily permission: %s',text=>{
 const due=requestedReminderDue({repeat:'daily',timePhrase:'8 pm'},fields({...request,text}),answer);
 expect(due.dueAt).toBeNull();expect(due.question).toContain('Which day');
});
test('a blocked earlier message cannot authorize recurrence',()=>{
 const due=requestedReminderDue({repeat:'daily',timePhrase:'8 pm'},fields({...request,canSave:false}),answer);
 expect(due.dueAt).toBeNull();
});
test('a different owned task cannot lend its daily purpose',()=>{
 const state=freshLabState(at);state.tasks=[{id:'reminder-pending:request',targetId:'other',sourceMessageId:'request',topic:'reminder'}];
 const context=reminderFieldSources({sourceMessageId:'answer',targetId:'log'},state,[request,answer]);
 expect(requestedReminderDue({repeat:'daily',timePhrase:'8 pm'},context,answer).dueAt).toBeNull();
});


test.each([1,2])('link an unassigned reminder only with exactly one owned purpose record: %s',count=>{
 const state=freshLabState(at);state.tasks=[{id:'clock',sourceMessageId:'request',targetId:null,topic:'reminder',question:'What time?'}];state.records=Array.from({length:count},(_,i)=>({id:'purpose'+i,kind:'task',label:'log protein',text:request.text,date:null,time:null,targetNumber:null,state:'planned',parentId:null,sourceMessageId:'request',evidence:request.text,reportedAt:at}));
 const tasks=linkReminderTasks(state,[request]);expect(tasks[0].targetId).toBe(count===1?'purpose0':null);
 const denied=linkReminderTasks(state,[{...request,canSave:false}]);expect(denied[0].targetId).toBeNull();
});
