import {captureAcquisition} from './pilotAcquisition';
import {whatsappReplyPayload} from './checkoutPresentation';
import {stageTimer} from './conversationTiming';
import {validEntitlementSource} from './pilotPaymentMode';
import {operatorPhonePermitted} from './operatorPhoneGate';
import {v} from 'convex/values';
import {makeFunctionReference} from 'convex/server';
import {internalMutation,internalQuery,internalAction} from './_generated/server';
import {saveReply} from './deliveryState';
import {userFor} from './tracking';
const deliverRef=makeFunctionReference<'action'>('whatsappDelivery:deliver');
const claimRef=makeFunctionReference<'mutation'>('whatsappDelivery:claim');
const finishRef=makeFunctionReference<'mutation'>('whatsappDelivery:finish');
export const lookup=internalQuery({args:{token:v.string(),messageId:v.string()},returns:v.union(v.id('whatsappReplies'),v.null()),handler:async(ctx,a)=>{const u=await userFor(ctx,a.token);return (await ctx.db.query('whatsappReplies').withIndex('by_user_message',q=>q.eq('userId',u._id).eq('messageId',a.messageId)).unique())?._id??null;}});
export const enqueue=internalMutation({args:{token:v.string(),messageId:v.string(),result:v.any()},returns:v.union(v.id('whatsappReplies'),v.null()),handler:async(ctx,a)=>{
 const u=await userFor(ctx,a.token);return await saveReply(ctx,u,a.messageId,a.result,true);
}});
export const claim=internalMutation({args:{id:v.id('whatsappReplies')},returns:v.any(),handler:async(ctx,a)=>{
 const r=await ctx.db.get(a.id);if(!r||r.status==='sent'||r.status==='dropped')return {done:true};
 const u=await ctx.db.get(r.userId);if(!u||!u.phoneNumber)return {done:true};
 if(r.welcomeGrant){const g=await ctx.db.get(r.welcomeGrant);if(!g||g.userId!==u._id||g.revokedAt!==undefined||g.startedAt!==undefined||g.activationDeadline<=Date.now()||u.dataDeletedAt||u.state==='stopped'||u.state==='paused'||u.safetyKind||!validEntitlementSource(g.source)){await ctx.db.patch(r._id,{status:'dropped',body:undefined});return {done:true};}}
 if(!r.control&&(u.dataDeletedAt||r.version!==(u.memoryVersion??0)||r.jobId!==u.jobId||!r.readOnly&&(u.state==='stopped'||!!u.safetyKind||u.conversationEnabled&&process.env.INTUNE_CONVERSATION_GATE!=='candidate'))){await ctx.db.patch(r._id,{status:'dropped',body:undefined});return {done:true};}
 const sending=await ctx.db.query('whatsappReplies').withIndex('by_user_status',q=>q.eq('userId',u._id).eq('status','sending')).take(20);
 if(sending.some(other=>(other.leaseUntil??0)>Date.now())){await ctx.scheduler.runAfter(250,deliverRef,{id:r._id});return {done:true};}
 for(const stale of sending)await ctx.db.patch(stale._id,{status:'queued',leaseUntil:undefined});
 const queued=await ctx.db.query('whatsappReplies').withIndex('by_user_status_time',q=>q.eq('userId',u._id).eq('status','queued')).order('asc').take(100);const position=queued.findIndex(other=>other._id===r._id);const older=position!==0?queued[0]:undefined;if(older){await ctx.scheduler.runAfter(0,deliverRef,{id:older._id});await ctx.scheduler.runAfter(250,deliverRef,{id:r._id});return {done:true};}
 const attempt=r.attempt+1;if(attempt>3){await ctx.db.patch(r._id,{status:'dropped',body:undefined});return {done:true};}
 await ctx.db.patch(r._id,{status:'sending',attempt,leaseUntil:Date.now()+15000});
 // Recover even if the worker dies after claiming, without simultaneous senders.
 await ctx.scheduler.runAfter(16000,deliverRef,{id:r._id});
 return {done:false,body:r.body,to:u.phoneNumber.slice(1),attempt,welcomeGrant:r.welcomeGrant??null};
}});
export const finish=internalMutation({args:{id:v.id('whatsappReplies'),attempt:v.number(),ok:v.boolean(),unknown:v.optional(v.boolean()),providerMessageId:v.optional(v.string())},returns:v.null(),handler:async(ctx,a)=>{
 const r=await ctx.db.get(a.id);if(!r||r.status!=='sending'||r.attempt!==a.attempt)return null;
 const log=await ctx.db.query('conversationLog').withIndex('by_user_message',q=>q.eq('userId',r.userId).eq('messageId',r.messageId).eq('direction','outgoing')).unique();
 if(log)await ctx.db.patch(log._id,{delivery:a.unknown?'unknown':a.ok?'accepted':r.attempt>=3?'failed':'retrying',...(a.providerMessageId?{providerMessageId:a.providerMessageId}:{}),...(a.ok&&!a.unknown?{providerAcceptedAt:log.providerAcceptedAt??Date.now()}:{})});
 if(a.unknown)await ctx.db.patch(r._id,{status:'dropped',uncertainDelivery:true,body:undefined,leaseUntil:undefined});
 else if(a.ok){await ctx.db.patch(r._id,{status:'sent',body:undefined,leaseUntil:undefined,...(a.providerMessageId?{providerMessageId:a.providerMessageId}:{})});
  const receipt=await ctx.db.query('receipts').withIndex('by_user_message',q=>q.eq('userId',r.userId).eq('messageId',r.messageId)).unique();if(receipt&&a.providerMessageId)await ctx.db.patch(receipt._id,{providerReplyId:a.providerMessageId});
  const turn=await ctx.db.query('conversationTurns').withIndex('by_user_message',q=>q.eq('userId',r.userId).eq('messageId',r.messageId)).unique();if(turn)await ctx.db.patch(turn._id,{replyDelivery:'accepted',...(a.providerMessageId?{providerReplyId:a.providerMessageId}:{})});
 }
 else if(r.attempt>=3)await ctx.db.patch(r._id,{status:'dropped',body:undefined,leaseUntil:undefined});
 else{await ctx.db.patch(r._id,{status:'queued',leaseUntil:undefined});await ctx.scheduler.runAfter(1000*r.attempt,deliverRef,{id:r._id});}
 if(!a.ok||a.unknown){const turn=await ctx.db.query('conversationTurns').withIndex('by_user_message',q=>q.eq('userId',r.userId).eq('messageId',r.messageId)).unique();if(turn)await ctx.db.patch(turn._id,{replyDelivery:'unconfirmed'});}
 return null;
}});
export const deliver=internalAction({args:{id:v.id('whatsappReplies')},returns:v.boolean(),handler:async(ctx,a)=>{
 const timer=stageTimer();
 const r:any=await timer.run('delivery:claim',()=>ctx.runMutation(claimRef,a));if(r.done)return true;
 let ok=false,attempted=false,acknowledged=false,acceptedHttp=false,providerMessageId:string|null=null;
 try{
  if(!operatorPhonePermitted('+'+r.to))throw new Error('Test recipient unavailable');
  const synthetic=process.env.INTUNE_SYNTHETIC_TRANSPORT==='1';
  if(synthetic&&!/^120255501\d{2}$/.test(r.to))throw new Error('Synthetic recipient required');
  const url=synthetic?`${process.env.CONVEX_SITE_URL}/verification/whatsapp`:`https://graph.facebook.com/v23.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
  const key=synthetic?process.env.INTUNE_SYNTHETIC_SINK_KEY:process.env.WHATSAPP_ACCESS_TOKEN;
  const payload=whatsappReplyPayload(r.to,r.body,synthetic?undefined:process.env.INTUNE_PILOT_WEB_URL??process.env.CONVEX_SITE_URL);
  attempted=true;const response=await timer.run('whatsapp:request',()=>fetch(url,{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(10000)}));acknowledged=true;acceptedHttp=response.ok;ok=response.ok;if(ok){const body:any=await response.json();providerMessageId=body.messages?.[0]?.id??null;if(!providerMessageId)ok=false;}
 }catch{ok=false;/* Never log phone numbers, body text or provider errors. */}
 const unknown=attempted&&!acknowledged||acceptedHttp&&!providerMessageId||!!r.welcomeGrant&&!ok;if(unknown)ok=false;
 if(r.welcomeGrant){if(ok&&providerMessageId)await ctx.runMutation(makeFunctionReference<'mutation'>('pilotAccess:welcomeAccepted'),{grantId:r.welcomeGrant,providerMessageId,replyId:a.id});else await ctx.runMutation(makeFunctionReference<'mutation'>('pilotAccess:welcomeUnknown'),{grantId:r.welcomeGrant});}
 await timer.run('delivery:finish',()=>ctx.runMutation(finishRef,{id:a.id,attempt:r.attempt,ok:ok||!!r.welcomeGrant,unknown,...(providerMessageId?{providerMessageId}:{})}));
 try{await ctx.runMutation(makeFunctionReference<'mutation'>('conversationTiming:delivery'),{id:a.id,snapshot:timer.snapshot('delivery')});}catch{/* Keep transport results authoritative. */}return ok;
}});

export const request=internalMutation({args:{token:v.string(),messageId:v.string(),showTyping:v.optional(v.boolean()),referralAdId:v.optional(v.string()),quotedMessageId:v.optional(v.string()),providerSentAt:v.optional(v.number())},returns:v.null(),handler:async(ctx,a)=>{
 const u=await userFor(ctx,a.token);await ctx.db.patch(u._id,{lastInboundAt:Date.now()});
 const existing=await ctx.db.query('whatsappRequests').withIndex('by_user_message',q=>q.eq('userId',u._id).eq('messageId',a.messageId)).unique();
 if(!existing){const id=await ctx.db.insert('whatsappRequests',{userId:u._id,messageId:a.messageId,receivedAt:Date.now(),...(a.quotedMessageId?{quotedMessageId:a.quotedMessageId}:{}),...(a.providerSentAt!==undefined?{providerSentAt:a.providerSentAt}:{})});
  if(a.referralAdId)await captureAcquisition(ctx,u,{messageId:a.messageId,referralAdId:a.referralAdId},Date.now());
  // Separate worker: indicator failure must never delay processing or delivery.
  // Brief delay lets already-prepared replies skip an unnecessary indicator.
  if(a.showTyping)await ctx.scheduler.runAfter(1000,makeFunctionReference<'action'>('whatsappTyping:show'),{id});
 }return null;
}});
