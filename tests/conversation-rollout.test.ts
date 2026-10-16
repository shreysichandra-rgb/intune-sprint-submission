import {test,expect,vi,afterEach} from 'vitest';
import {convexTest} from 'convex-test';
import {makeFunctionReference} from 'convex/server';
import schema from '../convex/schema';
import {internal} from '../convex/_generated/api';
const modules=import.meta.glob('../convex/**/*.*s');
const enroll=makeFunctionReference<'mutation'>('conversationRollout:enrollPage');
afterEach(()=>vi.unstubAllEnvs());
test('all-user upgrade is explicitly gated, preserves controls and consent, skips deleted users, and is idempotent',async()=>{
 const t=convexTest(schema,modules);
 const ids=await t.run(async ctx=>Promise.all(['active','paused','stopped','deleted'].map(state=>ctx.db.insert('users',{token:'synthetic-'+state,label:'Synthetic',jobId:'legacy',timezone:'Asia/Kolkata',startDate:'2026-10-02',endDate:'2026-10-08',trackedItems:['hot flashes'],state:state==='deleted'?'stopped':state as 'active'|'paused'|'stopped',...(state==='deleted'?{dataDeletedAt:1}:{}),...(state==='paused'?{safetyKind:'mental' as const}:{}),memoryVersion:2}))));
 const before=await t.run(ctx=>Promise.all(ids.map(id=>ctx.db.get(id))));
 vi.stubEnv('INTUNE_CONVERSATION_GATE','candidate');await expect(t.mutation(enroll,{paginationOpts:{numItems:100,cursor:null}})).rejects.toThrow('disabled');
 vi.stubEnv('INTUNE_CONVERSATION_ROLLOUT','all');expect((await t.mutation(enroll,{paginationOpts:{numItems:100,cursor:null}})).enrolled).toBe(3);
 const after=await t.run(ctx=>Promise.all(ids.map(id=>ctx.db.get(id))));
 after.forEach((user,i)=>{if(i===3)expect(user).toEqual(before[i]);else expect(user).toEqual({...before[i],conversationEnabled:true,memoryVersion:3});});
 expect((await t.mutation(enroll,{paginationOpts:{numItems:100,cursor:null}})).enrolled).toBe(0);
});
test('new WhatsApp account gets V2 only with explicit all-user rollout and no implied storage consent',async()=>{
 const t=convexTest(schema,modules);vi.stubEnv('INTUNE_CONVERSATION_GATE','candidate');vi.stubEnv('INTUNE_CONVERSATION_ROLLOUT','all');
 const token=await t.mutation(internal.phoneUsers.getOrCreate,{phoneNumber:'+12025550197'});
 await t.run(async ctx=>{const user=await ctx.db.query('users').withIndex('by_token',q=>q.eq('token',token)).unique();expect(user!.conversationEnabled).toBe(true);expect(user!.conversationConsent).toBeUndefined();});
 vi.stubEnv('INTUNE_CONVERSATION_GATE','off');const other=await t.mutation(internal.phoneUsers.getOrCreate,{phoneNumber:'+12025550198'});
 await t.run(async ctx=>{const user=await ctx.db.query('users').withIndex('by_token',q=>q.eq('token',other)).unique();expect(user!.conversationEnabled).toBeUndefined();});
});


test('V3 restart is gated and idempotent, keeps owned history, consent, controls and paid clocks',async()=>{
 const t=convexTest(schema,modules),epoch='fictional-v3-launch';
 const restart=makeFunctionReference<'mutation'>('conversationRollout:restartOnboardingPage');
 const a={epoch,paginationOpts:{numItems:50,cursor:null}};
 const ids=await t.run(async c=>Promise.all(['active','paused','stopped','deleted','paid'].map(state=>c.db.insert('users',{token:'restart-'+state,label:'Fictional',jobId:'old-'+state,timezone:'Asia/Kolkata',startDate:'2026-10-01',endDate:'2026-10-07',trackedItems:['sleep'],preferredName:'Fictional',conversationConsent:true,conversationQuestionId:'old-question',state:state==='deleted'?'stopped':state==='paid'?'active':state as 'active'|'paused'|'stopped',...(state==='deleted'?{dataDeletedAt:1}:{}),...(state==='paused'?{safetyKind:'mental' as const}:{}),...(state==='paid'?{pilotStartedAt:1000,pilotEndsAt:604801000}:{}),memoryVersion:2}))));
 const bodyId=await t.run(c=>c.db.insert('occurrences',{userId:ids[0],jobId:'old-active',trackedItem:'sleep',rawText:'Fictional old sleep update',occurrenceDate:'2026-10-01',occurrenceTime:null,timePrecision:'date-only',messageReceivedAt:1,source:'user',status:'active',confirmationState:'confirmed',batchId:'fictional'}));
 const before=await t.run(c=>Promise.all(ids.map(id=>c.db.get(id))));
 await expect(t.mutation(restart,a)).rejects.toThrow('disabled');
 vi.stubEnv('INTUNE_CONVERSATION_GATE','candidate');vi.stubEnv('INTUNE_CONVERSATION_ROLLOUT','all');vi.stubEnv('INTUNE_PILOT_MODE','v3');vi.stubEnv('INTUNE_PILOT_ONBOARDING_EPOCH',epoch);
 const result=await t.mutation(restart,a);expect(result.restarted).toBe(4);expect(result.deletedSkipped).toBe(1);
 const after=await t.run(c=>Promise.all(ids.map(id=>c.db.get(id))));
 for(const i of [0,1,2,4]){expect(after[i]!.state).toBe(before[i]!.state);expect(after[i]!.safetyKind).toBe(before[i]!.safetyKind);expect(after[i]!.conversationConsent).toBe(true);expect(after[i]!.preferredName).toBeUndefined();expect(after[i]!.pilotFreshConsentPending).toBe(true);expect(after[i]!.conversationQuestionId).toBeUndefined();}
 expect(after[3]).toEqual(before[3]);expect(after[4]!.jobId).toBe(before[4]!.jobId);expect(after[4]!.pilotStartedAt).toBe(1000);expect(after[4]!.pilotEndsAt).toBe(604801000);
 expect(after[0]!.jobId).not.toBe(before[0]!.jobId);expect((await t.run(c=>c.db.get(bodyId)))!.userId).toBe(ids[0]);
 expect((await t.mutation(restart,a)).restarted).toBe(0);expect(await t.run(c=>Promise.all(ids.map(id=>c.db.get(id))))).toEqual(after);
});


test('restarted paid onboarding asks name then refreshes consent without restarting its clock',async()=>{
 const t=convexTest(schema,modules),R=(name:string)=>makeFunctionReference(name);
 vi.stubEnv('INTUNE_CONVERSATION_GATE','candidate');vi.stubEnv('INTUNE_CONVERSATION_ROLLOUT','all');vi.stubEnv('INTUNE_PILOT_MODE','v3');vi.stubEnv('PAYMENT_MODE','razorpay_test');vi.stubEnv('INTUNE_SEMANTIC_BRIDGE','verified');vi.stubEnv('INTUNE_PILOT_ONBOARDING_EPOCH','fictional-restart');
 const token=await t.mutation(internal.phoneUsers.getOrCreate,{phoneNumber:'+12025550196'});
 await t.run(async c=>{const u=await c.db.query('users').withIndex('by_token',q=>q.eq('token',token)).unique();await c.db.patch(u!._id,{preferredName:'Earlier',conversationConsent:true});});
 await t.mutation(R('conversationRollout:restartOnboardingPage'),{epoch:'fictional-restart',paginationOpts:{numItems:50,cursor:null}});
 const g:any=await t.mutation(R('pilotAccess:grantTest'),{token,grantKey:'fictional-restart-grant'});
 await t.mutation(R('pilotAccess:welcomeAccepted'),{grantId:g.id,providerMessageId:'wamid.fictional_restart'});
 const deliveredAt=Date.now();await t.mutation(R('pilotAccess:welcomeDelivered'),{providerMessageId:'wamid.fictional_restart',recipient:'12025550196',deliveredAt});
 const name:any=await t.action(R('messages:send'),{token,messageId:'fictional-name',text:'Maya'});expect(name.message).toContain('Nice to meet you, Maya');expect(name.message).toContain('May I save');
 const consent:any=await t.action(R('messages:send'),{token,messageId:'fictional-consent',text:'yes'});expect(consent.outcome).toBe('consent');
 const s:any=await t.query(R('pilotAccess:status'),{token});expect(s.startedAt).toBe(deliveredAt);expect(s.endsAt).toBe(deliveredAt+604800000);
 await t.run(async c=>{const u=await c.db.query('users').withIndex('by_token',q=>q.eq('token',token)).unique();expect(u!.pilotFreshConsentPending).toBeUndefined();expect(u!.conversationConsent).toBe(true);expect(u!.preferredName).toBe('Maya');});
});


test('targeted restart clears onboarding only, preserves paid history and controls, isolates users and retries safely',async()=>{
 const t=convexTest(schema,modules),restart=makeFunctionReference<'mutation'>('pilotOperator:restartOnboarding');
 vi.stubEnv('INTUNE_PILOT_MODE','v3');vi.stubEnv('INTUNE_CONVERSATION_GATE','candidate');vi.stubEnv('INTUNE_CONVERSATION_ROLLOUT','all');
 const phones=['+12025550161','+12025550162','+12025550163'];
 const ids=await t.run(c=>Promise.all(phones.map((phoneNumber,i)=>c.db.insert('users',{phoneNumber,token:'target-reset-'+i,label:'Fictional',jobId:'preserved-job-'+i,timezone:'Asia/Kolkata',startDate:'2026-10-01',endDate:'2026-10-07',trackedItems:['sleep'],preferredName:'Earlier',conversationConsent:true,conversationQuestionId:'old-question',v3OnboardingEpoch:'existing-epoch',state:i===1?'paused':'active',...(i===1?{safetyKind:'mental' as const}:{}),pilotStartedAt:1000,pilotEndsAt:604801000,memoryVersion:2}))));
 const before=await t.run(c=>Promise.all(ids.map(id=>c.db.get(id))));
 const args={phoneNumbers:phones.slice(0,2),resetKey:'fictional-specific-reset'};
 expect(await t.mutation(restart,args)).toEqual({restarted:2,alreadyRestarted:0});
 const after=await t.run(c=>Promise.all(ids.map(id=>c.db.get(id))));
 for(const i of [0,1]){const expected={...before[i],pilotOnboardingResetKey:args.resetKey,conversationEnabled:true,pilotFreshConsentPending:true,pilotNameAsked:true,memoryVersion:3};delete expected.preferredName;delete expected.conversationQuestionId;expect(after[i]).toEqual(expected);}
 expect(after[2]).toEqual(before[2]);
 expect(await t.mutation(restart,args)).toEqual({restarted:0,alreadyRestarted:2});
 expect(await t.run(c=>Promise.all(ids.map(id=>c.db.get(id))))).toEqual(after);
 // Missing targets roll back the complete transaction, not just the last account.
 await expect(t.mutation(restart,{phoneNumbers:[phones[0],'+12025550164'],resetKey:'second-key'})).rejects.toThrow('unavailable');
 expect(await t.run(c=>c.db.get(ids[0]))).toEqual(after[0]);
 vi.stubEnv('INTUNE_PILOT_MODE','v2');await expect(t.mutation(restart,args)).rejects.toThrow('disabled');
});
