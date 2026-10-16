import {test,expect} from 'vitest';
import {completeV4ReminderDay} from '../convex/v4Action';
const now=Date.parse('2026-10-13T04:30:00Z');
function fixture(){return {p:{actions:[],open_tasks:[{id:'pending',targetId:'walk',topic:'reminder day',question:'Which day?'}],clarification:'Which day?',reply:'Which day?',safety:{intent:'none'}},c:{now,reminderDeliveryConfigured:true,state:{access:{mode:'active_paid'},control:{storage:true,tracking:'active',safetyPaused:false},tasks:[{id:'reminder-pending:m1',sourceMessageId:'m1',targetId:'walk',question:'Which day?'}],records:[{id:'walk',time:'9:20 pm'}]},sources:[{messageId:'m1',text:'Remind me to walk at 9:20 pm',canSave:true}]},a:{messageId:'m2',text:'Tomorrow please'}};}
test('the only asked date slot uses the owned purpose and clock without copying unsupported spans',()=>{const {p,c,a}=fixture();expect(completeV4ReminderDay(p,c,a)).toBe(true);expect(p.actions).toEqual([expect.objectContaining({type:'reminder',targetId:'walk',timePhrase:'9:20 pm',timeSourceMessageId:'m1',datePhrase:'Tomorrow',permissionEvidence:'Tomorrow please',sourceMessageId:'m2'})]);expect(p.clarification).toBeNull();});
test.each(['expired','revoked','eligible'])('inactive %s access never completes a new reminder',mode=>{const {p,c,a}=fixture();c.state.access.mode=mode;expect(completeV4ReminderDay(p,c,a)).toBe(false);});
test('ambiguous questions, quotes, unsupported clock, recurrence and blocked old source need AI clarification',()=>{for(const edit of [(c:any,a:any)=>c.state.tasks.push({...c.state.tasks[0],id:'another'}),(c:any,a:any)=>a.quotedMessageId='other',(c:any)=>{c.state.records[0].time=null;c.sources[0].text='Remind me to walk';},(c:any)=>c.sources[0].text+=' every day',(c:any)=>c.sources[0].canSave=false,(c:any)=>c.state.control.safetyPaused=true]){const {p,c,a}=fixture();edit(c,a);expect(completeV4ReminderDay(p,c,a)).toBe(false);expect(p.actions).toEqual([]);}});

test('a date answer reuses the requested reminder clock, never the activity session clock',()=>{const {p,c,a}=fixture();c.state.records[0].time='9 am';c.sources[0].text='Remind me about physio at 8:30 am';expect(completeV4ReminderDay(p,c,a)).toBe(true);expect(p.actions[0]).toMatchObject({timePhrase:'8:30 am',timeSourceMessageId:'m1',datePhrase:'Tomorrow'});expect(p.reply).toContain('8:30 am');});


test.each(['Tuesday','20 October 2026'])('a supplied %s completes the owned pending purpose at its saved time',text=>{
 const {p,c,a}=fixture();c.now=Date.parse('2026-10-16T07:40:00Z');c.state.records[0]={...c.state.records[0],kind:'task',time:'10 am'} as any;c.sources[0].text='Remind me to prepare my doctor questions';a.text=text;
 expect(completeV4ReminderDay(p,c,a)).toBe(true);expect(p.actions[0]).toMatchObject({type:'reminder',targetId:'walk',datePhrase:text,permissionEvidence:text});expect(p.clarification).toBeNull();
});

test('a complete day and explicit am clock answers the pending setup without asking either again',()=>{
 const {p,c,a}=fixture();c.now=Date.parse('2026-10-16T07:40:00Z');c.state.records[0]={...c.state.records[0],kind:'task',time:null} as any;c.sources[0].text='Remind me to prepare my doctor questions';a.text='Remind me on Tuesday at 10 am';
 expect(completeV4ReminderDay(p,c,a)).toBe(true);expect(p.actions[0]).toMatchObject({datePhrase:'Tuesday',timePhrase:'10 am',targetId:'walk'});expect(p.clarification).toBeNull();
});

test('a clock answer reuses the already saved reminder date rather than asking for the day again',()=>{
 const {p,c,a}=fixture();c.now=Date.parse('2026-10-16T07:40:00Z');c.state.records[0]={...c.state.records[0],kind:'task',date:'2026-10-20',time:null} as any;c.sources[0].text='Remind me to prepare my doctor questions';a.text='10 am';
 expect(completeV4ReminderDay(p,c,a)).toBe(true);expect(p.actions[0]).toMatchObject({datePhrase:'2026-10-20',dateSourceRecordId:'walk',timePhrase:'10 am'});
});

test.each(['6 pm is okay','6 pm is ok','6 pm please'])('clock acknowledgement %s completes only the asked time slot in a multi-reminder source',text=>{
 const {p,c,a}=fixture();c.now=Date.parse('2026-10-16T09:30:00Z');c.sources[0].text='Remind me to leave in 15 minutes for my class at 4. Set another reminder to review my packing list tonight.';(c.sources[0] as any).at=c.now;c.state.records[0]={...c.state.records[0],kind:'task',date:null,time:null} as any;a.text=text;
 expect(completeV4ReminderDay(p,c,a)).toBe(true);expect(p.actions).toEqual([expect.objectContaining({type:'correct',targetId:'walk',timePhrase:'6 pm'})]);expect(p.reply).toBe('Which day should I remind you?');expect(p.actions.some((x:any)=>x.type==='reminder')).toBe(false);
});

 test.each(['6 pm is not okay','6 pm or 8 pm','6 pm for a different task'])('does not strip changed meaning from %s',text=>{const {p,c,a}=fixture();a.text=text;expect(completeV4ReminderDay(p,c,a)).toBe(false);expect(p.actions).toEqual([]);});
