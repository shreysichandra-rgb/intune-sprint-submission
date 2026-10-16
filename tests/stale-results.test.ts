import fs from 'node:fs';
import {test,expect,vi,beforeEach,afterEach} from 'vitest';
import {convexTest} from 'convex-test';
import schema from '../convex/schema';
import {api,internal} from '../convex/_generated/api';
const generateObject=vi.hoisted(()=>vi.fn());
vi.mock('@convex-dev/agent',()=>({Agent:class{generateObject=generateObject;}}));
const modules=import.meta.glob('../convex/**/*.*s');
const start=Date.parse('2026-10-04T10:00:00+05:30');
const record={intent:'record',trackedItem:'brain fog',count:1,datePhrase:'today',timePhrase:'9am',precision:'exact',target:null,explicitNew:false};
const correction={...record,intent:'correct',trackedItem:null,count:null,datePhrase:'yesterday',timePhrase:null,target:'latest',precision:'date-only'};
let clock:number;
beforeEach(()=>{clock=start;vi.spyOn(Date,'now').mockImplementation(()=>clock);vi.stubEnv('OPENAI_API_KEY','noncredential-test-placeholder');generateObject.mockReset();});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs();});
async function fixture(){const t=convexTest(schema,modules);const pair=await t.mutation(api.tracking.createTestPair,{});return {t,pair};}
function deferred(){let finish!:(value:any)=>void;let signal!:()=>void;const started=new Promise<void>(r=>{signal=r;});const waiting=new Promise<any>(r=>{finish=r;});return {started,signal,finish,waiting};}
async function seed(t:any,token:string){generateObject.mockResolvedValueOnce({object:record});return t.action(api.messages.send,{token,messageId:'seed',text:'Brain fog today at 9am.'});}
async function snapshot(t:any,token:string){const v=await t.query(api.tracking.getSummary,{token});return {state:v.user.state,records:v.records,pending:v.pending,sevenDayCount:v.sevenDayCount,totalStored:v.totalStored};}
function reply(input:string,r:any){return {input,messageReceivedAt:r.messageReceivedAt??null,outcome:r.outcome,replyText:r.message};}
function write(name:string,value:any){fs.writeFileSync(`output/stale-${name}-raw.json`,JSON.stringify(value,null,2)+'\n');}
async function delayed(t:any,token:string,text:string,targetId?:any,messageId='delayed'){
 const wait=deferred();generateObject.mockImplementationOnce(()=>{wait.signal();return wait.waiting;});
 const running=t.action(api.messages.send,{token,messageId,text,...(targetId?{targetId}:{})});await wait.started;
 return {wait,running};
}
async function protectedDelete(name:string,meaning:any,text:string){
 const {t,pair}=await fixture();await seed(t,pair.A);const before=await snapshot(t,pair.A);
 clock=start+1000;const old=await delayed(t,pair.A,text);
 clock=start+2000;const command=await t.action(api.messages.send,{token:pair.A,messageId:'delete',text:'Delete my pilot data'});const afterDelete=await snapshot(t,pair.A);
 clock=start+3000;old.wait.finish({object:meaning});const oldReply=await old.running;const after=await snapshot(t,pair.A);
 write(name,{case:'1. Delete while AI is running',testClock:true,aiInput:text,before,intervening:reply('Delete my pilot data',command),afterIntervening:afterDelete,delayedReply:reply(text,oldReply),after});
 expect(oldReply.outcome).toBe('dropped');expect(after).toEqual(afterDelete);
 await t.run(async ctx=>{for(const table of ['occurrences','pending','references','proactiveOutputs'] as const)expect(await ctx.db.query(table).collect()).toEqual([]);});
}
test('Delete during AI processing rejects a late new occurrence without restoring health content',async()=>{await protectedDelete('delete',record,'Brain fog today at 9am.');});
test('Delete also rejects an AI clarification without restoring pending health text',async()=>{await protectedDelete('delete-clarification',{...record,intent:'clarify',count:null,datePhrase:null,timePhrase:null},'Brain fog?');});
test('Forget target before late AI correction rejects it without creating unresolved work',async()=>{
 const {t,pair}=await fixture();const seeded=await seed(t,pair.A);const targetId=seeded.changedIds[0];const before=await snapshot(t,pair.A);
 clock=start+1000;const text='Actually that happened yesterday, not today.';const old=await delayed(t,pair.A,text,targetId);
 clock=start+2000;const forgotten=await t.mutation(api.tracking.forget,{token:pair.A,occurrenceId:targetId});const afterForget=await snapshot(t,pair.A);
 clock=start+3000;old.wait.finish({object:correction});const oldReply=await old.running;const after=await snapshot(t,pair.A);
 write('forget',{case:'2. Forget target before AI correction returns',testClock:true,aiInput:text,targetId,before,intervening:reply('Forget this',forgotten),afterIntervening:afterForget,delayedReply:reply(text,oldReply),after});
 expect(oldReply.outcome).toBe('dropped');expect(after).toEqual(afterForget);expect(after.records).toEqual([]);expect(after.pending).toEqual([]);
});
test('newer correction wins over an older delayed correction',async()=>{
 const {t,pair}=await fixture();const seeded=await seed(t,pair.A);const targetId=seeded.changedIds[0];const before=await snapshot(t,pair.A);
 clock=start+1000;const text='Actually that happened yesterday, not today.';const old=await delayed(t,pair.A,text,targetId);
 clock=start+2000;generateObject.mockResolvedValueOnce({object:{...correction,datePhrase:'8 days ago'}});
 const newerText='Actually that happened 8 days ago.';const newer=await t.action(api.messages.send,{token:pair.A,messageId:'newer-correction',text:newerText,targetId});const afterNewer=await snapshot(t,pair.A);
 clock=start+3000;old.wait.finish({object:correction});const oldReply=await old.running;const after=await snapshot(t,pair.A);
 write('correction',{case:'3. Newer correction arrives first',testClock:true,aiInput:text,targetId,before,intervening:reply(newerText,newer),afterIntervening:afterNewer,delayedReply:reply(text,oldReply),after});
 expect(newer.outcome).toBe('corrected');expect(oldReply.outcome).toBe('dropped');expect(after).toEqual(afterNewer);expect(after.records[0].occurrenceDate).toBe('2026-09-26');expect(after.sevenDayCount).toBe(0);
});
test('duplicate delivery while AI is running and after completion uses one AI call and stores once',async()=>{
 const {t,pair}=await fixture();const before=await snapshot(t,pair.A);const text='Brain fog today at 9am.';
 clock=start+1000;const old=await delayed(t,pair.A,text,undefined,'same-id');
 clock=start+2000;const repeat=await t.action(api.messages.send,{token:pair.A,messageId:'same-id',text});const afterRepeat=await snapshot(t,pair.A);
 clock=start+3000;old.wait.finish({object:record});const first=await old.running;const after=await snapshot(t,pair.A);
 clock=start+4000;const repeatComplete=await t.action(api.messages.send,{token:pair.A,messageId:'same-id',text});const afterRepeatComplete=await snapshot(t,pair.A);
 const quota=await t.run(async ctx=>(await ctx.db.query('quotas').withIndex('by_key',q=>q.eq('key','global')).unique())!.times);
 write('duplicate',{case:'4. Same provider message delivered twice',testClock:true,messageId:'same-id',before,repeatWhileRunning:reply(text,repeat),afterRepeat,firstReply:reply(text,first),after,repeatAfterCompletion:reply(text,repeatComplete),afterRepeatComplete,aiCalls:generateObject.mock.calls.length,quotaCalls:quota.length});
 expect(repeat.outcome).toBe('provider_duplicate');expect(first.outcome).toBe('stored');expect(repeatComplete.outcome).toBe('provider_duplicate');expect(afterRepeat.records).toEqual([]);expect(afterRepeatComplete).toEqual(after);expect(after.totalStored).toBe(1);expect(generateObject).toHaveBeenCalledTimes(1);expect(quota).toHaveLength(1);
});
test('Stop while AI is running rejects the late result',async()=>{
 const {t,pair}=await fixture();const before=await snapshot(t,pair.A);clock=start+1000;const text='Brain fog today at 9am.';const old=await delayed(t,pair.A,text);
 clock=start+2000;const stopped=await t.action(api.messages.send,{token:pair.A,messageId:'stop',text:'Stop'});const afterStop=await snapshot(t,pair.A);
 clock=start+3000;old.wait.finish({object:record});const oldReply=await old.running;const after=await snapshot(t,pair.A);
 write('stop',{case:'Stop during AI call',testClock:true,before,intervening:reply('Stop',stopped),afterIntervening:afterStop,delayedReply:reply(text,oldReply),after});
 expect(oldReply.outcome).toBe('dropped');expect(after).toEqual(afterStop);
});
test('a record changing before AI reservation still invalidates the received snapshot',async()=>{
 const {t,pair}=await fixture();const seeded=await seed(t,pair.A);clock=start+1000;
 await t.mutation(internal.tracking.receive,{token:pair.A,messageId:'before-reserve'});
 clock=start+2000;await t.mutation(api.tracking.forget,{token:pair.A,occurrenceId:seeded.changedIds[0]});
 await t.mutation(internal.tracking.reserve,{token:pair.A,messageId:'before-reserve'});
 const result=await t.mutation(internal.tracking.apply,{token:pair.A,messageId:'before-reserve',text:'Brain fog today at 9am.',meaning:record});
 expect(result.outcome).toBe('dropped');expect(result.view.records).toEqual([]);expect(result.view.pending).toEqual([]);
});
test('receiving Stop or Delete invalidates old AI work even before the command mutation runs',async()=>{
 for(const command of ['Stop','Delete my pilot data']){
  const {t,pair}=await fixture();clock=start+1000;const old=await delayed(t,pair.A,'Brain fog today at 9am.');
  clock=start+2000;await t.mutation(internal.tracking.receive,{token:pair.A,messageId:command,cancelPending:true});
  old.wait.finish({object:record});const result=await old.running;
  expect(result.outcome).toBe('dropped');expect(result.view.records).toEqual([]);expect(result.view.pending).toEqual([]);
 }
});
test('another user changing records does not invalidate this user AI result',async()=>{
 const {t,pair}=await fixture();const old=await delayed(t,pair.A,'Brain fog today at 9am.');
 clock=start+1000;await seed(t,pair.B);clock=start+2000;old.wait.finish({object:record});const result=await old.running;
 expect(result.outcome).toBe('stored');expect(result.view.records).toHaveLength(1);expect(result.view.sevenDayCount).toBe(1);
});
test('a same-clock correction and a pause/resume cycle cannot hide an intervening change',async()=>{
 const {t,pair}=await fixture();const seeded=await seed(t,pair.A);const old=await delayed(t,pair.A,'Actually that happened yesterday, not today.',seeded.changedIds[0]);
 generateObject.mockResolvedValueOnce({object:{...correction,datePhrase:'8 days ago'}});
 await t.action(api.messages.send,{token:pair.A,messageId:'same-clock',text:'Actually that happened 8 days ago.',targetId:seeded.changedIds[0]});
 old.wait.finish({object:correction});expect((await old.running).outcome).toBe('dropped');
 const later=await delayed(t,pair.A,'Brain fog today at 9am.',undefined,'later');
 await t.action(api.messages.send,{token:pair.A,messageId:'pause',text:'Pause'});await t.action(api.messages.send,{token:pair.A,messageId:'resume',text:'Resume'});
 later.wait.finish({object:record});const result=await later.running;
 expect(result.outcome).toBe('dropped');expect(result.view.user.state).toBe('active');expect(result.view.records).toHaveLength(1);expect(result.view.records[0].occurrenceDate).toBe('2026-09-26');
});
