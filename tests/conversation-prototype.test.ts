import {test,expect,vi,beforeEach,afterEach,afterAll} from 'vitest';
import {convexTest} from 'convex-test';
import {writeFileSync} from 'node:fs';
import schema from '../convex/schema';
import {api,internal} from '../convex/_generated/api';
import {conversationRefs} from '../convex/conversationStore';
import {validateEnvelope,conversationSchema} from '../convex/conversationProtocol';
import {z} from 'zod';
import * as copy from '../convex/copy';
const generateObject=vi.hoisted(()=>vi.fn());
vi.mock('@convex-dev/agent',()=>({Agent:class{generateObject=generateObject;}}));
const modules=import.meta.glob('../convex/**/*.*s');
const now=Date.parse('2026-10-07T09:00:00+05:30');
const transcripts:any[]=[];
beforeEach(()=>{vi.stubEnv('INTUNE_SEMANTIC_BRIDGE','legacy');vi.spyOn(Date,'now').mockReturnValue(now);vi.stubEnv('OPENAI_API_KEY','synthetic');vi.stubEnv('INTUNE_CONVERSATION_PROTOTYPE','local');generateObject.mockReset();vi.spyOn(console,'info').mockImplementation(()=>{});});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs();});
afterAll(()=>writeFileSync('output/prototype-conversations.json',JSON.stringify(transcripts,null,2)));
function body(q:string,l:string,n:number|null=1,d:string|null='today',t:string|null=null,x=false,s='reported'):any{return {k:'body',q,l,b:null,r:null,n,d,t,x,s};}
function cycle(q:string,l='period started',d:string|null='today'):any{return {...body(q,l,1,d),k:'cycle'};}
function answer(q='yes',choice='confirm',target:string|null=null,d:string|null=null,t:string|null=null,n:number|null=null):any{return {k:'answer',q,target,choice,d,t,n};}
function question(q:string,scope='week',l:string|null=null):any{return {k:'question',q,scope,l};}
function correction(q:string,target:string|null,d:string|null=null,n:number|null=null,status:string|null=null):any{return {k:'correct',q,target,d,t:null,n,status};}
async function fixture(consent=true,labels:string[]=[]){
 const t=convexTest(schema,modules),token=await t.mutation(internal.phoneUsers.getOrCreate,{phoneNumber:'+12025550197'});
 await t.run(async ctx=>{const u=(await ctx.db.query('users').withIndex('by_token',q=>q.eq('token',token)).unique())!;await ctx.db.patch(u._id,{conversationConsent:consent,trackedItems:labels});});
 const send=async(text:string,ops:any[],id=crypto.randomUUID())=>{generateObject.mockResolvedValueOnce({object:{v:2,ops}});return t.action(conversationRefs.send,{token,messageId:id,text});};
 const view=()=>t.query(conversationRefs.view,{token});
 const getContext=()=>t.query(conversationRefs.context,{token,messageId:'not-a-receipt'});
 return {t,token,send,view,getContext};
}
async function seedPlan(f:Awaited<ReturnType<typeof fixture>>){await f.t.run(async ctx=>{const u=(await ctx.db.query('users').withIndex('by_token',q=>q.eq('token',f.token)).unique())!;await ctx.db.insert('plans',{userId:u._id,jobId:u.jobId,activity:'strength train',targetNumber:3,rawText:'strength train 3 times this week',messageReceivedAt:now,confirmedAt:now,state:'active'});});}
test('mixed body, cycle, completion and question preserve every meaning and confirm before counting',async()=>{
 const f=await fixture();await seedPlan(f);
 const text='Had 3 hot flashes yesterday, one night sweat last night. Period started today. Workout done today. What have I told you this week?';
 const ops=[body('Had 3 hot flashes yesterday','hot flashes',3,'yesterday'),body('one night sweat last night','night sweat',1,'last night'),cycle('Period started today'),{k:'complete',q:'Workout done today',d:'today',t:null,x:false},question('What have I told you this week?')];
 const first=await f.send(text,ops);expect(first.outcome).toBe('conversation');expect(first.message).toContain('Have I got that right?');expect((await f.view()).body).toEqual([]);expect((await f.view()).cycle).toEqual([]);
 const saved=await f.send('yes please', [answer('yes please')]);const v=await f.view();expect(v.body).toHaveLength(4);expect(v.cycle).toHaveLength(1);expect(v.plan.count).toBe(1);expect(saved.message).toContain('hot flashes: 3');expect(saved.message).toContain('strength train: 1/3');expect(saved.message).toContain('Cycle: period started');expect(v.pending).toEqual([]);
 transcripts.push({case:'mixed report',turns:[{input:text,reply:first.message},{input:'yes please',reply:saved.message}],final:{body:v.body.length,cycle:v.cycle.length,plan:v.plan.progress}});
});
test('no symptom slots and cycle remains separate from four body changes',async()=>{
 const f=await fixture();const texts=['hot flash today','night sweat today','brain fog today','low energy today'];
 const ops=texts.map((q,i)=>body(q,['hot flash','night sweat','brain fog','low energy'][i]));const text=texts.join('. ')+'. Period started today';
 await f.send(text,[...ops,cycle('Period started today')]);await f.send('yes',[answer()]);const v=await f.view();expect(v.body).toHaveLength(4);expect(v.cycle).toHaveLength(1);const context=await f.getContext();expect(context.body.map((r:any)=>r.label)).toEqual(['hot flashes','night sweats','brain fog','low energy']);
});
test('unfamiliar body change is kept in her words after repeat-back',async()=>{
 const f=await fixture();const first=await f.send('I had buzzing in my ears today',[body('I had buzzing in my ears today','buzzing in my ears')]);expect(first.message).toContain('buzzing in my ears');expect(first.message).not.toMatch(/unsupported|two body changes|choose/i);await f.send('yep',[answer('yep')]);const v=await f.view();expect(v.body[0].trackedItem).toBe('buzzing in my ears');expect(v.body[0].rawText).toBe('I had buzzing in my ears today');
 transcripts.push({case:'unfamiliar change',turns:[{input:'I had buzzing in my ears today',reply:first.message}],final:{label:v.body[0].trackedItem}});
});
test('broad storage consent stores no health draft and creates no proactive permission',async()=>{
 const f=await fixture(false);generateObject.mockReset();const first=await f.send('hot flash today',[body('hot flash today','hot flash')]);expect(first.message).toContain('Shall I keep this record');expect(generateObject).toHaveBeenCalledTimes(1);expect((await f.view()).body).toEqual([]);expect((await f.view()).pending).toEqual([]);
 await f.t.action(conversationRefs.send,{token:f.token,messageId:'consent',text:'yes'});expect((await f.view()).consent).toBe(true);expect((await f.view()).body).toEqual([]);await f.send('hot flash today',[body('hot flash today','hot flash')]);await f.send('yes',[answer()]);expect((await f.view()).body).toHaveLength(1);
 await f.t.run(async ctx=>{const u=(await ctx.db.query('users').withIndex('by_token',q=>q.eq('token',f.token)).unique())!;expect(await ctx.db.query('proactiveOutputs').withIndex('by_user',q=>q.eq('userId',u._id)).collect()).toEqual([]);});
});
test('partial understanding counts confirmed known event and asks only for missing day',async()=>{
 const f=await fixture(true,['hot flashes','night sweats']);await f.send('3 hot flashes yesterday and I had a night sweat',[body('3 hot flashes yesterday','hot flashes',3,'yesterday'),body('I had a night sweat','night sweat',1,null)]);const confirm=await f.send('yes',[answer()]);expect((await f.view()).body).toHaveLength(3);expect(confirm.message).toContain('Which day was the night sweat?');
 const clarified=await f.send('yep that was yesterday thanks',[answer('yep that was yesterday thanks','detail',null,'yesterday')]);const v=await f.view();expect(v.body).toHaveLength(4);expect(v.pending).toEqual([]);expect(clarified.message).not.toContain('What would you like');
});
test('friendly clarification across midnight uses original event anchor',async()=>{
 const f=await fixture(true,['hot flashes']);await f.send('had a hot flash',[body('had a hot flash','hot flash',1,null)]);vi.mocked(Date.now).mockReturnValue(Date.parse('2026-10-08T09:00:00+05:30'));await f.send('today lol, like literally right now',[answer('today lol, like literally right now','detail',null,'today')]);expect((await f.view()).body[0].occurrenceDate).toBe('2026-10-07');
});
test('known singular right-now event uses receipt time and keeps counts quiet',async()=>{
 const f=await fixture(true,['hot flashes']);const r=await f.send('having a hot flash right now',[body('having a hot flash right now','hot flash',1,'right now')]);const v=await f.view();expect(v.body[0].occurrenceTime).toBe('09:00');expect(r.message).not.toContain('time');
});
test('questions mixed with updates are answered after confirmed writes',async()=>{
 const f=await fixture(true,['hot flashes']);await f.send('3 hot flashes yesterday. How many hot flashes this week?',[body('3 hot flashes yesterday','hot flashes',3,'yesterday'),question('How many hot flashes this week?','body','hot flashes')]);expect((await f.view()).body).toHaveLength(3);const r=await f.send('And what have I told you this week?',[question('And what have I told you this week?')]);expect(r.message).toContain('hot flashes: 3');
});
test('provider duplicate uses one model call and one write',async()=>{
 const f=await fixture(true,['hot flashes']);const text='hot flash today',ops=[body(text,'hot flash')];await f.send(text,ops,'repeat-id');const r=await f.t.action(conversationRefs.send,{token:f.token,messageId:'repeat-id',text});expect(r.outcome).toBe('provider_duplicate');expect(generateObject).toHaveBeenCalledTimes(1);expect((await f.view()).body).toHaveLength(1);
});
test('possible user duplicate asks same/new and never auto counts again',async()=>{
 const f=await fixture(true,['hot flashes']);await f.send('hot flash today',[body('hot flash today','hot flash')]);const r=await f.send('had a hot flash today',[body('had a hot flash today','hot flash')]);expect(r.message).toContain('same episode');expect((await f.view()).body).toHaveLength(1);await f.send('the same one',[answer('the same one','same')]);expect((await f.view()).body).toHaveLength(1);expect((await f.view()).pending).toEqual([]);
});
test('cycle duplicate is separate from symptom duplication',async()=>{
 const f=await fixture();await f.send('period started today',[cycle('period started today')]);const r=await f.send('period started today',[cycle('period started today')]);expect(r.message).toContain('same period started');expect((await f.view()).cycle).toHaveLength(1);await f.send('same',[answer('same','same')]);expect((await f.view()).cycle).toHaveLength(1);
});
test('two corrections preserve group counts and separate cycle date',async()=>{
 const f=await fixture(true,['hot flashes']);await f.send('3 hot flashes today. Period started today',[body('3 hot flashes today','hot flashes',3),cycle('Period started today')]);await f.send('yes',[answer()]);let v=await f.view();const text='Actually two hot flashes today. The period started yesterday';
 await f.send(text,[correction('Actually two hot flashes today',v.body[0]._id,'today',2),correction('The period started yesterday',v.cycle[0]._id,'yesterday')]);expect((await f.view()).body).toHaveLength(3);await f.send('yes',[answer()]);v=await f.view();expect(v.body).toHaveLength(2);expect(v.cycle[0].occurrenceDate).toBe('2026-10-06');
});
test('plan proposal, confirmation, completion, retrieval and correction reuse V1 rules',async()=>{
 const f=await fixture();const p=await f.send('I need to strength train 3 times this week',[{k:'plan',q:'I need to strength train 3 times this week',activity:'strength train',n:3}]);expect(p.message).toContain('Have I got that right?');expect((await f.view()).plan.plan).toBeNull();await f.send('yes please',[answer('yes please')]);expect((await f.view()).plan.plan.targetNumber).toBe(3);
 await f.send('Workout done today',[{k:'complete',q:'Workout done today',d:'today',t:null,x:false}]);let v=await f.view();expect(v.plan.progress).toBe('1/3');await f.send('Actually I skipped it',[correction('Actually I skipped it',v.plan.records[0]._id,null,null,'skipped')]);await f.send('yes',[answer()]);v=await f.view();expect(v.plan.progress).toBe('0/3');
});
test('ordinary mood and HRT question do not create medical reasoning or crisis pause',async()=>{
 const f=await fixture(true,['low mood']);const r=await f.send('I had low mood today. Should I ask about HRT?',[body('I had low mood today','low mood'),question('Should I ask about HRT?','medical')]);expect(r.message).toContain('whether HRT is right for you');expect((await f.view()).body).toHaveLength(1);expect((await f.view()).safetyPaused).toBe(false);expect(r.message).not.toContain('emergency');
 transcripts.push({case:'medical boundary',turns:[{input:'I had low mood today. Should I ask about HRT?',reply:r.message}]});
});
test.each(['period started today','ordinary spotting today'])('ordinary cycle event %s is not an urgent trigger',async text=>{
 const f=await fixture();await f.send(text,[cycle(text,text.replace(' today',''))]);expect((await f.view()).cycle).toHaveLength(1);expect((await f.view()).safetyPaused).toBe(false);
});
test.each(['heavy bleeding','I want to kill myself','chest pain','difficulty breathing'])('approved trigger %s interrupts every update without model',async trigger=>{
 const f=await fixture();const r=await f.t.action(conversationRefs.send,{token:f.token,messageId:crypto.randomUUID(),text:trigger+'. hot flash today'});expect(r.outcome).toBe('safety');expect((await f.view()).body).toEqual([]);expect(generateObject).not.toHaveBeenCalled();
});
test('safety pause blocks new reports, no buffering or hidden replay, and preserves existing pending question',async()=>{
 const f=await fixture(true,['hot flashes']);await f.send('had a hot flash',[body('had a hot flash','hot flash',1,null)]);await f.t.action(conversationRefs.send,{token:f.token,messageId:'trigger',text:'heavy bleeding'});const r=await f.t.action(conversationRefs.send,{token:f.token,messageId:'during',text:'period started today'});expect(r.message).toBe(copy.safetyReturnQuestion);expect((await f.view()).cycle).toEqual([]);expect((await f.view()).pending).toHaveLength(1);await f.t.action(conversationRefs.send,{token:f.token,messageId:'continue',text:'yes'});expect((await f.view()).cycle).toEqual([]);await f.send('yesterday',[answer('yesterday','detail',null,'yesterday')]);expect((await f.view()).body).toHaveLength(1);
});
test('delete erases cycle, body, drafts and questions without affecting B',async()=>{
 const f=await fixture();await f.send('hot flash today. period started today',[body('hot flash today','hot flash'),cycle('period started today')]);await f.send('yes',[answer()]);await f.send('my ears buzzed',[body('my ears buzzed','ears buzzed',1,null)]);
 const other=await f.t.mutation(internal.phoneUsers.getOrCreate,{phoneNumber:'+12025550198'});await f.t.action(conversationRefs.send,{token:f.token,messageId:'delete',text:'Delete my pilot data'});const v=await f.view();expect(v.body).toEqual([]);expect(v.cycle).toEqual([]);expect(v.pending).toEqual([]);expect(v.consent).toBe(false);expect((await f.t.query(conversationRefs.view,{token:other})).body).toEqual([]);
});
test('foreign cycle and pending IDs cannot be used even with a valid quote',async()=>{
 const f=await fixture();const other=await f.t.mutation(internal.phoneUsers.getOrCreate,{phoneNumber:'+12025550198'});const id=await f.t.run(async ctx=>{const u=(await ctx.db.query('users').withIndex('by_token',q=>q.eq('token',other)).unique())!;return ctx.db.insert('cycleEvents',{userId:u._id,jobId:u.jobId,label:'period started',rawText:'period started today',occurrenceDate:'2026-10-07',occurrenceTime:null,timePrecision:'date-only',messageReceivedAt:now});});
 const r=await f.send('Actually period started yesterday',[correction('Actually period started yesterday',id,'yesterday')]);expect(r.outcome).toBe('error');expect((await f.view()).cycle).toEqual([]);expect((await f.t.query(conversationRefs.view,{token:other})).cycle[0].occurrenceDate).toBe('2026-10-07');
});
test.each(['I did not have a hot flash today','My friend had a hot flash today','If I had a hot flash today'])('cropped report evidence cannot count %s',async text=>{
 const f=await fixture(true,['hot flashes']);await f.send(text,[body('hot flash today','hot flash'),{k:'conversation',q:text,tone:'unclear'}]);expect((await f.view()).body).toEqual([]);
});
test('hallucinated label, date or count rejects whole batch without saving first valid part',async()=>{
 for(const invalid of [body('hot flash today','night sweat'),body('hot flash today','hot flash',2),body('hot flash today','hot flash',1,'yesterday')]){
  const f=await fixture(true,['hot flashes']);const r=await f.send('hot flash today',[body('hot flash today','hot flash'),invalid]);expect(r.outcome).toBe('error');expect((await f.view()).body).toEqual([]);expect((await f.view()).pending).toEqual([]);
 }
});
test('model cannot make three reported events into one',async()=>{const f=await fixture(true,['hot flashes']);const r=await f.send('3 hot flashes today',[body('3 hot flashes today','hot flashes',1)]);expect(r.outcome).toBe('error');expect((await f.view()).body).toEqual([]);});
test('model cannot turn a greeting into confirmation',async()=>{
 const f=await fixture();await f.send('hot flash today',[body('hot flash today','hot flash')]);const r=await f.send('hello there',[answer('hello there')]);expect(r.outcome).toBe('error');expect((await f.view()).body).toEqual([]);
});
test('natural control is confirmed and prevents mixed ordinary writes',async()=>{
 const f=await fixture(true,['hot flashes']);const r=await f.send('Please pause reminders. Had a hot flash today',[{k:'control',q:'Please pause reminders',command:'pause',target:null},body('Had a hot flash today','hot flash')]);expect(r.message).toContain('Should I pause');expect((await f.view()).body).toEqual([]);await f.send('yes',[answer()]);expect((await f.view()).state).toBe('paused');
});
test('paused proactive contact still allows requested tracking and creates no output',async()=>{
 const f=await fixture(true,['hot flashes']);await f.t.action(conversationRefs.send,{token:f.token,messageId:'pause',text:'Pause'});await f.send('hot flash today',[body('hot flash today','hot flash')]);expect((await f.view()).body).toHaveLength(1);expect((await f.view()).state).toBe('paused');
});
test('Stop rejects late model output and does not resurrect memory',async()=>{
 const f=await fixture(true,['hot flashes']);let finish:any,started:any;const began=new Promise(r=>started=r);generateObject.mockImplementationOnce(()=>{started();return new Promise(r=>finish=r);});const pending=f.t.action(conversationRefs.send,{token:f.token,messageId:'slow',text:'hot flash today'});await began;await f.t.action(conversationRefs.send,{token:f.token,messageId:'stop',text:'Stop'});finish({object:{v:2,ops:[body('hot flash today','hot flash')]}});expect((await pending).outcome).toBe('dropped');expect((await f.view()).body).toEqual([]);
});
test('a new natural V1 write invalidates an older prototype reservation',async()=>{
 const f=await fixture(true,['hot flashes']);await f.t.mutation(internal.tracking.receive,{token:f.token,messageId:'old'});await f.t.mutation(internal.tracking.reserve,{token:f.token,messageId:'old'});const context=await f.t.query(conversationRefs.context,{token:f.token,messageId:'old'});await f.t.action(api.messages.send,{token:f.token,messageId:'natural',text:'hot flash today'});const r=await f.t.mutation(conversationRefs.apply,{token:f.token,messageId:'old',text:'hot flash yesterday',version:context.version,envelope:{v:2,ops:[body('hot flash yesterday','hot flash',1,'yesterday')]}});expect(r.outcome).toBe('dropped');expect((await f.view()).body).toHaveLength(1);
});
test('provider failure and malformed/truncated result write no memory',async()=>{
 const f=await fixture();generateObject.mockRejectedValueOnce(new Error('provider failure with sensitive body'));expect((await f.t.action(conversationRefs.send,{token:f.token,messageId:'failed',text:'hot flash today'})).outcome).toBe('error');generateObject.mockResolvedValueOnce({object:{v:2,ops:[{k:'body'}]}});expect((await f.t.action(conversationRefs.send,{token:f.token,messageId:'malformed',text:'hot flash today'})).outcome).toBe('error');expect((await f.view()).body).toEqual([]);expect((await f.view()).pending).toEqual([]);
});
test('caps and no Agent message storage are retained',async()=>{
 const f=await fixture(true,['hot flashes']);await f.send('hot flash today',[body('hot flash today','hot flash')]);const params=generateObject.mock.calls[0];expect(params[2].maxOutputTokens).toBe(350);expect(params[2].maxRetries).toBe(0);expect(params[3].storageOptions.saveMessages).toBe('none');const prompt=JSON.parse(params[2].prompt);expect(prompt.context.timezone).toBe('Asia/Kolkata');expect(prompt.context.receivedAt).toBe(now);
 await f.t.run(async ctx=>{const quota=(await ctx.db.query('quotas').withIndex('by_key',q=>q.eq('key','global')).unique())!;await ctx.db.patch(quota._id,{times:Array(500).fill(now)});});const r=await f.t.action(conversationRefs.send,{token:f.token,messageId:'cap',text:'another hot flash today'});expect(r.outcome).toBe('error');expect((await f.view()).body).toHaveLength(1);expect(generateObject).toHaveBeenCalledTimes(1);
});
test('prototype path is disabled unless explicitly selected',async()=>{const f=await fixture();vi.stubEnv('INTUNE_CONVERSATION_PROTOTYPE','');expect((await f.t.action(conversationRefs.send,{token:f.token,messageId:'disabled',text:'hot flash today'})).outcome).toBe('disabled');expect(generateObject).not.toHaveBeenCalled();});

test('inherited symptom subject preserves distinct counts and dates',async()=>{
 const f=await fixture(true,['hot flashes']);const first=body('three hot flashes yesterday','hot flashes',3,'yesterday');const second={...body('one today','hot flashes'),r:0};
 await f.send('three hot flashes yesterday and one today',[first,second]);expect((await f.view()).body).toEqual([]);await f.send('yes',[answer()]);const v=await f.view();expect(v.body.filter((r:any)=>r.occurrenceDate==='2026-10-06')).toHaveLength(3);expect(v.body.filter((r:any)=>r.occurrenceDate==='2026-10-07')).toHaveLength(1);
});
test('proposed common-symptom mapping is confirmed and retained alongside original wording',async()=>{
 const f=await fixture(true,['hot flashes']);const q='I felt a sudden wave of heat today';const op={...body(q,'sudden wave of heat'),b:'hot flashes'};const r=await f.send(q,[op]);expect(r.message).toContain('Have I got that right?');expect((await f.view()).body).toEqual([]);await f.send('yes',[answer()]);const v=await f.view();expect(v.body[0].trackedItem).toBe('hot flashes');expect(v.body[0].reportedLabel).toBe('sudden wave of heat');
});
test('a valid first clause cannot silently drop the rest of the message',async()=>{
 const f=await fixture(true,['hot flashes']);const r=await f.send('hot flash today. Period started yesterday',[body('hot flash today','hot flash')]);expect(r.outcome).toBe('error');expect((await f.view()).body).toEqual([]);
});
test('a question about an occurrence is not a report',async()=>{
 const f=await fixture(true,['hot flashes']);await f.send('Did I have a hot flash today?',[body('Did I have a hot flash today?','hot flash')]);expect((await f.view()).body).toEqual([]);
});

test('provider schema uses supported anyOf rather than rejected oneOf',()=>{
 const schema=z.toJSONSchema(conversationSchema);const text=JSON.stringify(schema);expect(text).toContain('anyOf');expect(text).not.toContain('oneOf');
});
test('prototype reuses exact latest approved medical wording and preserves existing questions',async()=>{
 const f=await fixture(true,['hot flashes']);await f.send('had a hot flash',[body('had a hot flash','hot flash',1,null)]);const before=await f.view();const r=await f.send('Would HRT help me?',[question('Would HRT help me?','medical')]);expect(r.message).toContain(copy.medicalQuestionReply);expect((await f.view()).pending).toEqual(before.pending);expect((await f.view()).body).toEqual(before.body);
});
test('mixed negation protects the denied symptom without losing a separate affirmative clause',async()=>{
 const f=await fixture(true,['hot flashes','brain fog']);const text='no hot flashes today but brain fog twice yesterday';await f.send(text,[body('no hot flashes today','hot flashes',null,'today',null,false,'negated'),body('brain fog twice yesterday','brain fog',2,'yesterday')]);await f.send('yes',[answer()]);const v=await f.view();expect(v.body).toHaveLength(2);expect(v.body.every((r:any)=>r.trackedItem==='brain fog')).toBe(true);
});
test.each(['wasn’t having hot flashes today','without any hot flashes today','never had hot flashes today'])('shared V1 guard protects %s',async text=>{
 const f=await fixture(true,['hot flashes']);await f.send(text,[body(text,'hot flashes')]);expect((await f.view()).body).toHaveLength(0);
});
test('legacy V1 symptom clarification accepts a natural date through the shared resolver',async()=>{
 const f=await fixture(true,['hot flashes']);await f.t.action(api.messages.send,{token:f.token,messageId:'old-v1',text:'had a hot flash'});expect((await f.view()).pending).toHaveLength(1);await f.send('today lol',[answer('today lol','detail',null,'today')]);expect((await f.view()).body).toHaveLength(1);expect((await f.view()).pending).toHaveLength(0);
});
test('legacy V1 duplicate keeps same/new semantics when answered through prototype',async()=>{
 const f=await fixture(true,['hot flashes']);await f.t.action(api.messages.send,{token:f.token,messageId:'old-first',text:'hot flash today'});await f.t.action(api.messages.send,{token:f.token,messageId:'old-repeat',text:'hot flash today'});expect((await f.view()).pending).toHaveLength(1);await f.send('same one',[answer('same one','same')]);expect((await f.view()).body).toHaveLength(1);expect((await f.view()).pending).toHaveLength(0);
});
test('legacy V1 setup confirmation preserves the reports and original consent scope',async()=>{
 const f=await fixture(true,[]);await f.t.action(api.messages.send,{token:f.token,messageId:'old-setup',text:'3 hot flashes yesterday and one night sweat last night'});expect((await f.view()).body).toHaveLength(0);await f.send('yes',[answer()]);expect((await f.view()).body).toHaveLength(4);expect((await f.view()).pending).toHaveLength(0);
});
test('forgetting a V1 occurrence erases copied prototype correction evidence',async()=>{
 const f=await fixture(true,['hot flashes']);await f.send('hot flash today',[body('hot flash today','hot flash')]);const id=(await f.view()).body[0]._id;await f.send('Actually yesterday',[correction('Actually yesterday',id,'yesterday')]);expect((await f.view()).pending).toHaveLength(1);await f.t.mutation(api.tracking.forget,{token:f.token,occurrenceId:id});expect((await f.view()).pending).toHaveLength(0);expect((await f.view()).body).toHaveLength(0);
});
test('new extraction setting keeps the governing model within the unchanged output budget',async()=>{
 const f=await fixture(true,['hot flashes']);await f.send('hot flash today',[body('hot flash today','hot flash')]);expect(generateObject.mock.calls[0][2].providerOptions.openai.reasoningEffort).toBe('none');expect(generateObject.mock.calls[0][2].maxOutputTokens).toBe(350);
});
test('a wrong singular count cannot override the explicit suffix twice',async()=>{
 const f=await fixture(true,['hot flashes']);const r=await f.send('hot flash twice yesterday',[body('hot flash twice yesterday','hot flash',1,'yesterday')]);expect(r.outcome).toBe('error');expect((await f.view()).body).toHaveLength(0);
});
test('correction repeat-back identifies the owned record before confirming',async()=>{
 const f=await fixture(true,['hot flashes']);await f.send('hot flash today',[body('hot flash today','hot flash')]);const id=(await f.view()).body[0]._id;const r=await f.send('Actually yesterday',[correction('Actually yesterday',id,'yesterday')]);expect(r.message).toContain('a correction to hot flashes today');expect((await f.view()).body[0].occurrenceDate).toBe('2026-10-07');
});
test('mixed multi-report HRT question receives the approved boundary before counting confirmation',async()=>{
 const f=await fixture(true,['hot flashes','night sweats']);const text='hot flash today. night sweat today. Would HRT help?';const r=await f.send(text,[body('hot flash today','hot flash'),body('night sweat today','night sweat'),question('Would HRT help?','medical')]);expect(r.message).toContain(copy.medicalQuestionReply);expect(r.message).toContain('Have I got that right?');expect((await f.view()).body).toHaveLength(0);
});
test('summary bypasses provider quota and includes separate cycle records',async()=>{
 const f=await fixture();await f.send('Period started today',[cycle('Period started today')]);generateObject.mockReset();await f.t.run(async ctx=>{const quota=(await ctx.db.query('quotas').withIndex('by_key',q=>q.eq('key','global')).unique())!;await ctx.db.patch(quota._id,{times:Array(500).fill(now)});});const r=await f.t.action(conversationRefs.send,{token:f.token,messageId:'summary',text:'What have I told you this week?'});expect(r.message).toContain('Cycle: period started');expect(generateObject).not.toHaveBeenCalled();
});
test('plain current-plan retrieval keeps V1 progress and completed-date copy',async()=>{
 const f=await fixture();await seedPlan(f);await f.send('Workout done today',[{k:'complete',q:'Workout done today',d:'today',t:null,x:false}]);generateObject.mockReset();const r=await f.t.action(conversationRefs.send,{token:f.token,messageId:'retrieve',text:'What is my current plan?'});expect(r.message).toContain('Completed dates:');expect(r.message).toContain('1/3');expect(generateObject).not.toHaveBeenCalled();
});
test('an older staged correction cannot overwrite a newer correction to its target',async()=>{
 const f=await fixture(true,['hot flashes']);await f.send('hot flash today',[body('hot flash today','hot flash')]);const id=(await f.view()).body[0]._id;await f.send('Actually yesterday',[correction('Actually yesterday',id,'yesterday')]);await f.t.mutation(internal.tracking.receive,{token:f.token,messageId:'newer'});await f.t.mutation(internal.tracking.reserve,{token:f.token,messageId:'newer'});await f.t.mutation(internal.tracking.apply,{token:f.token,messageId:'newer',text:'Actually 2 days ago',targetId:id,meaning:{intent:'correct',trackedItem:null,count:null,datePhrase:'2 days ago',timePhrase:null,precision:'date-only',target:null,explicitNew:false}});const r=await f.send('yes',[answer()]);expect(r.message).toContain('record changed');expect((await f.view()).body[0].occurrenceDate).toBe('2026-10-05');expect((await f.view()).pending).toHaveLength(0);
});
test('meaning-classified approved physical safety retains V1 support for nonliteral language',async()=>{
 const f=await fixture();const r=await f.send('I am struggling for air',[{k:'safety',q:'I am struggling for air',category:'breathing'}]);expect(r.message).toBe(copy.medicalSafetyReply);expect((await f.view()).safetyPaused).toBe(true);expect((await f.view()).body).toHaveLength(0);
});
test('unsupported mental candidate cannot erase an understood ordinary update or its medical question',async()=>{
 const f=await fixture(true,['low mood']);const text='low mood today. Would HRT help?';const r=await f.send(text,[body('low mood today','low mood'),{k:'safety',q:'low mood today',category:'mental'},question('Would HRT help?','medical')]);expect(r.message).toContain(copy.medicalQuestionReply);expect((await f.view()).body).toHaveLength(1);expect((await f.view()).safetyPaused).toBe(false);
});
test('explicit reference reuses a saved symptom without another duplicate question or count',async()=>{
 const f=await fixture(true,['hot flashes']);await f.send('hot flash today',[body('hot flash today','hot flash')]);const id=(await f.view()).body[0]._id;const r=await f.send('same episode as earlier',[{k:'reference',q:'same episode as earlier',target:id}]);expect(r.message).toContain('same');expect((await f.view()).body).toHaveLength(1);expect((await f.view()).pending).toHaveLength(0);
});
test('cycle duplicate checks an existing V1 cycle record as well as the separate new table',async()=>{
 const f=await fixture(true,['cycle changes']);await f.t.action(api.messages.send,{token:f.token,messageId:'legacy-cycle',text:'period started today'});expect((await f.view()).body).toHaveLength(1);const r=await f.send('period started today',[cycle('period started today')]);expect(r.message).toContain('same period started');expect((await f.view()).cycle).toHaveLength(0);
});
test('unclassified context does not add a second question beside a missing-date question',async()=>{
 const f=await fixture(true,['hot flashes']);const r=await f.send('had a hot flash. something else too',[body('had a hot flash','hot flash',1,null),{k:'conversation',q:'something else too',tone:'unclear'}]);expect((r.message.match(/\?/g)??[])).toHaveLength(1);expect(r.message).toContain('Which day');expect(r.message).not.toContain('What would you like me to remember');
});
test('context remembers distinct source reports instead of letting one count consume every context slot',async()=>{
 const f=await fixture(true,['hot flashes','night sweats']);await f.send('night sweat yesterday',[body('night sweat yesterday','night sweat',1,'yesterday')]);await f.send('10 hot flashes today',[body('10 hot flashes today','hot flashes',10)]);const c=await f.getContext();expect(c.body).toHaveLength(2);expect(c.body.map((r:any)=>r.reportedCount)).toEqual([1,10]);expect((await f.view()).body).toHaveLength(11);
});
test('a quote ending at a sentence boundary does not inherit a later medical question',async()=>{
 const f=await fixture(true,['hot flashes']);const text='had a hot flash today. Would HRT help?';const r=await f.send(text,[body('had a hot flash today.','hot flash'),question('Would HRT help?','medical')]);expect(r.message).toContain(copy.medicalQuestionReply);expect((await f.view()).body).toHaveLength(1);
});
test('one original counted report is an unambiguous backend correction target',async()=>{
 const f=await fixture(true,['hot flashes']);await f.send('3 hot flashes today',[body('3 hot flashes today','hot flashes',3)]);await f.send('Actually two, not three',[correction('Actually two, not three',null,null,2)]);await f.send('yes',[answer()]);expect((await f.view()).body).toHaveLength(2);
});
test('linked narrative stays available as owned context without a second occurrence',async()=>{
 const f=await fixture(true,['low mood']);const text='low mood today, cried a bit but I’m not in danger';await f.send(text,[body('low mood today, cried a bit','low mood'),{k:'conversation',q:'I’m not in danger',tone:'context'}]);const v=await f.view();expect(v.body).toHaveLength(1);expect(v.pending).toHaveLength(0);expect((await f.getContext()).body[0].context).toContain('cried a bit');expect(v.safetyPaused).toBe(false);
});
test('standalone narrative acknowledges that no occurrence was counted',async()=>{
 const f=await fixture();const r=await f.send('I’m not in danger',[{k:'conversation',q:'I’m not in danger',tone:'context'}]);expect((await f.view()).body).toHaveLength(0);expect(r.message).toContain('haven’t added');expect(r.message).not.toContain('?');
});
