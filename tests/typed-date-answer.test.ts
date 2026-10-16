import {test,expect,vi,beforeEach,afterEach} from 'vitest';
import {convexTest} from 'convex-test';
import schema from '../convex/schema';
import {api} from '../convex/_generated/api';
const generateObject=vi.hoisted(()=>vi.fn());
vi.mock('@convex-dev/agent',()=>({Agent:class{generateObject=generateObject;}}));
const modules=import.meta.glob('../convex/**/*.*s');
const base={intent:'plan_complete',trackedItem:null,count:null,datePhrase:null,timePhrase:null,precision:'date-only',target:null,explicitNew:false,activity:'strength train',targetNumber:null,completionStatus:null};
let now:number;
beforeEach(()=>{now=Date.parse('2026-10-06T10:00:00+05:30');vi.spyOn(Date,'now').mockImplementation(()=>now);vi.stubEnv('OPENAI_API_KEY','fictional');generateObject.mockReset();});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs();});
async function setup(){const t=convexTest(schema,modules),pair=await t.mutation(api.tracking.createTestPair,{});generateObject.mockResolvedValueOnce({object:{...base,intent:'plan_proposal',targetNumber:3}});await t.action(api.messages.send,{token:pair.A,messageId:'draft',text:'strength train 3 times this week'});await t.action(api.messages.send,{token:pair.A,messageId:'yes',text:'yes'});return {t,pair,send:(text:string,id=crypto.randomUUID(),token=pair.A)=>t.action(api.messages.send,{token,messageId:id,text})};}
test.each([['today','2026-10-06'],['yesterday actually','2026-10-05'],['today morning','2026-10-06'],['2 days ago','2026-10-04']])('done then typed %s resolves once',async(answer,date)=>{
 const f=await setup();generateObject.mockResolvedValueOnce({object:base});const question=await f.send('done');expect(question.planView.pending).toHaveLength(1);expect(question.planView.count).toBe(0);
 const reply=await f.send(answer);expect(reply.outcome).toBe('plan_completed');expect(reply.planView.count).toBe(1);expect(reply.planView.records[0].completionDate).toBe(date);expect(reply.planView.pending).toEqual([]);expect(reply.message).toContain('1/3');expect((await f.t.query(api.tracking.getSummary,{token:f.pair.A})).records).toEqual([]);expect(generateObject).toHaveBeenCalledTimes(2);
});
test('Brain fog then this morning records one symptom without inventing a time',async()=>{
 const f=await setup();generateObject.mockResolvedValueOnce({object:{...base,intent:'record',activity:null,trackedItem:'brain fog',count:1}});await f.send('Brain fog');const r=await f.send('this morning');expect(r.outcome).toBe('stored');expect(r.view.sevenDayCount).toBe(1);expect(r.view.records[0].occurrenceDate).toBe('2026-10-06');expect(r.view.records[0].occurrenceTime).toBeNull();expect(r.view.records[0].rawText).toBe('Brain fog');expect(r.view.pending).toEqual([]);expect(r.message).toContain('recorded 1');
});
test('done then today delivered twice counts once, including simultaneous replies',async()=>{
 const f=await setup();generateObject.mockResolvedValueOnce({object:base});await f.send('done');const replies=await Promise.all([f.send('today','answer'),f.send('today','answer')]);expect(replies.map(r=>r.outcome).sort()).toEqual(['plan_completed','provider_duplicate']);const view=await f.t.query(api.plans.getPlan,{token:f.pair.A});expect(view.count).toBe(1);expect(view.records).toHaveLength(1);expect(view.pending).toEqual([]);expect((await f.t.query(api.tracking.getSummary,{token:f.pair.A})).records).toEqual([]);
});
test('non-date keeps pending; midnight answer uses original time; other user cannot resolve it',async()=>{
 const f=await setup();generateObject.mockResolvedValueOnce({object:base});const q=await f.send('done');generateObject.mockResolvedValueOnce({object:{...base,intent:'clarify',activity:null}});const r=await f.send('not sure');expect(r.message).not.toBe(q.message);expect((await f.t.query(api.plans.getPlan,{token:f.pair.A})).pending[0]._id).toBe(q.pendingId);
 now=Date.parse('2026-10-07T00:01:00+05:30');const done=await f.send('today');expect(done.planView.records[0].completionDate).toBe('2026-10-06');expect(done.planView.records[0].messageReceivedAt).toBe(q.messageReceivedAt);
 generateObject.mockResolvedValueOnce({object:{...base,intent:'clarify',activity:null}});const b=await f.send('today','b',f.pair.B);expect(b.outcome).toBe('clarification');expect((await f.t.query(api.plans.getPlan,{token:f.pair.B})).count).toBe(0);
});
test('time-only answer uses the original clock, and another today with a new delivery ID cannot count again',async()=>{
 const f=await setup();generateObject.mockResolvedValueOnce({object:{...base,intent:'record',activity:null,trackedItem:'brain fog',count:1}});await f.send('Brain fog');const clock=await f.send('9am');expect(clock.view.records[0].occurrenceTime).toBe('09:00');expect(clock.view.records[0].timePrecision).toBe('exact');
 generateObject.mockResolvedValueOnce({object:base});await f.send('done');await f.send('today');generateObject.mockResolvedValueOnce({object:{...base,intent:'clarify',activity:null}});await f.send('today');const plan=await f.t.query(api.plans.getPlan,{token:f.pair.A});expect(plan.count).toBe(1);expect(plan.records).toHaveLength(1);
});

test('unusable dates keep the same pending question and save no completion or symptom',async()=>{
 const f=await setup();generateObject.mockResolvedValueOnce({object:base});const q=await f.send('done');
 for(const answer of ['2026-02-30','2026-10-08','not sure']){
  generateObject.mockResolvedValueOnce({object:{...base,intent:'clarify',activity:null}});
  const reply=await f.send(answer);expect(reply.outcome).toBe('clarification');expect(['What would you like me to keep track of this week?', 'Tell me what you’d like me to keep track of. ‘Brain fog today’ or ‘strength training 3 times this week’ is enough.']).toContain(reply.message);
  const view=await f.t.query(api.plans.getPlan,{token:f.pair.A});expect(view.pending).toHaveLength(1);expect(view.pending[0]._id).toBe(q.pendingId);expect(view.count).toBe(0);expect(view.records).toEqual([]);
  expect((await f.t.query(api.tracking.getSummary,{token:f.pair.A})).records).toEqual([]);
 }
 expect(generateObject).toHaveBeenCalledTimes(5);
});

test('plan, yes, done, current-plan question, today preserves the pending question then reaches 1/3',async()=>{
 const f=await setup();generateObject.mockResolvedValueOnce({object:base});await f.send('done');
 const before=await f.t.query(api.plans.getPlan,{token:f.pair.A});expect(before.count).toBe(0);expect(before.pending).toHaveLength(1);
 for(const question of ["what's my current plan?",'How is my plan going?',"What's my progress?",'What have I told you this week?',"Show me this week's records"]){
  const reply=await f.send(question);
  if(question.toLowerCase().includes('week'))expect(reply.outcome).toBe('summary');
  else {expect(reply.outcome).toBe('plan_summary');expect(reply.message).toContain('strength train, 3 times this week. You’re at 0/3.');}
  expect(await f.t.query(api.plans.getPlan,{token:f.pair.A})).toEqual(before);
 }
 expect(generateObject).toHaveBeenCalledTimes(2);
 const answer=await f.send('today');expect(answer.planView.count).toBe(1);expect(answer.planView.progress).toBe('1/3');expect(answer.planView.records).toHaveLength(1);expect(answer.planView.pending).toEqual([]);expect((await f.t.query(api.tracking.getSummary,{token:f.pair.A})).records).toEqual([]);
});
test('unrelated messages use normal interpretation rather than repeat the pending date question',async()=>{
 const f=await setup();generateObject.mockResolvedValueOnce({object:base});const question=await f.send('done');
 const before=(await f.t.query(api.plans.getPlan,{token:f.pair.A})).pending;
 generateObject.mockResolvedValueOnce({object:{...base,intent:'clarify',activity:null}});const unrelated=await f.send('not sure about this');
 expect(generateObject).toHaveBeenCalledTimes(3);expect(unrelated.message).not.toBe(question.message);expect((await f.t.query(api.plans.getPlan,{token:f.pair.A})).pending).toEqual(before);
 const completed=await f.send('today');expect(completed.planView.progress).toBe('1/3');expect(completed.planView.records).toHaveLength(1);expect(completed.planView.pending).toEqual([]);
});

test.each(['same','the same one','same session'])('duplicate session accepts typed %s without counting again',async answer=>{
 const f=await setup();generateObject.mockResolvedValueOnce({object:{...base,datePhrase:'today'}});await f.send('done today');generateObject.mockResolvedValueOnce({object:{...base,datePhrase:'today'}});await f.send('done today');const r=await f.send(answer);expect(r.outcome).toBe('reference');expect(r.planView.count).toBe(1);expect(r.planView.pending).toEqual([]);expect((await f.t.query(api.tracking.getSummary,{token:f.pair.A})).records).toEqual([]);
});
test.each(['another','a new one','another session'])('duplicate session accepts typed %s once',async answer=>{
 const f=await setup();generateObject.mockResolvedValueOnce({object:{...base,datePhrase:'today'}});await f.send('done today');generateObject.mockResolvedValueOnce({object:{...base,datePhrase:'today'}});await f.send('done today');const r=await f.send(answer,'choice');expect(r.planView.progress).toBe('2/3');expect(r.planView.pending).toEqual([]);await f.send(answer,'choice');expect((await f.t.query(api.plans.getPlan,{token:f.pair.A})).count).toBe(2);expect((await f.t.query(api.tracking.getSummary,{token:f.pair.A})).records).toEqual([]);
});
test('done, today, today, another reaches 2/3 only after confirming another session',async()=>{
 const f=await setup();generateObject.mockResolvedValueOnce({object:base});await f.send('done');expect((await f.send('today')).planView.progress).toBe('1/3');const duplicate=await f.send('today');expect(duplicate.outcome).toBe('plan_duplicate');expect(duplicate.planView.progress).toBe('1/3');const newSession=await f.send('another');expect(newSession.planView.progress).toBe('2/3');expect(newSession.planView.records).toHaveLength(2);expect(newSession.planView.pending).toEqual([]);expect((await f.t.query(api.tracking.getSummary,{token:f.pair.A})).records).toEqual([]);
});
test.each(['same','another','the same one','a new one'])('duplicate symptom accepts typed %s',async answer=>{
 const f=await setup(),record={...base,intent:'record',trackedItem:'brain fog',count:1,activity:null,datePhrase:'today'};generateObject.mockResolvedValueOnce({object:record});await f.send('Brain fog today');generateObject.mockResolvedValueOnce({object:record});await f.send('Brain fog today');const r=await f.send(answer);expect(r.view.sevenDayCount).toBe(['same','the same one'].includes(answer)?1:2);expect(r.view.pending).toEqual([]);
});
test.each(['brain fog','poor sleep'])('which tracked change accepts typed %s using shared resolver',async item=>{
 const f=await setup();generateObject.mockResolvedValueOnce({object:{...base,intent:'record',trackedItem:null,count:1,activity:null,datePhrase:'today'}});const question=await f.send('It happened today');expect(question.message).toContain('Which one should I keep track of');const r=await f.send(item);expect(r.view.records).toHaveLength(1);expect(r.view.records[0].trackedItem).toBe(item);expect(r.view.pending).toEqual([]);
});
test.each(['reference','correct'])('which earlier episode for %s accepts a unique tracked change',async intent=>{
 const f=await setup();for(const item of ['brain fog','poor sleep']){generateObject.mockResolvedValueOnce({object:{...base,intent:'record',activity:null,trackedItem:item,count:1,datePhrase:'today'}});await f.send(`${item} today`);}
 generateObject.mockResolvedValueOnce({object:{...base,intent,activity:null,datePhrase:intent==='correct'?'yesterday':null}});await f.send(intent==='correct'?'Actually that was yesterday':'Same episode');const r=await f.send('brain fog');expect(r.outcome).toBe(intent==='correct'?'corrected':'reference');expect(r.view.records).toHaveLength(2);expect(r.view.pending).toEqual([]);if(intent==='correct')expect(r.view.records.find((x:any)=>x.trackedItem==='brain fog').occurrenceDate).toBe('2026-10-05');
});

test('done, today, done, today, another uses typed duplicate resolution and reaches 2/3',async()=>{
 const f=await setup();generateObject.mockResolvedValueOnce({object:base});await f.send('done');await f.send('today');generateObject.mockResolvedValueOnce({object:base});await f.send('done');const duplicate=await f.send('today');expect(duplicate.outcome).toBe('plan_duplicate');expect(duplicate.planView.progress).toBe('1/3');const result=await f.send('another');expect(result.planView.progress).toBe('2/3');expect(result.planView.pending).toEqual([]);expect((await f.t.query(api.tracking.getSummary,{token:f.pair.A})).records).toEqual([]);
});
test('What time accepts a typed clock through the shared symptom resolver',async()=>{
 const f=await setup();generateObject.mockResolvedValueOnce({object:{...base,intent:'record',activity:null,trackedItem:'brain fog',count:1,datePhrase:'today',timePhrase:'banana',precision:'exact'}});const q=await f.send('Brain fog today at banana');expect(q.message).toContain('What time');const r=await f.send('9am');expect(r.view.records[0].occurrenceTime).toBe('09:00');expect(r.view.pending).toEqual([]);
});
test('generic remembering question accepts a typed report and clears the original question',async()=>{
 const f=await setup();generateObject.mockResolvedValueOnce({object:{...base,intent:'clarify',activity:null}});await f.send('Something happened');generateObject.mockResolvedValueOnce({object:{...base,intent:'record',activity:null,trackedItem:'brain fog',count:1,datePhrase:'today'}});const r=await f.send('Brain fog today');expect(r.view.records).toHaveLength(1);expect(r.view.pending).toEqual([]);
});
test('plan reference yes resolves the saved clarification without inventing an activity',async()=>{
 const f=await setup();generateObject.mockResolvedValueOnce({object:{...base,datePhrase:'today',activity:'walking'}});const q=await f.send('walking today');expect(q.message).toContain('Is this about the plan we’re already tracking?');const r=await f.send('yes');expect(r.planView.count).toBe(1);expect(r.planView.plan.activity).toBe('strength train');expect(r.planView.pending).toEqual([]);
});
test('which completed session accepts a typed latest selection and corrects the same record',async()=>{
 const f=await setup();for(const date of ['today','yesterday']){generateObject.mockResolvedValueOnce({object:{...base,datePhrase:date}});await f.send(`done ${date}`);}
 generateObject.mockResolvedValueOnce({object:{...base,intent:'plan_correct',datePhrase:'2 days ago'}});const q=await f.send('Actually that was 2 days ago');expect(q.message).toContain('Which completed session');const r=await f.send('latest');expect(r.planView.records).toHaveLength(2);expect(r.planView.dates).toContain('2026-10-04');expect(r.planView.pending).toEqual([]);
});
test.each([
 ['What should I change','plan_correct','I actually skipped it',{completionStatus:'skipped',datePhrase:null}],
 ['What happened with your plan','plan_complete','did my strength session yesterday',{completionStatus:null,datePhrase:'yesterday'}],
])('free-text plan question %s resolves through the same resolver',async(label,intent,answer,fields)=>{
 const f=await setup();generateObject.mockResolvedValueOnce({object:{...base,datePhrase:'today'}});await f.send('done today');
 generateObject.mockResolvedValueOnce({object:label.startsWith('What should')?{...base,intent:'plan_correct',target:'latest'}:{...base,trackedItem:'brain fog',count:1}});await f.send('update');
 generateObject.mockResolvedValueOnce({object:{...base,intent,target:'latest',...fields}});const r=await f.send(answer);expect(r.planView.pending).toEqual([]);expect(r.planView.records).toHaveLength(label.startsWith('What should')?1:2);expect((await f.t.query(api.tracking.getSummary,{token:f.pair.A})).records).toEqual([]);
});
test('missing count accepts typed twice without creating a new clarification',async()=>{
 const f=await setup();generateObject.mockResolvedValueOnce({object:{...base,intent:'record',trackedItem:'brain fog',count:null,activity:null,datePhrase:'today'}});await f.send('Brain fog today');const r=await f.send('twice');expect(r.view.sevenDayCount).toBe(2);expect(r.view.pending).toEqual([]);
});
test('incomplete plan question accepts a typed complete plan, then yes confirms it',async()=>{
 const f=await setup();await f.send('Stop');await f.send('Start');generateObject.mockResolvedValueOnce({object:{...base,intent:'plan_proposal',activity:'strength train',targetNumber:null}});const q=await f.send('strength train');expect(q.message).toContain('How many times this week');generateObject.mockResolvedValueOnce({object:{...base,intent:'plan_proposal',activity:'strength train',targetNumber:3}});await f.send('strength train 3 times this week');const confirmed=await f.send('yes');expect(confirmed.planView.progress).toBe('0/3');expect(confirmed.planView.pending).toEqual([]);
});
test('question ID disambiguates multiple pending date questions without guessing',async()=>{
 const f=await setup();generateObject.mockResolvedValueOnce({object:base});await f.send('done');generateObject.mockResolvedValueOnce({object:{...base,intent:'record',trackedItem:'brain fog',count:1,activity:null}});const symptom=await f.send('Brain fog');const ambiguity=await f.send('today');expect(ambiguity.outcome).toBe('clarification');const selected=await f.send(`question ${symptom.pendingId}: today`);expect(selected.view.records).toHaveLength(1);expect(selected.view.pending).toEqual([]);expect((await f.t.query(api.plans.getPlan,{token:f.pair.A})).pending).toHaveLength(1);
});
test('additional-episode correction question accepts a typed new episode without altering the original count',async()=>{
 const f=await setup();const record={...base,intent:'record',trackedItem:'brain fog',count:1,activity:null,datePhrase:'today'};generateObject.mockResolvedValueOnce({object:record});await f.send('Brain fog today');generateObject.mockResolvedValueOnce({object:{...base,intent:'correct',count:2,activity:null,target:'latest'}});const q=await f.send('Actually it happened twice');expect(q.message).toContain('additional episode');generateObject.mockResolvedValueOnce({object:{...record,datePhrase:'yesterday'}});const r=await f.send('Brain fog yesterday');expect(r.view.records).toHaveLength(2);expect(r.view.pending).toEqual([]);expect(r.view.records.map((x:any)=>x.occurrenceDate)).toEqual(['2026-10-06','2026-10-05']);
});
