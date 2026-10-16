import {test,expect,vi,beforeEach,afterEach} from 'vitest';
import {convexTest} from 'convex-test';
import schema from '../convex/schema';
import * as copy from '../convex/copy';
import {api} from '../convex/_generated/api';
const generateObject=vi.hoisted(()=>vi.fn());
vi.mock('@convex-dev/agent',()=>({Agent:class{generateObject=generateObject;}}));
const modules=import.meta.glob('../convex/**/*.*s');
const now=Date.parse('2026-10-06T10:00:00+05:30');
const complete={intent:'plan_complete',trackedItem:null,count:null,datePhrase:'today',timePhrase:null,precision:'date-only',target:null,explicitNew:false,activity:'strength train',targetNumber:null,completionStatus:null};
beforeEach(()=>{vi.spyOn(Date,'now').mockReturnValue(now);vi.stubEnv('OPENAI_API_KEY','');generateObject.mockReset();});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs();});
async function setup(){
 const t=convexTest(schema,modules),pair=await t.mutation(api.tracking.createTestPair,{});
 await t.run(async ctx=>{
  const u=(await ctx.db.query('users').withIndex('by_token',q=>q.eq('token',pair.A)).unique())!;
  await ctx.db.insert('plans',{userId:u._id,jobId:u.jobId,activity:'strength train',targetNumber:3,rawText:'strength train 3 times this week',messageReceivedAt:now,confirmedAt:now,state:'active'});
  await ctx.db.insert('occurrences',{userId:u._id,jobId:u.jobId,trackedItem:'brain fog',rawText:'Brain fog yesterday',occurrenceDate:'2026-10-05',occurrenceTime:null,timePrecision:'date-only',messageReceivedAt:now,source:'user',status:'active',confirmationState:'confirmed',batchId:'fictional'});
  await ctx.db.insert('quotas',{key:'global',times:Array(500).fill(now)});
 });
 const snapshot=()=>t.run(async ctx=>{const out:Record<string,unknown>={};for(const name of ['users','occurrences','pending','plans','planPending','planCompletions','references','proactiveOutputs','quotas','deletionMarkers'] as const)out[name]=await ctx.db.query(name).collect();return out;});
 return {t,pair,snapshot,send:(text:string)=>t.action(api.messages.send,{token:pair.A,messageId:crypto.randomUUID(),text})};
}
async function expectGreeting(f:Awaited<ReturnType<typeof setup>>,text:string){
 const before=await f.snapshot(),reply=await f.send(text);
 expect(reply).toEqual({outcome:'greeting',message:before.users && (before.users as any[])[0].greetingSeenAt!==undefined?copy.returningGreetingReply:copy.greetingReply,messageReceivedAt:now});
 const after=await f.snapshot();for(const u of (after.users as any[]))delete u.greetingSeenAt;for(const u of (before.users as any[]))delete u.greetingSeenAt;expect(after).toEqual(before);
 expect(generateObject).not.toHaveBeenCalled();
}
test.each(['hello','hi','hey'])('whole-message %s replies without AI or health/state changes',async text=>{await expectGreeting(await setup(),text);});
test('greeting accepts case and surrounding spaces without broadening to other words',async()=>{await expectGreeting(await setup(),'  HeLLo  ');});
test.each(['symptom date','completion date','plan confirmation','duplicate session'])('greeting leaves pending %s unchanged',async kind=>{
 const f=await setup();
 await f.t.run(async ctx=>{
  const u=(await ctx.db.query('users').withIndex('by_token',q=>q.eq('token',f.pair.A)).unique())!;
  if(kind==='symptom date')await ctx.db.insert('pending',{userId:u._id,jobId:u.jobId,rawText:'Brain fog',messageReceivedAt:now,reason:'Which day was that?',kind:'clarification',proposal:{...complete,intent:'record',trackedItem:'brain fog',count:1,activity:null,datePhrase:null},relatedIds:[]});
  else await ctx.db.insert('planPending',{userId:u._id,jobId:u.jobId,rawText:kind==='plan confirmation'?'strength train 3 times this week':'done',messageReceivedAt:now,memoryVersion:u.memoryVersion??0,reason:kind==='duplicate session'?'Same or new session?':kind==='plan confirmation'?'Is that right?':'Which day was that?',kind:kind==='duplicate session'?'duplicate':kind==='plan confirmation'?'confirmation':'date',proposal:{...complete,datePhrase:null}});
 });
 await expectGreeting(f,'hello');
});
test.each(['Pause','Stop'])('greeting preserves state after %s',async command=>{
 const f=await setup();await f.send(command);const before=await f.t.query(api.tracking.getSummary,{token:f.pair.A});
 expect(before.user.state).toBe(command==='Pause'?'paused':'stopped');await expectGreeting(f,'hey');
 const after=await f.t.query(api.tracking.getSummary,{token:f.pair.A});expect(after).toEqual(before);
});
test('hey, I did my workout today still follows normal interpretation and saves one completion',async()=>{
 const f=await setup();vi.stubEnv('OPENAI_API_KEY','fictional');
 await f.t.run(async ctx=>{const quota=(await ctx.db.query('quotas').collect())[0];await ctx.db.patch(quota._id,{times:[]});});
 generateObject.mockResolvedValueOnce({object:complete});
 const reply=await f.send('hey, I did my workout today');
 expect(generateObject).toHaveBeenCalledTimes(1);expect(reply.outcome).toBe('plan_completed');expect(reply.message).toBe('Nice 💪 I’ve got that for today. You’re at 1/3 this week.');
 expect(reply.planView.count).toBe(1);expect(reply.planView.records).toHaveLength(1);expect(reply.planView.records[0].rawText).toBe('hey, I did my workout today');expect(reply.planView.records[0].completionDate).toBe('2026-10-06');
 const symptoms=await f.t.query(api.tracking.getSummary,{token:f.pair.A});expect(symptoms.records).toHaveLength(1);expect(symptoms.records[0].rawText).toBe('Brain fog yesterday');
});
