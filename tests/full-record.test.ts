import {test,expect} from 'vitest';
import {fullRecordReply,recordWords} from '../convex/fullRecord';
import {freshLabState,applyLabResponse} from '../convex/labModel';

const now=Date.parse('2026-10-22T10:00:00+05:30');
const user:any={timezone:'Asia/Kolkata',startDate:'2026-10-21',endDate:'2026-10-28',v4Records:[{id:'i-physio',kind:'plan',time:'9\nAm'}]};
const item=(values:any)=>({_id:'i-'+values.title,kind:'task',text:'',state:'planned',createdAt:now,updatedAt:now,...values});
const reminder=(title:string,state:string,dueAt=now)=>({title,state,dueAt,timezone:'Asia/Kolkata',repeat:'once'});
const record=(values:any={})=>({experiences:[],body:[],cycle:[],pending:[],previousPlans:[],previousCompletions:[],previousPending:[],plan:{plan:null},responsibilities:{items:[],events:[]},reminders:[],...values});

// Synthetic version of the founder's 22 October phone-check record.
const phoneCheck=record({
 experiences:[{label:'इस हफ़्ते मेरी नींद बार-बार टूट रही है।',text:'इस हफ़्ते मेरी नींद बार-बार टूट रही है।',status:'ongoing',kind:'body'},{label:'knee surgery',text:'My knee surgery was on 21 August 2025',status:'historical',kind:'history'}],
 responsibilities:{items:[
  item({kind:'plan',title:'stretching routine',text:'15 minutes on Tuesday and Saturday'}),
  item({_id:'i-physio',kind:'plan',title:'physio',text:'I go to physio three times a week -monday  Wednesday and Friday',target:3}),
  item({kind:'doctor_question',title:'Could we review my cycle notes at my next visit?',text:'Can we review my cycle notes?'}),
  item({kind:'doctor_question',title:'Can we review my sleep notes at my next appointment?',text:'Can we review my sleep notes and existing exercise plan at my next appointment?'}),
  item({kind:'task',title:'desk checklist',text:'blue folder and pen'}),
  item({kind:'task',title:'walk',text:'walk'}),
 ],events:[]},
 reminders:[reminder('walk','stopped'),reminder('physio','stopped'),reminder('physio','stopped'),reminder('packing list','stopped')],
});

test('full record reads as plain WhatsApp lines without technical wording',()=>{
 const r=fullRecordReply(phoneCheck,user);
 expect(r.startsWith('Here’s everything I’m keeping track of for you 👇')).toBe(true);
 expect(r.endsWith('That’s everything you’ve asked me to keep track of.')).toBe(true);
 for(const old of ['up to 250','not an episode count','0/?','. planned.','Ongoing experience:','Reminder: '])expect(r).not.toContain(old);
 expect(r).not.toMatch(/[—–]/);
 expect(r.split('इस हफ़्ते मेरी नींद बार-बार टूट रही है।').length).toBe(2);
 expect(r).toContain('My knee surgery was on 21 August 2025 (from your history)');
 expect(r).toContain('Plans:\n• stretching routine: 15 minutes on Tuesday and Saturday. Nothing marked done yet');
 expect(r).toContain('• I go to physio three times a week -monday Wednesday and Friday (9 Am). 0 of 3 done this pilot');
 expect(r).toContain('To do:\n• desk checklist: blue folder and pen\n• walk');
 expect(r).toContain('None active right now');
 expect(r).toContain('Earlier reminders, now stopped: walk, physio (2), packing list');
});

test('a doctor question corrected before the fix shows one question, never both wordings',()=>{
 const r=fullRecordReply(phoneCheck,user);
 expect(r).toContain('• Could we review my cycle notes at my next visit?');
 expect(r).not.toContain('Can we review my cycle notes?');
 expect(r).toContain('• Can we review my sleep notes and existing exercise plan at my next appointment?');
 expect(recordWords('physio','physio')).toBe('physio');
});

test('a long record stays within one WhatsApp message and says what was left out',()=>{
 const items=Array.from({length:40},(_,i)=>item({title:'task '+i,text:('detail '+i+' ').repeat(30)}));
 const r=fullRecordReply(record({responsibilities:{items,events:[]}}),user);
 expect(r.length).toBeLessThan(4096);
 expect(r).toMatch(/\d+ more saved items didn’t fit in one message/);
 expect(r).toContain('task 0: '+('detail 0 ').repeat(30).trim());
});

test('an empty record says so plainly',()=>{
 expect(fullRecordReply(record(),user)).toBe('I’m not keeping track of anything for you yet. Tell me something you’d like me to remember.');
});

const source=(text:string,id:string)=>({messageId:id,text,role:'user',at:now,canSave:true});
const action=(values:any)=>({type:'save',useSourceText:null,sourceMessageId:'m1',evidence:null,targetId:null,tempId:'q1',kind:'question',label:null,text:null,datePhrase:null,timePhrase:null,targetNumber:null,state:null,parentId:null,permissionEvidence:null,repeat:null,...values});
const response=(actions:any[])=>({onboarding:{introduced:false},reply:'Updated.',actions,clarification:null,open_tasks:[],safety:{intent:'none',sourceMessageId:null,evidence:null,reason:null}});

test('correcting a saved question replaces its old wording instead of keeping both',()=>{
 const q='Can we review my cycle notes?',next='Could we review my cycle notes at my next visit?';
 const saved=applyLabResponse(freshLabState(now),response([action({evidence:q,label:q})]),[source('Save a question for my doctor: '+q,'m1')],now,'m1').state;
 const id=saved.records[0].id;expect(saved.records[0].text).toBe(q);
 const fixed=applyLabResponse(saved,response([action({type:'correct',targetId:id,tempId:null,kind:null,sourceMessageId:'m2',evidence:next,label:next})]),[source('Actually change that doctor question to: '+next,'m2')],now,'m2').state;
 expect(fixed.records).toHaveLength(1);
 expect(fixed.records[0].label).toBe(next);
 expect(fixed.records[0].text).toBe(next);
});

test('correcting only a short title keeps separate saved details',()=>{
 const text='three times a week on Monday, Wednesday and Friday';
 const saved=applyLabResponse(freshLabState(now),response([action({kind:'plan',evidence:'physio '+text,label:'physio',text,targetNumber:3})]),[source('physio '+text,'m1')],now,'m1').state;
 const fixed=applyLabResponse(saved,response([action({type:'correct',targetId:saved.records[0].id,tempId:null,kind:null,sourceMessageId:'m2',evidence:'pilates',label:'pilates'})]),[source('Actually it is pilates, not physio','m2')],now,'m2').state;
 expect(fixed.records[0].label).toBe('pilates');
 expect(fixed.records[0].text).toBe(text);
});

test('a corrected note reads as a correction of its first wording, not a colon join',()=>{
 expect(recordWords('I woke up twice last night','Actually three times, not twice.',' (21 Oct)')).toBe('I woke up twice last night — correction: three times, not twice (21 Oct)');
 expect(recordWords('Brain fog','Nothing unusual')).toBe('Brain fog: Nothing unusual');
});

test('body changes keep counting plain repeats but show a corrected report with its correction',()=>{
 const body=[{trackedItem:'brain fog',rawText:'brain fog around 4pm',occurrenceDate:'2026-10-20'},{trackedItem:'brain fog',rawText:'brain fog again',occurrenceDate:'2026-10-21'},{trackedItem:'I woke up twice last night',rawText:'Actually three times, not twice.',occurrenceDate:'2026-10-21'}];
 const r=fullRecordReply(record({body}),user);
 expect(r).toMatch(/brain fog: 2 times/);
 expect(r).toContain('I woke up twice last night — correction: three times, not twice');
 expect(r).not.toMatch(/I woke up twice last night: (?:once|\d+ times)/);
});

test('supplements sit under Food and supplement plans (founder decision 23 October)',()=>{
 const text=fullRecordReply(record({responsibilities:{items:[item({kind:'food',title:'vitamin D',text:'My doctor said take vitamin D 60k once a week on Sundays'})],events:[]}}),user);
 expect(text).toContain('Food and supplement plans');expect(text).not.toMatch(/Food plans/);expect(text).toContain('vitamin D 60k once a week on Sundays');
});
