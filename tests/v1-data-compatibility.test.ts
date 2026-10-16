import {test,expect,vi,afterEach} from 'vitest';
import {convexTest} from 'convex-test';
import {makeFunctionReference} from 'convex/server';
import oldSchema from './fixtures/v1-schema';
import schema from '../convex/schema';
import {api,internal} from '../convex/_generated/api';
const modules=import.meta.glob('../convex/**/*.*s');
afterEach(()=>vi.unstubAllEnvs());
test('V2 retains every committed V1 table, field validator and index; added fields are optional',()=>{
 for(const [name,table] of Object.entries(oldSchema.tables)){
  const next=(schema.tables as any)[name];expect(next,name).toBeDefined();
  const oldFields=(table.validator as any).fields,nextFields=next.validator.fields;
  for(const [field,validator] of Object.entries(oldFields))expect(nextFields[field].json,name+'.'+field).toEqual((validator as any).json);
  for(const [field,validator] of Object.entries(nextFields))if(!(field in oldFields))expect((validator as any).isOptional,name+'.'+field).toBe('optional');
  for(const index of (table as any)[' indexes']())expect(next[' indexes']()).toContainEqual(index);
 }
});
test('legacy account and saved occurrence survive V2 reads, with no implicit enrollment or consent',async()=>{
 const t=convexTest(schema,modules);let token='synthetic-legacy-compatibility';
 const id=await t.run(async ctx=>{
  const userId=await ctx.db.insert('users',{token,label:'Synthetic compatibility user',jobId:'legacy-job',timezone:'Asia/Kolkata',startDate:'2026-10-02',endDate:'2026-10-08',trackedItems:['hot flashes']});
  return ctx.db.insert('occurrences',{userId,jobId:'legacy-job',trackedItem:'hot flashes',rawText:'synthetic hot flash today',occurrenceDate:'2026-10-08',occurrenceTime:null,timePrecision:'date-only',messageReceivedAt:1791470000000,source:'user',status:'active',confirmationState:'confirmed',batchId:'legacy-batch'});
 });
 const before=await t.run(ctx=>ctx.db.get(id));
 for(const gate of ['off','candidate']){
  vi.stubEnv('INTUNE_CONVERSATION_GATE',gate);
  expect(await t.query(makeFunctionReference<'query'>('conversationStore:route'),{token})).toBe('v1');
  const view=await t.query(makeFunctionReference<'query'>('conversationStore:view'),{token});expect(view.body).toHaveLength(1);expect(view.consent).toBe(false);
  expect(await t.run(ctx=>ctx.db.get(id))).toEqual(before);
 }
 const summary=await t.query(api.tracking.getSummary,{token});expect(summary.records).toHaveLength(1);
});
