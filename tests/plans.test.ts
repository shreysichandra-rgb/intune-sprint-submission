import {test,expect,vi,beforeEach,afterEach} from 'vitest';
import {convexTest} from 'convex-test';
import schema from '../convex/schema';
import {api,internal} from '../convex/_generated/api';
const generateObject=vi.hoisted(()=>vi.fn());
vi.mock('@convex-dev/agent',()=>({Agent:class{generateObject=generateObject;}}));
const modules=import.meta.glob('../convex/**/*.*s');
const now=Date.parse('2026-10-05T10:00:00+05:30');
const base={trackedItem:null,count:null,datePhrase:null,timePhrase:null,precision:'date-only',target:null,explicitNew:false,activity:'strength train',targetNumber:null,completionStatus:null};
const proposal={...base,intent:'plan_proposal',targetNumber:3};
const complete={...base,intent:'plan_complete',datePhrase:'today'};
beforeEach(()=>{vi.spyOn(Date,'now').mockReturnValue(now);vi.stubEnv('OPENAI_API_KEY','test-placeholder');generateObject.mockReset();});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs();});
async function fixture(){const t=convexTest(schema,modules);const pair=await t.mutation(api.tracking.createTestPair,{});const send=async(text:string,meaning:any,token=pair.A,extra:any={})=>{generateObject.mockResolvedValueOnce({object:meaning});return t.action(api.messages.send,{token,messageId:crypto.randomUUID(),text,...extra});};return {t,pair,send};}
async function setup(f:any){const r=await f.send('strength train 3 times this week',proposal);return f.t.mutation(api.plans.resolve,{token:f.pair.A,pendingId:r.pendingId,choice:'confirm'});}
test('typed plan is repeated and confirmed before saving; completions and date correction keep one truth and no occurrences',async()=>{
 const f=await fixture();const draft=await f.send('strength train 3 times this week',proposal);expect(draft.message).toContain('strength train');expect(draft.message).toContain('3');expect(draft.planView.plan).toBeNull();
 const confirmed=await f.t.mutation(api.plans.resolve,{token:f.pair.A,pendingId:draft.pendingId,choice:'confirm'});expect(confirmed.planView.progress).toBe('0/3');
 const first=await f.send('did my strength session today',complete);expect(first.planView.progress).toBe('1/3');
 const correction=await f.send('that was yesterday',{...base,intent:'plan_correct',datePhrase:'yesterday',target:'latest'});expect(correction.planView.records).toHaveLength(1);expect(correction.planView.records[0]._id).toBe(first.changedIds[0]);expect(correction.planView.dates).toEqual(['2026-10-04']);
 await f.send('did another strength session today',{...complete,explicitNew:true});const third=await f.send('did another strength session today',{...complete,explicitNew:true});expect(third.planView.progress).toBe('3/3');
 const skipped=await f.send('I actually skipped it',{...base,intent:'plan_correct',completionStatus:'skipped',target:'latest'});expect(skipped.planView.progress).toBe('2/3');expect(skipped.planView.records).toHaveLength(3);
 expect((await f.t.query(api.tracking.getSummary,{token:f.pair.A})).records).toEqual([]);
});
test('second active plan and unconfirmed completions are not saved; B sees no A plan',async()=>{
 const f=await fixture();const before=await f.send('did my strength session today',complete);expect(before.outcome).toBe('no_plan');await setup(f);
 const second=await f.send('walk 4 times this week',{...proposal,activity:'walk',targetNumber:4});expect(second.outcome).toBe('plan_exists');expect(second.planView.plan.activity).toBe('strength train');
 vi.stubEnv('OPENAI_API_KEY','');const b=await f.t.action(api.messages.send,{token:f.pair.B,messageId:'summary',text:'how is my plan going?'});expect(b.outcome).toBe('no_plan');expect(b.planView.plan).toBeNull();expect(b.planView.records).toEqual([]);
 const weekly=await f.t.action(api.messages.send,{token:f.pair.A,messageId:'week',text:'What have I told you this week?'});expect(weekly.message).not.toContain('strength');expect(weekly.view.records).toEqual([]);
});
test('Stop closes plan and blocks confirmations and completions; Start has no carried plan; Delete erases own plan copies only',async()=>{
 const f=await fixture();await setup(f);await f.send('did my strength session today',complete);
 const stop=await f.t.action(api.messages.send,{token:f.pair.A,messageId:'stop',text:'Stop'});expect(stop.outcome).toBe('stopped');const closed=await f.t.query(api.plans.getPlan,{token:f.pair.A});expect(closed.plan.state).toBe('closed');expect(closed.records).toHaveLength(1);
 const blocked=await f.t.action(api.messages.send,{token:f.pair.A,messageId:'blocked',text:'did my strength session today'});expect(blocked.outcome).toBe('stopped');
 await f.t.action(api.messages.send,{token:f.pair.A,messageId:'start',text:'Start'});expect((await f.t.query(api.plans.getPlan,{token:f.pair.A})).plan).toBeNull();
 const bDraft=await f.send('strength train 3 times this week',proposal,f.pair.B);await f.t.mutation(api.plans.resolve,{token:f.pair.B,pendingId:bDraft.pendingId,choice:'confirm'});
 await f.t.action(api.messages.send,{token:f.pair.A,messageId:'delete',text:'Delete my pilot data'});
 await f.t.run(async(ctx:any)=>{const a=await ctx.db.query('users').withIndex('by_token',(q:any)=>q.eq('token',f.pair.A)).unique();for(const table of ['plans','planCompletions','planPending'])expect(await ctx.db.query(table).withIndex('by_user',(q:any)=>q.eq('userId',a._id)).collect()).toEqual([]);});expect((await f.t.query(api.plans.getPlan,{token:f.pair.B})).plan).not.toBeNull();
});
test('missing completion date asks and delayed answer uses original received time; correction outside window changes count',async()=>{
 const f=await fixture();await setup(f);const missing=await f.send('did my strength session',{...complete,datePhrase:null});expect(missing.outcome).toBe('plan_clarification');expect(missing.planView.count).toBe(0);
 vi.mocked(Date.now).mockReturnValue(now+86400000);const resolved=await f.t.mutation(api.plans.resolve,{token:f.pair.A,pendingId:missing.pendingId,choice:'confirm',datePhrase:'yesterday'});expect(resolved.planView.dates).toEqual(['2026-10-04']);expect(resolved.planView.records[0].messageReceivedAt).toBe(now);
 const corrected=await f.send('that was 8 days ago',{...base,intent:'plan_correct',datePhrase:'8 days ago',target:'latest'});expect(corrected.planView.count).toBe(0);expect(corrected.planView.records).toHaveLength(1);
});
test('duplicate delivery and repeated completion are not silently counted',async()=>{
 const f=await fixture();await setup(f);generateObject.mockResolvedValue({object:complete});const args={token:f.pair.A,messageId:'same-id',text:'did my strength session today'};
 const first=await f.t.action(api.messages.send,args);const repeat=await f.t.action(api.messages.send,args);expect(repeat.outcome).toBe('provider_duplicate');expect((await f.t.query(api.plans.getPlan,{token:f.pair.A})).count).toBe(1);
 const possible=await f.send(args.text,complete);expect(possible.outcome).toBe('plan_duplicate');expect(possible.planView.count).toBe(1);
 const same=await f.t.mutation(api.plans.resolve,{token:f.pair.A,pendingId:possible.pendingId,choice:'same'});expect(same.planView.count).toBe(1);expect(same.planView.records[0]._id).toBe(first.changedIds[0]);
});
test('cross-user completion and pending identifiers are rejected without changes',async()=>{
 const f=await fixture();const draft=await f.send('strength train 3 times this week',proposal);await expect(f.t.mutation(api.plans.resolve,{token:f.pair.B,pendingId:draft.pendingId,choice:'confirm'})).rejects.toThrow();await f.t.mutation(api.plans.resolve,{token:f.pair.A,pendingId:draft.pendingId,choice:'confirm'});const first=await f.send('did my strength session today',complete);
 const b=await f.send('that was yesterday',{...base,intent:'plan_correct',datePhrase:'yesterday'},f.pair.B,{completionTargetId:first.changedIds[0]});expect(b.outcome).not.toBe('plan_corrected');expect((await f.t.query(api.plans.getPlan,{token:f.pair.A})).dates).toEqual(['2026-10-05']);
});
test('late AI completion after Delete is dropped and cannot restore plan content',async()=>{
 const f=await fixture();await setup(f);let finish!:(v:any)=>void;let began!:()=>void;const started=new Promise<void>(r=>began=r);generateObject.mockImplementationOnce(()=>{began();return new Promise(r=>finish=r);});
 const running=f.t.action(api.messages.send,{token:f.pair.A,messageId:'slow',text:'did my strength session today'});await started;await f.t.action(api.messages.send,{token:f.pair.A,messageId:'delete',text:'Delete my pilot data'});finish({object:complete});expect((await running).outcome).toBe('dropped');expect((await f.t.query(api.plans.getPlan,{token:f.pair.A})).records).toEqual([]);
});

test('plain code recognises another session even when AI misses the explicit-new flag',async()=>{
 const f=await fixture();await setup(f);await f.send('did my strength session today',complete);const next=await f.send('did another strength session today',complete);expect(next.outcome).toBe('plan_completed');expect(next.planView.progress).toBe('2/3');
});

test('Stop rejects an unconfirmed plan and malformed extracted target cannot become a plan',async()=>{
 const f=await fixture();const invalid=await f.send('strength train 3 times this week',{...proposal,targetNumber:99});expect(invalid.outcome).toBe('plan_clarification');expect(invalid.planView.pending.filter((p:any)=>p.kind==='confirmation')).toEqual([]);expect(invalid.planView.pending[0].kind).toBe('clarification');
 const draft=await f.send('strength train 3 times this week',proposal);await f.t.action(api.messages.send,{token:f.pair.A,messageId:'stop',text:'Stop'});const confirm=await f.t.mutation(api.plans.resolve,{token:f.pair.A,pendingId:draft.pendingId,choice:'confirm'});expect(confirm.outcome).toBe('stopped');expect(confirm.planView.plan).toBeNull();
});
test('body changes and weekly retrieval remain separate while a plan is active',async()=>{
 const f=await fixture();await setup(f);await f.send('did my strength session today',complete);const record=await f.send('Brain fog today',{intent:'record',trackedItem:'brain fog',count:1,datePhrase:'today',timePhrase:null,precision:'date-only',target:null,explicitNew:false});expect(record.view.sevenDayCount).toBe(1);const week=await f.t.action(api.messages.send,{token:f.pair.A,messageId:'week',text:'What have I told you this week?'});expect(week.message).toContain('brain fog');expect(week.message).not.toContain('strength');expect((await f.t.query(api.plans.getPlan,{token:f.pair.A})).progress).toBe('1/3');
});
