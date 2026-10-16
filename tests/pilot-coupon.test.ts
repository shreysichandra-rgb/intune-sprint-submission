import {test,expect,vi,beforeEach,afterEach} from 'vitest';
import {convexTest} from 'convex-test';
import {makeFunctionReference as ref} from 'convex/server';
import schema from '../convex/schema';
import {api,internal} from '../convex/_generated/api';
import {couponAttempt} from '../convex/pilotCoupon';
const generate=vi.hoisted(()=>vi.fn());vi.mock('@convex-dev/agent',()=>({Agent:class{generateObject=generate;}}));
const modules=import.meta.glob('../convex/**/*.*s'),R=(n:string)=>ref<any,any,any>(n),code='intunewithmyself',start=Date.parse('2026-10-10T04:30:00Z');let clock=start;
beforeEach(()=>{clock=start;vi.spyOn(Date,'now').mockImplementation(()=>clock);for(const[k,v]of Object.entries({INTUNE_PILOT_MODE:'v3',PAYMENT_MODE:'razorpay_live',INTUNE_PILOT_COUPON:code,INTUNE_CONVERSATION_GATE:'candidate',INTUNE_CONVERSATION_ROLLOUT:'all',INTUNE_IMPLIED_SAVING:'1',INTUNE_DEBUG_LOGGING:'1',INTUNE_DIRECT_RECORD_READ:'1',WHATSAPP_ACCESS_TOKEN:'',WHATSAPP_PHONE_NUMBER_ID:''}))vi.stubEnv(k,v);generate.mockReset();});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs();vi.unstubAllGlobals();});
async function fixture(phoneNumber='+12025550187'){const t=convexTest(schema,modules),token=await t.mutation(R('phoneUsers:getOrCreate'),{phoneNumber});const u=await t.run(async c=>(await c.db.query('users').withIndex('by_token',q=>q.eq('token',token)).unique())!);return {t,token,u,phoneNumber};}
const redeem=(f:any,value=code)=>f.t.mutation(R('pilotCoupon:redeem'),{token:f.token,code:value});
const status=(f:any)=>f.t.query(R('pilotAccess:status'),{token:f.token});
async function delivered(f:any){const s=await status(f);await f.t.mutation(R('pilotAccess:welcomeAccepted'),{grantId:s.id,providerMessageId:'wamid.coupon-'+f.phoneNumber.slice(1)});await f.t.mutation(R('pilotAccess:welcomeDelivered'),{providerMessageId:'wamid.coupon-'+f.phoneNumber.slice(1),recipient:f.phoneNumber.slice(1),deliveredAt:clock});return status(f);}
test('coupon starts one full week only on matching delivered welcome, with no payment or quota side effects',async()=>{
 const f=await fixture();expect((await redeem(f,'INTUNEWITHMYSELF')).message).toContain('seven days free');let s=await status(f);expect(s.state).toBe('eligible');expect(s.source).toBe('coupon');expect(s.startedAt).toBeNull();
 await f.t.mutation(R('pilotAccess:welcomeAccepted'),{grantId:s.id,providerMessageId:'wamid.coupon-wrong'});await f.t.mutation(R('pilotAccess:welcomeDelivered'),{providerMessageId:'wamid.coupon-wrong',recipient:'12025550188',deliveredAt:clock});expect((await status(f)).state).toBe('eligible');
 await f.t.mutation(R('pilotAccess:welcomeDelivered'),{providerMessageId:'wamid.coupon-wrong',recipient:f.phoneNumber.slice(1),deliveredAt:clock});s=await status(f);expect(s.state).toBe('active');expect(s.endsAt).toBe(start+604800000);
 clock+=1000;await redeem(f);expect((await status(f)).endsAt).toBe(s.endsAt);await f.t.run(async c=>{expect(await c.db.query('pilotOrders').collect()).toHaveLength(0);expect(await c.db.query('pilotPaymentEvents').collect()).toHaveLength(0);expect(await c.db.query('quotas').collect()).toHaveLength(0);});
});
test('complete WhatsApp gateway path accepts bare and explicit coupon without AI, duplicate messages or concurrent requests create one grant',async()=>{
 const f=await fixture();const results=await Promise.all(Array.from({length:5},(_,i)=>f.t.action(api.messages.send,{token:f.token,text:i%2?'Coupon intunewithmyself':code,messageId:i<2?'duplicate-coupon':'coupon-'+i})));
 expect(results.every(r=>r.message.includes('free')||r.message.includes('pending'))).toBe(true);expect(generate).not.toHaveBeenCalled();await f.t.run(async c=>{expect(await c.db.query('pilotEntitlements').collect()).toHaveLength(1);expect(await c.db.query('pilotOrders').collect()).toHaveLength(0);expect(await c.db.query('occurrences').collect()).toHaveLength(0);});
});
test('same code gives separate accounts their own week; normal expiry/revocation cannot renew it',async()=>{
 const f=await fixture();await redeem(f);const s=await delivered(f);const second=await f.t.mutation(R('phoneUsers:getOrCreate'),{phoneNumber:'+12025550188'});await f.t.mutation(R('pilotCoupon:redeem'),{token:second,code});expect((await f.t.query(R('pilotAccess:status'),{token:second})).id).not.toBe(s.id);
 clock=s.endsAt;expect((await status(f)).state).toBe('expired');expect((await redeem(f)).message).toContain('already used');await f.t.run(c=>c.db.patch(s.id,{revokedAt:clock}));expect((await redeem(f)).message).toContain('already used');
});
test('active paid/test access and pending welcome are not extended or labelled as coupon',async()=>{
 const f=await fixture();await f.t.mutation(R('pilotAccess:grantTest'),{token:f.token,grantKey:'coupon-existing-test'});expect((await redeem(f)).message).toContain('already pending');const s=await delivered(f);expect((await redeem(f)).message).toContain('existing end time');expect(await status(f)).toEqual(s);expect(s.source).toBe('operator_test');
});
test('only designated tester reset can claim another free week, and stale welcome cannot activate',async()=>{
 const f=await fixture();vi.stubEnv('INTUNE_TEST_RESET_PHONES',f.phoneNumber);await redeem(f);const s=await delivered(f);await f.t.mutation(R('pilotOperator:resetTestAccount'),{phoneNumber:f.phoneNumber,resetKey:'test-reset:fictional-coupon'});expect((await status(f)).state).toBe('unpaid');expect((await redeem(f)).message).toContain('seven days free');expect((await status(f)).id).not.toBe(s.id);
 await f.t.mutation(R('pilotAccess:welcomeDelivered'),{providerMessageId:'wamid.coupon-'+f.phoneNumber.slice(1),recipient:f.phoneNumber.slice(1),deliveredAt:clock});expect((await status(f)).state).toBe('eligible');
});
test('coupon retires pending checkout; delayed capture retains proof but cannot grant or extend access',async()=>{
 const f=await fixture();const o=await f.t.mutation(R('pilotPaymentsStore:reserveOrder'),{token:f.token,linkHash:'coupon-retired-link'});await f.t.mutation(R('pilotPaymentsStore:finishOrder'),{id:o.id,orderId:'order_couponRetired'});await redeem(f);const s=await delivered(f);
 await expect(f.t.query(R('pilotPaymentsStore:orderForLink'),{hash:'coupon-retired-link'})).rejects.toThrow('Checkout link unavailable');await f.t.mutation(R('pilotPaymentsStore:confirm'),{id:o.id,payment:{id:'pay_couponLate',order_id:'order_couponRetired',amount:9900,currency:'INR',status:'captured',captured:true}});expect(await status(f)).toEqual(s);expect((await f.t.run(c=>c.db.get(o.id)))!.state).toBe('paid');
});
for(const state of ['stopped','paused','deleted','withdrawn','safety'])test(`coupon respects ${state} control`,async()=>{
 const f=await fixture();await f.t.run(c=>c.db.patch(f.u._id,state==='deleted'?{dataDeletedAt:clock}:state==='withdrawn'?{storageWithdrawn:true}:state==='safety'?{safetyKind:'medical'}:{state:state as any}));const before=await f.t.run(c=>c.db.get(f.u._id));expect((await redeem(f)).message).toContain('No access was changed');expect(await f.t.run(c=>c.db.get(f.u._id))).toEqual(before);expect((await status(f)).state).toBe('unpaid');
});
test('unknown/disabled coupons and mixed plan messages do not grant access',async()=>{
 const f=await fixture();expect((await redeem(f,'incorrect')).message).toContain('not valid');vi.stubEnv('INTUNE_PILOT_COUPON','');expect((await redeem(f)).message).toContain('unavailable');expect((await status(f)).state).toBe('unpaid');
 expect(couponAttempt('Coupon intunewithmyself')).toBe(code);expect(couponAttempt('use coupon code: intunewithmyself')).toBe(code);expect(couponAttempt('Use coupon intunewithmyself and remind me about physio')).toBeNull();
});
test('coupon welcome uses existing WhatsApp outbox and delivery callback, with mocked provider transport',async()=>{
 const f=await fixture();await redeem(f);const s=await status(f);vi.stubEnv('WHATSAPP_ACCESS_TOKEN','synthetic');vi.stubEnv('WHATSAPP_PHONE_NUMBER_ID','123');
 const send=vi.fn(async()=>Response.json({messages:[{id:'wamid.mocked-coupon'}]}));vi.stubGlobal('fetch',send);
 await f.t.action(R('pilotWelcome:send'),{id:s.id});expect(send).toHaveBeenCalledTimes(1);const body=JSON.parse(send.mock.calls[0][1].body);expect(body.to).toBe(f.phoneNumber.slice(1));expect(body.text.body).not.toMatch(/call you|your name|\?/i);expect(body.text.body).toContain('Text only');expect((await status(f)).state).toBe('eligible');
 await f.t.mutation(R('pilotAccess:welcomeDelivered'),{providerMessageId:'wamid.mocked-coupon',recipient:f.phoneNumber.slice(1),deliveredAt:clock});expect((await status(f)).state).toBe('active');
 await f.t.action(R('pilotWelcome:send'),{id:s.id});expect(send).toHaveBeenCalledTimes(1);
});
test('coupon expiry preserves retrieval and correction eligibility, blocks additions, and deletion remains available',async()=>{
 const f=await fixture();await redeem(f);const s=await delivered(f);const id=await f.t.run(c=>c.db.insert('pilotItems',{userId:f.u._id,kind:'plan',title:'Swimming',text:'Swim three times each week',target:3,state:'planned',createdAt:clock,updatedAt:clock}));
 clock=s.endsAt;const read=await f.t.action(api.messages.send,{token:f.token,messageId:'coupon-expiry-read',text:'What have you saved?'});expect(read.outcome).toBe('summary');expect(read.message.toLowerCase()).toContain('swim');
 const {assertPilotWrite}=await import('../convex/pilotAccess');await f.t.run(async c=>{const u=(await c.db.get(f.u._id))!;await assertPilotWrite(c,u,id);await expect(assertPilotWrite(c,u)).rejects.toThrow('Paid access required');});
 await f.t.action(api.messages.send,{token:f.token,messageId:'coupon-delete',text:'Delete my pilot data'});expect(await f.t.run(c=>c.db.get(id))).toBeNull();expect((await redeem(f)).message).toContain('account was deleted');
});
test('invalid coupon through full conversation path produces accurate no-access reply and no AI calls',async()=>{
 const f=await fixture();const r=await f.t.action(api.messages.send,{token:f.token,messageId:'invalid-coupon',text:'Coupon incorrect'});expect(r.message).toContain('not valid');expect(r.controlOnly).toBe(true);expect((await status(f)).state).toBe('unpaid');expect(generate).not.toHaveBeenCalled();
});
test('a web-only account cannot redeem the WhatsApp coupon',async()=>{
 const t=convexTest(schema,modules),pair=await t.mutation(api.tracking.createTestPair,{});const r=await t.mutation(R('pilotCoupon:redeem'),{token:pair.A,code});expect(r.message).toContain('WhatsApp chat');expect((await t.query(R('pilotAccess:status'),{token:pair.A})).state).toBe('unpaid');
});
