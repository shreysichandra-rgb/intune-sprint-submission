import {v} from 'convex/values';
import {makeFunctionReference} from 'convex/server';
import {internalAction,internalMutation} from './_generated/server';
import {operatorPhonePermitted} from './operatorPhoneGate';

// Only an authenticated webhook creates these owned requests. No public typing endpoint.
export const claim=internalMutation({args:{id:v.id('whatsappRequests')},returns:v.union(v.string(),v.null()),handler:async(ctx,a)=>{
 const request=await ctx.db.get(a.id);
 if(!request||request.typingAttemptAt!==undefined||Date.now()-request.receivedAt>25000)return null;
 const u=await ctx.db.get(request.userId);
 if(!u?.phoneNumber||u.dataDeletedAt||u.state==='stopped'||!operatorPhonePermitted(u.phoneNumber))return null;
 const reply=await ctx.db.query('whatsappReplies').withIndex('by_user_message',q=>q.eq('userId',u._id).eq('messageId',request.messageId)).unique();
 const receipt=await ctx.db.query('receipts').withIndex('by_user_message',q=>q.eq('userId',u._id).eq('messageId',request.messageId)).unique();
 if(reply||receipt?.state==='complete')return null;
 await ctx.db.patch(request._id,{typingAttemptAt:Date.now()});
 return request.messageId;
}});
export const show=internalAction({args:{id:v.id('whatsappRequests')},returns:v.boolean(),handler:async(ctx,a)=>{
 // Fictional transport never calls Meta or changes simulated delivery evidence.
 if(process.env.INTUNE_SYNTHETIC_TRANSPORT==='1')return false;
 const phone=process.env.WHATSAPP_PHONE_NUMBER_ID,key=process.env.WHATSAPP_ACCESS_TOKEN;
 if(!phone||!/^\d+$/.test(phone)||!key)return false;
 const messageId=await ctx.runMutation(makeFunctionReference<'mutation'>('whatsappTyping:claim'),a);
 if(!messageId)return false;
 try{
  const response=await fetch(`https://graph.facebook.com/v23.0/${phone}/messages`,{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({messaging_product:'whatsapp',status:'read',message_id:messageId,typing_indicator:{type:'text'}}),signal:AbortSignal.timeout(2000)});
  // Do not log provider bodies, credentials, identifiers or message contents.
  return response.ok;
 }catch{return false;}
}});
