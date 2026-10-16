import {clearConversationContext} from './conversationContext';
import type {Id} from './_generated/dataModel';
import {v} from 'convex/values';import {makeFunctionReference as ref} from 'convex/server';import {internalMutation,internalQuery} from './_generated/server';
// No public admin function or client-side bypass. Deployment operator credentials are required.
export const grant=internalMutation({args:{phoneNumber:v.string(),grantKey:v.string()},returns:v.any(),handler:async(ctx,a)=>{const token=await ctx.runMutation(ref<'mutation'>('phoneUsers:getOrCreate'),{phoneNumber:a.phoneNumber});return ctx.runMutation(ref<'mutation'>('pilotAccess:grantTest'),{token,grantKey:a.grantKey});}});
export const revoke=internalMutation({args:{id:v.id('pilotEntitlements')},returns:v.null(),handler:async(ctx,a)=>ctx.runMutation(ref<'mutation'>('pilotAccess:revokeTest'),a)});
export const status=internalQuery({args:{phoneNumber:v.string()},returns:v.any(),handler:async(ctx,a)=>{const u=await ctx.db.query('users').withIndex('by_phone',q=>q.eq('phoneNumber',a.phoneNumber)).unique();if(!u)return {state:'not_found'};const access:any=await ctx.runQuery(ref<'query'>('pilotAccess:status'),{token:u.token});const grant=access.id?await ctx.db.get(access.id as Id<'pilotEntitlements'>):null;const log=grant?await ctx.db.query('conversationLog').withIndex('by_user_message',q=>q.eq('userId',u._id).eq('messageId','pilot-welcome:'+grant._id).eq('direction','outgoing')).unique():null;const delivery=grant?.welcomeMessageId?await ctx.db.query('pilotWelcomeStatuses').withIndex('by_message',q=>q.eq('providerMessageId',grant.welcomeMessageId!)).unique():null;return {...access,welcomeMessageId:grant?.welcomeMessageId??null,welcomeDiagnostic:{confirmation:grant?.welcomeConfirmation??null,delivery:log?.delivery??null,providerAcceptedAt:log?.providerAcceptedAt??null,deliveryCallbackAt:log?.deliveryCallbackAt??null,storedDeliveryAt:delivery?.deliveredAt??null,recipientMatches:delivery?delivery.recipient===u.phoneNumber?.slice(1):null}};}});

// Targeted onboarding restart only: no user recreation, history deletion or access extension.
export const restartOnboarding=internalMutation({
 args:{phoneNumbers:v.array(v.string()),resetKey:v.string()},
 returns:v.object({restarted:v.number(),alreadyRestarted:v.number()}),
 handler:async(ctx,a)=>{
  if(process.env.INTUNE_PILOT_MODE!=='v3'||process.env.INTUNE_CONVERSATION_GATE!=='candidate'||process.env.INTUNE_CONVERSATION_ROLLOUT!=='all')throw new Error('Onboarding restart disabled');
  if(!a.resetKey.trim()||a.phoneNumbers.length<1||a.phoneNumbers.length>5||new Set(a.phoneNumbers).size!==a.phoneNumbers.length)throw new Error('Invalid targeted restart');
  let restarted=0,alreadyRestarted=0;
  for(const phoneNumber of a.phoneNumbers){
   if(!/^\+[1-9]\d{7,14}$/.test(phoneNumber))throw new Error('Invalid phone number');
   const u=await ctx.db.query('users').withIndex('by_phone',q=>q.eq('phoneNumber',phoneNumber)).unique();
   if(!u||u.dataDeletedAt)throw new Error('Account unavailable for restart');
   if(u.pilotOnboardingResetKey===a.resetKey){alreadyRestarted++;continue;}
   await clearConversationContext(ctx,u);
   await ctx.db.patch(u._id,{pilotOnboardingResetKey:a.resetKey,conversationEnabled:true,pilotFreshConsentPending:true,pilotNameAsked:true,preferredName:undefined,greetingSeenAt:undefined,conversationConsentAsked:undefined,conversationQuestionId:undefined,clarificationChoices:undefined,memoryVersion:(u.memoryVersion??0)+1});
   restarted++;
  }
  return {restarted,alreadyRestarted};
 }
});
export const onboardingStatus=internalQuery({args:{phoneNumber:v.string()},returns:v.any(),handler:async(ctx,a)=>{
 const u=await ctx.db.query('users').withIndex('by_phone',q=>q.eq('phoneNumber',a.phoneNumber)).unique();
 return u?{resetKey:u.pilotOnboardingResetKey??null,nameAsked:u.pilotNameAsked===true,hasPreferredName:!!u.preferredName,freshStoragePending:u.pilotFreshConsentPending===true,hasAskedQuestion:!!u.conversationQuestionId,state:u.state??'active',safetyPaused:!!u.safetyKind}:null;
}});

// Operator-only checkout restart: retain financial proof and health records; never refund.
export const resetPaidAccess=internalMutation({
 args:{phoneNumber:v.string(),resetKey:v.string()},
 returns:v.object({reset:v.boolean(),revoked:v.number()}),
 handler:async(ctx,a)=>{
  if(process.env.INTUNE_PILOT_MODE!=='v3'||!/^\+[1-9]\d{7,14}$/.test(a.phoneNumber)||!a.resetKey.startsWith('payment-reset:'))throw new Error('Invalid payment restart');
  const u=await ctx.db.query('users').withIndex('by_phone',q=>q.eq('phoneNumber',a.phoneNumber)).unique();
  if(!u||u.dataDeletedAt)throw new Error('Account unavailable');
  if(u.pilotOnboardingResetKey===a.resetKey)return {reset:false,revoked:0};
  const orders=await ctx.db.query('pilotOrders').withIndex('by_user',q=>q.eq('userId',u._id)).order('desc').take(101);
  const grants=await ctx.db.query('pilotEntitlements').withIndex('by_user',q=>q.eq('userId',u._id)).take(101);
  if(orders.length>100||grants.length>100)throw new Error('Operator review required');
  if(orders[0]&&orders[0].state!=='paid')throw new Error('Unfinished checkout requires review before reset');
  let revoked=0;
  for(const g of grants)if(g.revokedAt===undefined){await ctx.db.patch(g._id,{revokedAt:Date.now()});revoked++;}
  await clearConversationContext(ctx,u);
  await ctx.db.patch(u._id,{pilotOnboardingResetKey:a.resetKey,pilotStartedAt:undefined,pilotEndsAt:undefined,conversationEnabled:true,pilotFreshConsentPending:true,pilotNameAsked:true,preferredName:undefined,greetingSeenAt:undefined,conversationConsentAsked:undefined,conversationQuestionId:undefined,clarificationChoices:undefined,memoryVersion:(u.memoryVersion??0)+1});
  return {reset:true,revoked};
 }
});

// Authenticated deployment operators only. The allowlist lives in private server configuration.
// Reset never changes consent, deletion, safety, contact state or quotas.
export const resetTestAccount=internalMutation({
 args:{phoneNumber:v.string(),resetKey:v.string()},returns:v.object({reset:v.boolean(),revoked:v.number()}),
 handler:async(ctx,a)=>{
  const allowed=(process.env.INTUNE_TEST_RESET_PHONES??'').split(',').map(p=>p.trim());
  if(process.env.INTUNE_PILOT_MODE!=='v3'||!allowed.includes(a.phoneNumber)||!/^\+[1-9]\d{7,14}$/.test(a.phoneNumber)||!/^test-reset:[a-zA-Z0-9_-]{8,100}$/.test(a.resetKey))throw new Error('This account is not enabled for test resets');
  const u=await ctx.db.query('users').withIndex('by_phone',q=>q.eq('phoneNumber',a.phoneNumber)).unique();
  if(!u||u.dataDeletedAt)throw new Error('Deleted or missing account requires support');
  if(u.pilotOnboardingResetKey===a.resetKey)return {reset:false,revoked:0};
  if(u.safetyKind)throw new Error('Use the explicit safety return flow before resetting');
  const orders=await ctx.db.query('pilotOrders').withIndex('by_user',q=>q.eq('userId',u._id)).take(101);
  const grants=await ctx.db.query('pilotEntitlements').withIndex('by_user',q=>q.eq('userId',u._id)).take(101);
  const reminders=await ctx.db.query('pilotReminders').withIndex('by_user',q=>q.eq('userId',u._id)).take(101);
  const queued=await ctx.db.query('whatsappReplies').withIndex('by_user_status',q=>q.eq('userId',u._id).eq('status','queued')).take(101);
  const pending=await ctx.db.query('pending').withIndex('by_user',q=>q.eq('userId',u._id)).take(101);
  const planPending=await ctx.db.query('planPending').withIndex('by_user',q=>q.eq('userId',u._id)).take(101);
  if([orders,grants,reminders,queued,pending,planPending].some(rows=>rows.length>100))throw new Error('Operator review required');
  const now=Date.now();let revoked=0;
  for(const o of orders)if(o.resetAt===undefined)await ctx.db.patch(o._id,{resetAt:now});
  for(const g of grants)if(g.revokedAt===undefined){await ctx.db.patch(g._id,{revokedAt:now});revoked++;}
  for(const r of reminders)if(r.state!=='stopped')await ctx.db.patch(r._id,{state:'stopped'});
  for(const p of [...pending,...planPending])if(!p.jobId||p.jobId===u.jobId)await ctx.db.patch(p._id,{jobId:'archived:'+a.resetKey});
  for(const r of queued)await ctx.db.patch(r._id,{status:'dropped',body:undefined});
  await clearConversationContext(ctx,u);
  await ctx.db.patch(u._id,{pilotOnboardingResetKey:a.resetKey,pilotStartedAt:undefined,pilotEndsAt:undefined,pilotFreshConsentPending:true,pilotNameAsked:true,preferredName:undefined,greetingSeenAt:undefined,conversationConsentAsked:undefined,conversationQuestionId:undefined,clarificationChoices:undefined,memoryVersion:(u.memoryVersion??0)+1});
  return {reset:true,revoked};
 }
});
