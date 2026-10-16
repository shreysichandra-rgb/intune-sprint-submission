// Internal, fixed-deployment synthetic fixture reset. Not a user restart path.
import {v} from 'convex/values';
import {internalMutation,internalQuery} from './_generated/server';
import {internal} from './_generated/api';
import {localDate,shiftDate} from './rules';
import {verificationRevision} from './verificationRevision';
const isolated=()=>process.env.CONVEX_CLOUD_URL==='https://disciplined-mammoth-312.convex.cloud'||process.env.CONVEX_SITE_URL==='https://disciplined-mammoth-312.convex.site';
export const reset=internalMutation({args:{token:v.string(),jobId:v.string(),enroll:v.boolean()},returns:v.string(),handler:async(ctx,a)=>{
 if(!isolated()||process.env.INTUNE_SYNTHETIC_TRANSPORT!=='1'||process.env.INTUNE_CONVERSATION_GATE!=='candidate')throw new Error('Isolated synthetic fixtures only');
 if(!/^[a-f0-9-]{36}$/.test(a.jobId))throw new Error('Fixture identifier required');
 const u=await ctx.db.query('users').withIndex('by_token',q=>q.eq('token',a.token)).unique();
 if(!u||!/^\+120255501\d{2}$/.test(u.phoneNumber??''))throw new Error('Synthetic account required');
 // Stable reset ID makes a lost CLI response safe to retry; quotas are never reset.
 if(u.jobId===a.jobId)return u.token;
 await ctx.runMutation(internal.commands.execute,{token:a.token,command:'delete'});
 // Remove synthetic receipt history to exercise genuinely first-time onboarding.
 // This test-only reset never clears usage limits or changes real-user deletion.
 while(true){const receipts=await ctx.db.query('receipts').withIndex('by_user_reply_entry',q=>q.eq('userId',u._id)).take(100);if(!receipts.length)break;for(const receipt of receipts)await ctx.db.delete(receipt._id);}
 const end=localDate(Date.now(),u.timezone);
 await ctx.db.patch(u._id,{jobId:a.jobId,startDate:shiftDate(end,-6),endDate:end,state:'active',dataDeletedAt:undefined,conversationEnabled:a.enroll?true:undefined,conversationConsent:undefined,conversationConsentAsked:undefined,conversationQuestionId:undefined,greetingSeenAt:undefined,safetyKind:undefined,safetyReturnAsked:undefined,testNow:undefined,trackedItems:[],clarificationChoices:undefined});
 return u.token;
}});

export const failure=internalMutation({args:{token:v.string(),messageId:v.string(),phase:v.string(),reason:v.union(v.literal('quota'),v.literal('provider_rate_limit'),v.literal('provider_timeout'),v.literal('model_or_provider_rejected'),v.literal('validation'))},returns:v.null(),handler:async(ctx,a)=>{
 if(!isolated()||process.env.INTUNE_SYNTHETIC_TRANSPORT!=='1')return null;
 if(!['receive','normalize','verify','decode','apply'].includes(a.phase))return null;
 const u=await ctx.db.query('users').withIndex('by_token',q=>q.eq('token',a.token)).unique();
 if(!u||!/^\+120255501\d{2}$/.test(u.phoneNumber??''))return null;
 const receipt=await ctx.db.query('receipts').withIndex('by_user_message',q=>q.eq('userId',u._id).eq('messageId',a.messageId)).unique();
 if(receipt)await ctx.db.patch(receipt._id,{verificationFailure:{phase:a.phase,reason:a.reason}});
 return null;
}});

export const identity=internalQuery({args:{},returns:v.string(),handler:async()=>{if(!isolated())throw new Error("Fixed test deployment only");return verificationRevision;}});
