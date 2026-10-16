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
beforeEach(()=>{vi.spyOn(Date,'now').mockReturnValue(now);vi.stubEnv('OPENAI_API_KEY','');generateObject.mockReset();vi.spyOn(console,'info').mockImplementation(()=>{});});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs();});
async function setup(){const t=convexTest(schema,modules),pair=await t.mutation(api.tracking.createTestPair,{});return {t,pair,send:(text:string,id=crypto.randomUUID(),token=pair.A)=>t.action(api.messages.send,{token,messageId:id,text})};}
const triggers=[['chest','chest pain'],['breathing','difficulty breathing'],['faint','I fainted'],['sudden','sudden numbness'],['face','facial droop'],['speech','difficulty speaking'],['head','headache'],['bleed','heavy bleeding'],['allergy','allergic reaction'],['rash','skin rash'],['seizure','seizure'],['abdomen','abdominal pain'],['pelvis','pelvic pain'],['temperature','fever'],['urinary','urinary symptoms'],['bowel','diarrhoea']];
test.each(triggers)('approved physical category %s interrupts capture without AI',async(_id,text)=>{
 const f=await setup();const r=await f.send(text);expect(r.message).toBe(copy.medicalSafetyReply);expect(r.outcome).toBe('safety');expect((await f.t.query(api.tracking.getSummary,{token:f.pair.A})).records).toEqual([]);expect((await f.t.query(api.plans.getPlan,{token:f.pair.A})).records).toEqual([]);expect(generateObject).not.toHaveBeenCalled();
});
test('mental danger uses separate exact approved reply and takes priority over physical category',async()=>{const f=await setup();expect((await f.send('I want to kill myself and have chest pain')).message).toBe(copy.mentalSafetyReply);});
test('Option B requires question then explicit yes; pause survives ordinary text, greeting and repeated yes delivery',async()=>{
 const f=await setup();await f.send('headache');const first=await f.send('brain fog today');expect(first.message).toBe(copy.safetyReturnQuestion);expect((await f.send('Hi')).message).toBe(copy.safetyReturnQuestion);expect((await f.send('3')).message).toBe(copy.safetyReturnQuestion);expect((await f.send('no')).message).toBe(copy.safetyReturnQuestion);expect((await f.send('yes','release')).outcome).toBe('safety_resumed');expect((await f.send('yes','release')).outcome).toBe('provider_duplicate');
 vi.stubEnv('OPENAI_API_KEY','synthetic');generateObject.mockResolvedValue({object:record});const logged=await f.send('brain fog today');expect(logged.outcome).toBe('stored');expect(logged.view.records).toHaveLength(1);
});
test('new trigger resets the continuation check, and commands cannot clear independent safety pause',async()=>{
 const f=await setup();await f.send('headache');await f.send('brain fog today');await f.send('fever');expect((await f.send('yes')).message).toBe(copy.safetyReturnQuestion);for(const cmd of ['Pause','Resume','Stop','Start'])await f.send(cmd);const r=await f.send('Track my workouts?');expect(r.message).toBe(copy.safetyReturnQuestion);expect((await f.t.query(api.plans.getPlan,{token:f.pair.A})).pending).toEqual([]);
 await f.send('Delete my pilot data');expect((await f.send('brain fog today')).message).toBe(copy.safetyReturnQuestion);expect((await f.t.query(api.tracking.getSummary,{token:f.pair.A})).records).toEqual([]);
});
test('safety is isolated, blocks direct resolvers, preserves specific pending questions and suppresses queued output',async()=>{
 const f=await setup();vi.stubEnv('OPENAI_API_KEY','synthetic');generateObject.mockResolvedValueOnce({object:{...record,datePhrase:null}});const q=await f.send('brain fog');await f.send('Track my workouts?');await f.send('3');const before=await f.t.query(api.plans.getPlan,{token:f.pair.A});const queued=await f.t.run(async ctx=>{const u=(await ctx.db.query('users').withIndex('by_token',q=>q.eq('token',f.pair.A)).unique())!;return ctx.db.insert('proactiveOutputs',{userId:u._id,jobId:u.jobId,kind:'summary',status:'queued',body:'synthetic'});});await f.send('headache');expect(await f.t.query(internal.commands.deliveryPermitted,{outputId:queued})).toBe(false);
 expect((await f.t.mutation(api.plans.resolve,{token:f.pair.A,pendingId:before.pending[0]._id,choice:'confirm'})).outcome).toBe('safety_paused');
 const direct=await f.t.mutation(api.tracking.resolvePending,{token:f.pair.A,pendingId:q.pendingId,choice:'clarify',datePhrase:'today'});expect(direct.outcome).toBe('safety_paused');expect((await f.t.query(api.tracking.getSummary,{token:f.pair.A})).pending[0]._id).toBe(q.pendingId);expect((await f.t.query(api.plans.getPlan,{token:f.pair.A})).pending[0]._id).toBe(before.pending[0]._id);
 generateObject.mockResolvedValueOnce({object:record});expect((await f.send('brain fog today',undefined,f.pair.B)).outcome).toBe('stored');expect((await f.t.query(api.tracking.getSummary,{token:f.pair.A})).records).toEqual([]);
});

test.each(['yes','Yeah'])('safety continuation %s does not confirm earlier plan; a separate yes confirms preserved draft',async answer=>{
 const f=await setup();await f.send('Track my workouts?');await f.send('3');await f.send('headache');await f.send('brain fog today');await f.send(answer);expect((await f.t.query(api.plans.getPlan,{token:f.pair.A})).plan).toBeNull();await f.send('yes');expect((await f.t.query(api.plans.getPlan,{token:f.pair.A})).plan?.targetNumber).toBe(3);
});
test('constrained AI safety candidate routes approved category before ordinary writes and logs metadata only',async()=>{
 const f=await setup();vi.stubEnv('OPENAI_API_KEY','synthetic');generateObject.mockResolvedValue({object:{...record,intent:'clarify',safetyCategory:'breathing',safetyEvidence:'struggling for air'}});const r=await f.send('I am struggling for air');expect(r.message).toBe(copy.medicalSafetyReply);expect((await f.t.query(api.tracking.getSummary,{token:f.pair.A})).records).toEqual([]);const logger=vi.mocked(console.info);for(const [line] of logger.mock.calls){const v=JSON.parse(String(line));expect(Object.keys(v).sort()).toEqual(['aiIntent','messageId','replyEntry','route']);expect(String(line)).not.toContain('struggling');}
});
test('delayed ordinary AI result after safety activation cannot create health records',async()=>{
 const f=await setup();vi.stubEnv('OPENAI_API_KEY','synthetic');let resolve:any;let started:any;const began=new Promise(r=>started=r);generateObject.mockImplementation(()=>{started();return new Promise(r=>resolve=r);});const pending=f.send('brain fog today');await began;await f.send('headache');resolve({object:record});expect((await pending).outcome).toBe('dropped');expect((await f.t.query(api.tracking.getSummary,{token:f.pair.A})).records).toEqual([]);
});

test.each(['Yeah','yep','Yeah!','yeah.'])('explicit return answer %s works only after the safety question and retries are idempotent',async answer=>{
 const f=await setup();await f.send('headache');expect((await f.send(answer)).message).toBe(copy.safetyReturnQuestion);const reply=await f.send(answer,'natural-return');expect(reply.outcome).toBe('safety_resumed');expect((await f.send(answer,'natural-return')).outcome).toBe('provider_duplicate');expect((await f.t.query(api.tracking.getSummary,{token:f.pair.A})).records).toHaveLength(0);expect(generateObject).not.toHaveBeenCalled();
});
test('V3 natural safety return and duplicate require no AI call or health writes',async()=>{
 vi.stubEnv('INTUNE_PILOT_MODE','v3');vi.stubEnv('INTUNE_CONVERSATION_GATE','candidate');vi.stubEnv('INTUNE_CONVERSATION_ROLLOUT','all');vi.stubEnv('INTUNE_IMPLIED_SAVING','1');vi.stubEnv('INTUNE_SEMANTIC_BRIDGE','1');const f=await setup();await f.t.mutation(internal.conversationStore.enroll,{token:f.pair.A});await f.send('headache');expect((await f.send('Yeah')).message).toBe(copy.safetyReturnQuestion);expect((await f.send('Yeah','v3-natural-return')).outcome).toBe('safety_resumed');expect((await f.send('Yeah','v3-natural-return')).outcome).toBe('provider_duplicate');expect((await f.t.query(api.tracking.getSummary,{token:f.pair.A})).records).toHaveLength(0);expect(generateObject).not.toHaveBeenCalled();
});
test('a mixed affirmative and new safety trigger never resumes tracking',async()=>{const f=await setup();await f.send('headache');await f.send('no');expect((await f.send('Yeah but chest pain')).outcome).toBe('safety');expect((await f.send('Yeah')).message).toBe(copy.safetyReturnQuestion);expect((await f.t.query(api.tracking.getSummary,{token:f.pair.A})).records).toHaveLength(0);});
