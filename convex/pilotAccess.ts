import {validEntitlementSource} from './pilotPaymentMode';
import {makeFunctionReference as ref} from 'convex/server';
import {v} from 'convex/values';
import {localDate,inWindow} from './rules';
import {zonedInstant} from './pilotReminderRules';
import type {QueryCtx,MutationCtx} from './_generated/server';
import type {Doc} from './_generated/dataModel';
import {internalQuery,internalMutation} from './_generated/server';
export const WEEK=604800000;
export const pilotEnabled=()=>process.env.INTUNE_PILOT_MODE==='v3';
type Reader=QueryCtx|MutationCtx;
export async function pilotUser(ctx:Reader,token:string){const u=await ctx.db.query('users').withIndex('by_token',q=>q.eq('token',token)).unique();if(!u)throw new Error('Unauthorised account');return periodUser(ctx,u);}
export async function periodUser(ctx:Reader,u:Doc<'users'>):Promise<Doc<'users'>>{if(!pilotEnabled()||u.pilotStartedAt!==undefined)return u;const a=await accessFor(ctx,u);return a.startedAt===null||a.endsAt===null?u:{...u,pilotStartedAt:a.startedAt,pilotEndsAt:a.endsAt,startDate:localDate(a.startedAt,u.timezone),endDate:localDate(a.endsAt-1,u.timezone)};}
export async function accessFor(ctx:Reader,user:Doc<'users'>,now=Date.now()){
 const grants=await ctx.db.query('pilotEntitlements').withIndex('by_user',q=>q.eq('userId',user._id)).order('desc').take(101);
 if(grants.length>100)throw new Error('Access history requires operator review');
 const valid=grants.filter(g=>g.revokedAt===undefined&&validEntitlementSource(g.source));
 const active=valid.find(g=>g.startedAt!==undefined&&g.startedAt<=now&&g.endsAt!>now);
 const eligible=valid.find(g=>g.startedAt===undefined&&g.activationDeadline>now);
 const chosen=active??eligible??valid[0];
 const state=active?'active':eligible?'eligible':chosen?chosen.startedAt!==undefined?'expired':'resolution':'unpaid';
 return {state,source:chosen?.source??null,id:chosen?._id??null,startedAt:chosen?.startedAt??null,endsAt:chosen?.endsAt??null,activationDeadline:chosen?.activationDeadline??null,welcomeState:chosen?.welcomeState??null};
}
export async function assertPilotWrite(ctx:Reader,user:Doc<'users'>,correctionTarget?:string){
 if(!pilotEnabled()||(await accessFor(ctx,user)).state==='active')return;
 if(correctionTarget&&user.conversationConsent&&!user.dataDeletedAt&&!user.safetyKind&&user.state!=='stopped')for(const table of ['occurrences','cycleEvents','planCompletions','pilotItems','pilotItemEvents','pilotExperiences'] as const){const id=ctx.db.normalizeId(table,correctionTarget);if(id){const record=await ctx.db.get(id);if(record?.userId===user._id)return;}}
 throw new Error('Paid access required for new entries. Your existing records can still be read or corrected.');
}
export const status=internalQuery({args:{token:v.string()},returns:v.any(),handler:async(ctx,a)=>accessFor(ctx,await pilotUser(ctx,a.token))});
// Internal functions are available only to deployment operators, never public clients.
export const grantTest=internalMutation({args:{token:v.string(),grantKey:v.string()},returns:v.any(),handler:async(ctx,a)=>{
 if(!pilotEnabled())throw new Error('V3 test access disabled');if(!/^[a-zA-Z0-9_-]{8,100}$/.test(a.grantKey))throw new Error('Unique grant key required');
 const u=await pilotUser(ctx,a.token);if(u.dataDeletedAt)throw new Error('Deleted account requires support');
 const prior=await ctx.db.query('pilotEntitlements').withIndex('by_key',q=>q.eq('grantKey',a.grantKey)).unique();if(prior){if(prior.userId!==u._id)throw new Error('Grant belongs to another account');return {id:prior._id};}
 const current=await accessFor(ctx,u);if(['active','eligible'].includes(current.state))throw new Error('Account already has current access');
 const now=Date.now();const id=await ctx.db.insert('pilotEntitlements',{userId:u._id,source:'operator_test',grantKey:a.grantKey,eligibleAt:now,activationDeadline:now+WEEK,welcomeState:'pending',actor:'deployment_operator'});
 await ctx.db.patch(u._id,{memoryVersion:(u.memoryVersion??0)+1});await ctx.scheduler.runAfter(0,ref<'action'>('pilotWelcome:send'),{id});return {id};
}});
export const revokeTest=internalMutation({args:{id:v.id('pilotEntitlements')},returns:v.null(),handler:async(ctx,a)=>{const g=await ctx.db.get(a.id);if(!g||g.source!=='operator_test')throw new Error('Test grant required');if(g.revokedAt===undefined){await ctx.db.patch(g._id,{revokedAt:Date.now()});const u=await ctx.db.get(g.userId);if(u)await ctx.db.patch(u._id,{memoryVersion:(u.memoryVersion??0)+1});}return null;}});
export const welcomeAccepted=internalMutation({args:{grantId:v.id('pilotEntitlements'),providerMessageId:v.string(),replyId:v.optional(v.id('whatsappReplies'))},returns:v.null(),handler:async(ctx,a)=>{const g=await ctx.db.get(a.grantId);if(!g||g.revokedAt!==undefined||g.startedAt!==undefined)return null;const reply=a.replyId?await ctx.db.get(a.replyId):null;if(a.replyId&&(!reply||reply.userId!==g.userId||reply.welcomeGrant!==g._id||reply.status!=='sending'))throw new Error('Owned sending welcome required');if(g.welcomeMessageId&&g.welcomeMessageId!==a.providerMessageId&&!reply)throw new Error('Welcome already accepted');if(reply)await ctx.db.patch(reply._id,{providerMessageId:a.providerMessageId});const other=await ctx.db.query('pilotEntitlements').withIndex('by_welcome',q=>q.eq('welcomeMessageId',a.providerMessageId)).unique();if(other&&other._id!==g._id)throw new Error('Welcome belongs to another account');await ctx.db.patch(g._id,{welcomeMessageId:g.welcomeMessageId??a.providerMessageId,welcomeState:'accepted'});const status=await ctx.db.query('pilotWelcomeStatuses').withIndex('by_message',q=>q.eq('providerMessageId',a.providerMessageId)).unique();if(status)await ctx.runMutation(ref<'mutation'>('pilotAccess:welcomeDelivered'),{providerMessageId:status.providerMessageId,recipient:status.recipient,deliveredAt:status.deliveredAt,...(status.confirmation?{confirmation:status.confirmation}:{})});return null;}});
export const welcomeUnknown=internalMutation({args:{grantId:v.id('pilotEntitlements')},returns:v.null(),handler:async(ctx,a)=>{const g=await ctx.db.get(a.grantId);if(g&&g.startedAt===undefined)await ctx.db.patch(g._id,{welcomeState:'unknown'});return null;}});
export const welcomeDelivered=internalMutation({args:{providerMessageId:v.string(),recipient:v.string(),deliveredAt:v.number(),confirmation:v.optional(v.union(v.literal('delivered'),v.literal('read')))},returns:v.null(),handler:async(ctx,a)=>{
 if(!a.providerMessageId||a.providerMessageId.length>200||!/^\d{8,15}$/.test(a.recipient)||!Number.isFinite(a.deliveredAt)||a.deliveredAt>Date.now()+30000)return null;
 const direct=await ctx.db.query('pilotEntitlements').withIndex('by_welcome',q=>q.eq('welcomeMessageId',a.providerMessageId)).unique();const reply=direct?null:await ctx.db.query('whatsappReplies').withIndex('by_provider',q=>q.eq('providerMessageId',a.providerMessageId)).unique();const g=direct??(reply?.welcomeGrant?await ctx.db.get(reply.welcomeGrant):null);if(g&&reply&&reply.userId!==g.userId)return null;if(!g){const old=await ctx.db.query('pilotWelcomeStatuses').withIndex('by_message',q=>q.eq('providerMessageId',a.providerMessageId)).unique();if(!old)await ctx.db.insert('pilotWelcomeStatuses',a);return null;}if(g.revokedAt!==undefined||g.startedAt!==undefined||!validEntitlementSource(g.source))return null;
 const u=await ctx.db.get(g.userId);if(!u||u.dataDeletedAt||u.phoneNumber?.slice(1)!==a.recipient)return null;
 if(!Number.isFinite(a.deliveredAt)||a.deliveredAt<Math.floor(g.eligibleAt/1000)*1000||a.deliveredAt>=g.activationDeadline||a.deliveredAt>Date.now()+30000)return null;
 await ctx.db.patch(g._id,{startedAt:a.deliveredAt,endsAt:a.deliveredAt+(g.source==='trial'?86400000:WEEK),welcomeState:'delivered',welcomeConfirmation:a.confirmation??'delivered'});await ctx.db.patch(u._id,{memoryVersion:(u.memoryVersion??0)+1,pilotNameAsked:u.pilotFreshConsentPending||!u.preferredName?true:false,pilotStartedAt:a.deliveredAt,pilotEndsAt:a.deliveredAt+(g.source==='trial'?86400000:WEEK),startDate:localDate(a.deliveredAt,u.timezone),endDate:localDate(a.deliveredAt+(g.source==='trial'?86400000:WEEK)-1,u.timezone)});if(g.source==='trial')await ctx.scheduler.runAt(a.deliveredAt+86400000,ref<'action'>('pilotTrial:sendNudge'),{id:g._id});else await ctx.scheduler.runAfter(0,ref<'action'>('pilotWelcome:periodConfirmation'),{id:g._id});return null;
}});

export const welcomeContext=internalQuery({args:{id:v.id('pilotEntitlements')},returns:v.any(),handler:async(ctx,a)=>{const g=await ctx.db.get(a.id);if(!g||g.revokedAt!==undefined||g.startedAt!==undefined||!validEntitlementSource(g.source)||g.activationDeadline<=Date.now()||g.welcomeState!=='pending')return null;const u=await ctx.db.get(g.userId);if(!u||!u.phoneNumber||u.dataDeletedAt||u.state==='stopped'||u.safetyKind)return null;return {token:u.token,id:g._id,source:g.source};}});

export const periodContext=internalQuery({args:{id:v.id('pilotEntitlements')},returns:v.any(),handler:async(ctx,a)=>{const g=await ctx.db.get(a.id);if(!g||g.revokedAt!==undefined||g.startedAt===undefined||g.endsAt===undefined||!validEntitlementSource(g.source))return null;const u=await ctx.db.get(g.userId);if(!u||u.dataDeletedAt||u.state==='stopped'||u.state==='paused'||u.safetyKind)return null;return {token:u.token,timezone:u.timezone,source:g.source,startedAt:g.startedAt,endsAt:g.endsAt};}});

// Date-only reports keep their stated date; never invent an occurrence clock time.
export function inPilotPeriod(u:Doc<'users'>,date:string,time?:string|null,precision?:string){if(!inWindow(date,u.startDate,u.endDate))return false;if(u.pilotStartedAt!==undefined&&u.pilotEndsAt!==undefined&&time&&precision==='exact'){try{const at=zonedInstant(date,time,u.timezone);return at>=u.pilotStartedAt&&at<u.pilotEndsAt;}catch{return false;}}return true;}
