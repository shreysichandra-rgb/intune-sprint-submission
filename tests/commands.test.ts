import {test,expect,vi,beforeEach,afterEach} from 'vitest';
import {convexTest} from 'convex-test';
import schema from '../convex/schema';
import {api,internal} from '../convex/_generated/api';
const generateObject=vi.hoisted(()=>vi.fn());
vi.mock('@convex-dev/agent',()=>({Agent:class{generateObject=generateObject;}}));
const TEST_NOW=Date.parse('2026-10-04T10:00:00+05:30');
beforeEach(()=>{vi.spyOn(Date,'now').mockReturnValue(TEST_NOW);});
const modules=import.meta.glob('../convex/**/*.*s');
afterEach(()=>{vi.unstubAllEnvs();vi.restoreAllMocks();generateObject.mockClear();});
async function fixture(){
 const t=convexTest(schema,modules); const pair=await t.mutation(api.tracking.createTestPair,{});
 await t.run(async ctx=>{await ctx.db.insert('quotas',{key:'global',times:Array(500).fill(Date.now())});});
 vi.stubEnv('OPENAI_API_KEY','');return {t,pair};
}
test('Pause, Resume, Stop, Delete and summary bypass both missing AI key and exhausted quota',async()=>{
 const {t,pair}=await fixture();
 for(const token of [pair.A,pair.B]){
  const send=(text:string)=>t.action(api.messages.send,{token,messageId:crypto.randomUUID(),text});
  expect((await send('pAuSe')).outcome).toBe('paused');
  expect((await send('ReSuMe')).outcome).toBe('active');
  expect((await send('WHAT HAVE I TOLD YOU THIS WEEK?')).outcome).toBe('summary');
  expect((await send('STOP')).outcome).toBe('stopped');
  expect((await send('Delete My Pilot Data')).outcome).toBe('deleted');
 }
 expect(generateObject).not.toHaveBeenCalled();
 await t.run(async ctx=>{expect((await ctx.db.query('quotas').withIndex('by_key',q=>q.eq('key','global')).unique())!.times).toHaveLength(500);const receipts=await ctx.db.query('receipts').collect();expect(receipts).toHaveLength(10);expect(receipts.every(r=>r.state==='complete'&&r.messageReceivedAt===TEST_NOW)).toBe(true);});
});
async function seed(t:any,token:string,item='brain fog'){
 return t.run(async(ctx:any)=>{
  const user=await ctx.db.query('users').withIndex('by_token',(q:any)=>q.eq('token',token)).unique();
  const occurrenceId=await ctx.db.insert('occurrences',{userId:user._id,jobId:user.jobId,trackedItem:item,rawText:`${item} today.`,occurrenceDate:'2026-10-04',occurrenceTime:null,timePrecision:'date-only',messageReceivedAt:TEST_NOW,source:'user',status:'active',confirmationState:'confirmed',batchId:crypto.randomUUID()});
  const outputIds=[];
  for(const kind of ['flag','correction','summary']) outputIds.push(await ctx.db.insert('proactiveOutputs',{userId:user._id,jobId:user.jobId,kind,status:'queued',body:`Fictional ${item} ${kind}`}));
  return {userId:user._id,jobId:user.jobId,occurrenceId,outputIds};
 });
}
test('existing users default active; pause and stop drop every queued kind and resume never backfills',async()=>{
 const {t,pair}=await fixture();const a=await seed(t,pair.A);
 expect((await t.query(api.tracking.getSummary,{token:pair.A})).user.state).toBe('active');
 for(const outputId of a.outputIds) expect(await t.query(internal.commands.deliveryPermitted,{outputId})).toBe(true);
 const send=(text:string)=>t.action(api.messages.send,{token:pair.A,messageId:crypto.randomUUID(),text});
 await send('Pause');
 for(const outputId of a.outputIds) expect(await t.query(internal.commands.deliveryPermitted,{outputId})).toBe(false);
 await send('Resume');
 for(const outputId of a.outputIds) expect(await t.query(internal.commands.deliveryPermitted,{outputId})).toBe(false);
 const newer=await seed(t,pair.A);await send('Stop');
 for(const outputId of newer.outputIds) expect(await t.query(internal.commands.deliveryPermitted,{outputId})).toBe(false);
 await send('Resume');expect((await t.query(api.tracking.getSummary,{token:pair.A})).user.state).toBe('stopped');
});
test('summary uses only own records and deletion erases all own health copies without touching B',async()=>{
 const {t,pair}=await fixture();const a=await seed(t,pair.A);await seed(t,pair.B,'poor sleep');
 await t.run(async ctx=>{
  await ctx.db.insert('pending',{userId:a.userId,rawText:'Brain fog?',messageReceivedAt:1791088200000,reason:'Which date?',kind:'clarification',proposal:{},relatedIds:[a.occurrenceId]});
  await ctx.db.insert('references',{userId:a.userId,jobId:a.jobId,occurrenceId:a.occurrenceId});
  await ctx.db.insert('receipts',{userId:a.userId,messageId:'running-ai',state:'processing'});
 });
 const bBefore=await t.query(api.tracking.getSummary,{token:pair.B});
 const b=await t.action(api.messages.send,{token:pair.B,messageId:'b-summary',text:'What have I told you this week?'});
 expect(b.view.records).toEqual(bBefore.records);expect(b.view.sevenDayCount).toBe(1);expect(b.view.records[0].trackedItem).toBe('poor sleep');
 const deleted=await t.action(api.messages.send,{token:pair.A,messageId:'delete',text:'Delete my pilot data'});
 expect(deleted.view.records).toEqual([]);expect(deleted.view.pending).toEqual([]);expect(deleted.view.user.trackedItems).toEqual([]);expect(deleted.view.user.state).toBe('stopped');expect(deleted.view.sevenDayCount).toBe(0);
 await t.run(async ctx=>{
  for(const table of ['occurrences','pending','references','proactiveOutputs'] as const) expect(await ctx.db.query(table).withIndex('by_user',q=>q.eq('userId',a.userId)).collect()).toEqual([]);
  expect((await ctx.db.query('receipts').withIndex('by_user_message',q=>q.eq('userId',a.userId).eq('messageId','running-ai')).unique())!.state).toBe('cancelled');
 });
 expect((await t.query(api.tracking.getSummary,{token:pair.B})).records).toEqual(bBefore.records);
});
test('control commands stay exact while week retrieval bypasses AI',async()=>{
 const {t,pair}=await fixture();
 for(const text of ['Pause please',' Stop']){
  const reply=await t.action(api.messages.send,{token:pair.A,messageId:crypto.randomUUID(),text});
  expect(reply.outcome).toBe('error');expect(reply.message).toContain('shared app capacity');
 }
 const week=await t.action(api.messages.send,{token:pair.A,messageId:'week-without-question-mark',text:'What have I told you this week'});
 expect(week.outcome).toBe('summary');expect(week.message).toContain('Here’s what you told me over the last 7 days');
});

test('deletion confirmation matches public instructions and states which data remains',async()=>{
 const t=convexTest(schema,modules);const pair=await t.mutation(api.tracking.createTestPair,{});
 const result=await t.action(api.messages.send,{token:pair.A,messageId:'privacy-deletion-confirmation',text:'Delete my pilot data'});
 expect(result.message).toBe('Your health records have been deleted. Your phone number and service records remain. All proactive messages are stopped.');
 const {readFileSync}=await import('node:fs');
 for(const path of ['public/privacy.html','public/data-deletion.html'])expect(readFileSync(path,'utf8')).toContain(result.message);
});
