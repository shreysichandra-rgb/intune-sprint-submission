import {test,expect,vi,afterEach} from 'vitest';
import {convexTest} from 'convex-test';
import {makeFunctionReference} from 'convex/server';
import schema from '../convex/schema';
import {internal} from '../convex/_generated/api';
import {verificationFailureKind} from '../convex/verificationDiagnostics';
const modules=import.meta.glob('../convex/**/*.*s');
const reset=makeFunctionReference<'mutation'>('verificationFixtures:reset');
afterEach(()=>vi.unstubAllEnvs());
function enabled(){vi.stubEnv('CONVEX_CLOUD_URL','https://disciplined-mammoth-312.convex.cloud');vi.stubEnv('INTUNE_SYNTHETIC_TRANSPORT','1');vi.stubEnv('INTUNE_CONVERSATION_GATE','candidate');}
test('fixture reset rejects another deployment and real phone numbers',async()=>{
 const t=convexTest(schema,modules),token=await t.mutation(internal.phoneUsers.getOrCreate,{phoneNumber:'+12025550100'});
 enabled();vi.stubEnv('CONVEX_CLOUD_URL','https://other.convex.cloud');await expect(t.mutation(reset,{token,jobId:crypto.randomUUID(),enroll:true})).rejects.toThrow('Isolated');
 enabled();const real=await t.mutation(internal.phoneUsers.getOrCreate,{phoneNumber:'+12025550999'});await expect(t.mutation(reset,{token:real,jobId:crypto.randomUUID(),enroll:true})).rejects.toThrow('Synthetic');
});
test('synthetic reset uses deletion, keeps quotas, is idempotent and is disabled after cleanup',async()=>{
 const t=convexTest(schema,modules),token=await t.mutation(internal.phoneUsers.getOrCreate,{phoneNumber:'+12025550100'});enabled();
 const userId=await t.run(async ctx=>{const u=(await ctx.db.query('users').withIndex('by_token',q=>q.eq('token',token)).unique())!;await ctx.db.insert('quotas',{key:'user:'+u._id,times:[123]});await ctx.db.insert('receipts',{userId:u._id,messageId:'synthetic-old-greeting',state:'complete',replyEntry:'greetingReply'});await ctx.db.insert('cycleEvents',{userId:u._id,jobId:u.jobId,label:'period started',rawText:'synthetic event',occurrenceDate:'2026-10-08',occurrenceTime:null,timePrecision:'date-only',messageReceivedAt:123});return u._id;});
 const jobId=crypto.randomUUID();await t.mutation(reset,{token,jobId,enroll:true});
 const read=()=>t.run(async ctx=>({user:await ctx.db.get(userId),cycles:await ctx.db.query('cycleEvents').withIndex('by_user',q=>q.eq('userId',userId)).take(5),receipts:await ctx.db.query('receipts').withIndex('by_user_reply_entry',q=>q.eq('userId',userId)).take(5),quota:await ctx.db.query('quotas').withIndex('by_key',q=>q.eq('key','user:'+userId)).unique()}));
 const first=await read();expect(first.cycles).toHaveLength(0);expect(first.receipts).toHaveLength(0);expect(first.quota!.times).toEqual([123]);expect(first.user!.dataDeletedAt).toBeUndefined();expect(first.user!.conversationConsent).toBeUndefined();await t.mutation(reset,{token,jobId,enroll:true});expect(await read()).toEqual(first);
 vi.stubEnv('INTUNE_SYNTHETIC_TRANSPORT','0');await expect(t.mutation(reset,{token,jobId:crypto.randomUUID(),enroll:true})).rejects.toThrow('Isolated');
});

test('wrapped timeouts and quota failures stay separate from model validation errors',()=>{expect(verificationFailureKind({cause:{name:'TimeoutError'}},'rejected')).toBe('provider_timeout');expect(verificationFailureKind({cause:{statusCode:429}},'rejected')).toBe('provider_rate_limit');expect(verificationFailureKind({},'AI hourly call limit reached')).toBe('quota');expect(verificationFailureKind({},'Conflicting source purpose')).toBe('validation');});
