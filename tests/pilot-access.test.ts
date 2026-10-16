import {test,expect,vi,beforeEach,afterEach} from 'vitest';
import {convexTest} from 'convex-test';
import {makeFunctionReference as ref} from 'convex/server';
import schema from '../convex/schema';
import {api,internal} from '../convex/_generated/api';
const modules=import.meta.glob('../convex/**/*.*s');
const grant=ref<'mutation',any,any>('pilotAccess:grantTest');
const revoke=ref<'mutation',any,any>('pilotAccess:revokeTest');
const status=ref<'query',any,any>('pilotAccess:status');
const accept=ref<'mutation',any,any>('pilotAccess:welcomeAccepted');
const delivered=ref<'mutation',any,any>('pilotAccess:welcomeDelivered');
const start=Date.parse('2026-10-09T04:30:00Z');
beforeEach(()=>{vi.stubEnv('INTUNE_PILOT_MODE','v3');vi.spyOn(Date,'now').mockReturnValue(start);});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs();});
async function fixture(){const t=convexTest(schema,modules);const token=await t.mutation(internal.phoneUsers.getOrCreate,{phoneNumber:'+12025550191'});return {t,token};}
test('existing users default unpaid; test grant is distinct and does not start clock until delivered',async()=>{
 const {t,token}=await fixture();expect((await t.query(status,{token})).state).toBe('unpaid');
 const g=await t.mutation(grant,{token,grantKey:'synthetic-grant-1'});expect((await t.query(status,{token})).state).toBe('eligible');
 expect(await t.mutation(grant,{token,grantKey:'synthetic-grant-1'})).toEqual(g);
 await t.mutation(accept,{grantId:g.id,providerMessageId:'wamid.synthetic-welcome'});expect((await t.query(status,{token})).state).toBe('eligible');
 await t.mutation(delivered,{providerMessageId:'wamid.synthetic-welcome',recipient:'12025550191',deliveredAt:start+1000});
 vi.mocked(Date.now).mockReturnValue(start+1000);let s=await t.query(status,{token});expect(s.state).toBe('active');expect(s.source).toBe('operator_test');expect(s.endsAt).toBe(start+1000+604800000);
 await t.mutation(delivered,{providerMessageId:'wamid.synthetic-welcome',recipient:'12025550191',deliveredAt:start+2000});expect((await t.query(status,{token})).startedAt).toBe(start+1000);
 vi.mocked(Date.now).mockReturnValue(s.endsAt);expect((await t.query(status,{token})).state).toBe('expired');
});
test('delivery must match recipient; exact activation deadline is too late and delayed webhook preserves real start',async()=>{
 const {t,token}=await fixture();const g=await t.mutation(grant,{token,grantKey:'synthetic-deadline'});await t.mutation(accept,{grantId:g.id,providerMessageId:'wamid.deadline'});
 await t.mutation(delivered,{providerMessageId:'wamid.deadline',recipient:'12025550192',deliveredAt:start+1});expect((await t.query(status,{token})).state).toBe('eligible');
 vi.mocked(Date.now).mockReturnValue(start+604800000+10000);
 await t.mutation(delivered,{providerMessageId:'wamid.deadline',recipient:'12025550191',deliveredAt:start+604800000});expect((await t.query(status,{token})).state).toBe('resolution');
});
test('revocation preserves records and public message cannot forge grant or add unpaid data',async()=>{
 const {t,token}=await fixture();await t.run(async c=>{const u=(await c.db.query('users').withIndex('by_token',q=>q.eq('token',token)).unique())!;await c.db.insert('occurrences',{userId:u._id,jobId:u.jobId,trackedItem:'brain fog',rawText:'synthetic old report',occurrenceDate:'2026-10-09',occurrenceTime:null,timePrecision:'date-only',messageReceivedAt:start,source:'user',status:'active',confirmationState:'confirmed',batchId:'old'});});
 const g=await t.mutation(grant,{token,grantKey:'synthetic-revoke'});await t.mutation(revoke,{id:g.id});expect((await t.query(status,{token})).state).toBe('unpaid');
 const r=await t.action(api.messages.send,{token,messageId:'forge',text:'PAID. Brain fog today'});expect(r.outcome).toBe('unpaid');expect((await t.query(api.tracking.getSummary,{token})).records).toHaveLength(1);
});

test('authenticated read proof activates exactly once, including callback before acceptance; later delivered event cannot reset the week',async()=>{const {t,token}=await fixture();const g:any=await t.mutation(grant,{token,grantKey:'fictional-read-proof'});await t.mutation(delivered,{providerMessageId:'wamid.readOnly',recipient:'12025550191',deliveredAt:start,confirmation:'read'});expect((await t.query(status,{token})).state).toBe('eligible');await t.mutation(accept,{grantId:g.id,providerMessageId:'wamid.readOnly'});const first:any=await t.query(status,{token});expect(first.state).toBe('active');expect(first.startedAt).toBe(start);expect(first.endsAt).toBe(start+604800000);await t.mutation(delivered,{providerMessageId:'wamid.readOnly',recipient:'12025550191',deliveredAt:start+10000,confirmation:'delivered'});expect(await t.query(status,{token})).toEqual(first);await t.run(async c=>{expect((await c.db.get(g.id))!.welcomeConfirmation).toBe('read');});});
test('read proof does not bypass wrong recipient, revoked access, activation deadline or future timestamp',async()=>{const {t,token}=await fixture();const g:any=await t.mutation(grant,{token,grantKey:'fictional-read-guards'});await t.mutation(accept,{grantId:g.id,providerMessageId:'wamid.readGuard'});for(const a of [{recipient:'12025550192',deliveredAt:start},{recipient:'12025550191',deliveredAt:start+604800000},{recipient:'12025550191',deliveredAt:start+60000}]){await t.mutation(delivered,{providerMessageId:'wamid.readGuard',confirmation:'read',...a});expect((await t.query(status,{token})).state).toBe('eligible');}await t.mutation(revoke,{id:g.id});await t.mutation(delivered,{providerMessageId:'wamid.readGuard',recipient:'12025550191',deliveredAt:start,confirmation:'read'});expect((await t.query(status,{token})).state).not.toBe('active');});
