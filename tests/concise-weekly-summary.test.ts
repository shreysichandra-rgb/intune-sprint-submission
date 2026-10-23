import {mkdirSync,writeFileSync} from 'node:fs';
import {test,expect,vi,afterEach} from 'vitest';
import {convexTest} from 'convex-test';
import {makeFunctionReference as ref} from 'convex/server';
import schema from '../convex/schema';
import {internal} from '../convex/_generated/api';
const modules=import.meta.glob('../convex/**/*.*s');
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs();});
async function fixture(){
 vi.stubEnv('INTUNE_PILOT_MODE','v3');
 const t=convexTest(schema,modules),token=await t.mutation(internal.phoneUsers.getOrCreate,{phoneNumber:'+12025550190'});
 const now=Date.parse('2026-10-20T04:30:00Z');vi.spyOn(Date,'now').mockReturnValue(now);
 await t.run(async c=>{
  const u=(await c.db.query('users').withIndex('by_token',q=>q.eq('token',token)).unique())!;
  await c.db.patch(u._id,{conversationConsent:true,startDate:'2026-10-13',endDate:'2026-10-20',pilotStartedAt:now-604800000,pilotEndsAt:now});
  await c.db.insert('pilotExperiences',{userId:u._id,jobId:u.jobId,kind:'body',label:'fictional ongoing experience',text:'fictional ongoing experience',status:'ongoing',reportedAt:now-1000,updatedAt:now-1000});
  const plan=await c.db.insert('pilotItems',{userId:u._id,kind:'plan',title:'existing stretching plan',text:'My existing stretching plan is three sessions',target:3,state:'planned',createdAt:now-1000,updatedAt:now-1000});
  for(const [date,status]of [['2026-10-14','completed'],['2026-10-16','skipped'],['2026-10-12','completed']]as const)await c.db.insert('pilotItemEvents',{userId:u._id,itemId:plan,text:'fictional reported session',date,status,createdAt:now-1000});
  await c.db.insert('pilotItems',{userId:u._id,kind:'doctor_question',title:'Can we review my existing exercise plan?',text:'Can we review my existing exercise plan?',state:'planned',createdAt:now-1000,updatedAt:now-1000});
  await c.db.insert('pilotItems',{userId:u._id,kind:'task',title:'fictional test packing list',text:'fictional test packing list: scarf and pen',state:'planned',createdAt:now-1000,updatedAt:now-1000});
  for(const state of ['stopped','stopped','active']as const)await c.db.insert('pilotReminders',{userId:u._id,kind:'tracking',title:state==='active'?'future stretching':'old practice reminder',permissionText:'fictional request',timezone:'Asia/Kolkata',localTime:'10:00',dueAt:now+86400000,repeat:'once',state,createdAt:now-1000});
 });
 const summary=()=>t.query(ref<'query',any,any>('conversationStore:recordReply'),{token,scope:'week'});
 const history=()=>t.query(ref<'query',any,any>('conversationStore:history'),{token});
 return {t,token,summary,history};
}
test('weekly recap groups facts once, keeps reported progress, and separates stopped reminders and explicit test notes',async()=>{
 const f=await fixture(),r=await f.summary();
 mkdirSync('output',{recursive:true});writeFileSync('output/concise-summary-fictional.txt',r.message+'\n');
 expect(r.message.match(/fictional ongoing experience/g)).toHaveLength(1);
 expect(r.message).not.toContain('. planned.');expect(r.message).not.toContain('ongoing; not an episode count');
 expect(r.message).toContain('1/3');expect(r.message).toContain('1 reported skipped');
 expect(r.message).toContain('Ask your doctor to review your existing exercise plan.');expect(r.message).not.toContain('Can we review my existing exercise plan?');
 expect(r.message).toContain('2 stopped reminders');expect(r.message).not.toContain('old practice reminder');
 expect(r.message).toContain('Test notes: 1');expect(r.message).not.toContain('scarf and pen');
 expect(r.message).toContain('Show my saved records');
});
test('full retrieval still returns original test notes and stopped reminder details; summary does not change records',async()=>{
 const f=await fixture(),snapshot=()=>f.t.run(async c=>({items:await c.db.query('pilotItems').collect(),events:await c.db.query('pilotItemEvents').collect(),reminders:await c.db.query('pilotReminders').collect()}));
 const before=await snapshot();await f.summary();expect(await snapshot()).toEqual(before);
 const h=await f.history();expect(h.message).toContain('Can we review my existing exercise plan?');expect(h.message).toContain('scarf and pen');expect(h.message).toContain('old practice reminder');expect(h.message).toContain('stopped');
});
test('weekly recap bounds long saved text and signals that full details remain available',async()=>{
 const f=await fixture();await f.t.run(async c=>{const u=(await c.db.query('users').withIndex('by_token',q=>q.eq('token',f.token)).unique())!;for(let i=0;i<12;i++)await c.db.insert('pilotItems',{userId:u._id,kind:'task',title:'task '+i,text:('detail '+i+' ').repeat(100),state:'planned',createdAt:Date.now(),updatedAt:Date.now()});});
 const r=await f.summary();expect(r.message.length).toBeLessThan(2400);expect(r.message).toContain('more');expect((await f.history()).message).toContain(('detail 11 ').repeat(20));
});
test('weekly recap preserves complementary description fields instead of dropping the original experience',async()=>{
 const f=await fixture();await f.t.run(async c=>{const u=(await c.db.query('users').withIndex('by_token',q=>q.eq('token',f.token)).unique())!;await c.db.insert('pilotExperiences',{userId:u._id,jobId:u.jobId,kind:'body',label:'My hands feel stiff after gardening',text:'It eases after a short rest',status:'ongoing',reportedAt:Date.now(),updatedAt:Date.now()});});
 const r=await f.summary();expect(r.message).toContain('My hands feel stiff after gardening');expect(r.message).toContain('It eases after a short rest');
 expect(r.message).not.toContain('Ongoing experiences are not an episode count');
});

import {summaryFactText} from '../convex/pilotMemory';
test.each([
 ['example fact','Example fact.','Example fact.'],
 ['example fact','example fact with more detail','example fact with more detail'],
 ['example fact with more detail','example fact','example fact with more detail'],
 ['first detail','second detail','first detail. second detail'],
 ['','saved description','saved description'],
 ['saved title','','saved title'],
])('summary preserves original meaning without duplicate wording: %s', (label,text,expected)=>{expect(summaryFactText(label,text)).toBe(expected);});
import {doctorQuestionSummary} from '../convex/pilotMemory';
test.each([
 ['Can we review my existing plan at the next appointment?', 'At your next appointment, ask your doctor to review your existing plan. The saved note does not specify which plan.'],
 ['Can we review my existing exercise plan?', 'Ask your doctor to review your existing exercise plan.'],
 ['Should I change my existing exercise plan?', 'Ask your doctor whether you should change your existing exercise plan.'],
 ['Should I not change my existing exercise plan?', 'Ask your doctor whether you should not change your existing exercise plan.'],
 ['Can I continue my existing exercise plan?', 'Ask your doctor whether you can continue your existing exercise plan.'],
 ['Do I need to change my existing plan?', 'Ask your doctor whether you need to change your existing plan.'],
 ['What should I ask at my appointment?', 'Ask your doctor what you should ask at your appointment.'],
])('doctor follow-up paraphrases the request while preserving uncertainty: %s', (question,expected)=>{
 const actual=doctorQuestionSummary(question,question);expect(actual).toBe(expected);expect(actual).not.toContain('physio');
});
test('unsupported doctor wording stays a quoted question instead of invented advice',()=>{
 const text='Only if my appointment changes, should I ask about my plan?';expect(doctorQuestionSummary(text,text)).toBe('Question to discuss with your doctor: “'+text+'”');
});

test('doctor summary does not rewrite quoted first-person speech as a new claim',()=>{const text='Should I tell my doctor “I am feeling better”?';expect(doctorQuestionSummary(text,text)).toBe('Question to discuss with your doctor: “'+text+'”');});
