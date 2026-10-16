import {v} from 'convex/values';
import {internalMutation} from './_generated/server';
import {pilotUser} from './pilotAccess';
export const offer=internalMutation({args:{token:v.string(),messageId:v.string(),version:v.number()},returns:v.boolean(),handler:async(ctx,a)=>{
 const u=await pilotUser(ctx,a.token);if(u.dataDeletedAt||u.safetyKind||u.state==='stopped'||!u.conversationConsent||(u.memoryVersion??0)!==a.version)return false;
 const old=await ctx.db.query('pilotSummaryReviews').withIndex('by_user',q=>q.eq('userId',u._id)).unique();
 if(old?.messageId===a.messageId&&old.version===a.version)return true;
 const value={userId:u._id,jobId:u.jobId,version:a.version,messageId:a.messageId,offeredAt:Date.now(),awaitingApproval:true,approvedAt:undefined,approvalMessageId:undefined};
 if(old)await ctx.db.patch(old._id,value);else await ctx.db.insert('pilotSummaryReviews',value);
 const receipt=await ctx.db.query('receipts').withIndex('by_user_message',q=>q.eq('userId',u._id).eq('messageId',a.messageId)).unique();if(receipt)await ctx.db.patch(receipt._id,{state:'complete',replyEntry:'pilot_summary_review',repliedAt:Date.now()});return true;
}});
export const approve=internalMutation({args:{token:v.string(),messageId:v.string()},returns:v.any(),handler:async(ctx,a)=>{
 const u=await pilotUser(ctx,a.token);if(u.dataDeletedAt||u.safetyKind||u.state==='stopped'||!u.conversationConsent)return null;
 const review=await ctx.db.query('pilotSummaryReviews').withIndex('by_user',q=>q.eq('userId',u._id)).unique();
 const latest=(await ctx.db.query('receipts').withIndex('by_user_reply_at',q=>q.eq('userId',u._id)).order('desc').take(20)).find(r=>r.state==='complete'&&r.messageId!==a.messageId);
 if(!review||review.awaitingApproval!==true||review.jobId!==u.jobId||!latest||!['pilot_summary_review','pilot_summary_approved'].includes(latest.replyEntry??''))return null;
 if(review.version!==(u.memoryVersion??0))return {outcome:'summary',controlOnly:true,message:'Your records changed after that summary. Ask for your weekly summary again so you can check the corrected version.'};
 if(!review.approvedAt)await ctx.db.patch(review._id,{approvedAt:Date.now(),approvalMessageId:a.messageId});
 const receipt=await ctx.db.query('receipts').withIndex('by_user_message',q=>q.eq('userId',u._id).eq('messageId',a.messageId)).unique();if(receipt)await ctx.db.patch(receipt._id,{state:'complete',replyEntry:'pilot_summary_approved',repliedAt:Date.now()});
 return {outcome:'summary',controlOnly:true,message:'Marked your weekly summary as accurate. This does not renew your pilot or charge you.'};
}});

export const dismiss=internalMutation({args:{token:v.string()},returns:v.null(),handler:async(ctx,a)=>{const u=await pilotUser(ctx,a.token);const review=await ctx.db.query('pilotSummaryReviews').withIndex('by_user',q=>q.eq('userId',u._id)).unique();if(review?.awaitingApproval)await ctx.db.patch(review._id,{awaitingApproval:false});return null;}});
