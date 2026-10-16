import {logOutgoing} from './conversationLog';
import {recordConversationReply} from './conversationContext';
import {makeFunctionReference} from 'convex/server';
import type {MutationCtx} from './_generated/server';
import type {Doc} from './_generated/dataModel';
export async function saveReply(ctx:MutationCtx,user:Doc<'users'>,messageId:string,result:any,transport=false){
 const currentForContext=await ctx.db.get(user._id);if(currentForContext)await recordConversationReply(ctx,currentForContext,messageId,result);
 const request=await ctx.db.query('whatsappRequests').withIndex('by_user_message',q=>q.eq('userId',user._id).eq('messageId',messageId)).unique();
 if(!request&&!transport)return null;
 const prior=await ctx.db.query('whatsappReplies').withIndex('by_user_message',q=>q.eq('userId',user._id).eq('messageId',messageId)).unique();
 if(['provider_duplicate','dropped'].includes(result.outcome)||typeof result.message!=='string')return prior?._id??null;
 const current=await ctx.db.get(user._id);if(!current)return null;
 const control=result.controlOnly===true||['paused','stopped','deleted','resumed','started','safety','safety_paused','safety_resumed','greeting','disabled','error','help','farewell'].includes(result.outcome);
 const readOnly=result.readOnly===true||result.correctionOnly===true||['summary','plan_summary','no_plan'].includes(result.outcome),version=result.version??current.memoryVersion??0;
 const allowed=control||!current.dataDeletedAt&&(readOnly||current.state!=='stopped'&&!current.safetyKind)&&version===(current.memoryVersion??0)&&(!current.conversationEnabled||readOnly||process.env.INTUNE_CONVERSATION_GATE==='candidate');
 const values={...(result.welcomeGrant?{welcomeGrant:result.welcomeGrant}:{}),version,jobId:current.jobId,status:allowed?'queued' as const:'dropped' as const,control,readOnly,receivedAt:request?.receivedAt??Date.now(),body:allowed?result.message:undefined};
 // Inner helpers may prepare a reply; the outer transaction replaces it with its final coherent reply.
 if(prior){if(prior.status==='queued')await ctx.db.patch(prior._id,values);await logOutgoing(ctx,current,messageId,result,values.status);return prior._id;}
 const id=await ctx.db.insert('whatsappReplies',{userId:current._id,messageId,attempt:0,...values});await logOutgoing(ctx,current,messageId,result,values.status);if(allowed)await ctx.scheduler.runAfter(1000,makeFunctionReference<'action'>('whatsappDelivery:deliver'),{id});return id;
}
