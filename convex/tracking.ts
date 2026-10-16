import {purgeConversationLog} from './conversationLog';
import {consumeAiQuota} from './usageLimits';
import {clearConversationContext} from './conversationContext';
import {assertPilotWrite,periodUser} from './pilotAccess';
import {saveReply} from './deliveryState';
import * as copy from './copy';
import {matchSafetyCategory,safetyCategories,safetyReturnAffirmative,type SafetyCategory} from './safety';
import { v } from 'convex/values';
import { mutation, query, internalQuery, internalMutation } from './_generated/server';
import type { MutationCtx, QueryCtx } from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';
import {parsePlanTarget,isStandaloneWorkoutUpdate} from './commandRoute';
import {naturalTracking,dateAnswer} from './naturalTracking';
import { meaningSchema, validateReportMeaning, type Meaning } from './interpretation';
import {acknowledgement,eventLabel,STOPPED_REPLY} from './replyCopy';
import {applyPlanMeaning,resolvePlan,planView} from './plans';
import { reportedTimePhrase, MAX_RECORDS, localDate, shiftDate, resolveDate, resolveWhen, summary, summaryText } from './rules';

type Reader = QueryCtx | MutationCtx;
export async function userFor(ctx: Reader, token: string) {
  const user = await ctx.db.query('users').withIndex('by_token', q => q.eq('token', token)).unique();
  if (!user) throw new Error(copy.tracking_This_test_session_is_not_authorised_Create);
  return periodUser(ctx,user);
}
// A non-content counter changes whenever this user's records or control state changes.
// No old record text is copied into a receipt.
export async function memoryChanged(ctx: MutationCtx, userId: Id<'users'>) {
  const user = await ctx.db.get(userId);
  if (!user) throw new Error(copy.tracking_This_test_session_is_not_authorised);
  await ctx.db.patch(userId, {memoryVersion: (user.memoryVersion ?? 0) + 1});
}
async function recordsFor(ctx: Reader, userId: Id<'users'>) {
  const user=await ctx.db.get(userId);
  const rows = user?.conversationEnabled
    ? await ctx.db.query('occurrences').withIndex('by_user_job',q=>q.eq('userId',userId).eq('jobId',user.jobId)).take(MAX_RECORDS+1)
    : await ctx.db.query('occurrences').withIndex('by_user', q => q.eq('userId', userId)).take(MAX_RECORDS + 1);
  if (rows.length > MAX_RECORDS) throw new Error(copy.tracking_Test_record_limit_reached);
  return rows;
}
async function viewFor(ctx: Reader, user: Doc<'users'>) {
  const records = await recordsFor(ctx, user._id);
  const pending = await ctx.db.query('pending').withIndex('by_user', q => q.eq('userId', user._id)).take(50);
  return {version:(await ctx.db.get(user._id))?.memoryVersion??0, user: { state: user.state ?? 'active', proactiveAllowed: (user.state ?? 'active') === 'active' && !user.dataDeletedAt && !user.safetyKind, label: user.label, jobId: user.jobId, timezone: user.timezone, trackedItems: user.trackedItems }, ...summary(records.filter(r => r.jobId === user.jobId), user.startDate, user.endDate), records, totalStored: records.length, pending };
}
export const createTestPair = mutation({ args: {}, returns: v.any(), handler: async ctx => {
  const pair: Record<string, string> = {};
  for (const label of ['A', 'B']) {
    const token = crypto.randomUUID() + crypto.randomUUID();
    await ctx.db.insert('users', { token, label, jobId: crypto.randomUUID(), timezone: 'Asia/Kolkata', startDate: shiftDate(localDate(Date.now(), 'Asia/Kolkata'), -6), endDate: localDate(Date.now(), 'Asia/Kolkata'), trackedItems: ['brain fog', 'poor sleep'] });
    pair[label] = token;
  }
  return pair;
}});
export const getSummary = query({ args: { token: v.string() }, returns: v.any(), handler: async (ctx, args) => viewFor(ctx, await userFor(ctx, args.token)) });
export const context = internalQuery({ args: { token: v.string() }, returns: v.any(), handler: async (ctx, args) => {
  const user = await userFor(ctx, args.token);
  return { userId: user._id, ...await viewFor(ctx, user) };
}});
// Save a server-owned timestamp before commands, quota checks or AI processing.
// Receipts contain no health text. Re-deliveries keep the first received time.
export const receive = internalMutation({ args: { token: v.string(), messageId: v.string(), cancelPending: v.optional(v.boolean()) }, returns: v.number(), handler: async (ctx, args) => {
  const user = await userFor(ctx, args.token);
  if (!args.messageId || args.messageId.length > 100) throw new Error(copy.tracking_Invalid_message_ID);
  const receipt = await ctx.db.query('receipts').withIndex('by_user_message', q => q.eq('userId', user._id).eq('messageId', args.messageId)).unique();
  if (receipt) return receipt.messageReceivedAt ?? receipt._creationTime;
  const transport=await ctx.db.query('whatsappRequests').withIndex('by_user_message',q=>q.eq('userId',user._id).eq('messageId',args.messageId)).unique();
  const qaNow=process.env.INTUNE_LAB_ENABLED==='1'&&/^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?$/.test(process.env.CONVEX_CLOUD_URL??'')&&user.token.startsWith('lab-qa-')&&Number.isFinite(user.testNow)?user.testNow!:Date.now();
  const messageReceivedAt = transport?.providerSentAt??transport?.receivedAt??qaNow;
  // Stop/Delete invalidate older work as soon as the command arrives, before its next action step.
  if (args.cancelPending) await memoryChanged(ctx, user._id);
  await ctx.db.insert('receipts', {userId: user._id, messageId: args.messageId, messageReceivedAt,jobId:user.jobId,...(user.pilotOnboardingResetKey?{resetKey:user.pilotOnboardingResetKey}:{}), memoryVersion: (user.memoryVersion ?? 0) + (args.cancelPending ? 1 : 0), userState: user.state ?? 'active', state: 'received'});
  return messageReceivedAt;
}});
export const completeCommand = internalMutation({ args: { token: v.string(), messageId: v.string() }, returns: v.null(), handler: async (ctx, args) => {
  const user = await userFor(ctx, args.token);
  const receipt = await ctx.db.query('receipts').withIndex('by_user_message', q => q.eq('userId', user._id).eq('messageId', args.messageId)).unique();
  if (receipt) await ctx.db.patch(receipt._id, {state: 'complete'});
  return null;
}});
// Reply metadata contains entry names only, never message or health text.
export const noteReply=internalMutation({args:{token:v.string(),messageId:v.string(),replyEntry:v.string()},returns:v.null(),handler:async(ctx,args)=>{
 const user=await userFor(ctx,args.token);
 const receipt=await ctx.db.query('receipts').withIndex('by_user_message',q=>q.eq('userId',user._id).eq('messageId',args.messageId)).unique();
 if(receipt)await ctx.db.patch(receipt._id,{replyEntry:args.replyEntry,repliedAt:Date.now()});
 return null;
}});
export const reserveDeterministic=internalMutation({args:{token:v.string(),messageId:v.string()},returns:v.boolean(),handler:async(ctx,a)=>{const u=await userFor(ctx,a.token);const r=await ctx.db.query('receipts').withIndex('by_user_message',q=>q.eq('userId',u._id).eq('messageId',a.messageId)).unique();if(!r||r.state!=='received'||r.memoryVersion!==(u.memoryVersion??0)||r.userState!==(u.state??'active'))return false;await ctx.db.patch(r._id,{state:'processing'});return true;}});
export const reserveFollowup=internalMutation({args:{token:v.string(),messageId:v.string(),allowSafety:v.optional(v.boolean())},returns:v.boolean(),handler:async(ctx,args)=>{const user=await userFor(ctx,args.token);const r=await ctx.db.query('receipts').withIndex('by_user_message',q=>q.eq('userId',user._id).eq('messageId',args.messageId)).unique();if(!r||r.state!=='processing'||r.memoryVersion!==(user.memoryVersion??0)||user.state==='stopped'||user.safetyKind&&!args.allowSafety||process.env.INTUNE_CONVERSATION_GATE!=='candidate')return false;await consumeAiQuota(ctx,user,false);return true;}});
export const reserve = internalMutation({ args: { token: v.string(), messageId: v.string() }, returns: v.any(), handler: async (ctx, args) => {
  const user = await userFor(ctx, args.token);
  if (!args.messageId || args.messageId.length > 100) throw new Error(copy.tracking_Invalid_message_ID_2);
  const receipt = await ctx.db.query('receipts').withIndex('by_user_message', q => q.eq('userId', user._id).eq('messageId', args.messageId)).unique();
  if (receipt && receipt.state !== 'received') return { proceed: false, state: receipt.state };
  await consumeAiQuota(ctx,user,true);
  if (receipt) await ctx.db.patch(receipt._id, {state: 'processing'});
  else await ctx.db.insert('receipts', { userId: user._id, messageId: args.messageId, messageReceivedAt: Date.now(), memoryVersion: user.memoryVersion ?? 0, userState: user.state ?? 'active', state: 'processing' });
  return { proceed: true, state: 'processing' };
}});
export const fail = internalMutation({ args: { token: v.string(), messageId: v.string() }, returns: v.null(), handler: async (ctx, args) => {
  const user = await userFor(ctx, args.token);
  const receipt = await ctx.db.query('receipts').withIndex('by_user_message', q => q.eq('userId', user._id).eq('messageId', args.messageId)).unique();
  if (receipt&&['processing','v4_claimed'].includes(receipt.state)) await ctx.db.patch(receipt._id, {state: 'failed',v4LeaseUntil:undefined});
  return null;
}});
export async function applyMeaning(ctx: MutationCtx, user: Doc<'users'>, text: string, p: Meaning, messageReceivedAt: number, targetId?: Id<'occurrences'>, bypassDuplicate = false, confirmedDate = false,validatedSource?:string) {
 await assertPilotWrite(ctx,user,p.intent==='correct'?targetId:undefined);
  if(user.safetyKind)return {outcome:'safety_paused',message:copy.safetyReturnQuestion,changedIds:[]};
  if (user.state === 'stopped' || user.dataDeletedAt) return {outcome:'stopped', message:STOPPED_REPLY, changedIds:[]};
  // Even an incorrect AI 'record' cannot turn an explicit denial into an occurrence.
  p=validateReportMeaning(validatedSource??text,p);
  if(p.intent==='record'&&isStandaloneWorkoutUpdate(text))p={...p,intent:'clarify',trackedItem:null,count:null};
  const records = await recordsFor(ctx, user._id);
  if(user.conversationEnabled&&targetId&&!records.some(r=>r._id===targetId)){
    const earlier=await ctx.db.get(targetId);
    if(earlier?.userId===user._id)records.push(...await ctx.db.query('occurrences').withIndex('by_user_job',q=>q.eq('userId',user._id).eq('jobId',earlier.jobId)).take(MAX_RECORDS));
  }
  // Model-extracted date/time phrases must actually occur in the original text.
  const raw = text.toLowerCase();
  if (!confirmedDate && ((p.datePhrase && !raw.includes(p.datePhrase.toLowerCase())) || (p.timePhrase && !raw.includes(p.timePhrase.toLowerCase())))) {
    p = {...p, intent: 'clarify', datePhrase: null, timePhrase: null};
  }
  let target = targetId ? records.find(r => r._id === targetId) : undefined;
  if (targetId && !target) throw new Error(copy.tracking_That_occurrence_is_not_available_to_this);
  const pending = async (reason: string, kind: 'clarification' | 'possible_duplicate' = 'clarification', relatedIds: Id<'occurrences'>[] = []) => {
    const open = await ctx.db.query('pending').withIndex('by_user', q => q.eq('userId', user._id)).take(50);
    if (open.length >= 50) throw new Error(copy.tracking_Resolve_an_existing_clarification_before_adding_more);
    const pendingId = await ctx.db.insert('pending', { jobId: user.jobId, userId: user._id, rawText: text, messageReceivedAt, reason, kind, proposal: p, relatedIds });
    return { outcome: kind, message: reason, pendingId, changedIds: [] };
  };
  if (p.intent === 'summary') return { outcome: 'summary', message: summaryText(summary(records.filter(r => r.jobId === user.jobId), user.startDate, user.endDate),user.timezone), changedIds: [] };
  if (p.intent === 'clarify') {
    if(p.trackedItem&&user.trackedItems.includes(p.trackedItem))return pending(copy.symptomDetailsQuestion({item:p.trackedItem}));
    const earlier=await ctx.db.query('pending').withIndex('by_user',q=>q.eq('userId',user._id)).take(50);
    for(const question of earlier)if(question.kind==='clarification'&&question.proposal?.intent==='clarify'&&!question.proposal.trackedItem&&!question.relatedIds.length)await ctx.db.delete(question._id);
    const last=await ctx.db.query('receipts').withIndex('by_user_reply_at',q=>q.eq('userId',user._id)).order('desc').first();
    return pending(last?.replyEntry==='tracking_What_would_you_like_me_to_remember'?copy.clarifyWithExample:copy.tracking_What_would_you_like_me_to_remember);
  }
  if (p.intent === 'reference') {
    if (!target && records.length === 1) target = records[0];
    if (!target) return pending(copy.tracking_Which_earlier_episode_do_you_mean_I, 'clarification', records.map(r => r._id));
    const links = await ctx.db.query('references').withIndex('by_user', q => q.eq('userId', user._id)).take(MAX_RECORDS);
    if (links.length >= MAX_RECORDS) throw new Error(copy.tracking_Test_record_limit_reached_2);
    await ctx.db.insert('references', {userId: user._id, jobId: user.jobId, occurrenceId: target._id});
    return { outcome: 'reference', message: copy.tracking_Got_it_the_same({value: eventLabel(target.trackedItem,target.occurrenceDate,target.occurrenceTime,target.timePrecision,1,user.timezone)}), changedIds: [target._id] };
  }
  if (p.intent === 'correct') {
    if (!target && records.length === 1) target = records[0];
    if (!target) return pending(copy.tracking_Which_earlier_episode_should_I_correct, 'clarification', records.map(r => r._id));
    const correctedWhen = p.datePhrase || p.timePhrase ? resolveWhen({...p,datePhrase:p.datePhrase??target.occurrenceDate}, messageReceivedAt, user.timezone) : null;
    if (correctedWhen?.question) return pending(correctedWhen.question, 'clarification', [target._id]);
    if (p.count !== null) {
      const group = records.filter(r => r.batchId === target!.batchId);
      if (p.count > group.length) return pending(copy.tracking_I_haven_t_added_any_episodes_from);
      // A reduced count erases extra occurrences rather than keeping health text in tombstones.
      const keep = [target, ...group.filter(r => r._id !== target!._id)].slice(0, p.count);
      for (const r of group) if (!keep.some(k => k._id === r._id)) await erase(ctx, user, r._id);
      for (const r of keep) await ctx.db.patch(r._id, {status: 'corrected', correctionText: text});
      if (!p.datePhrase && !p.timePhrase) return {outcome: 'corrected', message: copy.tracking_Corrected({trackedItem: target.trackedItem, count: p.count}), changedIds: keep.map(r => r._id)};
    }
    const resolved = resolveWhen({...p,datePhrase:p.datePhrase??target.occurrenceDate}, messageReceivedAt, user.timezone);
    const when = {...resolved,time:p.timePhrase?resolved.time:target.occurrenceTime};
    if (when.question) return pending(when.question, 'clarification', [target._id]);
    const correctionPrecision=when.time?(p.timePhrase?/^(around|about|approximately|~)/i.test(p.timePhrase)?'approximate':'exact':target.timePrecision):'date-only';
    await ctx.db.patch(target._id, {occurrenceDate: when.date!, occurrenceTime: when.time, reportedTimePhrase:reportedTimePhrase(p.datePhrase,p.timePhrase), timePrecision: correctionPrecision, status: 'corrected', correctionText: text});
    return {outcome: 'corrected', message: copy.tracking_Ah_yes({value: eventLabel(target.trackedItem,when.date!,when.time,correctionPrecision,1,user.timezone), outsideWindow: when.date!<user.startDate||when.date!>user.endDate})+(reportedTimePhrase(p.datePhrase,p.timePhrase)?` Kept the time as “${reportedTimePhrase(p.datePhrase,p.timePhrase)}”, without an exact clock time.`:''), changedIds: [target._id]};
  }
  if(!user.trackedItems.length)return pending(copy.chooseTrackedItemsReply);
  if (!p.trackedItem || !user.trackedItems.includes(p.trackedItem) || !p.count) return pending(copy.tracking_Which_of_your_chosen_changes_would_you({items: user.trackedItems}));
  const when = resolveWhen(p, messageReceivedAt, user.timezone);
  if (when.question) return pending(!p.datePhrase&&!p.timePhrase?copy.symptomDateQuestion({item:p.trackedItem}):when.question);
  const duplicates = records.filter(r => r.jobId === user.jobId && r.trackedItem === p.trackedItem && r.occurrenceDate === when.date && (r.occurrenceTime === when.time || !r.occurrenceTime || !when.time));
  if (duplicates.length && !p.explicitNew && !bypassDuplicate) return pending(copy.tracking_Is_that_the_same_episode_you_already, 'possible_duplicate', duplicates.map(r => r._id));
  if (records.length + p.count > MAX_RECORDS) throw new Error(copy.tracking_The_fictional_test_session_has_reached_its);
  const batchId = crypto.randomUUID();
  const ids = [];
  for (let i = 0; i < p.count; i++) ids.push(await ctx.db.insert('occurrences', { userId: user._id, jobId: user.jobId, trackedItem: p.trackedItem, rawText: text, occurrenceDate: when.date!, occurrenceTime: when.time, reportedTimePhrase:reportedTimePhrase(p.datePhrase,p.timePhrase), timePrecision: when.time ? p.precision : 'date-only', messageReceivedAt, source: 'user', status: 'active', confirmationState: 'confirmed', batchId }));
  return { outcome: 'stored', message: acknowledgement(p.trackedItem,when.date!,when.time,when.time?p.precision:'date-only',p.count,user.timezone), changedIds: ids };
}
export const apply = internalMutation({ args: { token: v.string(), messageId: v.string(), text: v.string(), meaning: v.any(), completionTargetId:v.optional(v.id('planCompletions')), targetId: v.optional(v.id('occurrences')) }, returns: v.any(), handler: async (ctx, args) => {
  const user = await userFor(ctx, args.token);
  const receipt = await ctx.db.query('receipts').withIndex('by_user_message', q => q.eq('userId', user._id).eq('messageId', args.messageId)).unique();
  if (!receipt) throw new Error(copy.tracking_Message_is_not_reserved_for_processing);
  // This re-read and every health write run in one Convex mutation. Concurrent
  // Stop/Delete/Forget/corrections force a retry, then this check rejects the old result.
  if (receipt.state !== 'processing' || receipt.memoryVersion !== (user.memoryVersion ?? 0) || receipt.userState !== (user.state ?? 'active')) {
    if (receipt.state === 'processing') await ctx.db.patch(receipt._id, {state: 'dropped'});
    return {outcome: 'dropped', message: copy.tracking_Your_record_or_tracking_state_changed_while, changedIds: [], view: await viewFor(ctx, user)};
  }
  if(user.safetyKind){await ctx.db.patch(receipt._id,{state:'dropped'});return {outcome:'safety_paused',message:copy.safetyReturnQuestion,changedIds:[]};}
  const meaning=validateReportMeaning(args.text,meaningSchema.parse(args.meaning));
  if(meaning.intent==='out_of_scope_medical'){
    await ctx.db.patch(receipt._id,{state:'complete'});
    return {outcome:'out_of_scope_medical',message:copy.medicalQuestionReply,changedIds:[],view:await viewFor(ctx,user)};
  }
  const freePlans=(await ctx.db.query('planPending').withIndex('by_user_job',q=>q.eq('userId',user._id).eq('jobId',user.jobId)).take(20)).filter(p=>p.kind==='clarification');
  const freeSymptoms=(await ctx.db.query('pending').withIndex('by_user',q=>q.eq('userId',user._id)).take(50)).filter(p=>(!p.jobId||p.jobId===user.jobId)&&(p.proposal?.intent==='clarify'||p.reason.includes('additional episode')));
  let answered:any=null;
  if(freePlans.length+freeSymptoms.length===1){
    if(freePlans.length&&meaning.intent===freePlans[0].proposal?.intent&&meaning.intent.startsWith('plan_')&&meaning.intent!=='plan_summary')answered=await resolvePlan(ctx,{token:args.token,pendingId:freePlans[0]._id,choice:'confirm',meaning,answerText:args.text,...(args.completionTargetId?{completionTargetId:args.completionTargetId}:{})},receipt.messageReceivedAt??receipt._creationTime);
    if(freeSymptoms.length&&['record','correct','reference'].includes(meaning.intent))answered=await resolveSymptom(ctx,{token:args.token,pendingId:freeSymptoms[0]._id,choice:'clarify',meaning,answerText:args.text,...(args.targetId?{targetId:args.targetId}:{})},receipt.messageReceivedAt??receipt._creationTime);
  }
  const result = answered??(meaning.intent.startsWith('plan_')
    ? await applyPlanMeaning(ctx,user,args.text,meaning,receipt.messageReceivedAt ?? receipt._creationTime,args.completionTargetId)
    : await applyMeaning(ctx, user, args.text, meaning, receipt.messageReceivedAt ?? receipt._creationTime, args.targetId));
  if (!answered&&(result.outcome === 'stored' || result.outcome === 'corrected')) await memoryChanged(ctx, user._id);
  const genericEntry=result.message===copy.tracking_What_would_you_like_me_to_remember?'tracking_What_would_you_like_me_to_remember':result.message===copy.clarifyWithExample?'clarifyWithExample':null;
  await ctx.db.patch(receipt._id, {state: 'complete',...(genericEntry?{replyEntry:genericEntry,repliedAt:Date.now()}:{})});
  const response={ ...result, version:(await ctx.db.get(user._id))?.memoryVersion??0, view: await viewFor(ctx, user) };await saveReply(ctx,user,args.messageId,response);return response;
}});
async function erase(ctx: MutationCtx, user: Doc<'users'>, id: Id<'occurrences'>) {
  const record = await ctx.db.get(id);
  if (!record || record.userId !== user._id) throw new Error(copy.tracking_That_occurrence_is_not_available_to_this_2);
  // Remove copied content in linked unresolved work as well as the occurrence itself.
  const pending = await ctx.db.query('pending').withIndex('by_user', q => q.eq('userId', user._id)).take(50);
  for (const p of pending) if (p.relatedIds.includes(id) || p.rawText === record.rawText || (p.proposal?.v===2&&(p.proposal.target===id||(p.proposal.ops??[]).some((op:any)=>op.target===id||op.q===record.rawText)))) await ctx.db.delete(p._id);
  const links = await ctx.db.query('references').withIndex('by_occurrence', q => q.eq('occurrenceId', id)).take(MAX_RECORDS);
  for (const link of links) await ctx.db.delete(link._id);
  for(const status of ['queued','sending'] as const){const replies=await ctx.db.query('whatsappReplies').withIndex('by_user_status',q=>q.eq('userId',user._id).eq('status',status)).take(100);for(const r of replies)if(!r.control)await ctx.db.patch(r._id,{status:'dropped',body:undefined});}
  await clearConversationContext(ctx,user);
  await ctx.db.delete(id);
  await memoryChanged(ctx, user._id);
  await ctx.db.insert('deletionMarkers', { jobId: user.jobId, deletedAt: Date.now() });
}
export const forget = mutation({ args: { token: v.string(), occurrenceId: v.id('occurrences') }, returns: v.any(), handler: async (ctx, args) => {
  const user = await userFor(ctx, args.token);
  await erase(ctx, user, args.occurrenceId);
  await purgeConversationLog(ctx,user);
  return { outcome: 'forgotten', message: copy.tracking_Forgotten_that_episode_and_its_linked_notes, view: await viewFor(ctx, user) };
}});
export const resolvePending = mutation({ args: { token: v.string(), pendingId: v.id('pending'), choice: v.union(v.literal('same'), v.literal('new'), v.literal('clarify'), v.literal('discard')), datePhrase: v.optional(v.string()), trackedItem:v.optional(v.string()), targetId: v.optional(v.id('occurrences')) }, returns: v.any(), handler: async (ctx, args) => resolveSymptom(ctx,args) });
export async function resolveSymptom(ctx:MutationCtx,args:{token:string,pendingId:Id<'pending'>,choice:'same'|'new'|'clarify'|'discard',datePhrase?:string,timePhrase?:string,trackedItem?:string,count?:number,meaning?:Meaning,answerText?:string,targetId?:Id<'occurrences'>},receivedAt=Date.now()) {
  const user = await userFor(ctx, args.token);
  if(args.choice!=='discard'&&args.choice!=='same')await assertPilotWrite(ctx,user);
  const messageReceivedAt = receivedAt;
  const p = await ctx.db.get(args.pendingId);
  if (!p || p.userId !== user._id) throw new Error(copy.tracking_That_clarification_is_not_available_to_this);
  if (args.choice !== 'discard' && (user.state === 'stopped' || user.dataDeletedAt || (p.jobId && p.jobId !== user.jobId))) return {outcome:'stopped', message:copy.tracking_That_update_belongs_to_a_stopped_job, messageReceivedAt, originalMessageReceivedAt:p.messageReceivedAt, view:await viewFor(ctx,user)};
  if(user.safetyKind&&args.choice!=='discard')return {outcome:'safety_paused',message:copy.safetyReturnQuestion};
  await ctx.db.insert('receipts', {userId: user._id, messageId: crypto.randomUUID(), messageReceivedAt, state: 'complete'});
  let result: any;
  if (args.choice === 'discard') result = {outcome:'discarded', message:copy.tracking_That_unresolved_message_is_removed_Nothing_was};
  else if (args.choice === 'same') {
    if (p.kind !== 'possible_duplicate') throw new Error(copy.tracking_This_is_not_a_duplicate_clarification_2);
    result = {outcome:'reference', message:copy.tracking_Got_it_the_same_episode_I_haven};
  } else {
    if (args.choice === 'new' && p.kind !== 'possible_duplicate') throw new Error(copy.tracking_This_is_not_a_duplicate_clarification);
    const proposal = validateReportMeaning(p.rawText+' '+(args.answerText??''),meaningSchema.parse(args.meaning??p.proposal));
    if(args.meaning){const source=(p.rawText+' '+(args.answerText??'')).toLowerCase();if((proposal.datePhrase&&!source.includes(proposal.datePhrase.toLowerCase()))||(proposal.timePhrase&&!source.includes(proposal.timePhrase.toLowerCase())))return {outcome:'clarification',message:p.reason,view:await viewFor(ctx,user)};}
    if(args.trackedItem){if(!user.trackedItems.includes(args.trackedItem))throw new Error(copy.tracking_That_change_is_not_tracked_by_this);proposal.trackedItem=args.trackedItem;}
    if(args.count!==undefined)proposal.count=args.count;
    meaningSchema.parse(proposal);
    if (args.datePhrase) proposal.datePhrase = args.datePhrase;
    if (args.timePhrase) {proposal.timePhrase=args.timePhrase;proposal.precision=/^(around|about|approximately|~)/.test(args.timePhrase)?'approximate':'exact';}
    result = await applyMeaning(ctx, user, p.rawText, proposal, p.messageReceivedAt, args.targetId, args.choice === 'new', Boolean(args.datePhrase)||Boolean(args.meaning));
  }
  if (result.outcome === 'stored' || result.outcome === 'corrected') await memoryChanged(ctx, user._id);
  await ctx.db.delete(p._id);
  return {...result, messageReceivedAt, originalMessageReceivedAt: p.messageReceivedAt, view: await viewFor(ctx, user)};
}

// Typed date answers share the button resolvers and one receipt transaction.
export const resolveTypedDate=internalMutation({args:{token:v.string(),messageId:v.string(),text:v.string()},returns:v.any(),handler:async(ctx,args)=>{
 const user=await userFor(ctx,args.token);
 if(user.safetyKind)return {outcome:'safety_paused',message:copy.safetyReturnQuestion};
 const receipt=await ctx.db.query('receipts').withIndex('by_user_message',q=>q.eq('userId',user._id).eq('messageId',args.messageId)).unique();
 if(!receipt||receipt.state!=='received')return null;
 let plans=(await ctx.db.query('planPending').withIndex('by_user_job',q=>q.eq('userId',user._id).eq('jobId',user.jobId)).take(20)).filter(p=>p.kind==='date');
 let symptoms=(await ctx.db.query('pending').withIndex('by_user',q=>q.eq('userId',user._id)).take(50)).filter(p=>p.kind==='clarification'&&(!p.jobId||p.jobId===user.jobId)&&['record','correct'].includes(p.proposal?.intent));
 let allPlans=await ctx.db.query('planPending').withIndex('by_user_job',q=>q.eq('userId',user._id).eq('jobId',user.jobId)).take(20);
 let allSymptoms=(await ctx.db.query('pending').withIndex('by_user',q=>q.eq('userId',user._id)).take(50)).filter(p=>!p.jobId||p.jobId===user.jobId);

 let answerHash='';
 const finish=async(result:any)=>{await saveReply(ctx,user,args.messageId,{...result,version:(await ctx.db.get(user._id))?.memoryVersion??0});await ctx.db.patch(receipt._id,{state:'complete',...(result.outcome==='plan_completed'&&result.changedIds?.[0]?{answerHash,completionId:result.changedIds[0],jobId:user.jobId}:{})});return result;};
 let word=args.text.trim().toLowerCase().replace(/^(?:actually[, ]+)+|[, ]+actually[.!]?$/g,'').replace(/[.!]$/,'').trim();
 const friendlyDate=dateAnswer(word);if(friendlyDate)word=friendlyDate;
 if(friendlyDate&&!plans.length&&!symptoms.length){
  const last=await ctx.db.query('receipts').withIndex('by_user_reply_at',q=>q.eq('userId',user._id)).order('desc').first();
  const records=await recordsFor(ctx,user._id);const latest=records.at(-1);
  if(latest&&['acknowledgement','tracking_Got_it_the_same_episode_I_haven'].includes(last?.replyEntry??'')&&resolveDate(friendlyDate,latest.messageReceivedAt,user.timezone)===latest.occurrenceDate)return finish({outcome:'reference',message:copy.tracking_Got_it_the_same_episode_I_haven,changedIds:[],view:await viewFor(ctx,user)});
 }
 const numbered=word.match(/^([1-9]\d*)[: ]+(.+)$/);
 if(numbered&&user.clarificationChoices){
  const selected=user.clarificationChoices[Number(numbered[1])-1];
  if(selected){word=numbered[2];plans=plans.filter(p=>selected.kind==='plan'&&p._id===selected.id);symptoms=symptoms.filter(p=>selected.kind==='symptom'&&p._id===selected.id);allPlans=allPlans.filter(p=>selected.kind==='plan'&&p._id===selected.id);allSymptoms=allSymptoms.filter(p=>selected.kind==='symptom'&&p._id===selected.id);if(!allPlans.length&&!allSymptoms.length)return null;}
 }
 const selectedQuestion=word.match(/^question ([a-z0-9]+)[: ]+(.+)$/);
 if(selectedQuestion){const id=selectedQuestion[1];word=selectedQuestion[2];plans=plans.filter(p=>p._id===id);symptoms=symptoms.filter(p=>p._id===id);allPlans=allPlans.filter(p=>p._id===id);allSymptoms=allSymptoms.filter(p=>p._id===id);if(!allPlans.length&&!allSymptoms.length)return null;}
 answerHash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(word)))).map(b=>b.toString(16).padStart(2,'0')).join('');
 const same=['same','same episode','same session','the same one','same one'].includes(word);
 const another=['another','another one','new','new one','a new one','another session','new session','new episode'].includes(word);
 const yes=['yes','ok','confirm','haan'].includes(word),no=['no','cancel'].includes(word);
 const discard=['discard','discard it'].includes(word);
 const item=user.trackedItems.find(i=>i.toLowerCase()===word);
 const candidates:any[]=[];
 for(const p of allPlans){
  if(p.kind==='confirmation'&&(yes||no))candidates.push({plan:p,choice:no?'discard':'confirm'});
  if(p.kind==='duplicate'&&(same||another))candidates.push({plan:p,choice:same?'same':'new'});
  if(discard)candidates.push({plan:p,choice:'discard'});
  if(p.kind==='clarification'){
   const target=parsePlanTarget(args.text);
   if(p.reason===copy.planNeedsTarget&&p.proposal?.intent==='plan_proposal'&&target)candidates.push({plan:p,choice:'confirm',meaning:{...p.proposal,targetNumber:target},answerText:args.text});
   const view=await planView(ctx,user);
   if((p.reason.startsWith('Does this update refer')||p.reason===copy.plans_Does_this_update_refer_to_your_confirmed)&&(yes||no))candidates.push({plan:p,choice:no?'discard':'confirm',meaning:{...p.proposal,activity:view.plan?.activity??null},answerText:args.text});
   if(p.reason.startsWith('Which completed session')){
    const matching=view.records.filter(r=>r._id===word||r._id.endsWith(word)||r.completionDate===resolveDate(word,p.messageReceivedAt,user.timezone)||(['latest','last one','last session','the latest one'].includes(word)&&r._id===view.records.at(-1)?._id));
    if(matching.length===1)candidates.push({plan:p,choice:'confirm',completionTargetId:matching[0]._id});
    else if(matching.length>1)return finish({outcome:'plan_clarification',message:copy.tracking_Which_completed_session_do_you_mean_Please});
   }
  }
 }
 for(const p of allSymptoms){
  if(p.proposal?.intent==='tracking_setup'&&(yes||no))candidates.push({symptom:p,choice:no?'discard':'setup_confirm'});
  if(p.kind==='possible_duplicate'&&(same||another))candidates.push({symptom:p,choice:same?'same':'new'});
  if(discard)candidates.push({symptom:p,choice:'discard'});
  const amount=word==='once'?1:word==='twice'?2:/^(?:[1-9]|10)(?: times?)?$/.test(word)?parseInt(word):null;
  if(p.kind==='clarification'&&p.proposal?.intent==='record'&&p.proposal.trackedItem&&!p.proposal.count&&amount)candidates.push({symptom:p,choice:'clarify',count:amount});
  if(p.kind==='clarification'&&item&&p.proposal?.intent==='record'&&(!p.proposal.trackedItem||!user.trackedItems.includes(p.proposal.trackedItem)))candidates.push({symptom:p,choice:'clarify',trackedItem:item});
  if(p.kind==='clarification'&&['reference','correct'].includes(p.proposal?.intent)&&p.relatedIds.length){
   const records=await recordsFor(ctx,user._id);
   const eligible=records.filter(r=>p.relatedIds.includes(r._id));
   const selected=eligible.filter(r=>r._id===word||r._id.endsWith(word)||r.occurrenceDate===resolveDate(word,p.messageReceivedAt,user.timezone)||(item&&r.trackedItem===item)||((word==='latest'||word==='the latest one'||word==='last one')&&r._id===eligible.at(-1)?._id));
   if(selected.length===1)candidates.push({symptom:p,choice:'clarify',targetId:selected[0]._id});
   else if(selected.length>1)return finish({outcome:'clarification',message:copy.tracking_Which_earlier_episode_do_you_mean_Please});
  }
 }
 const askChoice=async(options:{kind:'plan'|'symptom';pending:any}[])=>{
  await ctx.db.patch(user._id,{clarificationChoices:options.map(o=>({kind:o.kind,id:o.pending._id}))});
  return finish({outcome:'clarification',message:copy.clarificationChoiceReply({choices:options.map(o=>o.pending.rawText.slice(0,120))})});
 };
 if(candidates.length>1)return askChoice(candidates.map(c=>({kind:c.plan?'plan':'symptom',pending:c.plan??c.symptom})));

 if(candidates.length===1){
  const c=candidates[0];
  if(c.choice==='setup_confirm'){await saveChoices(ctx,user,c.symptom.proposal.items);const selected=await ctx.db.get(user._id);if(!selected)throw new Error('User unavailable');const result=c.symptom.proposal.updates.length?await applyNaturalUpdates(ctx,selected,c.symptom.rawText,c.symptom.proposal.updates,c.symptom.messageReceivedAt):{outcome:'tracking_setup',message:copy.trackedItemsSavedReply({items:selected.trackedItems}),changedIds:[]};await ctx.db.delete(c.symptom._id);return finish(result);}
  const result=c.plan?await resolvePlan(ctx,{token:args.token,pendingId:c.plan._id,choice:c.choice,...(c.meaning?{meaning:c.meaning,answerText:c.answerText}:{}),...(c.completionTargetId?{completionTargetId:c.completionTargetId}:{})},receipt.messageReceivedAt??receipt._creationTime):await resolveSymptom(ctx,{token:args.token,pendingId:c.symptom._id,choice:c.choice,...(c.trackedItem?{trackedItem:c.trackedItem}:{}),...(c.count?{count:c.count}:{}),...(c.targetId?{targetId:c.targetId}:{})},receipt.messageReceivedAt??receipt._creationTime);
  return finish(result);
 }
 if(yes&&!candidates.length){const previous=await ctx.db.query('receipts').withIndex('by_user_reply_at',q=>q.eq('userId',user._id)).order('desc').first();if(previous?.replyEntry==='trackerLimitReply')return finish({outcome:'tracking_limit',message:copy.trackerLimitReply({items:user.trackedItems})});}
 if(!plans.length&&!symptoms.length){
  // A second delivery ID for the same recent clarification answer asks
  // about duplication. It never creates a completion without confirmation.
  if(allPlans.length||allSymptoms.length)return null;
  const recent=await ctx.db.query('receipts').withIndex('by_user_state',q=>q.eq('userId',user._id).eq('state','complete')).order('desc').take(1);
  const prior=recent[0];
  if(prior?.answerHash!==answerHash||!prior.completionId||prior.jobId!==user.jobId||localDate(receipt.messageReceivedAt??receipt._creationTime,user.timezone)!==localDate(prior.messageReceivedAt??prior._creationTime,user.timezone))return null;
  const completion=await ctx.db.get(prior.completionId);
  if(!completion||completion.userId!==user._id||completion.jobId!==user.jobId||completion.status!=='completed')return null;
  const view=await planView(ctx,user);if(!view.plan)return null;
  const proposal:Meaning={intent:'plan_complete',trackedItem:null,count:null,datePhrase:completion.completionDate,timePhrase:null,precision:'date-only',target:null,explicitNew:false,activity:view.plan.activity,targetNumber:null,completionStatus:null};
  return finish(await applyPlanMeaning(ctx,user,args.text,proposal,completion.messageReceivedAt,undefined,true));
 }

 const timeMatch=word.match(/^(?:(today|yesterday)\s+)?((?:around |about |at |approximately |~)?\d{1,2}(?::\d{2})?\s*(?:am|pm))$/);
 const timePhrase=timeMatch?.[2];
 const dateWord=['this morning','today morning','right now','last night'].includes(word)?'today':word;
 if(!timePhrase&&!/^(today|yesterday|\d{1,3} days? ago|\d{4}-\d{2}-\d{2})$/.test(dateWord))return null;
 if(plans.length+symptoms.length!==1)return askChoice([...plans.map(p=>({kind:'plan' as const,pending:p})),...symptoms.map(p=>({kind:'symptom' as const,pending:p}))]);
 const pending=plans[0]??symptoms[0];
 const when=timePhrase?resolveWhen({datePhrase:timeMatch?.[1]??pending.proposal.datePhrase,timePhrase},pending.messageReceivedAt,user.timezone):null;
 const datePhrase=timePhrase?when?.date??'':['this morning','today morning','right now','last night'].includes(word)?'today':word;
 const accepted=/^(today|yesterday|\d{1,3} days? ago|\d{4}-\d{2}-\d{2})$/.test(datePhrase);
 if(!accepted)return null;
 // Use the shared calendar rules before resolving. An unusable answer must
 // leave the existing pending question intact, rather than replace it.
 const checked=resolveWhen({datePhrase,timePhrase:timePhrase??pending.proposal.timePhrase},pending.messageReceivedAt,user.timezone);
 if(checked.question)return null;
 const result=plans.length
  ? await resolvePlan(ctx,{token:args.token,pendingId:plans[0]._id,choice:'confirm',datePhrase,...(timePhrase?{timePhrase}:{})},receipt.messageReceivedAt??receipt._creationTime)
  : await resolveSymptom(ctx,{token:args.token,pendingId:symptoms[0]._id,choice:'clarify',datePhrase,...(timePhrase?{timePhrase}:{})},receipt.messageReceivedAt??receipt._creationTime);
 if(!plans.length&&result.outcome==='stored')result.message+=copy.clarifiedSymptomCount({count:result.view.sevenDayCount});
 return finish(result);
}});

export const greet = internalMutation({args:{token:v.string(),messageId:v.string()},returns:v.any(),handler:async(ctx,args)=>{
 const user=await userFor(ctx,args.token);
 const receipt=await ctx.db.query('receipts').withIndex('by_user_message',q=>q.eq('userId',user._id).eq('messageId',args.messageId)).unique();
 if(receipt?.state==='complete')return {outcome:'provider_duplicate',message:receipt.replyEntry==='greetingReply'?copy.greetingReply:copy.returningGreetingReply};
 const prior=await ctx.db.query('receipts').withIndex('by_user_reply_entry',q=>q.eq('userId',user._id).eq('replyEntry','greetingReply')).first();
 const returning=user.greetingSeenAt!==undefined||!!prior;
 if(!returning)await ctx.db.patch(user._id,{greetingSeenAt:Date.now()});
 if(receipt)await ctx.db.patch(receipt._id,{state:'complete'});
 return {outcome:'greeting',message:returning?copy.returningGreetingReply:copy.greetingReply};
}});

export const safetyGuard=internalMutation({args:{token:v.string(),messageId:v.string(),text:v.string(),neutral:v.optional(v.boolean()),category:v.optional(v.string())},returns:v.any(),handler:async(ctx,args)=>{
 const user=await userFor(ctx,args.token);
 const receipt=await ctx.db.query('receipts').withIndex('by_user_message',q=>q.eq('userId',user._id).eq('messageId',args.messageId)).unique();
 if(!receipt)return null;
 if(receipt.state==='complete'&&['medicalSafetyReply','mentalSafetyReply','safetyReturnQuestion','safety_resumed'].includes(receipt.replyEntry??''))return {outcome:'provider_duplicate',message:copy.messages_I_already_received_this_message_I_haven};
 if(args.category&&!safetyCategories.includes(args.category as SafetyCategory))throw new Error('Invalid interpretation category');
 const category=matchSafetyCategory(args.text)??(args.category&&args.category!=='mental'&&args.category!=='bleeding'?args.category:undefined);
 const setState=async(kind:'medical'|'mental'|undefined,asked:boolean)=>{
  await clearConversationContext(ctx,user);
  const version=user.memoryVersion??0;
  await memoryChanged(ctx,user._id);
  // Safety-only changes must invalidate in-flight AI while preserving valid saved questions.
  const pending=await ctx.db.query('planPending').withIndex('by_user_job',q=>q.eq('userId',user._id).eq('jobId',user.jobId)).take(20);
  for(const p of pending)if(p.memoryVersion===version)await ctx.db.patch(p._id,{memoryVersion:version+1});
  await ctx.db.patch(user._id,{safetyKind:kind,safetyReturnAsked:asked});
 };
 const finish=async(outcome:string,message:string,replyEntry:string)=>{await ctx.db.patch(receipt._id,{state:'complete',replyEntry,repliedAt:Date.now()});const result={outcome,message,version:(await ctx.db.get(user._id))?.memoryVersion??0};await saveReply(ctx,user,args.messageId,result);return result;};
 if(category){
  for(const status of ['queued','sending'] as const){const replies=await ctx.db.query('whatsappReplies').withIndex('by_user_status',q=>q.eq('userId',user._id).eq('status',status)).take(100);for(const r of replies)if(!r.control)await ctx.db.patch(r._id,{status:'dropped',body:undefined});}
  const kind=category==='mental'?'mental':'medical';await setState(kind,false);
  while(true){const queued=await ctx.db.query('proactiveOutputs').withIndex('by_user_status',q=>q.eq('userId',user._id).eq('status','queued')).take(100);if(!queued.length)break;for(const output of queued)await ctx.db.patch(output._id,{status:'dropped',body:undefined});}
  return finish('safety',kind==='mental'?copy.mentalSafetyReply:copy.medicalSafetyReply,kind==='mental'?'mentalSafetyReply':'medicalSafetyReply');
 }
 if(!user.safetyKind||args.neutral)return null;
 if(user.safetyReturnAsked&&safetyReturnAffirmative(args.text)){
  await setState(undefined,false);return finish('safety_resumed',copy.tracking_What_would_you_like_me_to_remember,'safety_resumed');
 }
 await ctx.db.patch(user._id,{safetyReturnAsked:true});return finish('safety_paused',copy.safetyReturnQuestion,'safetyReturnQuestion');
}});

export async function applyNaturalUpdates(ctx:MutationCtx,user:Doc<'users'>,text:string,updates:Meaning[],receivedAt:number){
 const results=[];
 for(const update of updates){
  if(!update.count){
   const reason=copy.symptomCountQuestion({item:update.trackedItem!});
   const id=await ctx.db.insert('pending',{jobId:user.jobId,userId:user._id,rawText:text,messageReceivedAt:receivedAt,reason,kind:'clarification',proposal:update,relatedIds:[]});
   results.push({outcome:'clarification',message:reason,changedIds:[],pendingId:id});
  }else results.push(await applyMeaning(ctx,user,text,update,receivedAt));
 }
 // Match the existing AI/resolver mechanism, in the same transaction as the writes.
 if(results.some(r=>r.changedIds.length||'pendingId' in r))await memoryChanged(ctx,user._id);
 return {outcome:results.length===1?results[0].outcome:'natural_updates',message:copy.naturalTrackingReplies({replies:results.map(r=>r.message)}),changedIds:results.flatMap(r=>r.changedIds),view:await viewFor(ctx,user)};
}
export const selectTrackedItems=internalMutation({args:{token:v.string(),messageId:v.string(),text:v.string()},returns:v.any(),handler:async(ctx,args)=>{
 const user=await userFor(ctx,args.token);if(user.safetyKind)return {outcome:'safety_paused',message:copy.safetyReturnQuestion};
 if(user.state==='stopped'||user.dataDeletedAt)return null;
 const parsed=naturalTracking(args.text);if(!parsed)return null;
 // Preserve the established single-item interpretation path for existing supported reports.
 if(!/\b(?:track|remember)\b/.test(args.text.toLowerCase())&&parsed.items.length===1&&user.trackedItems.includes(parsed.items[0])&& !['hot flashes','night sweats','cycle changes'].includes(parsed.items[0])&&!/\bright now\b|\bthis morning\b/.test(args.text.toLowerCase()))return null;
 const items=[...new Set([...user.trackedItems,...parsed.items])];
 if(!parsed.setup&&!parsed.updates.length)return null;
 const receipt=await ctx.db.query('receipts').withIndex('by_user_message',q=>q.eq('userId',user._id).eq('messageId',args.messageId)).unique();
 if(!receipt||receipt.state!=='received')return {outcome:'provider_duplicate',message:copy.messages_I_already_received_this_message_I_haven};
 if(receipt.memoryVersion!==(user.memoryVersion??0)||receipt.userState!==(user.state??'active')){await ctx.db.patch(receipt._id,{state:'dropped'});return {outcome:'dropped',message:copy.tracking_Your_record_or_tracking_state_changed_while};}
 let pendingChanged=false;
 const finish=async(result:any)=>{
  const current=await ctx.db.get(user._id);
  if(pendingChanged&&(current?.memoryVersion??0)===(user.memoryVersion??0))await memoryChanged(ctx,user._id);
  await ctx.db.patch(receipt._id,{state:'complete'});await saveReply(ctx,user,args.messageId,{...result,version:(await ctx.db.get(user._id))?.memoryVersion??0});return result;
 };
 if(items.length>2)return finish({outcome:'tracking_limit',message:user.trackedItems.length?copy.trackerLimitReply({items:user.trackedItems}):copy.chooseTrackedItemsReply});
 const questions=await ctx.db.query('pending').withIndex('by_user',q=>q.eq('userId',user._id)).take(50);
 for(const question of questions)if(question.proposal?.intent==='clarify'&&!question.proposal.trackedItem&&!question.relatedIds.length){await ctx.db.delete(question._id);pendingChanged=true;}
 const adding=parsed.items.some(i=>!user.trackedItems.includes(i));
 // Reports never silently become tracker choices. Preserve their details for confirmation.
 if(adding&&(!parsed.setup||parsed.updates.length)){
  const earlier=await ctx.db.query('pending').withIndex('by_user',q=>q.eq('userId',user._id)).take(50);
  if(earlier.length>=50)throw new Error(copy.tracking_Resolve_an_existing_clarification_before_adding_more);
  const reason=copy.setupUpdatesConfirmation({items,updates:parsed.updates});
  await ctx.db.insert('pending',{jobId:user.jobId,userId:user._id,rawText:args.text,messageReceivedAt:receipt.messageReceivedAt??receipt._creationTime,reason,kind:'clarification',proposal:{intent:'tracking_setup',items,updates:parsed.updates},relatedIds:[]});
  pendingChanged=true;
  // Save explicit choices only; the occurrence reports remain uncounted until yes.
  if(parsed.setup)await saveChoices(ctx,user,items);
  return finish({outcome:'clarification',message:reason,changedIds:[]});
 }
 if(parsed.setup&&adding)await saveChoices(ctx,user,items);
 const current=await ctx.db.get(user._id);if(!current)throw new Error('User unavailable');
 if(parsed.updates.length)return finish(await applyNaturalUpdates(ctx,current,args.text,parsed.updates,receipt.messageReceivedAt??receipt._creationTime));
 return finish({outcome:'tracking_setup',message:copy.trackedItemsSavedReply({items})});
}});
export async function saveChoices(ctx:MutationCtx,user:Doc<'users'>,items:string[]){
 await assertPilotWrite(ctx,user);
 const version=user.memoryVersion??0;await memoryChanged(ctx,user._id);await ctx.db.patch(user._id,{trackedItems:items});
 const pending=await ctx.db.query('planPending').withIndex('by_user_job',q=>q.eq('userId',user._id).eq('jobId',user.jobId)).take(20);
 for(const p of pending)if(p.memoryVersion===version)await ctx.db.patch(p._id,{memoryVersion:version+1});
}
