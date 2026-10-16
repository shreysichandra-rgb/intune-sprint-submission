import {test,expect,vi,beforeEach,afterEach} from 'vitest';
import {convexTest} from 'convex-test';
import schema from '../convex/schema';
import {api,internal} from '../convex/_generated/api';
const generateObject=vi.hoisted(()=>vi.fn());
vi.mock('@convex-dev/agent',()=>({Agent:class{generateObject=generateObject;}}));
const modules=import.meta.glob('../convex/**/*.*s');
const now=Date.parse('2026-10-07T09:00:00+05:30');
const record={intent:'record',trackedItem:'hot flashes',count:1,datePhrase:'today',timePhrase:null,precision:'date-only',target:null,explicitNew:false};
beforeEach(()=>{vi.spyOn(Date,'now').mockReturnValue(now);vi.stubEnv('OPENAI_API_KEY','synthetic');generateObject.mockReset();vi.spyOn(console,'info').mockImplementation(()=>{});});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs();});
async function fixture(items:string[]){const t=convexTest(schema,modules),token=await t.mutation(internal.phoneUsers.getOrCreate,{phoneNumber:'+12025550194'});await t.action(api.messages.send,{token,messageId:'setup',text:'track '+items.join(' and ')});return {t,token,send:(text:string,id=crypto.randomUUID())=>t.action(api.messages.send,{token,messageId:id,text}),view:()=>t.query(api.tracking.getSummary,{token}),version:()=>t.run(async ctx=>(await ctx.db.query('users').withIndex('by_token',q=>q.eq('token',token)).unique())?.memoryVersion??0)};}
test.each([
 ['I had a hot flash today','I didn’t have any hot flashes today','hot flashes','today'],
 ["I had a hot flash today","I didn't have any hot flashes today",'hot flashes','today'],
 ['hot flash today','no hot flashes today','hot flashes','today'],
 ['had brain fog today','haven’t had brain fog today','brain fog','today'],
 ['had one night sweat last night','no night sweats last night','night sweats','last night'],
])('positive/negative report pair %# never counts the denial even if AI returns record',async(positive,negative,item,date)=>{
 const f=await fixture([item]);generateObject.mockResolvedValue({object:{...record,trackedItem:item,datePhrase:date}});
 await f.send(positive);const before=await f.view();expect(before.records).toHaveLength(1);
 const denial=await f.send(negative);const after=await f.view();expect(after.records).toEqual(before.records);expect(after.sevenDayCount).toBe(1);expect(denial.outcome).not.toBe('stored');
 expect(generateObject).toHaveBeenCalled();
 const fresh=await fixture([item]);await fresh.send(negative);expect((await fresh.view()).records).toEqual([]);
});
test('negative report before tracker selection cannot become a positive setup confirmation',async()=>{const t=convexTest(schema,modules),token=await t.mutation(internal.phoneUsers.getOrCreate,{phoneNumber:'+12025550195'});generateObject.mockResolvedValue({object:record});await t.action(api.messages.send,{token,messageId:'negative',text:'no hot flashes today'});let view=await t.query(api.tracking.getSummary,{token});expect(view.user.trackedItems).toEqual([]);expect(view.records).toEqual([]);expect(view.pending.every(p=>p.proposal?.intent!=='tracking_setup')).toBe(true);});
test('clear denial follows AI interpretation and preserves a specific unresolved question',async()=>{const f=await fixture(['hot flashes']);await f.send('had a hot flash');const pending=(await f.view()).pending[0];generateObject.mockResolvedValue({object:{...record,intent:'clarify',count:null}});await f.send('no hot flashes today');const view=await f.view();expect(view.records).toEqual([]);expect(view.pending.some(p=>p._id===pending._id)).toBe(true);expect(generateObject).toHaveBeenCalledTimes(1);});
function deferred(){let finish!:(value:any)=>void;let started!:()=>void;const signal=new Promise<void>(r=>{started=r;});const promise=new Promise<any>(r=>{finish=r;});return {finish,started,signal,promise};}
test.each(['record','correct','clarify'])('newer natural write rejects a late AI %s and leaves newer state intact',async intent=>{
 const f=await fixture(['brain fog','hot flashes']);generateObject.mockResolvedValueOnce({object:{...record,trackedItem:'brain fog'}});const seed=await f.send('brain fog today');
 const wait=deferred();generateObject.mockImplementationOnce(()=>{wait.started();return wait.promise;});
 const message=intent==='correct'?'Actually the brain fog was yesterday.':intent==='clarify'?'Brain fog?':'brain fog yesterday';
 const running=f.t.action(api.messages.send,{token:f.token,messageId:'older-ai',text:message,...(intent==='correct'?{targetId:seed.changedIds[0]}:{})});await wait.signal;
 const versionBefore=await f.version();const newer=await f.send('hot flash right now','newer-natural');expect(newer.outcome).toBe('stored');const afterNewer=await f.view();const newerVersion=await f.version();expect(newerVersion).toBeGreaterThan(versionBefore);
 wait.finish({object:{...record,intent,trackedItem:intent==='correct'?null:'brain fog',count:intent==='clarify'||intent==='correct'?null:1,datePhrase:intent==='clarify'?null:'yesterday',target:intent==='correct'?'latest':null}});
 const late=await running;expect(late.outcome).toBe('dropped');const afterLate=await f.view();expect(afterLate.records).toEqual(afterNewer.records);expect(afterLate.pending).toEqual(afterNewer.pending);expect(await f.version()).toBe(newerVersion);
});
test('a natural pending setup also advances an initially absent version and rejects older AI',async()=>{
 const t=convexTest(schema,modules),token=await t.mutation(internal.phoneUsers.getOrCreate,{phoneNumber:'+12025550196'});
 const wait=deferred();generateObject.mockImplementationOnce(()=>{wait.started();return wait.promise;});const older=t.action(api.messages.send,{token,messageId:'older',text:'Something happened'});await wait.signal;
 await t.action(api.messages.send,{token,messageId:'newer',text:'hot flash today'});const newer=await t.query(api.tracking.getSummary,{token});expect(newer.records).toEqual([]);expect(newer.pending).toHaveLength(1);expect(newer.pending[0].proposal.intent).toBe('tracking_setup');
 wait.finish({object:{...record,intent:'clarify',trackedItem:null,count:null,datePhrase:null}});expect((await older).outcome).toBe('dropped');expect((await t.query(api.tracking.getSummary,{token})).pending).toEqual(newer.pending);
});
test('a natural acknowledgement without a data change does not invalidate older AI',async()=>{
 const f=await fixture(['brain fog','hot flashes']);const wait=deferred();generateObject.mockImplementationOnce(()=>{wait.started();return wait.promise;});const older=f.send('brain fog today','older');await wait.signal;
 const before=await f.version();await f.send('track hot flashes','ack-only');expect(await f.version()).toBe(before);wait.finish({object:{...record,trackedItem:'brain fog'}});expect((await older).outcome).toBe('stored');expect((await f.view()).records).toHaveLength(1);
});
test('a negative answer to an existing generic question cannot bypass record validation',async()=>{const f=await fixture(['hot flashes']);generateObject.mockResolvedValueOnce({object:{...record,intent:'clarify',trackedItem:null,count:null,datePhrase:null}});await f.send('Something happened');generateObject.mockResolvedValueOnce({object:record});await f.send('I did not have any hot flashes today');expect((await f.view()).records).toEqual([]);});
