import {purgeTestArchives} from './pilotTestArchive';
import {purgeConversationLog} from './conversationLog';
import {clearConversationContext} from './conversationContext';
import {makeFunctionReference as ref} from 'convex/server';
import {accessFor,pilotEnabled,assertPilotWrite} from './pilotAccess';
import * as copy from './copy';
import {v} from 'convex/values';
import {internalMutation,internalQuery} from './_generated/server';
import type {MutationCtx} from './_generated/server';
import type {Doc} from './_generated/dataModel';
import {STOPPED_REPLY} from './replyCopy';
import {localDate,shiftDate} from './rules';
import {userFor,memoryChanged} from './tracking';
const controls=v.union(v.literal('pause'),v.literal('resume'),v.literal('stop'),v.literal('delete'),v.literal('start'));
async function dropQueued(ctx:MutationCtx,user:Doc<'users'>){
  for(const status of ['queued','sending'] as const){const replies=await ctx.db.query('whatsappReplies').withIndex('by_user_status',q=>q.eq('userId',user._id).eq('status',status)).take(100);for(const r of replies)if(!r.control)await ctx.db.patch(r._id,{status:'dropped',body:undefined});}
  while(true){
    const rows=await ctx.db.query('proactiveOutputs').withIndex('by_user_status',q=>q.eq('userId',user._id).eq('status','queued')).take(100);
    if(!rows.length) break;
    for(const row of rows) await ctx.db.patch(row._id,{status:'dropped',body:undefined});
  }
}
export const execute=internalMutation({args:{token:v.string(),command:controls,messageId:v.optional(v.string())},returns:v.any(),handler:async(ctx,args)=>{
  const user=await userFor(ctx,args.token);
  const state=user.state??'active';
  if(args.command==='start'){
    if(pilotEnabled()){if(user.dataDeletedAt)return {outcome:'stopped',message:copy.commands_Your_health_records_were_deleted_Starting_again,state:'stopped'};if(state==='stopped'){await memoryChanged(ctx,user._id);await ctx.db.patch(user._id,{state:'active'});}const access=await accessFor(ctx,user);if(state==='stopped'&&access.state==='eligible'&&access.id&&access.welcomeState==='pending')await ctx.scheduler.runAfter(0,ref<'action'>('pilotWelcome:send'),{id:access.id});return {outcome:'started',message:access.state==='active'?'Tracking reopened. Your records and paid pilot end time stay the same.':access.state==='eligible'?'Contact reopened. Your welcome is pending delivery.':"Contact reopened. Your saved records are still here. Send Join for the ₹99 pilot. No paid access was added.",state:'active'};}
    await assertPilotWrite(ctx,user);
    let startReceipt:Doc<'receipts'>|null=null;
    if(args.messageId){
      const receipt=await ctx.db.query('receipts').withIndex('by_user_message',q=>q.eq('userId',user._id).eq('messageId',args.messageId!)).unique();
      startReceipt=receipt;
      if(receipt?.state==='complete') return {outcome:'provider_duplicate',message:copy.commands_I_already_received_this_Start_message_I,state};
    }
    if(user.dataDeletedAt) return {outcome:'stopped',message:copy.commands_Your_health_records_were_deleted_Starting_again,state:'stopped'};
    if(state!=='stopped') return {outcome:state,message:copy.commands_This_job_is_already_open_I_m,state};
    // Anchor legacy unresolved messages to their closed job before renewing.
    const pending=await ctx.db.query('pending').withIndex('by_user',q=>q.eq('userId',user._id)).take(50);
    for(const row of pending) if(!row.jobId) await ctx.db.patch(row._id,{jobId:user.jobId});
    await memoryChanged(ctx,user._id);
    const endDate=localDate(Date.now(),user.timezone);
    await ctx.db.patch(user._id,{state:'active',conversationConsent:user.conversationEnabled?user.conversationConsent:undefined,conversationQuestionId:undefined,jobId:crypto.randomUUID(),startDate:shiftDate(endDate,-6),endDate});
    if(startReceipt) await ctx.db.patch(startReceipt._id,{state:'complete'});
    return {outcome:'started',message:pilotEnabled()?'I’ve resumed tracking. Your paid pilot end time stays the same.':copy.commands_Started_a_fresh_seven_day_job_for,state:'active'};
  }
  if(['pause','stop','delete'].includes(args.command))await clearConversationContext(ctx,user);
  if(args.command==='delete'){
    await purgeTestArchives(ctx,user._id);
    await purgeConversationLog(ctx,user);
    await memoryChanged(ctx,user._id);
    // Erase all persistent health copies, including summaries in queued/dropped outputs.
    for(const table of ['occurrences','pending','references','proactiveOutputs','plans','planCompletions','planPending','cycleEvents','whatsappReplies','whatsappRequests','verificationDeliveries','verificationBarriers','pilotItems','pilotItemEvents','pilotReminders','pilotReminderDeliveries','pilotFeedback','pilotSummaryReviews','conversationTurns','pilotExperiences'] as const){
      while(true){
        const rows=await ctx.db.query(table).withIndex('by_user',q=>q.eq('userId',user._id)).take(100);
        if(!rows.length) break;
        for(const row of rows) await ctx.db.delete(row._id);
      }
    }
    // Existing apply() already rejects receipts that are no longer processing.
    // This prevents an already-running interpretation from restoring deleted content.
    while(true){
      const receipts=await ctx.db.query('receipts').withIndex('by_user_state',q=>q.eq('userId',user._id).eq('state','processing')).take(100);
      if(!receipts.length) break;
      for(const receipt of receipts) await ctx.db.patch(receipt._id,{state:'cancelled'});
    }
    const deletedAt=user.dataDeletedAt??Date.now();
    await ctx.db.patch(user._id,{state:'stopped',v4Context:undefined,v4Records:undefined,preferredName:undefined,pilotNameAsked:undefined,conversationConsent:undefined,conversationConsentAsked:undefined,conversationQuestionId:undefined,trackedItems:[],clarificationChoices:undefined,dataDeletedAt:deletedAt});
    if(!user.dataDeletedAt) await ctx.db.insert('deletionMarkers',{jobId:user.jobId,deletedAt});
    return {outcome:'deleted',message:copy.commands_Your_health_records_have_been_deleted_Your,state:'stopped'};
  }
  if(args.command==='stop'){
    await memoryChanged(ctx,user._id);
    await dropQueued(ctx,user);
    const plan=await ctx.db.query('plans').withIndex('by_user_job',q=>q.eq('userId',user._id).eq('jobId',user.jobId)).unique();
    if(plan) await ctx.db.patch(plan._id,{state:'closed'});
    await ctx.db.patch(user._id,{state:'stopped'});
    return {outcome:'stopped',message:pilotEnabled()?'Tracking stopped. Your saved records remain. Send Start to reopen tracking. This does not restart your paid week or add paid access.':STOPPED_REPLY,state:'stopped'};
  }
  if(state==='stopped'||user.dataDeletedAt){
    await dropQueued(ctx,user);
    return {outcome:'stopped',message:STOPPED_REPLY,state:'stopped'};
  }
  if(args.command==='pause'){
    if(state!=='paused') await memoryChanged(ctx,user._id);
    await dropQueued(ctx,user);
    await ctx.db.patch(user._id,{state:'paused'});
    return {outcome:'paused',message:pilotEnabled()?'Reminders paused. Your saved plans and updates are still here.':copy.commands_Paused_I_ll_stay_quiet_including_messages,state:'paused'};
  }
  if(state!=='active') await memoryChanged(ctx,user._id);
  await ctx.db.patch(user._id,{state:'active'});
  return {outcome:'active',message:copy.commands_Resumed_Future_messages_you_ve_agreed_to,state:'active'};
}});
// No messaging provider or sender exists in this slice. Any future sender must
// use this final check; a paused/stopped/deleted user or dropped output fails it.
export const deliveryPermitted=internalQuery({args:{outputId:v.id('proactiveOutputs')},returns:v.boolean(),handler:async(ctx,args)=>{
  const output=await ctx.db.get(args.outputId);
  if(!output||output.status!=='queued') return false;
  const user=await ctx.db.get(output.userId);
  return !!user&&(!pilotEnabled()||(await accessFor(ctx,user)).state==='active')&&(user.state??'active')==='active'&&!user.dataDeletedAt&&!user.safetyKind&&output.jobId===user.jobId;
}});
