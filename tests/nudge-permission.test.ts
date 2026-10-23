import {test,expect,vi,beforeEach,afterEach} from 'vitest';
import {convexTest} from 'convex-test';
import {makeFunctionReference as ref} from 'convex/server';
import schema from '../convex/schema';
import {internal} from '../convex/_generated/api';
import {TRIAL_NUDGE_QUESTION,PAID_NUDGE_QUESTION,TRIAL_END_TEMPLATE_TEXT} from '../convex/pilotTrial';
import {whatsappReplyPayload} from '../convex/checkoutPresentation';
const modules=import.meta.glob('../convex/**/*.*s'),R=(n:string)=>ref<any,any,any>(n),base=Date.parse('2026-10-16T07:30:00Z');let now=base;
beforeEach(()=>{now=base;vi.spyOn(Date,'now').mockImplementation(()=>now);for(const [k,v]of Object.entries({INTUNE_PILOT_MODE:'v3',INTUNE_TRIAL_ENABLED:'1',INTUNE_IMPLIED_SAVING:'1',PAYMENT_MODE:'razorpay_live'}))vi.stubEnv(k,v);});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs();});
async function trialUser(){const t=convexTest(schema,modules);const token=await t.mutation(internal.phoneUsers.getOrCreate,{phoneNumber:'+12025550191'});const joined:any=await t.mutation(R('pilotTrial:join'),{token});await t.mutation(R('pilotAccess:welcomeAccepted'),{grantId:joined.id,providerMessageId:'wamid.trial'});await t.mutation(R('pilotAccess:welcomeDelivered'),{providerMessageId:'wamid.trial',recipient:'12025550191',deliveredAt:now});const user=(await t.run(c=>c.db.query('users').withIndex('by_token',q=>q.eq('token',token)).unique()))!;return {t,token,user,id:joined.id};}
const offer=async(f:any,canAsk=true)=>f.t.run(async(c:any)=>{const {recordTrialUsefulAction}=await import('../convex/pilotTrial');const u=await c.db.get(f.user._id);const item=await c.db.insert('pilotItems',{userId:u._id,kind:'doctor_question',title:'fictional',text:'fictional',state:'planned',createdAt:now,updatedAt:now});return recordTrialUsefulAction(c,u,[{type:'save',kind:'doctor_question'}],[item],true,'Save my question',canAsk);});
const said=(f:any,text:string)=>f.t.run(async(c:any)=>{const u=await c.db.get(f.user._id);await c.db.insert('conversationLog',{userId:u._id,epoch:u.debugEpoch??0,messageId:'out-'+now,direction:'outgoing',type:'text',text,receivedAt:now,recordIds:[],suppressed:false});});

test('a plain Yes answers the nudge question and keeps the exact question as proof of opt-in',async()=>{
 const f=await trialUser();expect(await offer(f)).toBe(TRIAL_NUDGE_QUESTION);now+=1000;await said(f,'Saved your question for your doctor.\n\n'+TRIAL_NUDGE_QUESTION);now+=1000;
 const r:any=await f.t.mutation(R('pilotTrial:permission'),{token:f.token,text:'Yes'});expect(r.message).toBe('Done 👍 I’ll send just that one message. No automatic charge.');
 const g:any=await f.t.run(c=>c.db.get(f.id));expect(g.nudgePermissionAt).toBe(now);expect(g.nudgePermissionQuestion).toContain(TRIAL_NUDGE_QUESTION);
});

test('a plain yes or no is left alone when InTune last asked something else, or before the question',async()=>{
 const f=await trialUser();expect(await f.t.mutation(R('pilotTrial:permission'),{token:f.token,text:'Yes'})).toBeNull();
 await offer(f);now+=1000;await said(f,TRIAL_NUDGE_QUESTION);now+=1000;await said(f,'Which days do you do yoga?');now+=1000;
 expect(await f.t.mutation(R('pilotTrial:permission'),{token:f.token,text:'yes'})).toBeNull();expect(await f.t.mutation(R('pilotTrial:permission'),{token:f.token,text:'no'})).toBeNull();
 const g:any=await f.t.run(c=>c.db.get(f.id));expect(g.nudgePermissionAt).toBeUndefined();expect(g.nudgeDeclinedAt).toBeUndefined();
});

test('No is recorded once and the question is never asked again',async()=>{
 const f=await trialUser();await offer(f);now+=1000;await said(f,TRIAL_NUDGE_QUESTION);now+=1000;
 const r:any=await f.t.mutation(R('pilotTrial:permission'),{token:f.token,text:'No thanks'});expect(r.message).toBe('No problem, I won’t send it. Your notes stay saved either way.');
 expect((await f.t.run(c=>c.db.get(f.id)) as any).nudgeDeclinedAt).toBe(now);expect(await offer(f)).toBe('');
});

test('the question waits when the save reply already asks something, then comes on the next save',async()=>{
 const f=await trialUser();expect(await offer(f,false)).toBe('');const g:any=await f.t.run(c=>c.db.get(f.id));expect(g.firstUsefulAt).toBeDefined();expect(g.nudgeOfferedAt).toBeUndefined();
 expect(await offer(f,true)).toBe(TRIAL_NUDGE_QUESTION);expect(await offer(f,true)).toBe('');
});

test('a coupon week gets the founder-approved week-end question once',async()=>{
 const t=convexTest(schema,modules);const token=await t.mutation(internal.phoneUsers.getOrCreate,{phoneNumber:'+12025550192'});
 const user=(await t.run(async c=>{const u=(await c.db.query('users').withIndex('by_token',q=>q.eq('token',token)).unique())!;await c.db.patch(u._id,{conversationConsent:true,conversationEnabled:true});await c.db.insert('pilotEntitlements',{userId:u._id,source:'coupon',grantKey:'fictional-coupon',eligibleAt:now,activationDeadline:now+604800000,startedAt:now,endsAt:now+604800000,welcomeState:'delivered',actor:'test'});return c.db.get(u._id);}))!;
 const f={t,token,user};expect(await offer(f)).toBe(PAID_NUDGE_QUESTION);expect(await offer(f)).toBe('');
});

for(const approved of [false,true])test('trial end outside the 24-hour window '+(approved?'uses the approved template':'stays blocked until the template is approved'),async()=>{
 if(approved)vi.stubEnv('INTUNE_TRIAL_END_TEMPLATE_APPROVED','1');
 const f=await trialUser();await f.t.run(async c=>{await c.db.patch(f.id,{nudgePermissionAt:now});await c.db.patch(f.user._id,{lastInboundAt:now});});
 now+=86400000*2;const claimed:any=await f.t.mutation(R('pilotTrial:claimNudge'),{id:f.id});const g:any=await f.t.run(c=>c.db.get(f.id));
 if(!approved){expect(claimed).toBeNull();expect(g.nudgeStatus).toBe('blocked_template');return;}
 expect(claimed).toMatchObject({template:true});const reply=await f.t.mutation(R('pilotTrial:finishNudge'),{id:f.id,url:null});expect(reply).toBeTruthy();
 const row:any=await f.t.run(c=>c.db.get(reply));expect(row.body).toBe(TRIAL_END_TEMPLATE_TEXT);
 expect(whatsappReplyPayload('12025550191',TRIAL_END_TEMPLATE_TEXT)).toMatchObject({type:'template',template:{name:'intune_trial_end_v1',language:{code:'en'}}});
});

test('the template body is never sent as a template unless approval is switched on',()=>{
 expect(whatsappReplyPayload('12025550191',TRIAL_END_TEMPLATE_TEXT)).toMatchObject({type:'text'});
});

async function couponUser(){const t=convexTest(schema,modules);const token=await t.mutation(internal.phoneUsers.getOrCreate,{phoneNumber:'+12025550193'});const ids=await t.run(async c=>{const u=(await c.db.query('users').withIndex('by_token',q=>q.eq('token',token)).unique())!;await c.db.patch(u._id,{conversationConsent:true,conversationEnabled:true,lastInboundAt:now});const id=await c.db.insert('pilotEntitlements',{userId:u._id,source:'coupon',grantKey:'fictional-coupon-week',eligibleAt:now,activationDeadline:now+604800000,startedAt:now,endsAt:now+604800000,welcomeState:'delivered',actor:'test',nudgeOfferedAt:now});return {user:u,id};});return {t,token,...ids};}
const yesTo=async(f:any,q=PAID_NUDGE_QUESTION)=>{now+=1000;await said(f,q);now+=1000;return f.t.mutation(R('pilotTrial:permission'),{token:f.token,text:'Yes'});};

test('a coupon Yes books one week-end message for 24 hours before the end',async()=>{
 const f=await couponUser();await yesTo(f);
 const jobs=await f.t.run(c=>c.db.system.query('_scheduled_functions').collect());const job=jobs.find((j:any)=>j.name.includes('sendWeekEndNudge'));
 expect(job).toBeTruthy();expect(job!.scheduledTime).toBe(base+604800000-86400000);
});

for(const approved of [false,true])test('the week-end message '+(approved?'goes as the approved template with date and time':'goes as text inside the 24-hour window before approval'),async()=>{
 if(approved)vi.stubEnv('INTUNE_EXPIRY_TEMPLATE_APPROVED','1');
 const f=await couponUser();await yesTo(f);now=base+604800000-86400000;if(!approved)await f.t.run(c=>c.db.patch(f.user._id,{lastInboundAt:now-3600000}));
 const reply=await f.t.mutation(R('pilotTrial:claimWeekEndNudge'),{id:f.id});expect(reply).toBeTruthy();
 const row:any=await f.t.run(c=>c.db.get(reply));expect(row.body).toMatch(/^Your InTune access ends on 23 October 2026 at 1:00 pm IST\. You can record body changes/);
 const p:any=whatsappReplyPayload('12025550193',row.body);
 if(approved)expect(p).toMatchObject({type:'template',template:{name:'intune_access_expiry_v1',components:[{type:'body',parameters:[{type:'text',text:'23 October 2026'},{type:'text',text:'1:00 pm'}]}]}});else expect(p.type).toBe('text');
 expect(await f.t.mutation(R('pilotTrial:claimWeekEndNudge'),{id:f.id})).toBeNull();
});

test('the week-end message is suppressed after No, Pause, or once her week has ended, and blocked outside the window without approval',async()=>{
 const declined=await couponUser();now+=1000;await said(declined,PAID_NUDGE_QUESTION);now+=1000;await declined.t.mutation(R('pilotTrial:permission'),{token:declined.token,text:'No'});
 expect(await declined.t.mutation(R('pilotTrial:claimWeekEndNudge'),{id:declined.id})).toBeNull();
 const paused=await couponUser();await yesTo(paused);await paused.t.run(c=>c.db.patch(paused.user._id,{state:'paused'}));expect(await paused.t.mutation(R('pilotTrial:claimWeekEndNudge'),{id:paused.id})).toBeNull();
 const late=await couponUser();await yesTo(late);now=base+604800000+1;expect(await late.t.mutation(R('pilotTrial:claimWeekEndNudge'),{id:late.id})).toBeNull();
 now=base;const quiet=await couponUser();await yesTo(quiet);now=base+604800000-86400000;expect(await quiet.t.mutation(R('pilotTrial:claimWeekEndNudge'),{id:quiet.id})).toBeNull();
 expect((await quiet.t.run(c=>c.db.get(quiet.id)) as any).nudgeStatus).toBe('blocked_template');
});
