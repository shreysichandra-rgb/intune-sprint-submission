import {captureAcquisition,purgeAcquisition} from './pilotAcquisition';
import {clearConversationContext} from './conversationContext';
import {v} from 'convex/values';
import {makeFunctionReference as ref,paginationOptsValidator} from 'convex/server';
import {internalQuery,internalMutation} from './_generated/server';
import type {MutationCtx} from './_generated/server';
import type {Doc} from './_generated/dataModel';
import {userFor} from './tracking';
import {storageDeclined} from './directTracking';
import {redactLog} from './logRedaction';
export function loggingEnabled(){return process.env.INTUNE_PILOT_MODE==='v3'&&process.env.INTUNE_DEBUG_LOGGING==='1';}
const withdrawal=(text:string)=>/^(?:please )?(?:stop saving|stop logging|withdraw (?:my )?(?:storage )?permission|do not save anything|don't save anything|don’t save anything)[.!]?$/i.test(text.trim());
async function purgeBatch(ctx:MutationCtx,userId:Doc<'users'>['_id'],throughEpoch:number){
 let complete=true;
 for(const table of ['conversationAttachments','conversationLog'] as const){
  const rows=await ctx.db.query(table).withIndex('by_user_epoch',q=>q.eq('userId',userId).lte('epoch',throughEpoch)).take(50);
  for(const row of rows){if('storageId' in row&&row.storageId)await ctx.storage.delete(row.storageId);await ctx.db.delete(row._id);}if(rows.length===50)complete=false;
 }
 if(!complete)await ctx.scheduler.runAfter(0,ref<'mutation'>('conversationLog:purgePage'),{userId,throughEpoch});return complete;
}
export async function purgeConversationLog(ctx:MutationCtx,u:Doc<'users'>){
 await purgeAcquisition(ctx,u._id);const current=await ctx.db.get(u._id);if(!current)return true;const throughEpoch=current.debugEpoch??0;
 // Hide content and invalidate every in-flight job before bounded physical deletion.
 await ctx.db.patch(u._id,{debugEpoch:throughEpoch+1});return purgeBatch(ctx,u._id,throughEpoch);
}
export const purgePage=internalMutation({args:{userId:v.id('users'),throughEpoch:v.number()},returns:v.null(),handler:async(ctx,a)=>{await purgeBatch(ctx,a.userId,a.throughEpoch);return null;}});
export const privacy=internalMutation({args:{token:v.string(),text:v.string(),messageId:v.string()},returns:v.any(),handler:async(ctx,a)=>{
 if(!loggingEnabled())return null;const u=await userFor(ctx,a.token);
 const isWithdrawal=withdrawal(a.text),isResume=!!u.storageWithdrawn&&/^(?:please )?(?:save again|start saving again|resume saving)[.!]?$/i.test(a.text.trim());
 if(isWithdrawal||isResume){const prior=await ctx.db.query('receipts').withIndex('by_user_message',q=>q.eq('userId',u._id).eq('messageId',a.messageId)).unique();if(prior?.state==='complete')return {outcome:'provider_duplicate',message:'I already received this message.'};await ctx.runMutation(ref<'mutation'>('tracking:receive'),{token:a.token,messageId:a.messageId});const receipt=await ctx.db.query('receipts').withIndex('by_user_message',q=>q.eq('userId',u._id).eq('messageId',a.messageId)).unique();if(receipt)await ctx.db.patch(receipt._id,{state:'complete',replyEntry:'conversation_storage_control',repliedAt:Date.now()});}
 if(isWithdrawal){const removed=await purgeConversationLog(ctx,u);await clearConversationContext(ctx,u);await ctx.db.patch(u._id,{storageWithdrawn:true,conversationConsent:false,conversationConsentAsked:undefined,conversationQuestionId:undefined,memoryVersion:(u.memoryVersion??0)+1});return {outcome:'privacy',controlOnly:true,message:'I’ve stopped saving new information. '+(removed?'The conversation and upload copies kept for debugging were removed.':'The conversation and upload copies are hidden and being deleted.')+' Your previously saved health records remain; you can ask me to delete them too.'};}
 if(isResume){await ctx.db.patch(u._id,{storageWithdrawn:undefined,conversationConsent:true,pilotFreshConsentPending:undefined,memoryVersion:(u.memoryVersion??0)+1});return {outcome:'privacy',controlOnly:true,message:'Saving is back on. Payment access and reminder permissions stay the same.'};}return null;
}});
export const begin=internalMutation({args:{token:v.string(),messageId:v.string(),type:v.string(),text:v.optional(v.string()),quotedMessageId:v.optional(v.string()),providerSentAt:v.optional(v.number()),media:v.optional(v.object({id:v.optional(v.string()),filename:v.optional(v.string()),mimeType:v.optional(v.string())}))},returns:v.union(v.id('conversationLog'),v.null()),handler:async(ctx,a)=>{
 if(!loggingEnabled())return null;const u=await userFor(ctx,a.token);if(u.dataDeletedAt)return null;
 const prior=await ctx.db.query('conversationLog').withIndex('by_user_message',q=>q.eq('userId',u._id).eq('messageId',a.messageId).eq('direction','incoming')).unique();if(prior)return prior._id;
 const request=await ctx.db.query('whatsappRequests').withIndex('by_user_message',q=>q.eq('userId',u._id).eq('messageId',a.messageId)).unique();
 const suppressed=!!u.storageWithdrawn||!!a.text&&(storageDeclined(a.text)||withdrawal(a.text));
 if(!suppressed)await captureAcquisition(ctx,u,a,request?.receivedAt??Date.now());
 const id=await ctx.db.insert('conversationLog',{userId:u._id,epoch:u.debugEpoch??0,messageId:a.messageId,direction:'incoming',type:a.type.slice(0,40),receivedAt:request?.receivedAt??Date.now(),providerSentAt:a.providerSentAt??request?.providerSentAt,quotedMessageId:a.quotedMessageId??request?.quotedMessageId,...(!suppressed&&a.text?{text:redactLog(a.text)}:{}),recordIds:[],suppressed});
 if(a.media&&!suppressed)await ctx.db.insert('conversationAttachments',{userId:u._id,logId:id,epoch:u.debugEpoch??0,type:a.type,mediaId:a.media.id,filename:a.media.filename?redactLog(a.media.filename):undefined,mimeType:a.media.mimeType,state:a.media.id?'pending':'failed',...(!a.media.id?{failure:'missing_media_id'}:{})});return id;
}});
export const finish=internalMutation({args:{id:v.id('conversationLog'),result:v.any()},returns:v.null(),handler:async(ctx,a)=>{
 const row=await ctx.db.get(a.id);if(!row)return null;if(a.result.outcome==='provider_duplicate'&&row.outcome!==undefined)return null;const u=await ctx.db.get(row.userId);if(!u||u.dataDeletedAt||row.epoch!==(u.debugEpoch??0))return null;
 const receipt=await ctx.db.query('receipts').withIndex('by_user_message',q=>q.eq('userId',row.userId).eq('messageId',row.messageId)).unique();
 await ctx.db.patch(row._id,{outcome:a.result.outcome??'error',recordIds:row.suppressed?[]:(a.result.changedIds??receipt?.recordIds??[]).slice(0,20),...(receipt?.verificationFailure?{failure:receipt.verificationFailure.reason}:a.result.failure?.kind==='usage_limit'?{failure:'usage_limit:'+a.result.failure.limits.join(',')}:{})});return null;
}});
export async function logOutgoing(ctx:MutationCtx,u:Doc<'users'>,messageId:string,result:any,delivery:string,proactive=false){
 if(!loggingEnabled()||u.dataDeletedAt||u.storageWithdrawn||typeof result.message!=='string'||['provider_duplicate','dropped'].includes(result.outcome))return;
 const incoming=await ctx.db.query('conversationLog').withIndex('by_user_message',q=>q.eq('userId',u._id).eq('messageId',messageId).eq('direction','incoming')).unique();
 if(incoming?.suppressed||incoming&&incoming.epoch!==(u.debugEpoch??0))return;
 const prior=await ctx.db.query('conversationLog').withIndex('by_user_message',q=>q.eq('userId',u._id).eq('messageId',messageId).eq('direction','outgoing')).unique();
 const value={text:delivery==='dropped'?undefined:redactLog(result.message),outcome:result.outcome,delivery,recordIds:(result.changedIds??[]).slice(0,20)};
 if(prior){if(!['accepted','delivered','read'].includes(prior.delivery??''))await ctx.db.patch(prior._id,value);return;}
 // Proactive and welcome replies have no incoming row. Their source is the server-owned outbox.
 if(!incoming&&!proactive&&!/^(?:pilot-welcome:|pilot-period:|pilot-trial-end:)/.test(messageId))return;
 if(!incoming&&!proactive&&!await ctx.db.query('whatsappReplies').withIndex('by_user_message',q=>q.eq('userId',u._id).eq('messageId',messageId)).unique())return;
 await ctx.db.insert('conversationLog',{userId:u._id,epoch:u.debugEpoch??0,messageId,direction:'outgoing',type:'text',receivedAt:Date.now(),suppressed:false,...value});
}
export const outgoing=internalMutation({args:{token:v.string(),messageId:v.string(),result:v.any()},returns:v.null(),handler:async(ctx,a)=>{const u=await userFor(ctx,a.token);const request=await ctx.db.query('whatsappRequests').withIndex('by_user_message',q=>q.eq('userId',u._id).eq('messageId',a.messageId)).unique();await logOutgoing(ctx,u,a.messageId,a.result,request?'queued':'returned');return null;}});
export const status=internalMutation({args:{providerMessageId:v.string(),recipient:v.string(),status:v.string(),at:v.optional(v.number())},returns:v.null(),handler:async(ctx,a)=>{
 const row=await ctx.db.query('conversationLog').withIndex('by_provider',q=>q.eq('providerMessageId',a.providerMessageId)).unique();if(!row)return null;const u=await ctx.db.get(row.userId);if(!u||u.phoneNumber!=='+'+a.recipient||u.dataDeletedAt||row.epoch!==(u.debugEpoch??0))return null;
 const rank:Record<string,number>={queued:0,accepted:1,delivered:2,read:3};if(a.status==='failed'||(rank[a.status]??-1)>(rank[row.delivery??'queued']??0)){const now=Date.now();await ctx.db.patch(row._id,{delivery:a.status,...(a.status==='delivered'?{deliveryCallbackAt:now,...(row.providerAcceptedAt!==undefined?{timings:[...(row.timings??[]).filter(t=>t.scope!=='delivery_callback'),{scope:'delivery_callback',totalMs:Math.max(0,now-row.providerAcceptedAt),stages:[{stage:'whatsapp:acceptance_to_delivery_callback',ms:Math.max(0,now-row.providerAcceptedAt),runs:1,failed:0}]}].slice(-6)}:{})}:{})});}return null;
}});
// Only deployment administrators can call these internal functions. No public file URLs.
export const review=internalQuery({args:{phoneNumber:v.string(),paginationOpts:paginationOptsValidator},returns:v.any(),handler:async(ctx,a)=>{
 const u=await ctx.db.query('users').withIndex('by_phone',q=>q.eq('phoneNumber',a.phoneNumber)).unique();if(!u)return null;
 const page=await ctx.db.query('conversationLog').withIndex('by_user_epoch',q=>q.eq('userId',u._id).eq('epoch',u.debugEpoch??0)).order('desc').paginate({...a.paginationOpts,numItems:Math.min(a.paginationOpts.numItems,50)});
 const attachments=[];for(const row of page.page)attachments.push(...await ctx.db.query('conversationAttachments').withIndex('by_log',q=>q.eq('logId',row._id)).take(10));return {...page,attachments};
}});
export const attachment=internalQuery({args:{phoneNumber:v.string(),id:v.id('conversationAttachments')},returns:v.any(),handler:async(ctx,a)=>{const u=await ctx.db.query('users').withIndex('by_phone',q=>q.eq('phoneNumber',a.phoneNumber)).unique(),file=await ctx.db.get(a.id);if(!u||!file||file.userId!==u._id||u.dataDeletedAt||file.epoch!==(u.debugEpoch??0))return null;return file;}});
export const claimAttachment=internalMutation({args:{logId:v.id('conversationLog')},returns:v.any(),handler:async(ctx,a)=>{
 const row=await ctx.db.get(a.logId);if(!row||row.suppressed)return null;const u=await ctx.db.get(row.userId);if(!u||u.dataDeletedAt||u.storageWithdrawn||row.epoch!==(u.debugEpoch??0))return null;
 const file=await ctx.db.query('conversationAttachments').withIndex('by_log',q=>q.eq('logId',row._id)).unique();if(!file)return null;
 if(file.state==='stored'||file.state==='failed')return {...file,done:true};if(file.state==='fetching'&&(file.leaseUntil??0)>Date.now())return {done:true,state:'fetching'};
 const leaseUntil=Date.now()+60000;await ctx.db.patch(file._id,{state:'fetching',leaseUntil});return {...file,leaseUntil,done:false};
}});
export const storeAttachment=internalMutation({args:{id:v.id('conversationAttachments'),leaseUntil:v.number(),storageId:v.optional(v.id('_storage')),size:v.optional(v.number()),mimeType:v.optional(v.string()),failure:v.optional(v.string())},returns:v.boolean(),handler:async(ctx,a)=>{
 const file=await ctx.db.get(a.id),u=file?await ctx.db.get(file.userId):null;
 if(!file||!u||u.dataDeletedAt||u.storageWithdrawn||file.epoch!==(u.debugEpoch??0)||file.state!=='fetching'||file.leaseUntil!==a.leaseUntil){if(a.storageId)await ctx.storage.delete(a.storageId);return false;}
 await ctx.db.patch(file._id,{storageId:a.storageId,size:a.size,mimeType:a.mimeType??file.mimeType,state:a.storageId?'stored':'failed',failure:a.failure,leaseUntil:undefined});return !!a.storageId;
}});

export const reminder=internalMutation({args:{id:v.id('pilotReminderDeliveries'),epoch:v.number(),body:v.string(),type:v.string(),status:v.string(),providerMessageId:v.optional(v.string())},returns:v.null(),handler:async(ctx,a)=>{
 const d=await ctx.db.get(a.id);if(!d)return null;const u=await ctx.db.get(d.userId);if(!u||u.dataDeletedAt||u.storageWithdrawn||(u.debugEpoch??0)!==a.epoch)return null;
 const messageId='pilot-reminder:'+a.id;await logOutgoing(ctx,u,messageId,{outcome:'reminder',message:a.body},a.status,true);
 const row=await ctx.db.query('conversationLog').withIndex('by_user_message',q=>q.eq('userId',u._id).eq('messageId',messageId).eq('direction','outgoing')).unique();if(row)await ctx.db.patch(row._id,{type:a.type,providerMessageId:a.providerMessageId});return null;
}});

export const failure=internalMutation({args:{token:v.string(),messageId:v.string(),kind:v.string(),phase:v.string(),rule:v.optional(v.string())},returns:v.null(),handler:async(ctx,a)=>{if(!loggingEnabled())return null;const u=await userFor(ctx,a.token);const row=await ctx.db.query('conversationLog').withIndex('by_user_message',q=>q.eq('userId',u._id).eq('messageId',a.messageId).eq('direction','incoming')).unique();if(row&&!u.dataDeletedAt&&row.epoch===(u.debugEpoch??0))await ctx.db.patch(row._id,{failure:[a.kind,a.phase,a.rule??''].filter(Boolean).join(':').slice(0,160)});return null;}});

export const retained=internalQuery({args:{id:v.id("conversationLog")},returns:v.boolean(),handler:async(ctx,a)=>{const row=await ctx.db.get(a.id);if(!row||row.suppressed)return false;const u=await ctx.db.get(row.userId);return !!u&&!u.dataDeletedAt&&!u.storageWithdrawn&&row.epoch===(u.debugEpoch??0);}});
