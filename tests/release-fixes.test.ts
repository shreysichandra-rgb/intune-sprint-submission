import {test,expect,vi,beforeEach,afterEach} from 'vitest';
import {convexTest} from 'convex-test';
import schema from '../convex/schema';
import {api,internal} from '../convex/_generated/api';
import * as copy from '../convex/copy';
const generateObject=vi.hoisted(()=>vi.fn());
vi.mock('@convex-dev/agent',()=>({Agent:class{generateObject=generateObject;}}));
const modules=import.meta.glob('../convex/**/*.*s');
const now=Date.parse('2026-10-06T10:00:00+05:30');
const record={intent:'record',trackedItem:'brain fog',count:1,datePhrase:'today',timePhrase:null,precision:'date-only',target:null,explicitNew:false,activity:null,targetNumber:null,completionStatus:null};
beforeEach(()=>{vi.spyOn(Date,'now').mockReturnValue(now);vi.stubEnv('OPENAI_API_KEY','synthetic');generateObject.mockReset();vi.spyOn(console,'info').mockImplementation(()=>{});});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs();});
async function setup(){const t=convexTest(schema,modules),pair=await t.mutation(api.tracking.createTestPair,{});return {t,pair,send:(text:string,id=crypto.randomUUID(),token=pair.A)=>t.action(api.messages.send,{token,messageId:id,text})};}
test('first greeting is exact approved introduction; repeat delivery is stable; later greeting is short and user-specific',async()=>{
 const f=await setup();vi.stubEnv('OPENAI_API_KEY','');const first=await f.send('Hi','first');expect(first.message).toBe('Hi 👋\n\nPerimenopause has enough surprises. I’m InTune. Tell me what showed up and what you got done. I’ll keep track.\n\nSymptoms, workouts, whatever you’re keeping track of this week. Tell me as it happens. I’ll remember it and keep count.\n\nText me like you’d text a friend. I save what you tell me, and you can delete it anytime.\n\nWhat should we keep track of this week?');const repeated=await f.send('Hi','first');expect(repeated.message).toBe(first.message);expect(repeated.outcome).toBe('provider_duplicate');expect((await f.send('Hi')).message).toBe(copy.returningGreetingReply);expect((await f.send('Hi','b',f.pair.B)).message).toBe(first.message);expect((await f.t.query(api.tracking.getSummary,{token:f.pair.A})).records).toEqual([]);expect(generateObject).not.toHaveBeenCalled();
});
test('multiple duplicates offer numbered updates; selected same resolves only one without counting or exposing IDs',async()=>{
 const f=await setup();generateObject.mockResolvedValue({object:record});await f.send('brain fog today');await f.send('brain fog today');await f.send('brain fog today');const view=await f.t.query(api.tracking.getSummary,{token:f.pair.A});const r=await f.send('same');expect(r.message).toContain('1. brain fog today');expect(r.message).toContain('2. brain fog today');expect(r.message).not.toContain('question ID');for(const p of view.pending)expect(r.message).not.toContain(p._id);
 await f.send('1 same');const after=await f.t.query(api.tracking.getSummary,{token:f.pair.A});expect(after.records).toHaveLength(1);expect(after.pending).toHaveLength(1);await f.send('same');expect((await f.t.query(api.tracking.getSummary,{token:f.pair.A})).pending).toHaveLength(0);
});
test('numbered date selection retains the other pending update and isolates user B',async()=>{
 const f=await setup();generateObject.mockResolvedValueOnce({object:{...record,datePhrase:null}});await f.send('brain fog');generateObject.mockResolvedValueOnce({object:{...record,trackedItem:'poor sleep',datePhrase:null}});await f.send('poor sleep');const r=await f.send('today');expect(r.message).toContain('1. brain fog');expect(r.message).toContain('2. poor sleep');await f.send('2 today');const view=await f.t.query(api.tracking.getSummary,{token:f.pair.A});expect(view.records[0].trackedItem).toBe('poor sleep');expect(view.pending).toHaveLength(1);expect(view.pending[0].rawText).toBe('brain fog');expect((await f.t.query(api.tracking.getSummary,{token:f.pair.B})).records).toEqual([]);
});
test('saved-update limit returns catalogue copy without internal/test wording',async()=>{
 const f=await setup();await f.t.run(async ctx=>{const u=(await ctx.db.query('users').withIndex('by_token',q=>q.eq('token',f.pair.A)).unique())!;for(let i=0;i<250;i++)await ctx.db.insert('occurrences',{userId:u._id,jobId:u.jobId,trackedItem:'brain fog',rawText:'synthetic',occurrenceDate:'2026-10-06',occurrenceTime:null,timePrecision:'date-only',messageReceivedAt:now,source:'user',status:'active',confirmationState:'confirmed',batchId:'synthetic-'+i});});generateObject.mockResolvedValue({object:{...record,explicitNew:true}});expect((await f.send('brain fog again today')).message).toBe('I can’t save another update right now.');expect((await f.t.query(api.tracking.getSummary,{token:f.pair.A})).records).toHaveLength(250);
});

test('legacy greeting receipt receives short greeting without rewriting old records',async()=>{
 const f=await setup();await f.t.run(async ctx=>{const user=(await ctx.db.query('users').withIndex('by_token',q=>q.eq('token',f.pair.A)).unique())!;await ctx.db.insert('receipts',{userId:user._id,messageId:'legacy',state:'complete',replyEntry:'greetingReply'});});expect((await f.send('Hi')).message).toBe(copy.returningGreetingReply);
});

test('real phone user has no test symptom defaults; model cannot save an unchosen symptom; web fixtures stay unchanged',async()=>{
 const f=await setup();const token=await f.t.mutation(internal.phoneUsers.getOrCreate,{phoneNumber:'+12025550188'});expect((await f.t.query(api.tracking.getSummary,{token})).user.trackedItems).toEqual([]);expect((await f.t.query(api.tracking.getSummary,{token:f.pair.A})).user.trackedItems).toEqual(['brain fog','poor sleep']);generateObject.mockResolvedValueOnce({object:record});await f.send('brain fog today',undefined,token);expect((await f.t.query(api.tracking.getSummary,{token})).records).toEqual([]);
});
test('contradictory AI classification cannot turn a standalone workout into a symptom or symptom into completion',async()=>{
 const f=await setup();await f.send('Track my workouts?');await f.send('3');await f.send('yes');generateObject.mockResolvedValueOnce({object:record});await f.send('Workout done today');expect((await f.t.query(api.tracking.getSummary,{token:f.pair.A})).records).toEqual([]);
 generateObject.mockResolvedValueOnce({object:{...record,intent:'plan_complete',trackedItem:null,count:null,activity:'workouts'}});await f.send('brain fog today');expect((await f.t.query(api.plans.getPlan,{token:f.pair.A})).records).toEqual([]);
});
