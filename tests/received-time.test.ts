import {test,expect,vi,beforeEach,afterEach} from 'vitest';
import fs from 'node:fs';
import {convexTest} from 'convex-test';
import schema from '../convex/schema';
import {api} from '../convex/_generated/api';
const generateObject=vi.hoisted(()=>vi.fn());
vi.mock('@convex-dev/agent',()=>({Agent:class{generateObject=generateObject;}}));
const modules=import.meta.glob('../convex/**/*.*s');
const first=Date.parse('2026-10-04T23:59:00+05:30');
const next=Date.parse('2026-10-05T00:01:00+05:30');
const meaning={intent:'record',trackedItem:'brain fog',count:1,datePhrase:'yesterday',timePhrase:null,precision:'date-only',target:null,explicitNew:false};
let clock:number;
beforeEach(()=>{clock=first;vi.spyOn(Date,'now').mockImplementation(()=>clock);vi.stubEnv('OPENAI_API_KEY','noncredential-test-placeholder');generateObject.mockReset();});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs();});
async function setup(){const t=convexTest(schema,modules);const pair=await t.mutation(api.tracking.createTestPair,{});return {t,pair};}
test('message received before midnight keeps its saved anchor when AI finishes after midnight',async()=>{
 const {t,pair}=await setup();
 generateObject.mockImplementationOnce(async()=>{clock=next;return {object:meaning};});
 const result=await t.action(api.messages.send,{token:pair.A,messageId:'midnight',text:'Brain fog yesterday'});
 expect(result.outcome).toBe('stored');expect(result.messageReceivedAt).toBe(first);
 expect(result.view.records[0].messageReceivedAt).toBe(first);expect(result.view.records[0].occurrenceDate).toBe('2026-10-03');
 await t.run(async ctx=>{const r=await ctx.db.query('receipts').collect();expect(r[0].messageReceivedAt).toBe(first);});
 fs.writeFileSync('output/received-time-midnight-test.json',JSON.stringify({test:'Controlled clock only inside tests: AI completes after midnight',input:'Brain fog yesterday',timezone:'Asia/Kolkata',messageReceivedAt:result.messageReceivedAt,receivedTimeUTC:new Date(result.messageReceivedAt).toISOString(),aiCompletedAt:clock,resolvedDate:result.view.records[0].occurrenceDate,replyText:result.message,storedRecords:result.view.records,sevenDayCount:result.view.sevenDayCount},null,2)+'\n');
});
test('two received days resolve yesterday independently in the user timezone',async()=>{
 const {t,pair}=await setup();generateObject.mockResolvedValue({object:meaning});
 const a=await t.action(api.messages.send,{token:pair.A,messageId:'one',text:'Brain fog yesterday'});
 clock=next;
 const b=await t.action(api.messages.send,{token:pair.A,messageId:'two',text:'Brain fog yesterday'});
 expect(a.view.records[0].occurrenceDate).toBe('2026-10-03');
 expect(b.view.records.map((r:any)=>r.occurrenceDate)).toEqual(['2026-10-03','2026-10-04']);
 expect(b.view.records.map((r:any)=>r.messageReceivedAt)).toEqual([first,next]);
});
test('a clarification answered a day later uses the original message date and time',async()=>{
 clock=Date.parse('2026-10-04T10:00:00+05:30');const original=clock;
 const {t,pair}=await setup();generateObject.mockResolvedValue({object:{...meaning,datePhrase:null,timePhrase:'4pm',precision:'exact'}});
 const question=await t.action(api.messages.send,{token:pair.A,messageId:'question',text:'Brain fog at 4pm.'});
 expect(question.outcome).toBe('clarification');expect(question.message).toContain('Which day');expect(question.message).not.toContain('earlier today');
 clock=Date.parse('2026-10-05T17:00:00+05:30');
 const answer=await t.mutation(api.tracking.resolvePending,{token:pair.A,pendingId:question.pendingId,choice:'clarify',datePhrase:'yesterday'});
 expect(answer.view.records[0].occurrenceDate).toBe('2026-10-03');expect(answer.view.records[0].messageReceivedAt).toBe(original);
 expect(answer.messageReceivedAt).toBe(clock);expect(answer.originalMessageReceivedAt).toBe(original);
 fs.writeFileSync('output/received-time-clarification-test.json',JSON.stringify({test:'Controlled clock only inside tests: clarification answered the next day',timezone:'Asia/Kolkata',original:{input:'Brain fog at 4pm.',messageReceivedAt:question.messageReceivedAt,receivedTimeUTC:new Date(question.messageReceivedAt).toISOString(),resolvedDate:null,replyText:question.message,storedRecords:question.view.records,sevenDayCount:question.view.sevenDayCount},answer:{input:'yesterday',messageReceivedAt:answer.messageReceivedAt,receivedTimeUTC:new Date(answer.messageReceivedAt).toISOString(),originalMessageReceivedAt:answer.originalMessageReceivedAt,resolvedDate:answer.view.records[0].occurrenceDate,replyText:answer.message,storedRecords:answer.view.records,sevenDayCount:answer.view.sevenDayCount}},null,2)+'\n');
});
test('commands and failed AI messages also save received times without storing their text',async()=>{
 const {t,pair}=await setup();vi.stubEnv('OPENAI_API_KEY','');
 const command=await t.action(api.messages.send,{token:pair.B,messageId:'pause',text:'Pause'});
 const failure=await t.action(api.messages.send,{token:pair.A,messageId:'fail',text:'Brain fog yesterday'});
 expect(command.messageReceivedAt).toBe(first);expect(failure.messageReceivedAt).toBe(first);
 await t.run(async ctx=>{const receipts=await ctx.db.query('receipts').collect();expect(receipts).toHaveLength(2);for(const r of receipts){expect(r.messageReceivedAt).toBe(first);expect(r).not.toHaveProperty('rawText');}});
});
test('summary reply lists only own in-window records as text',async()=>{
 const {t,pair}=await setup();generateObject.mockResolvedValue({object:meaning});
 await t.action(api.messages.send,{token:pair.A,messageId:'a',text:'Brain fog yesterday'});
 generateObject.mockResolvedValue({object:{...meaning,trackedItem:'poor sleep',datePhrase:'last night'}});
 await t.action(api.messages.send,{token:pair.B,messageId:'b',text:'Poor sleep last night.'});
 const reply=await t.action(api.messages.send,{token:pair.B,messageId:'summary',text:'What have I told you this week?'});
 expect(reply.message).toContain('poor sleep');expect(reply.message).toContain('poor sleep: 1 time: today.');expect(reply.message).toContain('poor sleep: 1 time:');
 expect(reply.message).not.toContain('brain fog');expect(reply.message).not.toContain('shown below');
});

test('retrieval after midnight refreshes labels without changing stored dates; repeated delivery keeps its anchor',async()=>{
 const {t,pair}=await setup();generateObject.mockResolvedValue({object:{...meaning,datePhrase:'today',timePhrase:'9am',precision:'approximate'}});
 const original=await t.action(api.messages.send,{token:pair.A,messageId:'retry-midnight',text:'Brain fog today around 9am'});
 expect(original.message).toBe('Got it, brain fog today around 9am.');
 clock=next;
 const retry=await t.action(api.messages.send,{token:pair.A,messageId:'retry-midnight',text:'Brain fog today around 9am'});
 expect(retry.outcome).toBe('provider_duplicate');expect(retry.messageReceivedAt).toBe(first);expect(generateObject).toHaveBeenCalledTimes(1);
 const reply=await t.action(api.messages.send,{token:pair.A,messageId:'next-summary',text:'What have I told you this week?'});
 expect(reply.message).toContain('brain fog: 1 time: yesterday around 9am.');
 expect(reply.view.records).toHaveLength(1);expect(reply.view.records[0].occurrenceDate).toBe('2026-10-04');expect(reply.view.records[0].timePrecision).toBe('approximate');expect(reply.view.records[0].messageReceivedAt).toBe(first);
});
