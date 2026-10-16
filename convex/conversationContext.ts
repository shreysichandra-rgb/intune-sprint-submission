import {v} from 'convex/values';
import {internalMutation} from './_generated/server';
import {makeFunctionReference as ref} from 'convex/server';
import type {MutationCtx,QueryCtx} from './_generated/server';
import type {Doc} from './_generated/dataModel';
import {accessFor} from './pilotAccess';
import {matchSafetyCategory} from './safety';
import {storageDeclined} from './directTracking';
const TTL=30*60*1000,MAX_TURNS=12,MAX_CHARS=10000;
export function contextEnabled(){return process.env.INTUNE_PILOT_MODE==='v3'&&process.env.INTUNE_CONTEXT_ENABLED==='1';}
async function owner(ctx:MutationCtx|QueryCtx,token:string){const u=await ctx.db.query('users').withIndex('by_token',q=>q.eq('token',token)).unique();if(!u)throw Error('Unauthorised account');return u;}
export async function clearConversationContext(ctx:MutationCtx,u:Doc<'users'>){
 if(u.v4Context)await ctx.db.patch(u._id,{v4Context:undefined});
 const rows=await ctx.db.query('conversationTurns').withIndex('by_user',q=>q.eq('userId',u._id)).take(MAX_TURNS+2);
 for(const row of rows)await ctx.db.delete(row._id);
}
export async function readConversationContext(ctx:MutationCtx|QueryCtx,u:Doc<'users'>,messageId:string){
 if(!contextEnabled()||u.dataDeletedAt||u.safetyKind||u.state==='stopped'||u.state==='paused')return null;
 const active=(await accessFor(ctx,u)).state==='active';
 const current=await ctx.db.query('conversationTurns').withIndex('by_user_message',q=>q.eq('userId',u._id).eq('messageId',messageId)).unique();
 const valid=(t:Doc<'conversationTurns'>)=>active&&t.jobId===u.jobId&&t.resetKey===u.pilotOnboardingResetKey&&t.expiresAt>Date.now();

 const request=await ctx.db.query('whatsappRequests').withIndex('by_user_message',q=>q.eq('userId',u._id).eq('messageId',messageId)).unique();
 const quoteId=current?.quotedMessageId??request?.quotedMessageId;
 let quoted:Doc<'conversationTurns'>|null=null;
 if(quoteId){quoted=await ctx.db.query('conversationTurns').withIndex('by_user_message',q=>q.eq('userId',u._id).eq('messageId',quoteId)).unique()??await ctx.db.query('conversationTurns').withIndex('by_user_provider_reply',q=>q.eq('userId',u._id).eq('providerReplyId',quoteId)).unique();if(quoted&&!valid(quoted))quoted=null;}
 const rows=(await ctx.db.query('conversationTurns').withIndex('by_user',q=>q.eq('userId',u._id)).order('desc').take(MAX_TURNS)).filter(t=>valid(t)&&t.messageId!==messageId&&t.stage!=='received');
 const project=(t:Doc<'conversationTurns'>)=>({messageId:t.messageId,userText:t.text,assistantReply:!t.replyDelivery||['returned','accepted'].includes(t.replyDelivery)?t.reply??null:null,replyDelivery:t.replyDelivery??'returned',receivedAt:t.receivedAt,wasSaved:t.recordIds.length>0,recordIds:t.recordIds,askedPendingId:t.askedPendingId??null,outcome:t.outcome??null,storagePermissionAtCapture:t.consentAtCapture,role:t.providerReplyId===quoteId?'assistant':'user'});
 let savedQuote:any=null;
 if(quoteId&&!quoted){
  const receipt=await ctx.db.query('receipts').withIndex('by_user_message',q=>q.eq('userId',u._id).eq('messageId',quoteId)).unique()??await ctx.db.query('receipts').withIndex('by_user_provider_reply',q=>q.eq('userId',u._id).eq('providerReplyId',quoteId)).unique();
  const records:any[]=[];
  for(const recordId of (receipt?.recordIds??[]).slice(0,20))for(const table of ['occurrences','cycleEvents','pilotItems','pilotItemEvents','pilotExperiences','plans','planCompletions'] as const){const id=ctx.db.normalizeId(table,recordId);if(id){const record=await ctx.db.get(id);if(record?.userId===u._id)records.push(record);break;}}
  const askedId=receipt?.askedPendingId?ctx.db.normalizeId('pending',receipt.askedPendingId):null;const asked=askedId?await ctx.db.get(askedId):null;
  if(records.length||asked?.userId===u._id)savedQuote={messageId:receipt!.messageId,role:receipt!.providerReplyId===quoteId?'assistant':'user',userText:null,assistantReply:asked?.userId===u._id?asked.reason:null,receivedAt:receipt!.messageReceivedAt??null,recordIds:records.map(r=>r._id),relatedRecords:records.map(r=>({id:r._id,label:r.label??r.trackedItem??r.title??r.activity,text:(r.text??r.correctionText??'').slice(0,600),date:r.occurrenceDate??r.date??null,kind:r.kind??null,status:r.status??r.state??null})),askedPendingId:asked?.userId===u._id?asked._id:null,wasSaved:records.length>0,source:'current-owned-memory'};
 }
 if(quoteId&&!quoted&&!savedQuote&&u.conversationConsent&&!u.storageWithdrawn){
  const log=await ctx.db.query('conversationLog').withIndex('by_user_message',q=>q.eq('userId',u._id).eq('messageId',quoteId).eq('direction','incoming')).unique()??await ctx.db.query('conversationLog').withIndex('by_user_provider',q=>q.eq('userId',u._id).eq('providerMessageId',quoteId)).unique();
  // A denied or safety-paused health update is never recovered from the debug transcript.
  if(log&&!log.suppressed&&log.epoch===(u.debugEpoch??0)&&log.recordIds.length&&log.text&&!['unpaid','error','safety','safety_paused','stopped','dropped'].includes(log.outcome??''))savedQuote={messageId:log.messageId,role:log.direction==='outgoing'?'assistant':'user',userText:log.direction==='incoming'?log.text.slice(0,1200):null,assistantReply:log.direction==='outgoing'?log.text.slice(0,1200):null,receivedAt:log.providerSentAt??log.receivedAt,recordIds:log.recordIds,wasSaved:true,source:'historical-quote-use-current-owned-records-for-corrections'};
 }
 let chars=0;const recent=[];for(const t of rows){const n=t.text.length+(t.reply?.length??0);if(chars+n>MAX_CHARS)break;recent.push(project(t));chars+=n;}
 const ordered=recent.reverse();const shown=ordered.filter(t=>t.assistantReply!==null).at(-1);
 return {recentTurns:ordered,hasReplyDeliveryEvidence:ordered.length>0,displayedQuestionId:shown?.askedPendingId??null,quoted:quoted?project(quoted):savedQuote,quotedUnavailable:!!quoteId&&!quoted&&!savedQuote,storagePermission:u.conversationConsent===true&&!u.pilotFreshConsentPending};
}
export const begin=internalMutation({args:{token:v.string(),messageId:v.string(),text:v.string(),quotedMessageId:v.optional(v.string())},returns:v.null(),handler:async(ctx,a)=>{
 if(!contextEnabled())return null;const u=await owner(ctx,a.token);
 if(u.dataDeletedAt||u.storageWithdrawn||u.safetyKind||u.state==='stopped'||u.state==='paused'||matchSafetyCategory(a.text)||storageDeclined(a.text)||(await accessFor(ctx,u)).state!=='active')return null;
 const consent=u.conversationConsent===true&&!u.pilotFreshConsentPending;
 if(!consent&&process.env.INTUNE_PRECONSENT_CONTEXT!=='1')return null;
 if(!a.text.trim()||a.text.length>2000||!a.messageId||a.messageId.length>100||a.quotedMessageId&&a.quotedMessageId.length>100)return null;
 if(await ctx.db.query('conversationTurns').withIndex('by_user_message',q=>q.eq('userId',u._id).eq('messageId',a.messageId)).unique())return null;
 const rows=await ctx.db.query('conversationTurns').withIndex('by_user',q=>q.eq('userId',u._id)).order('desc').take(MAX_TURNS+1);
 for(const [i,t] of rows.entries())if(i>=MAX_TURNS-1||t.expiresAt<=Date.now()||t.jobId!==u.jobId||t.resetKey!==u.pilotOnboardingResetKey)await ctx.db.delete(t._id);
 const request=await ctx.db.query('whatsappRequests').withIndex('by_user_message',q=>q.eq('userId',u._id).eq('messageId',a.messageId)).unique();
 const id=await ctx.db.insert('conversationTurns',{userId:u._id,jobId:u.jobId,...(u.pilotOnboardingResetKey?{resetKey:u.pilotOnboardingResetKey}:{}),messageId:a.messageId,text:a.text,receivedAt:request?.providerSentAt??request?.receivedAt??Date.now(),expiresAt:Date.now()+TTL,recordIds:[],stage:'received',consentAtCapture:consent,...(a.quotedMessageId??request?.quotedMessageId?{quotedMessageId:a.quotedMessageId??request!.quotedMessageId}: {})});
 await ctx.scheduler.runAfter(TTL,ref<'mutation'>('conversationContext:expire'),{id});return null;
}});
export const expire=internalMutation({args:{id:v.id('conversationTurns')},returns:v.null(),handler:async(ctx,a)=>{const t=await ctx.db.get(a.id);if(t&&t.expiresAt<=Date.now())await ctx.db.delete(t._id);return null;}});
export async function recordConversationReply(ctx:MutationCtx,u:Doc<'users'>,messageId:string,result:any){
 if(!contextEnabled())return;
 const receipt=await ctx.db.query('receipts').withIndex('by_user_message',q=>q.eq('userId',u._id).eq('messageId',messageId)).unique();
 if(receipt&&result.outcome!=='provider_duplicate'&&result.outcome!=='dropped'&&u.conversationConsent&&!u.pilotFreshConsentPending&&!u.safetyKind&&!u.dataDeletedAt)await ctx.db.patch(receipt._id,{recordIds:(result.changedIds??[]).slice(0,20),askedPendingId:u.conversationQuestionId});
 const t=await ctx.db.query('conversationTurns').withIndex('by_user_message',q=>q.eq('userId',u._id).eq('messageId',messageId)).unique();if(!t||t.stage==='complete'||['provider_duplicate','dropped'].includes(result.outcome))return;
 if(u.safetyKind||u.dataDeletedAt||u.storageWithdrawn||u.state==='stopped'||u.state==='paused'){await clearConversationContext(ctx,u);return;}
 // This is temporary conversational state, not a saved clinical record or operator log.
 const request=await ctx.db.query('whatsappRequests').withIndex('by_user_message',q=>q.eq('userId',u._id).eq('messageId',messageId)).unique();
 await ctx.db.patch(t._id,{replyDelivery:request?'queued':'returned',reply:typeof result.message==='string'?result.message.slice(0,1500):undefined,recordIds:(result.changedIds??[]).slice(0,20),askedPendingId:u.conversationQuestionId,outcome:result.outcome,stage:result.outcome==='error'?'failed':'complete'});
}
export const finish=internalMutation({args:{token:v.string(),messageId:v.string(),text:v.optional(v.string()),quotedMessageId:v.optional(v.string()),result:v.any()},returns:v.null(),handler:async(ctx,a)=>{const u=await owner(ctx,a.token);if(a.text&&u.conversationConsent&&!u.pilotFreshConsentPending&&!['provider_duplicate','dropped','error'].includes(a.result.outcome))await ctx.runMutation(ref<'mutation'>('conversationContext:begin'),{token:a.token,messageId:a.messageId,text:a.text,...(a.quotedMessageId?{quotedMessageId:a.quotedMessageId}:{})});await recordConversationReply(ctx,u,a.messageId,a.result);return null;}});
