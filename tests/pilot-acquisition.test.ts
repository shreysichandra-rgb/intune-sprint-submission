import {test,expect,vi,beforeEach,afterEach} from 'vitest';
import {convexTest} from 'convex-test';
import {makeFunctionReference as ref} from 'convex/server';
import schema from '../convex/schema';
import {api} from '../convex/_generated/api';
import {joinAdSource,metaReferralAdId} from '../convex/acquisitionRules';
const modules=import.meta.glob('../convex/**/*.*s'),R=(n:string)=>ref<any,any,any>(n);
const generate=vi.hoisted(()=>vi.fn());vi.mock('@convex-dev/agent',()=>({Agent:class{generateObject=generate;}}));
beforeEach(()=>{for(const[k,v]of Object.entries({INTUNE_PILOT_MODE:'v3',INTUNE_DEBUG_LOGGING:'1',INTUNE_V4_ENABLED:'1',PAYMENT_MODE:'razorpay_live',RAZORPAY_KEY_ID:'',RAZORPAY_KEY_SECRET:'',WHATSAPP_ACCESS_TOKEN:'',WHATSAPP_PHONE_NUMBER_ID:''}))vi.stubEnv(k,v);generate.mockReset();});
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();vi.restoreAllMocks();});
async function fixture(){const t=convexTest(schema,modules);const token=await t.mutation(R('phoneUsers:getOrCreate'),{phoneNumber:'+12025550181'});return {t,token};}
const begin=(f:any,messageId:string,text?:string)=>f.t.mutation(R('conversationLog:begin'),{token:f.token,messageId,type:text?'text':'image',...(text?{text}:{})});
const report=(f:any)=>f.t.query(R('pilotAcquisition:report'),{});
test('entry parser is anchored, supports case/dashes, and leaves normal Join and mixed controls untouched',()=>{for(const t of ['Join — ad01','JOIN - Ad01','Join – ad01.'])expect(joinAdSource(t)).toBe('ad01');for(const t of ['Join','Join — ad01 Stop','Join — ad01\nmy plan','Join — <script>','Join — '+ 'a'.repeat(33),'Join — ad01?'])expect(joinAdSource(t)).toBeNull();});
test('tagged Join uses ordinary checkout route without AI or granting paid access, retaining original debug message',async()=>{const f=await fixture();const tagged=await f.t.action(api.messages.send,{token:f.token,messageId:'tagged',text:'Join — ad01'});const normal=await f.t.action(api.messages.send,{token:f.token,messageId:'normal',text:'Join'});expect(tagged.outcome).toBe(normal.outcome);expect(tagged.message).toBe(normal.message);expect(generate).not.toHaveBeenCalled();expect((await f.t.query(R('pilotAccess:status'),{token:f.token})).state).toBe('unpaid');await f.t.run(async c=>{const rows=await c.db.query('conversationLog').collect();expect(rows.find(r=>r.messageId==='tagged'&&r.direction==='incoming')?.text).toBe('Join — ad01');});expect((await report(f)).rows[0].source).toBe('ad01');});
test('duplicate and concurrent log attempts count once, and later tags cannot overwrite first touch',async()=>{const f=await fixture();await Promise.all([begin(f,'first','Join — ad01'),begin(f,'first','Join — ad01')]);await begin(f,'second','Join — ad02');expect((await report(f)).rows).toMatchObject([{source:'ad01',newChats:1,paidUsers:0}]);await f.t.run(async c=>{expect(await c.db.query('pilotAcquisitions').collect()).toHaveLength(1);});});
test.each([undefined,'Hello','Join'])('missing entry tag remains unknown (%s)',async text=>{const f=await fixture();await begin(f,'first',text);await begin(f,'later','Join — ad01');expect((await report(f)).rows[0].source).toBe('unknown');});
test('an existing conversation is not a new ad contact',async()=>{const f=await fixture();await f.t.run(async c=>{const u=(await c.db.query('users').withIndex('by_token',q=>q.eq('token',f.token)).unique())!;await c.db.insert('conversationLog',{userId:u._id,epoch:0,messageId:'old',direction:'incoming',type:'text',receivedAt:1,recordIds:[],suppressed:false});});await begin(f,'new-tag','Join — ad01');expect((await report(f)).rows).toEqual([]);});
test('out of order processing never credits a later tagged request as first contact',async()=>{const f=await fixture();await f.t.run(async c=>{const u=(await c.db.query('users').withIndex('by_token',q=>q.eq('token',f.token)).unique())!;await c.db.insert('whatsappRequests',{userId:u._id,messageId:'hello',receivedAt:1});await c.db.insert('whatsappRequests',{userId:u._id,messageId:'tag',receivedAt:2});});await begin(f,'tag','Join — ad01');expect((await report(f)).rows).toMatchObject([{source:'unknown',newChats:1}]);});
test('counts verified live payers once, excludes test/coupon/unpaid orders, isolates owners and cohorts',async()=>{const f=await fixture();await begin(f,'first','Join — ad01');const other=await f.t.mutation(R('phoneUsers:getOrCreate'),{phoneNumber:'+12025550182'});await begin({...f,token:other},'second','Join — ad02');await f.t.run(async c=>{const u=(await c.db.query('users').withIndex('by_token',q=>q.eq('token',f.token)).unique())!;for(const [state,paymentMode,paymentId]of [['paid','razorpay_live','pay_live'],['paid','razorpay_live','pay_live'],['paid','razorpay_test','pay_test'],['ready','razorpay_live','pay_unpaid']]as const)await c.db.insert('pilotOrders',{userId:u._id,linkHash:crypto.randomUUID(),state,paymentMode,paymentId,createdAt:Date.now(),verifiedAt:Date.now()});});expect((await report(f)).rows).toMatchObject([{source:'ad01',newChats:1,paidUsers:1,capturedPayments:1,grossInr:99},{source:'ad02',newChats:1,paidUsers:0,grossInr:0}]);expect((await f.t.query(R('pilotAcquisition:report'),{from:Date.now()+1000})).rows).toEqual([]);});
test.each(['delete','withdraw'])('%s removes acquisition and it cannot be restored by later messages',async action=>{const f=await fixture();await begin(f,'first','Join — ad01');if(action==='delete')await f.t.mutation(R('commands:execute'),{token:f.token,command:'delete'});else await f.t.mutation(R('conversationLog:privacy'),{token:f.token,text:'Stop saving',messageId:'withdraw'});await begin(f,'later','Join — ad02');expect((await report(f)).rows).toEqual([]);await f.t.run(async c=>{expect(await c.db.query('pilotAcquisitions').collect()).toHaveLength(0);});});
test('fictional non-phone owners are excluded and report is internal',async()=>{expect(R('pilotAcquisition:report')).toBeTruthy();const f=await fixture();await f.t.run(async c=>{const u=(await c.db.query('users').withIndex('by_token',q=>q.eq('token',f.token)).unique())!;await c.db.patch(u._id,{phoneNumber:undefined});});await begin(f,'first','Join — ad01');expect((await report(f)).rows).toEqual([]);});

test('tagged entry to mocked live checkout to duplicate verified capture produces one paid conversion',async()=>{const f=await fixture();for(const[k,v]of Object.entries({RAZORPAY_KEY_ID:'rzp_live_fictional',RAZORPAY_KEY_SECRET:'fictional',RAZORPAY_WEBHOOK_SECRET:'fictionalwebhook',INTUNE_PILOT_WEB_URL:'https://fictional.convex.site'}))vi.stubEnv(k,v);const provider=vi.fn(async()=>Response.json({id:'order_fictional',amount:9900,currency:'INR'}));vi.stubGlobal('fetch',provider);const tagged=await f.t.action(api.messages.send,{token:f.token,messageId:'new-entry',text:'Join — ad01'});expect(tagged.message).toContain('https://fictional.convex.site/pilot/checkout.html#');const normal=await f.t.action(api.messages.send,{token:f.token,messageId:'normal-retry',text:'Join'});expect(normal.message).toBe(tagged.message);expect(provider).toHaveBeenCalledTimes(1);const order=await f.t.run(async c=>(await c.db.query('pilotOrders').collect())[0]);const payment={id:'pay_fictional',order_id:'order_fictional',amount:9900,currency:'INR',status:'captured',captured:true};await f.t.mutation(R('pilotPaymentsStore:confirm'),{id:order._id,payment,eventId:'event_fictional'});await f.t.mutation(R('pilotPaymentsStore:confirm'),{id:order._id,payment,eventId:'event_fictional'});expect((await report(f)).rows).toMatchObject([{source:'ad01',newChats:1,paidUsers:1,capturedPayments:1,grossInr:99}]);expect(generate).not.toHaveBeenCalled();});

test.each(['Join','Join — ad01'])('new contact remains new when audio is processed before first entry: %s',async firstText=>{
 const f=await fixture(),at=Date.now();await f.t.run(async ctx=>{const u=(await ctx.db.query('users').withIndex('by_token',q=>q.eq('token',f.token)).unique())!;await ctx.db.insert('whatsappRequests',{userId:u._id,messageId:'first-entry',receivedAt:at});await ctx.db.insert('whatsappRequests',{userId:u._id,messageId:'later-audio',receivedAt:at+1});});
 await f.t.mutation(R('conversationLog:begin'),{token:f.token,messageId:'later-audio',type:'audio'});expect((await report(f)).rows).toMatchObject([{source:'unknown',newChats:1,paidUsers:0}]);
 await begin(f,'first-entry',firstText);expect((await report(f)).rows).toMatchObject([{source:firstText==='Join'?'unknown':'ad01',newChats:1}]);
 await begin(f,'later-tag','Join — ad02');const rows=(await report(f)).rows;expect(rows).toHaveLength(1);expect(rows[0].newChats).toBe(1);expect(rows[0].source).not.toBe('ad02');
 await f.t.run(async ctx=>{const acquisition=(await ctx.db.query('pilotAcquisitions').take(2))[0];expect(acquisition).toMatchObject({firstMessageId:'first-entry',firstAt:at,isNew:true});});
});

async function legacyRace(firstText='Join'){
 const f=await fixture(),at=Date.now();await f.t.run(async ctx=>{const u=(await ctx.db.query('users').withIndex('by_token',q=>q.eq('token',f.token)).unique())!;await ctx.db.insert('whatsappRequests',{userId:u._id,messageId:'entry',receivedAt:at});await ctx.db.insert('whatsappRequests',{userId:u._id,messageId:'audio',receivedAt:at+1});});
 await f.t.mutation(R('conversationLog:begin'),{token:f.token,messageId:'audio',type:'audio'});await begin(f,'entry',firstText);
 const userId=await f.t.run(async ctx=>{const a=(await ctx.db.query('pilotAcquisitions').take(1))[0];await ctx.db.patch(a._id,{isNew:false,source:null});return a.userId;});return {...f,userId,at};
}
test.each(['Join','Join — ad01'])('repair only the proven legacy ordering error and keep other records unchanged: %s',async text=>{
 const f=await legacyRace(text);const before=await f.t.run(async ctx=>({user:await ctx.db.get(f.userId),logs:await ctx.db.query('conversationLog').withIndex('by_user',q=>q.eq('userId',f.userId)).take(20),orders:await ctx.db.query('pilotOrders').withIndex('by_user',q=>q.eq('userId',f.userId)).take(10)}));
 expect(await f.t.mutation(R('pilotAcquisition:repairOutOfOrder'),{userId:f.userId})).toMatchObject({repaired:true});
 expect((await report(f)).rows).toMatchObject([{source:text==='Join'?'unknown':'ad01',newChats:1,paidUsers:0}]);
 expect(await f.t.mutation(R('pilotAcquisition:repairOutOfOrder'),{userId:f.userId})).toMatchObject({repaired:false});
 const after=await f.t.run(async ctx=>({user:await ctx.db.get(f.userId),logs:await ctx.db.query('conversationLog').withIndex('by_user',q=>q.eq('userId',f.userId)).take(20),orders:await ctx.db.query('pilotOrders').withIndex('by_user',q=>q.eq('userId',f.userId)).take(10)}));expect(after).toEqual(before);
});
test.each(['prior_history','reset','withdrawn'])('repair refuses uncertain or excluded history: %s',async reason=>{
 const f=await legacyRace();await f.t.run(async ctx=>{if(reason==='prior_history')await ctx.db.insert('conversationLog',{userId:f.userId,epoch:0,messageId:'older',direction:'incoming',type:'text',text:'Hello',receivedAt:f.at-1000,recordIds:[],suppressed:false});else if(reason==='reset')await ctx.db.patch(f.userId,{debugEpoch:1});else await ctx.db.patch(f.userId,{storageWithdrawn:true});});
 expect(await f.t.mutation(R('pilotAcquisition:repairOutOfOrder'),{userId:f.userId})).toMatchObject({repaired:false});
 await f.t.run(async ctx=>{expect((await ctx.db.query('pilotAcquisitions').withIndex('by_user',q=>q.eq('userId',f.userId)).unique())!.isNew).toBe(false);});
});


test('private referral parser accepts only bounded numeric ad IDs and discards other metadata',()=>{
 expect(metaReferralAdId({source_type:'ad',source_id:'120000000001',ctwa_clid:'discarded'})).toBe('120000000001');
 for(const value of [null,{},'ad',{source_type:'post',source_id:'123'},{source_type:'ad',source_id:123},{source_type:'ad',source_id:'0'},{source_type:'ad',source_id:'1'.repeat(33)},{source_type:'ad',source_id:'123?health=private'},{source_type:'ad',source_id:'123\n'}])expect(metaReferralAdId(value)).toBeNull();
});
async function receiveReferral(f:any,messageId:string,adId:string){await f.t.mutation(R('whatsappDelivery:request'),{token:f.token,messageId,referralAdId:adId});}
test('later referrals cannot assign an ad to an earlier unknown contact or its live payment',async()=>{
 const f=await fixture();await f.t.mutation(R('whatsappDelivery:request'),{token:f.token,messageId:'unknown-first'});await begin(f,'unknown-first','Join');
 await f.t.run(async c=>{const u=(await c.db.query('users').withIndex('by_token',q=>q.eq('token',f.token)).unique())!;await c.db.insert('pilotOrders',{userId:u._id,linkHash:'fictional',state:'paid',paymentMode:'razorpay_live',paymentId:'pay_fictional',createdAt:Date.now(),verifiedAt:Date.now()});});
 await receiveReferral(f,'later-ad','120000000002');await begin(f,'later-ad','Join');
 expect((await report(f)).rows).toMatchObject([{source:'unknown',newChats:1,paidUsers:1,grossInr:99}]);
});
test('private source belongs to the earliest receipt and survives out of order logging',async()=>{
 const f=await fixture();await receiveReferral(f,'first-ad','120000000001');await f.t.mutation(R('whatsappDelivery:request'),{token:f.token,messageId:'audio-later'});
 await f.t.mutation(R('conversationLog:begin'),{token:f.token,messageId:'audio-later',type:'audio'});await begin(f,'first-ad','Join — ad01');
 expect((await report(f)).rows).toMatchObject([{source:'meta_ad:120000000001',newChats:1}]);
 const other=await f.t.mutation(R('phoneUsers:getOrCreate'),{phoneNumber:'+12025550182'});await begin({...f,token:other},'ordinary','Join');
 expect((await report(f)).rows).toMatchObject([{source:'meta_ad:120000000001',newChats:1},{source:'unknown',newChats:1}]);
});
test.each(['delete','withdraw'])('private ad source is removed on %s and cannot return from retries',async command=>{
 const f=await fixture();await receiveReferral(f,'ad-first','120000000001');await begin(f,'ad-first','Join');
 if(command==='delete')await f.t.mutation(R('commands:execute'),{token:f.token,command:'delete'});else await f.t.mutation(R('conversationLog:privacy'),{token:f.token,text:'Stop saving',messageId:'withdraw'});
 await receiveReferral(f,'retry-later','120000000002');expect((await report(f)).rows).toEqual([]);
 expect(await f.t.run(async c=>c.db.query('pilotAcquisitions').collect())).toEqual([]);
});
