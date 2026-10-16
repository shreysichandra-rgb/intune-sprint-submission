import { test, expect, vi, beforeEach, afterEach } from 'vitest';
import { convexTest } from 'convex-test';
import schema from '../convex/schema';
import { api, internal } from '../convex/_generated/api';
import { resolveWhen, resolveDate } from '../convex/rules';
const TEST_NOW = Date.parse('2026-10-04T10:00:00+05:30');
beforeEach(() => {vi.spyOn(Date, 'now').mockReturnValue(TEST_NOW);});
afterEach(() => {vi.restoreAllMocks();});
const modules = import.meta.glob('../convex/**/*.*s');
const record = { intent: 'record', trackedItem: 'brain fog', count: 1, datePhrase: 'today', timePhrase: '9am', precision: 'exact', target: null, explicitNew: false };
async function setup() { const t = convexTest(schema, modules); const pair = await t.mutation(api.tracking.createTestPair, {}); return {t,pair}; }
async function submit(t:any, token:string, text:string, meaning:any, targetId?:string) {
  const messageId = crypto.randomUUID();
  await t.mutation(internal.tracking.reserve, {token, messageId});
  return t.mutation(internal.tracking.apply, {token, messageId, text, meaning, ...(targetId ? {targetId} : {})});
}
test('missing and future time-only dates ask, while past time-only follows the written rule', () => {
  expect(resolveWhen({datePhrase:null,timePhrase:null},TEST_NOW,'Asia/Kolkata').question).toBeTruthy();
  expect(resolveWhen({datePhrase:null,timePhrase:'4pm'},TEST_NOW,'Asia/Kolkata').date).toBeNull();
  expect(resolveWhen({datePhrase:null,timePhrase:'9am'},TEST_NOW,'Asia/Kolkata').date).toBe('2026-10-04');
  expect(resolveDate('yesterday',TEST_NOW,'Asia/Kolkata')).toBe('2026-10-03');
  expect(resolveDate('last night',TEST_NOW,'Asia/Kolkata')).toBe('2026-10-04');
  expect(resolveDate('2026-02-30',TEST_NOW,'Asia/Kolkata')).toBeNull();
});
test('two occurrences become one in-window after correction; history still contains two', async () => {
  const {t,pair} = await setup();
  const before = await submit(t,pair.A,'Brain fog twice yesterday.',{...record,count:2,datePhrase:'yesterday',timePhrase:null,precision:'date-only'});
  expect(before.view.sevenDayCount).toBe(2);
  const after = await submit(t,pair.A,'Actually one of those was 8 days ago.',{...record,intent:'correct',trackedItem:null,count:null,datePhrase:'8 days ago',timePhrase:null,precision:'date-only',target:'one_of_last'}, before.changedIds[0]);
  expect(after.view.totalStored).toBe(2); expect(after.view.sevenDayCount).toBe(1);
  expect(after.view.records.find((r:any)=>r._id===before.changedIds[0]).occurrenceDate).toBe('2026-09-26');
});
test('provider repeats and possible user duplicates never silently add counts', async () => {
  const {t,pair} = await setup();
  const messageId = 'provider-fixed';
  await t.mutation(internal.tracking.reserve,{token:pair.A,messageId});
  const first = await t.mutation(internal.tracking.apply,{token:pair.A,messageId,text:'Brain fog today at 9am.',meaning:record});
  expect((await t.mutation(internal.tracking.reserve,{token:pair.A,messageId})).proceed).toBe(false);
  const repeated = await submit(t,pair.A,'Brain fog today at 9am.',record);
  expect(repeated.outcome).toBe('possible_duplicate'); expect(repeated.view.sevenDayCount).toBe(1);
  const same = await t.mutation(api.tracking.resolvePending,{token:pair.A,pendingId:repeated.pendingId,choice:'same'});
  expect(same.view.sevenDayCount).toBe(1);
  const reference = await submit(t,pair.A,'Same episode I mentioned earlier.',{...record,intent:'reference',count:null,trackedItem:null,datePhrase:null,timePhrase:null}, first.changedIds[0]);
  expect(reference.view.totalStored).toBe(1);
});
test('unresolved date and ambiguous reference do not count; confirmed date does', async () => {
  const {t,pair} = await setup();
  const result = await submit(t,pair.A,'Brain fog at 4pm.',{...record,datePhrase:null,timePhrase:'4pm'});
  expect(result.view.sevenDayCount).toBe(0);
  const resolved = await t.mutation(api.tracking.resolvePending,{token:pair.A,pendingId:result.pendingId,choice:'clarify',datePhrase:'yesterday'});
  expect(resolved.view.sevenDayCount).toBe(1); expect(resolved.view.records[0].occurrenceTime).toBe('16:00');
  await submit(t,pair.A,'Brain fog again yesterday.',{...record,datePhrase:'yesterday',timePhrase:null,explicitNew:true});
  const ambiguous = await submit(t,pair.A,'Same episode I mentioned earlier.',{...record,intent:'reference',count:null,trackedItem:null,datePhrase:null,timePhrase:null});
  expect(ambiguous.outcome).toBe('clarification'); expect(ambiguous.view.sevenDayCount).toBe(2);
});
test('user B cannot retrieve, change, resolve, or forget user A content', async () => {
  const {t,pair} = await setup();
  const a = await submit(t,pair.A,'Brain fog today at 9am.',record);
  const pending = await submit(t,pair.A,'Brain fog today at 9am.',record);
  const b = await t.query(api.tracking.getSummary,{token:pair.B});
  expect(b.records).toEqual([]); expect(b.pending).toEqual([]); expect(b.sevenDayCount).toBe(0);
  await expect(t.mutation(api.tracking.forget,{token:pair.B,occurrenceId:a.changedIds[0]})).rejects.toThrow('not available');
  await expect(t.mutation(api.tracking.resolvePending,{token:pair.B,pendingId:pending.pendingId,choice:'same'})).rejects.toThrow('not available');
  await expect(submit(t,pair.B,'Actually yesterday.',{...record,intent:'correct',count:null,datePhrase:'yesterday'},a.changedIds[0])).rejects.toThrow('not available');
  await expect(t.query(api.tracking.getSummary,{token:'not-a-token'})).rejects.toThrow('session isn’t available');
});
test('forget physically removes health content and linked unresolved messages', async () => {
  const {t,pair} = await setup();
  const a = await submit(t,pair.A,'Brain fog today at 9am.',record);
  await submit(t,pair.A,'Brain fog today at 9am.',record);
  const forgotten = await t.mutation(api.tracking.forget,{token:pair.A,occurrenceId:a.changedIds[0]});
  expect(forgotten.view.totalStored).toBe(0); expect(forgotten.view.pending).toEqual([]);
  await t.run(async ctx => { expect(await ctx.db.get(a.changedIds[0])).toBeNull(); const markers=await ctx.db.query('deletionMarkers').collect(); expect(Object.keys(markers[0]).sort()).toEqual(['_creationTime','_id','deletedAt','jobId'].sort()); });
});
test('count corrections reduce occurrences rather than retain erased content', async () => {
  const {t,pair}=await setup();
  const a=await submit(t,pair.A,'Brain fog twice yesterday.',{...record,count:2,datePhrase:'yesterday',timePhrase:null});
  const corrected=await submit(t,pair.A,'I said twice, but it happened once.',{...record,intent:'correct',count:1,datePhrase:null,timePhrase:null,target:'all_of_last'},a.changedIds[0]);
  expect(corrected.view.totalStored).toBe(1); expect(corrected.view.sevenDayCount).toBe(1);
});
test('hourly quota reservations are atomic and do not charge provider duplicates', async () => {
  const {t,pair}=await setup();
  for(let i=0;i<20;i++){vi.mocked(Date.now).mockReturnValue(TEST_NOW+Math.floor(i/10)*60000);await t.mutation(internal.tracking.reserve,{token:pair.A,messageId:String(i)});}
  expect((await t.mutation(internal.tracking.reserve,{token:pair.A,messageId:'0'})).proceed).toBe(false);
  await expect(t.mutation(internal.tracking.reserve,{token:pair.A,messageId:'over-cap'})).rejects.toThrow('personal_hourly');
});
test('a date/count correction with an unclear date changes nothing until clarified', async () => {
  const {t,pair}=await setup();
  const a=await submit(t,pair.A,'Brain fog twice yesterday.',{...record,count:2,datePhrase:'yesterday',timePhrase:null});
  const unclear=await submit(t,pair.A,'Actually once sometime last week.',{...record,intent:'correct',count:1,datePhrase:'sometime last week',timePhrase:null,target:'all_of_last'},a.changedIds[0]);
  expect(unclear.outcome).toBe('clarification');expect(unclear.view.totalStored).toBe(2);expect(unclear.view.sevenDayCount).toBe(2);
});
test('model-invented date phrases cannot create an occurrence', async () => {
  const {t,pair}=await setup();
  const invented=await submit(t,pair.A,'Brain fog.',record);
  expect(invented.view.totalStored).toBe(0);expect(invented.outcome).toBe('clarification');
});
test('seven local calendar days include both boundary dates, not the day before', async () => {
  const {t,pair}=await setup();
  await submit(t,pair.A,'Brain fog on 2026-09-27.',{...record,datePhrase:'2026-09-27',timePhrase:null});
  await submit(t,pair.A,'Brain fog on 2026-09-28.',{...record,datePhrase:'2026-09-28',timePhrase:null});
  await submit(t,pair.A,'Brain fog today at 9am.',record);
  const view=await t.query(api.tracking.getSummary,{token:pair.A});
  expect(view.totalStored).toBe(3);expect(view.sevenDayCount).toBe(2);
});
test('creating extra fictional users does not bypass the global hourly AI cap', async () => {
 const {t,pair}=await setup();await t.run(async c=>{await c.db.insert('quotas',{key:'global',times:Array(500).fill(TEST_NOW)});});
 await expect(t.mutation(internal.tracking.reserve,{token:pair.B,messageId:'global-cap'})).rejects.toThrow('shared_capacity');
});
test('an explicit today date cannot bypass the future-time clarification', () => {
  expect(resolveWhen({datePhrase:'today',timePhrase:'4pm'},TEST_NOW,'Asia/Kolkata').date).toBeNull();
});
test('references persist a link without another occurrence; forgetting removes the link', async () => {
  const {t,pair}=await setup();
  const a=await submit(t,pair.A,'Brain fog today at 9am.',record);
  await submit(t,pair.A,'Same episode I mentioned earlier.',{...record,intent:'reference',count:null,trackedItem:null,datePhrase:null,timePhrase:null},a.changedIds[0]);
  await t.run(async ctx=>{const links=await ctx.db.query('references').collect();expect(links.length).toBe(1);expect(links[0].occurrenceId).toBe(a.changedIds[0]);});
  await t.mutation(api.tracking.forget,{token:pair.A,occurrenceId:a.changedIds[0]});
  await t.run(async ctx=>{expect(await ctx.db.query('references').collect()).toEqual([]);});
});
