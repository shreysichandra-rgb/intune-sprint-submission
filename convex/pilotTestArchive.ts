import {v} from 'convex/values';
import {makeFunctionReference as ref} from 'convex/server';
import {internalMutation,internalQuery} from './_generated/server';
import type {MutationCtx} from './_generated/server';
import type {Id} from './_generated/dataModel';
import {accessFor} from './pilotAccess';
import {localDate} from './rules';
export const archivedTables=['occurrences','pending','references','proactiveOutputs','plans','planCompletions','planPending','cycleEvents','pilotItems','pilotItemEvents','pilotExperiences','pilotFeedback','pilotSummaryReviews','pilotReminders','pilotReminderDeliveries'] as const;
// Only the private allowlisted founder accounts. Stable active user ID keeps quotas,
// receipt deduplication and financial ownership intact; health IDs stay recoverable.
export const fresh=internalMutation({args:{phoneNumber:v.string(),resetKey:v.string()},returns:v.any(),handler:async(ctx,a)=>{
 const allowed=(process.env.INTUNE_TEST_RESET_PHONES??'').split(',').map(p=>p.trim());
 if(process.env.INTUNE_PILOT_MODE!=='v3'||!allowed.includes(a.phoneNumber)||!/^test-reset:[a-zA-Z0-9_-]{8,100}$/.test(a.resetKey))throw Error('This account is not enabled for fresh test resets');
 const u=await ctx.db.query('users').withIndex('by_phone',q=>q.eq('phoneNumber',a.phoneNumber)).unique();
 if(!u||u.dataDeletedAt||u.safetyKind||u.state==='stopped'||u.storageWithdrawn)throw Error('Fresh reset cannot bypass deletion, safety or withdrawn tracking controls');
 const prior=await ctx.db.query('pilotTestArchives').withIndex('by_user_reset',q=>q.eq('userId',u._id).eq('resetKey',a.resetKey)).unique();if(prior)return {reset:false,archiveId:prior._id,counts:prior.counts};
 const archives=await ctx.db.query('pilotTestArchives').withIndex('by_user',q=>q.eq('userId',u._id)).take(11);if(archives.length>=10)throw Error('Archive review required before another fresh reset');
 const batches: Array<{table:typeof archivedTables[number],rows:any[]}>=[];let total=0;const counts:Record<string,number>={};
 for(const table of archivedTables){const rows=await ctx.db.query(table).withIndex('by_user',q=>q.eq('userId',u._id)).take(101);if(rows.length>100)throw Error('Archive page limit: no reset applied');total+=rows.length;counts[table]=rows.length;batches.push({table,rows});}if(total>500)throw Error('Archive size requires operator review: no reset applied');
 const result=await ctx.runMutation(ref<'mutation',any,any>('pilotOperator:resetTestAccount'),a);
 const archiveUserId=await ctx.db.insert('users',{token:'archive:'+crypto.randomUUID()+crypto.randomUUID(),label:'Archived founder test memory',jobId:u.jobId,timezone:u.timezone,startDate:u.startDate,endDate:u.endDate,trackedItems:u.trackedItems,state:'stopped',conversationEnabled:false,conversationConsent:false,storageWithdrawn:true,...(u.preferredName?{preferredName:u.preferredName}:{}),...(u.v4Records?{v4Records:u.v4Records}:{}),...(u.v4Context?{v4Context:u.v4Context}:{})});
 for(const {table,rows} of batches)for(const row of rows)await ctx.db.patch(row._id,{userId:archiveUserId,...(table==='pilotReminders'?{state:'stopped'}:table==='proactiveOutputs'?{status:'dropped'}:{})});
 const archiveId=await ctx.db.insert('pilotTestArchives',{userId:u._id,archiveUserId,resetKey:a.resetKey,createdAt:Date.now(),priorEpoch:u.debugEpoch??0,counts});
 const today=localDate(Date.now(),'Asia/Kolkata');await ctx.db.patch(u._id,{jobId:crypto.randomUUID(),trackedItems:[],startDate:today,endDate:today,v4Context:undefined,v4Records:undefined,preferredName:undefined,pilotNameAsked:undefined,conversationConsent:undefined,conversationConsentAsked:undefined,pilotFreshConsentPending:true,conversationQuestionId:undefined,clarificationChoices:undefined,greetingSeenAt:undefined,debugEpoch:(u.debugEpoch??0)+1});
 return {...result,archiveId,counts};
}});
export const status=internalQuery({args:{phoneNumber:v.string()},returns:v.any(),handler:async(ctx,a)=>{
 const u=await ctx.db.query('users').withIndex('by_phone',q=>q.eq('phoneNumber',a.phoneNumber)).unique();if(!u)return null;const counts:Record<string,number>={};for(const table of archivedTables)counts[table]=(await ctx.db.query(table).withIndex('by_user',q=>q.eq('userId',u._id)).take(101)).length;const archives=await ctx.db.query('pilotTestArchives').withIndex('by_user',q=>q.eq('userId',u._id)).take(11);return {access:(await accessFor(ctx,u)).state,hasName:!!u.preferredName,hasContext:!!u.v4Context,hasMetadata:!!u.v4Records,epoch:u.debugEpoch??0,counts,archives:archives.map(x=>({id:x._id,counts:x.counts,createdAt:x.createdAt})),state:u.state??'active'};
}});
// Recovery is operator-only, never injected into the new conversation.
export const read=internalQuery({args:{phoneNumber:v.string(),archiveId:v.id('pilotTestArchives'),cursor:v.optional(v.union(v.string(),v.null()))},returns:v.any(),handler:async(ctx,a)=>{const u=await ctx.db.query('users').withIndex('by_phone',q=>q.eq('phoneNumber',a.phoneNumber)).unique(),archive=await ctx.db.get(a.archiveId);if(!u||!archive||archive.userId!==u._id||u.dataDeletedAt)throw Error('Owned archive unavailable');const records:Record<string,any[]>={};for(const table of archivedTables)records[table]=await ctx.db.query(table).withIndex('by_user',q=>q.eq('userId',archive.archiveUserId)).take(101);const log=await ctx.db.query('conversationLog').withIndex('by_user_epoch',q=>q.eq('userId',u._id).eq('epoch',archive.priorEpoch)).order('desc').paginate({numItems:50,cursor:a.cursor??null});const attachments=[];for(const row of log.page)attachments.push(...await ctx.db.query('conversationAttachments').withIndex('by_log',q=>q.eq('logId',row._id)).take(10));return {archive,profile:await ctx.db.get(archive.archiveUserId),records,log,attachments};}});
export async function purgeTestArchives(ctx:MutationCtx,userId:Id<'users'>){const archives=await ctx.db.query('pilotTestArchives').withIndex('by_user',q=>q.eq('userId',userId)).take(11);if(archives.length>10)throw Error('Archive deletion review required');for(const archive of archives){for(const table of archivedTables){const rows=await ctx.db.query(table).withIndex('by_user',q=>q.eq('userId',archive.archiveUserId)).take(101);if(rows.length>100)throw Error('Archive deletion page required');for(const row of rows)await ctx.db.delete(row._id);}await ctx.db.delete(archive.archiveUserId);await ctx.db.delete(archive._id);}}
