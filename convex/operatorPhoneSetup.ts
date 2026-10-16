// Only recovery of the operator fixture recorded by the private setup session.
import {v} from 'convex/values';
import {internalMutation} from './_generated/server';
import {localDate,shiftDate} from './rules';
export const restore=internalMutation({args:{token:v.string(),jobId:v.string()},returns:v.null(),handler:async(ctx,a)=>{
 const isolated=process.env.CONVEX_CLOUD_URL==='https://disciplined-mammoth-312.convex.cloud'||process.env.CONVEX_SITE_URL==='https://disciplined-mammoth-312.convex.site';
 const originalOwned=(process.env.CONVEX_CLOUD_URL==='https://careful-caterpillar-581.convex.cloud'||process.env.CONVEX_SITE_URL==='https://careful-caterpillar-581.convex.site')&&process.env.INTUNE_CONVERSATION_ROLLOUT==='off'&&process.env.INTUNE_OPERATOR_FIXTURE_TOKEN===a.token;
 const expiry=Number(process.env.INTUNE_OPERATOR_PHONE_EXPIRES),now=Date.now();
 if(!(isolated||originalOwned)||process.env.INTUNE_CONVERSATION_GATE!=='off'||process.env.INTUNE_SYNTHETIC_TRANSPORT!=='0'||!Number.isFinite(expiry)||expiry<=now||expiry-now>3600000)throw new Error('Operator recovery disabled');
 if(!/^[a-f0-9-]{36}$/.test(a.jobId))throw new Error('Recovery identifier required');
 const u=await ctx.db.query('users').withIndex('by_token',q=>q.eq('token',a.token)).unique();
 if(!u||u.phoneNumber!==process.env.INTUNE_OPERATOR_PHONE)throw new Error('Operator ownership mismatch');
 if(u.jobId===a.jobId)return null;
 if(originalOwned&&now-u._creationTime>7200000)throw new Error('Fresh synthetic fixture required');
 if(!u.dataDeletedAt||u.state!=='stopped')throw new Error('Deleted operator fixture required');
 for(const table of ['occurrences','cycleEvents','pending','plans','planCompletions','planPending','references','proactiveOutputs','whatsappReplies','whatsappRequests','verificationDeliveries','verificationBarriers'] as const){if((await ctx.db.query(table).withIndex('by_user',q=>q.eq('userId',u._id)).take(1)).length)throw new Error('Operator records remain');}
 while(true){const rows=await ctx.db.query('receipts').withIndex('by_user_message',q=>q.eq('userId',u._id)).take(100);if(!rows.length)break;for(const row of rows)await ctx.db.delete(row._id);}
 const end=localDate(now,u.timezone);await ctx.db.patch(u._id,{jobId:a.jobId,startDate:shiftDate(end,-6),endDate:end,state:'active',dataDeletedAt:undefined,conversationEnabled:true,conversationConsent:undefined,conversationConsentAsked:undefined,conversationQuestionId:undefined,greetingSeenAt:undefined,safetyKind:undefined,safetyReturnAsked:undefined,trackedItems:[],clarificationChoices:undefined});return null;
}});
