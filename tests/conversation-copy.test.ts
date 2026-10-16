import {test,expect,vi,beforeEach,afterEach} from 'vitest';
import {convexTest} from 'convex-test';
import schema from '../convex/schema';
import {api,internal} from '../convex/_generated/api';
import {readFileSync,writeFileSync} from 'node:fs';
const generateObject=vi.hoisted(()=>vi.fn());
vi.mock('@convex-dev/agent',()=>({Agent:class{generateObject=generateObject;}}));
const modules=import.meta.glob('../convex/**/*.*s');
const now=Date.parse('2026-10-06T10:00:00+05:30');
const base={intent:'record',trackedItem:'brain fog',count:1,datePhrase:'today',timePhrase:null,precision:'date-only',target:null,explicitNew:false,activity:null,targetNumber:null,completionStatus:null};
beforeEach(()=>{vi.spyOn(Date,'now').mockReturnValue(now);vi.stubEnv('OPENAI_API_KEY','fictional-placeholder');generateObject.mockReset();});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs();});
async function fixture(){const t=convexTest(schema,modules);const pair=await t.mutation(api.tracking.createTestPair,{});const send=async(text:string,meaning:any=base,token=pair.A)=>{generateObject.mockResolvedValueOnce({object:meaning});return t.action(api.messages.send,{token,messageId:crypto.randomUUID(),text});};return {t,pair,send};}
test('symptom confirmations identify saved dates and times, show useful multiple counts, and do not celebrate poor sleep',async()=>{
 const f=await fixture();const first=await f.send('Brain fog today around 9am',{...base,timePhrase:'9am',precision:'approximate'});
 expect(first.message).toBe('Got it, brain fog today around 9am.');expect(first.message).not.toMatch(/\b1\b|count|occurrence/i);expect(first.view.sevenDayCount).toBe(1);
 const twice=await f.send('Brain fog twice yesterday',{...base,count:2,datePhrase:'yesterday'});expect(twice.message).toBe('Got it, brain fog twice yesterday.');expect(twice.view.sevenDayCount).toBe(3);
 const sleep=await f.send('Poor sleep last night',{...base,trackedItem:'poor sleep',datePhrase:'last night'},f.pair.B);expect(sleep.message).toBe('Ugh, that’s rough 😕 Got it, poor sleep today.');expect(sleep.message).not.toMatch(/great|nice|well done/i);
 writeFileSync('/tmp/intune-representative-replies.json',JSON.stringify({symptom:first.message,multiple:twice.message,poorSleep:sleep.message},null,2));
});
test('duplicates and date questions ask one question without counting; correction and forget preserve the same record rules',async()=>{
 const f=await fixture();const first=await f.send('Brain fog today');const duplicate=await f.send('Brain fog today');expect(duplicate.message).toBe('Was that the same episode as earlier or a new one? I haven’t counted it again yet.');expect(duplicate.view.sevenDayCount).toBe(1);
 const same=await f.t.mutation(api.tracking.resolvePending,{token:f.pair.A,pendingId:duplicate.pendingId,choice:'same'});expect(same.message).toBe('Got it, the same episode. I haven’t counted it again.');expect(same.view.records).toHaveLength(1);
 const question=await f.send('Brain fog at 4pm',{...base,datePhrase:null,timePhrase:'4pm',precision:'exact'});expect(question.message.match(/\?/g)).toHaveLength(1);expect(question.message).not.toContain('earlier today');expect(question.view.sevenDayCount).toBe(1);
 await f.t.mutation(api.tracking.resolvePending,{token:f.pair.A,pendingId:question.pendingId,choice:'discard'});
 const correction=await f.send('Actually that happened 8 days ago',{...base,intent:'correct',trackedItem:null,count:null,datePhrase:'8 days ago',target:'latest'});expect(correction.message).toBe('Ah yes, brain fog on 28 September. Corrected 👍 It’s outside this seven-day period.');expect(correction.view.totalStored).toBe(1);expect(correction.view.sevenDayCount).toBe(0);expect(correction.changedIds).toEqual(first.changedIds);
 const forgotten=await f.t.mutation(api.tracking.forget,{token:f.pair.A,occurrenceId:first.changedIds[0]});expect(forgotten.view.records).toEqual([]);expect(forgotten.message).toBe('Done 👍 That episode is gone. I won’t count it or include it in your summary.');
});
test('plan confirmation, completion and skip correction confirm the activity and keep progress visible without another record',async()=>{
 const f=await fixture();const plan={...base,intent:'plan_proposal',trackedItem:null,count:null,datePhrase:null,activity:'strength train',targetNumber:3};const draft=await f.send('strength train 3 times this week',plan);
 expect(draft.message).toBe('strength train, 3 times this week. Have I got that right? Say yes to save it, or no to leave it unsaved.');expect(draft.message.match(/\?/g)).toHaveLength(1);expect(draft.planView.plan).toBeNull();
 const yes=await f.t.action(api.messages.send,{token:f.pair.A,messageId:'yes',text:'yes'});expect(yes.message).toBe('Got it 👍 Your plan is strength train, 3 times this week. You’re starting at 0/3.');
 const completion={...plan,intent:'plan_complete',targetNumber:null,datePhrase:'today'};const done=await f.send('did my strength session today',completion);expect(done.message).toBe('Nice 💪 I’ve got that for today. You’re at 1/3 this week.');
 const skipped=await f.send('I actually skipped it',{...completion,intent:'plan_correct',datePhrase:null,completionStatus:'skipped',target:'latest'});expect(skipped.message).toBe('Got it, corrected 👍 strength train for today marked as skipped. You’re at 0/3 this week.');expect(skipped.changedIds).toEqual(done.changedIds);expect(skipped.planView.records).toHaveLength(1);expect((await f.t.query(api.tracking.getSummary,{token:f.pair.A})).records).toEqual([]);
});
test('retrieval is factual and user-owned; Pause drops queued output while controls remain independent of AI',async()=>{
 const f=await fixture();await f.send('Brain fog twice yesterday',{...base,count:2,datePhrase:'yesterday'});vi.stubEnv('OPENAI_API_KEY','');
 const a=await f.t.action(api.messages.send,{token:f.pair.A,messageId:'a-week',text:'What have I told you this week?'});expect(a.message).toBe('Here’s what you told me over the last 7 days (30 September to 6 October):\nbrain fog: 2 times: yesterday; yesterday.');
 const b=await f.t.action(api.messages.send,{token:f.pair.B,messageId:'b-week',text:'What have I told you this week?'});expect(b.message).not.toContain('brain fog');
 const output=await f.t.run(async ctx=>{const u=await ctx.db.query('users').withIndex('by_token',q=>q.eq('token',f.pair.A)).unique();return ctx.db.insert('proactiveOutputs',{userId:u!._id,jobId:u!.jobId,kind:'summary',status:'queued',body:'fictional summary'});});
 const pause=await f.t.action(api.messages.send,{token:f.pair.A,messageId:'pause',text:'Pause'});expect(pause.message).toBe('Of course. I’ll stay quiet for now, but I’ll still keep track when you message me.');expect(await f.t.query(internal.commands.deliveryPermitted,{outputId:output})).toBe(false);expect(pause.view.sevenDayCount).toBe(2);
 const stop=await f.t.action(api.messages.send,{token:f.pair.A,messageId:'stop',text:'Stop'});expect(stop.message).toContain('Your earlier records are still there');expect(stop.view.sevenDayCount).toBe(2);
 const del=await f.t.action(api.messages.send,{token:f.pair.A,messageId:'delete',text:'Delete my pilot data'});expect(del.message).toBe('Your health records have been deleted. Your phone number and service records remain. All proactive messages are stopped.');expect(del.view.records).toEqual([]);
 for(const path of ['public/privacy.html','public/data-deletion.html'])expect(readFileSync(path,'utf8')).toContain(del.message);
});
test('Done remains on the interpretation path and an undated completion still asks before counting',async()=>{
 const f=await fixture();const plan={...base,intent:'plan_proposal',trackedItem:null,count:null,datePhrase:null,activity:'strength train',targetNumber:3};const draft=await f.send('strength train 3 times this week',plan);await f.t.mutation(api.plans.resolve,{token:f.pair.A,pendingId:draft.pendingId,choice:'confirm'});
 const done=await f.send('Done',{...plan,intent:'plan_complete',targetNumber:null});expect(done.outcome).toBe('plan_clarification');expect(done.message).toBe('Which day was that? You can say today, yesterday or 2 days ago. I haven’t counted it yet.');expect(done.planView.count).toBe(0);expect(done.planView.records).toEqual([]);expect(generateObject).toHaveBeenCalledTimes(2);
});

test('generated punctuation stays plain while original messages and plan activity retain user punctuation',async()=>{
 const f=await fixture();const input='Brain fog today — around 9am';
 const record=await f.send(input,{...base,timePhrase:'9am',precision:'approximate'});
 expect(record.message).toBe('Got it, brain fog today around 9am.');
 expect(record.message).not.toMatch(/[–—]/);expect(record.view.records[0].rawText).toBe(input);
 const activity='strength-train — gently';const raw=`${activity} 3 times this week`;
 const draft=await f.send(raw,{...base,intent:'plan_proposal',trackedItem:null,count:null,datePhrase:null,activity,targetNumber:3});
 expect(draft.message).toContain(activity);
 const confirmed=await f.t.action(api.messages.send,{token:f.pair.A,messageId:'punctuation-yes',text:'yes'});
 expect(confirmed.planView.plan.rawText).toBe(raw);expect(confirmed.planView.plan.activity).toBe(activity);expect(confirmed.planView.count).toBe(0);
});
