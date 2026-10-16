import {test,expect,vi,beforeEach,afterEach} from 'vitest';
import {convexTest} from 'convex-test';
import {makeFunctionReference as ref} from 'convex/server';
import schema from '../convex/schema';
const modules=import.meta.glob('../convex/**/*.*s'),R=(n:string)=>ref<any,any,any>(n),phone='+12025550871';
beforeEach(()=>{vi.stubEnv('INTUNE_PILOT_MODE','v3');vi.stubEnv('PAYMENT_MODE','razorpay_test');vi.stubEnv('INTUNE_TEST_RESET_PHONES',phone+',+12025550872');});afterEach(()=>vi.unstubAllEnvs());
async function fixture(){const t=convexTest(schema,modules),token=await t.mutation(R('phoneUsers:getOrCreate'),{phoneNumber:phone});const u=await t.run(async c=>(await c.db.query('users').withIndex('by_token',q=>q.eq('token',token)).unique())!);return {t,token,u};}
const reset=(t:any,key='test-reset:fictional-one',phoneNumber=phone)=>t.mutation(R('pilotOperator:resetTestAccount'),{phoneNumber,resetKey:key});
test('test reset retires unpaid checkout, revokes access, retains audit/health/logs/quotas and stops reminders',async()=>{
 const {t,token,u}=await fixture();const o=await t.mutation(R('pilotPaymentsStore:reserveOrder'),{token,linkHash:'old'});await t.mutation(R('pilotPaymentsStore:finishOrder'),{id:o.id,orderId:'order_resetPending'});
 const g=await t.mutation(R('pilotAccess:grantTest'),{token,grantKey:'fictional-reset-grant'});
 const ids=await t.run(async c=>{
 await c.db.patch(u._id,{conversationConsent:true,storageWithdrawn:true,state:'stopped',conversationEnabled:false,preferredName:'Fictional'});
 const item=await c.db.insert('pilotItems',{userId:u._id,kind:'plan',title:'Swim',text:'Swim weekly',state:'planned',createdAt:Date.now(),updatedAt:Date.now()});
 const quota=await c.db.insert('quotas',{key:'user:'+u._id,times:[Date.now()]});
 const reminder=await c.db.insert('pilotReminders',{userId:u._id,itemId:item,kind:'tracking',title:'Swim',permissionText:'Please remind',timezone:'Asia/Kolkata',localTime:'09:00',dueAt:Date.now()+3600000,repeat:'once',state:'active',createdAt:Date.now()});return {item,quota,reminder};});
 const quota=await t.run(c=>c.db.get(ids.quota));expect(await reset(t)).toEqual({reset:true,revoked:1});
 expect((await t.query(R('pilotAccess:status'),{token})).state).toBe('unpaid');
 expect(await t.query(R('pilotPaymentsStore:latestOrder'),{token})).toBeNull();await expect(t.query(R('pilotPaymentsStore:orderForLink'),{hash:'old'})).rejects.toThrow('Checkout link unavailable');
 await t.run(async c=>{expect(await c.db.get(ids.item)).not.toBeNull();expect(await c.db.get(ids.quota)).toEqual(quota);expect((await c.db.get(ids.reminder))!.state).toBe('stopped');const after=(await c.db.get(u._id))!;expect(after.state).toBe('stopped');expect(after.storageWithdrawn).toBe(true);expect(after.conversationConsent).toBe(true);expect(after.conversationEnabled).toBe(false);expect(after.preferredName).toBeUndefined();expect((await c.db.get(g.id))!.revokedAt).toBeDefined();});
 expect(await reset(t)).toEqual({reset:false,revoked:0});
 const fresh=await t.mutation(R('pilotPaymentsStore:reserveOrder'),{token,linkHash:'new'});expect(fresh.id).not.toBe(o.id);
 const oldPayment={id:'pay_resetPending',order_id:'order_resetPending',amount:9900,currency:'INR',status:'captured',captured:true};await t.mutation(R('pilotPaymentsStore:confirm'),{id:o.id,payment:oldPayment,eventId:'late-reset-event'});
 expect((await t.query(R('pilotAccess:status'),{token})).state).toBe('unpaid');expect((await t.run(c=>c.db.get(o.id)))!.paymentId).toBe('pay_resetPending');
});
test('both allowlisted test users may reset; another user and missing configuration cannot',async()=>{
 const {t}=await fixture();await t.mutation(R('phoneUsers:getOrCreate'),{phoneNumber:'+12025550872'});expect((await reset(t,'test-reset:fictional-two','+12025550872')).reset).toBe(true);
 await expect(reset(t,'test-reset:fictional-third','+12025550873')).rejects.toThrow('not enabled');vi.stubEnv('INTUNE_TEST_RESET_PHONES','');await expect(reset(t)).rejects.toThrow('not enabled');
});
test('deleted or safety-paused accounts cannot bypass their controls with reset',async()=>{
 const {t,u}=await fixture();await t.run(c=>c.db.patch(u._id,{safetyKind:'medical'}));await expect(reset(t)).rejects.toThrow('safety return');await t.run(c=>c.db.patch(u._id,{safetyKind:undefined,dataDeletedAt:Date.now()}));await expect(reset(t)).rejects.toThrow('requires support');
});
test('duplicate concurrent reset only changes state once and stale welcome cannot reactivate',async()=>{
 const {t,token}=await fixture();const g=await t.mutation(R('pilotAccess:grantTest'),{token,grantKey:'fictional-stale-reset'});await t.mutation(R('pilotAccess:welcomeAccepted'),{grantId:g.id,providerMessageId:'wamid.before-reset'});
 const results=await Promise.all([reset(t),reset(t)]);expect(results.filter(r=>r.reset)).toHaveLength(1);
 await t.mutation(R('pilotAccess:welcomeDelivered'),{providerMessageId:'wamid.before-reset',recipient:phone.slice(1),deliveredAt:Date.now()});expect((await t.query(R('pilotAccess:status'),{token})).state).toBe('unpaid');
});
test('old unanswered questions remain recoverable but cannot capture new onboarding replies',async()=>{
 const {t,u,token}=await fixture();const pending=await t.run(c=>c.db.insert('pending',{userId:u._id,jobId:u.jobId,rawText:'Fictional old report',messageReceivedAt:Date.now(),reason:'Which date?',kind:'clarification',proposal:{intent:'clarify'},relatedIds:[]}));
 await reset(t);expect((await t.run(c=>c.db.get(pending)))!.jobId).toContain('archived:');
 const context=await t.query(R('conversationStore:context'),{token,messageId:'fresh-reset-onboarding'});expect(context.pending).toHaveLength(0);expect(context.askedPendingId).toBeNull();
});
