import {test,expect,vi,beforeEach,afterEach} from 'vitest';
import {convexTest} from 'convex-test';
import schema from '../convex/schema';
import {api,internal} from '../convex/_generated/api';
import * as copy from '../convex/copy';
import {writeFileSync} from 'node:fs';
const generateObject=vi.hoisted(()=>vi.fn());
vi.mock('@convex-dev/agent',()=>({Agent:class{generateObject=generateObject;}}));
const modules=import.meta.glob('../convex/**/*.*s');
const now=Date.parse('2026-10-06T10:00:00+05:30');
const clarify={intent:'clarify',trackedItem:null,count:null,datePhrase:null,timePhrase:null,precision:'date-only',target:null,explicitNew:false,activity:null,targetNumber:null,completionStatus:null};
let diagnostics:ReturnType<typeof vi.spyOn>;
beforeEach(()=>{vi.spyOn(Date,'now').mockReturnValue(now);vi.stubEnv('OPENAI_API_KEY','fictional');generateObject.mockReset();generateObject.mockResolvedValue({object:clarify});diagnostics=vi.spyOn(console,'info').mockImplementation(()=>{});});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs();});
async function setup(){const t=convexTest(schema,modules),pair=await t.mutation(api.tracking.createTestPair,{});let index=0;return {t,pair,send:(text:string,token=pair.A,id='simulation-'+(++index))=>t.action(api.messages.send,{token,text,messageId:id}),view:async()=>({symptoms:await t.query(api.tracking.getSummary,{token:pair.A}),plan:await t.query(api.plans.getPlan,{token:pair.A})})};}
test('exact replay gives help, asks the target, awaits confirmation and ends without repeated replies',async()=>{
 const f=await setup(),conversation=[];let waitingId:string|undefined;
 const inputs=['Hi','Going good.','What are your capabilities?','Track my workouts?','3','Okay bye.'];
 const replies=[copy.greetingReply,copy.doingWellReply,copy.helpReply,copy.planNeedsTarget,copy.planConfirmation({activity:'workouts',target:3}),'Okay, bye for now 👋'];
 for(let i=0;i<inputs.length;i++){
  const reply=await f.send(inputs[i]);expect(reply.message).toBe(replies[i]);conversation.push({input:inputs[i],reply:reply.message});
  if(i>0)expect(reply.message).not.toBe(conversation[i-1].reply);
  expect((await f.view()).plan.plan).toBeNull();
  if(i===2)expect(reply.outcome).toBe('help');
  if(i===3){waitingId=reply.pendingId;expect(reply.planView.plan).toBeNull();expect(reply.planView.pending[0].proposal.targetNumber).toBeNull();}
  if(i===4){expect(reply.outcome).toBe('plan_confirmation');expect(await f.t.run(ctx=>ctx.db.get(waitingId as any))).toBeNull();expect(reply.planView.pending).toHaveLength(1);expect(reply.planView.pending[0].proposal.targetNumber).toBe(3);expect(reply.planView.pending[0].proposal.activity).toBe('workouts');}
  if(i===5){expect(reply.outcome).toBe('farewell');expect(reply.message).not.toContain('?');expect(reply.message).not.toBe(copy.tracking_What_would_you_like_me_to_remember);expect(reply.message).not.toBe(copy.clarifyWithExample);}
 }
 const state=await f.view();expect(state.symptoms.records).toEqual([]);expect(state.symptoms.sevenDayCount).toBe(0);expect(state.symptoms.pending).toHaveLength(0);expect(state.plan.pending).toHaveLength(1);expect(state.plan.plan).toBeNull();expect(state.plan.count).toBe(0);
 expect(generateObject).not.toHaveBeenCalled();
 const lines=diagnostics.mock.calls.map(args=>JSON.parse(args[0] as string));expect(lines).toHaveLength(inputs.length);
 for(const line of lines){expect(Object.keys(line).sort()).toEqual(['aiIntent','messageId','replyEntry','route']);expect(JSON.stringify(line)).not.toMatch(/Going good|workouts|Okay bye|phone|secret/i);}
 expect(lines.map(l=>l.replyEntry)).toEqual(['greetingReply','doingWellReply','helpReply','planNeedsTarget','planConfirmation','farewellReply']);
 writeFileSync('output/fallback-user1.json',JSON.stringify({conversation,pendingQuestionCount:state.symptoms.pending.length+state.plan.pending.length,pendingByKind:{generic:state.symptoms.pending.length,planConfirmation:state.plan.pending.length},planState:{confirmedPlan:state.plan.plan,awaitingConfirmation:{activity:state.plan.pending[0].proposal.activity,targetNumber:state.plan.pending[0].proposal.targetNumber},completionCount:state.plan.count,symptomCount:state.symptoms.sevenDayCount},diagnostics:lines},null,2)+'\n');
});
test.each(['What can you do?','what can you help me with','how does this work','you tell me what all can you help me with'])('capability variant %s returns help without health writes or AI',async text=>{
 const f=await setup();await f.send('Going good.');const before=await f.view();generateObject.mockClear();vi.stubEnv('OPENAI_API_KEY','');const r=await f.send(text);expect(r.message).toBe(copy.helpReply);expect(r.outcome).toBe('help');expect(await f.view()).toEqual(before);expect(generateObject).not.toHaveBeenCalled();
});
test.each([['Can you help me track my workouts?','3 times','workouts'],['My workout schedule','three times','workout'],['My training schedule','3','training']])('missing target %s accepts typed %s through the shared plan resolver',async(text,answer,activity)=>{
 const f=await setup();vi.stubEnv('OPENAI_API_KEY','');const question=await f.send(text);expect(question.message).toBe(copy.planNeedsTarget);const oldId=question.pendingId;
 const answered=await f.send(answer);expect(answered.outcome).toBe('plan_confirmation');expect(answered.message).toBe(copy.planConfirmation({activity,target:3}));expect(await f.t.run(ctx=>ctx.db.get(oldId))).toBeNull();expect(answered.planView.pending).toHaveLength(1);expect(answered.planView.plan).toBeNull();
 await f.send(answer,undefined,'simulation-2');expect((await f.view()).plan.pending).toHaveLength(1);
 const saved=await f.send('yes');expect(saved.planView.plan.activity).toBe(activity);expect(saved.planView.plan.targetNumber).toBe(3);expect(saved.planView.pending).toEqual([]);expect((await f.view()).symptoms.records).toEqual([]);expect(generateObject).not.toHaveBeenCalled();
});
test('consecutive generic clarifications alternate with an example and replace only generic pending items',async()=>{
 const f=await setup();
 // A specific date question must survive every generic replacement unchanged.
 const specific=await f.t.run(async ctx=>{const u=(await ctx.db.query('users').withIndex('by_token',q=>q.eq('token',f.pair.A)).unique())!;return ctx.db.insert('pending',{userId:u._id,jobId:u.jobId,rawText:'Brain fog',messageReceivedAt:now,reason:'Which day was that?',kind:'clarification',proposal:{...clarify,intent:'record',trackedItem:'brain fog',count:1},relatedIds:[]});});
 const before=await f.t.run(ctx=>ctx.db.get(specific)),replies=[];
 for(const input of ['Not sure yet.','Nutrition?','Not sure yet','Not sure']){const r=await f.send(input);replies.push(r.message);const state=await f.view();expect(state.symptoms.pending).toHaveLength(2);expect(state.symptoms.pending.filter(p=>p.proposal.intent==='clarify')).toHaveLength(1);expect(state.symptoms.records).toEqual([]);expect(await f.t.run(ctx=>ctx.db.get(specific))).toEqual(before);}
 expect(replies).toEqual([copy.tracking_What_would_you_like_me_to_remember,copy.clarifyWithExample,copy.tracking_What_would_you_like_me_to_remember,copy.clarifyWithExample]);
 await f.send('What can you do?');expect((await f.send('Still not sure')).message).toBe(copy.tracking_What_would_you_like_me_to_remember);
});
test('legacy accumulated generic questions collapse while specific questions and another user remain unchanged',async()=>{
 const f=await setup();await f.t.run(async ctx=>{for(const token of [f.pair.A,f.pair.B]){const u=(await ctx.db.query('users').withIndex('by_token',q=>q.eq('token',token)).unique())!;for(let i=0;i<3;i++)await ctx.db.insert('pending',{userId:u._id,jobId:u.jobId,rawText:'synthetic unclear message',messageReceivedAt:now,reason:copy.tracking_What_would_you_like_me_to_remember,kind:'clarification',proposal:clarify,relatedIds:[]});}});
 const b=await f.t.query(api.tracking.getSummary,{token:f.pair.B});await f.send('Not sure');expect((await f.view()).symptoms.pending).toHaveLength(1);expect(await f.t.query(api.tracking.getSummary,{token:f.pair.B})).toEqual(b);
});
test.each(['active','paused','stopped'] as const)('standalone farewell keeps %s state, pending questions, queued output and quotas unchanged',async state=>{
 const f=await setup();await f.send('Going good.');await f.send('Track my workouts?');await f.send('3');
 await f.t.run(async ctx=>{
  const u=(await ctx.db.query('users').withIndex('by_token',q=>q.eq('token',f.pair.A)).unique())!;
  await ctx.db.patch(u._id,{state});
  await ctx.db.insert('proactiveOutputs',{userId:u._id,jobId:u.jobId,kind:'summary',status:'queued',body:'synthetic output'});
  await ctx.db.insert('quotas',{key:'global',times:Array(500).fill(now)});
 });
 const snapshot=()=>f.t.run(async ctx=>{const result:Record<string,unknown>={};for(const table of ['users','occurrences','pending','plans','planPending','planCompletions','references','proactiveOutputs','quotas','deletionMarkers'] as const)result[table]=await ctx.db.query(table).collect();return result;});
 const before=await snapshot();generateObject.mockClear();vi.stubEnv('OPENAI_API_KEY','');diagnostics.mockClear();
 const reply=await f.send('Okay bye.');expect(reply.outcome).toBe('farewell');expect(reply.message).toBe('Okay, bye for now 👋');
 expect(await snapshot()).toEqual(before);expect(generateObject).not.toHaveBeenCalled();
 expect(diagnostics).toHaveBeenCalledTimes(1);expect(JSON.parse(diagnostics.mock.calls[0][0] as string)).toMatchObject({aiIntent:null,route:'farewell',replyEntry:'farewellReply'});
});
test('confirmed plan, completion, correction and duplicate logic remain intact after a missing-target answer',async()=>{
 const f=await setup();await f.send('Track my workouts?');await f.send('three times');await f.send('yes');
 const completion={...clarify,intent:'plan_complete',activity:'workouts',datePhrase:'today'};generateObject.mockResolvedValueOnce({object:completion});const first=await f.send('did my workouts today');expect(first.planView.progress).toBe('1/3');expect(first.planView.records[0].completionDate).toBe('2026-10-06');
 generateObject.mockResolvedValueOnce({object:{...completion,intent:'plan_correct',datePhrase:'yesterday',target:'latest'}});const corrected=await f.send('Actually that was yesterday');expect(corrected.planView.records).toHaveLength(1);expect(corrected.planView.records[0]._id).toBe(first.planView.records[0]._id);expect(corrected.planView.records[0].completionDate).toBe('2026-10-05');expect(corrected.planView.progress).toBe('1/3');
 generateObject.mockResolvedValueOnce({object:{...completion,datePhrase:'yesterday'}});const duplicate=await f.send('did my workouts yesterday');expect(duplicate.outcome).toBe('plan_duplicate');await f.send('same');const state=await f.view();expect(state.plan.count).toBe(1);expect(state.plan.records).toHaveLength(1);expect(state.symptoms.records).toEqual([]);
});
test('Stop and Delete reject missing-target plans; Pause preserves its state; invalid targets are never invented',async()=>{
 const f=await setup();await f.send('Pause');const request=await f.send('Track my workouts?');expect(request.message).toBe(copy.planNeedsTarget);expect(request.planView.state).toBe('paused');
 for(const answer of ['0','251','a lot']){const reply=await f.send(answer);expect(reply.planView?.plan??null).toBeNull();expect((await f.view()).plan.pending.find(p=>p._id===request.pendingId)?.proposal.targetNumber).toBeNull();}
 await f.send('Stop');expect((await f.send('Track my workouts?')).outcome).toBe('stopped');await f.send('Delete my pilot data');expect((await f.send('My workout schedule')).outcome).toBe('stopped');expect((await f.view()).plan.pending).toEqual([]);
});
test('safe diagnostic line is emitted once for an AI failure and contains no exception text or provider secrets',async()=>{
 const f=await setup();generateObject.mockRejectedValueOnce(new Error('synthetic health content and private credential'));await f.send('private synthetic message');expect(diagnostics).toHaveBeenCalledTimes(1);const line=JSON.parse(diagnostics.mock.calls[0][0] as string);expect(line).toEqual({messageId:'simulation-1',aiIntent:null,route:'error',replyEntry:'messages_I_couldn_t_safely_process_that_right'});
});
test('malformed AI intent cannot put provider content into the diagnostic line',async()=>{
 const f=await setup();generateObject.mockResolvedValueOnce({object:{...clarify,intent:'private synthetic health content'}});await f.send('synthetic message');expect(diagnostics).toHaveBeenCalledTimes(1);const line=JSON.parse(diagnostics.mock.calls[0][0] as string);expect(line.aiIntent).toBeNull();expect(JSON.stringify(line)).not.toContain('private synthetic health content');expect((await f.view()).symptoms.records).toEqual([]);
});

const uncertaintyReply="Sure. We can start with what’s changing in your body, or one plan you want help staying on top of this week. Which feels more useful right now?";
test.each(["I don’t know, you tell me","you tell me","what do you suggest?","I don't know, you tell me"])("uncertainty %s guides without AI, generic fallback or changing pending plans",async text=>{
 const f=await setup();await f.send('Track my workouts?');const before=await f.view();generateObject.mockClear();vi.stubEnv('OPENAI_API_KEY','');
 for(let i=0;i<2;i++){const reply=await f.send(text);expect(reply.message).toBe(uncertaintyReply);expect(reply.outcome).toBe('help');expect(await f.view()).toEqual(before);}
 expect(generateObject).not.toHaveBeenCalled();await f.send('3');expect((await f.view()).plan.plan).toBeNull();await f.send('yes');expect((await f.view()).plan.plan?.targetNumber).toBe(3);
});
test('Going good acknowledges without AI or an unresolved generic question',async()=>{
 const f=await setup();const before=await f.view();vi.stubEnv('OPENAI_API_KEY','');const reply=await f.send('Going good.');expect(reply.message).toBe('Good to hear 🙂 What would you like me to keep track of this week?');expect(await f.view()).toEqual(before);expect(generateObject).not.toHaveBeenCalled();
});
