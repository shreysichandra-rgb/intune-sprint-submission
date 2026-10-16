import {test,expect,vi,afterEach} from 'vitest';
import {convexTest} from 'convex-test';
import {makeFunctionReference} from 'convex/server';
import schema from '../convex/schema';
import {internal} from '../convex/_generated/api';
const modules=import.meta.glob('../convex/**/*.*s'),restore=makeFunctionReference<'mutation'>('operatorPhoneSetup:restore');
afterEach(()=>vi.unstubAllEnvs());
function gate(){vi.stubEnv('CONVEX_SITE_URL','https://disciplined-mammoth-312.convex.site');vi.stubEnv('INTUNE_CONVERSATION_GATE','off');vi.stubEnv('INTUNE_SYNTHETIC_TRANSPORT','0');vi.stubEnv('INTUNE_OPERATOR_PHONE','+12025550190');vi.stubEnv('INTUNE_OPERATOR_PHONE_EXPIRES',String(Date.now()+600000));}
async function fixture(){const t=convexTest(schema,modules),token=await t.mutation(internal.phoneUsers.getOrCreate,{phoneNumber:'+12025550190'});return {t,token,jobId:crypto.randomUUID()};}
test('operator recovery rejects production, enabled gates and a different account',async()=>{
 gate();const f=await fixture();vi.stubEnv('CONVEX_SITE_URL','https://other.convex.site');await expect(f.t.mutation(restore,{token:f.token,jobId:f.jobId})).rejects.toThrow('disabled');gate();vi.stubEnv('INTUNE_CONVERSATION_GATE','candidate');await expect(f.t.mutation(restore,{token:f.token,jobId:f.jobId})).rejects.toThrow('disabled');gate();vi.stubEnv('INTUNE_OPERATOR_PHONE','+12025550191');await expect(f.t.mutation(restore,{token:f.token,jobId:f.jobId})).rejects.toThrow('ownership');
});
test('recovery refuses an active or expired operator fixture',async()=>{
 gate();const f=await fixture();await expect(f.t.mutation(restore,{token:f.token,jobId:f.jobId})).rejects.toThrow('Deleted');vi.stubEnv('INTUNE_OPERATOR_PHONE_EXPIRES','0');await expect(f.t.mutation(restore,{token:f.token,jobId:f.jobId})).rejects.toThrow('disabled');
});
test('deleted fixture reopens only after records are erased, without resetting usage',async()=>{
 gate();const f=await fixture();await f.t.mutation(internal.commands.execute,{token:f.token,command:'delete'});
 await f.t.run(async ctx=>{await ctx.db.insert('quotas',{key:'global',times:[123]});});
 await f.t.mutation(restore,{token:f.token,jobId:f.jobId});await f.t.mutation(restore,{token:f.token,jobId:f.jobId});
 await f.t.run(async ctx=>{const u=(await ctx.db.query('users').withIndex('by_token',q=>q.eq('token',f.token)).unique())!;expect(u.dataDeletedAt).toBeUndefined();expect(u.jobId).toBe(f.jobId);expect(u.conversationConsent).toBeUndefined();expect(u.conversationEnabled).toBe(true);expect((await ctx.db.query('quotas').withIndex('by_key',q=>q.eq('key','global')).unique())!.times).toEqual([123]);});
});
test('original deployment recovery requires exact new fixture token and preserves ordinary deletion protection',async()=>{
 gate();const f=await fixture();await f.t.mutation(internal.commands.execute,{token:f.token,command:'delete'});
 vi.stubEnv('CONVEX_SITE_URL','https://careful-caterpillar-581.convex.site');vi.stubEnv('INTUNE_CONVERSATION_ROLLOUT','off');
 await expect(f.t.mutation(restore,{token:f.token,jobId:f.jobId})).rejects.toThrow('disabled');
 vi.stubEnv('INTUNE_OPERATOR_FIXTURE_TOKEN',f.token);await f.t.mutation(restore,{token:f.token,jobId:f.jobId});
 await f.t.run(async ctx=>{const u=(await ctx.db.query('users').withIndex('by_token',q=>q.eq('token',f.token)).unique())!;expect(u.dataDeletedAt).toBeUndefined();expect(u.conversationConsent).toBeUndefined();});
});
