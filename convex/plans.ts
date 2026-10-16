import {assertPilotWrite} from './pilotAccess';
import {saveReply} from './deliveryState';
import * as copy from './copy';
import {isStandaloneBodyUpdate} from './commandRoute';
export {planReply} from './copy';
import {planReply} from './copy';
import {v} from 'convex/values';
import {mutation,query,internalQuery,internalMutation} from './_generated/server';
import type {MutationCtx,QueryCtx} from './_generated/server';
import type {Doc,Id} from './_generated/dataModel';
import {userFor,memoryChanged} from './tracking';
import {meaningSchema,type Meaning} from './interpretation';
import {STOPPED_REPLY,dateLabel} from './replyCopy';
import {resolveWhen,inWindow,MAX_RECORDS} from './rules';
type Reader=MutationCtx|QueryCtx;
export async function planView(ctx:Reader,user:Doc<'users'>){
 const plan=await ctx.db.query('plans').withIndex('by_user_job',q=>q.eq('userId',user._id).eq('jobId',user.jobId)).unique();
 const records=await ctx.db.query('planCompletions').withIndex('by_user_job',q=>q.eq('userId',user._id).eq('jobId',user.jobId)).take(MAX_RECORDS);
 const pending=await ctx.db.query('planPending').withIndex('by_user_job',q=>q.eq('userId',user._id).eq('jobId',user.jobId)).take(20);
 const counted=records.filter(r=>r.status==='completed'&&inWindow(r.completionDate,user.startDate,user.endDate));
 return {version:(await ctx.db.get(user._id))?.memoryVersion??0,timezone:user.timezone,jobId:user.jobId,state:user.state??'active',plan,records,pending,count:counted.length,progress:plan?`${counted.length}/${plan.targetNumber}`:null,dates:counted.map(r=>r.completionDate),skipped:records.filter(r=>r.status==='skipped'&&inWindow(r.completionDate,user.startDate,user.endDate)).length,windowStart:user.startDate,windowEnd:user.endDate};
}
export const getPlan=query({args:{token:v.string()},returns:v.any(),handler:async(ctx,args)=>planView(ctx,await userFor(ctx,args.token))});
export const context=internalQuery({args:{token:v.string()},returns:v.any(),handler:async(ctx,args)=>{
 const view=await planView(ctx,await userFor(ctx,args.token));
 return {pending:view.pending.filter(p=>p.kind==='clarification').map(p=>({id:p._id,question:p.reason,proposal:p.proposal,rawText:p.rawText})),plan:view.plan?{activity:view.plan.activity,targetNumber:view.plan.targetNumber}:null,recentCompletions:view.records.slice(-5).map(r=>({id:r._id,date:r.completionDate,status:r.status,messageReceivedAt:r.messageReceivedAt}))};
}});

export async function applyPlanMeaning(ctx:MutationCtx,user:Doc<'users'>,text:string,p:Meaning,receivedAt:number,targetId?:Id<'planCompletions'>,confirmedDate=false,bypassDuplicate=false,validatedSource?:string){
 await assertPilotWrite(ctx,user,p.intent==='plan_correct'?targetId:undefined);
 const source=validatedSource??text;
 const view=await planView(ctx,user);
 const result=async(outcome:string,message:string,extra:Record<string,any>={})=>({outcome,message,...extra,planView:await planView(ctx,user)});
 if(user.safetyKind)return result('safety_paused',copy.safetyReturnQuestion);
 if(p.intent==='plan_summary')return result(view.plan?'plan_summary':'no_plan',planReply(view));
 if(user.state==='stopped'||user.dataDeletedAt)return result('stopped',STOPPED_REPLY);
 const pend=async(kind:'confirmation'|'date'|'duplicate'|'clarification',reason:string)=>{
  if(view.pending.length>=20)return result('plan_clarification',copy.plans_Resolve_an_existing_plan_question_before_adding);
  await memoryChanged(ctx,user._id);
  const pendingId=await ctx.db.insert('planPending',{userId:user._id,jobId:user.jobId,rawText:text,messageReceivedAt:receivedAt,memoryVersion:(user.memoryVersion??0)+1,reason,kind,proposal:p,...(targetId?{completionTargetId:targetId}:{})});
  return result(kind==='confirmation'?'plan_confirmation':kind==='duplicate'?'plan_duplicate':'plan_clarification',reason,{pendingId});
 };
 if(p.intent==='plan_proposal'){
  if(view.plan)return result('plan_exists',copy.plans_I_m_keeping_your_confirmed_plan_for);
  const words=['zero','one','two','three','four','five','six','seven','eight','nine','ten'];
  const numberPresent=p.targetNumber&&(new RegExp(`\\b${p.targetNumber}\\b`).test(source)||Boolean(words[p.targetNumber]&&new RegExp(`\\b${words[p.targetNumber]}\\b`,'i').test(source)));
  if(p.activity&&source.toLowerCase().includes(p.activity.toLowerCase())&&!p.targetNumber)return pend('clarification',copy.planNeedsTarget);
  if(!p.activity||!p.targetNumber||!source.toLowerCase().includes(p.activity.toLowerCase())||!numberPresent)return pend("clarification",copy.plans_What_s_the_plan_you_want_me);
  // A second draft replaces the earlier unconfirmed draft, never an active plan.
  for(const draft of view.pending)if(draft.kind==='confirmation')await ctx.db.delete(draft._id);
  return pend("confirmation",copy.planConfirmation({activity:p.activity,target:p.targetNumber}));
 }
 if(!view.plan)return result('no_plan',planReply(view));
 if(view.plan.state!=='active')return result('stopped',copy.plans_This_plan_is_closed_Send_Start_to);
 if(p.activity&&p.activity!==view.plan.activity)return pend('clarification',copy.plans_Does_this_update_refer_to_your_confirmed);
 if(!confirmedDate&&((p.datePhrase&&!text.toLowerCase().includes(p.datePhrase.toLowerCase()))||(p.timePhrase&&!text.toLowerCase().includes(p.timePhrase.toLowerCase()))))return pend('clarification',copy.plans_Which_day_did_this_happen_Nothing_was);
 if(p.intent==='plan_correct'){
  const target=targetId?view.records.find(r=>r._id===targetId):p.target==='latest'?view.records.at(-1):view.records.length===1?view.records[0]:null;
  if(!target)return pend('clarification',copy.plans_Which_completed_session_should_I_correct_I);
  targetId=target._id;
  if(!p.datePhrase&&!p.timePhrase&&!p.completionStatus)return pend('clarification',copy.plans_What_should_I_change_about_that_session);
  const when=p.datePhrase||p.timePhrase?resolveWhen(p,receivedAt,user.timezone):null;
  if(when?.question)return pend("date",when.question);
  await ctx.db.patch(target._id,{...(when?.date?{completionDate:when.date}:{}),...(p.completionStatus?{status:p.completionStatus}:{}),correctionText:text,correctedAt:Date.now()});
  await memoryChanged(ctx,user._id);
  return result('plan_corrected',copy.plans_Corrected({activity: view.plan.activity, date: dateLabel(when?.date??target.completionDate,user.timezone), skipped: (p.completionStatus??target.status)==='skipped', progress: (await planView(ctx,user)).progress}),{changedIds:[target._id]});
 }
 if(p.intent==='plan_complete'&&isStandaloneBodyUpdate(text,user.trackedItems))return pend('clarification',copy.plans_What_happened_with_your_plan_I_haven);
 if(p.trackedItem || p.count || p.targetNumber || p.completionStatus==='skipped')return pend('clarification',copy.plans_What_happened_with_your_plan_I_haven);
 if(p.intent!=='plan_complete')return pend('clarification',copy.plans_What_changed_about_your_plan_I_haven);
 const when=resolveWhen(p,receivedAt,user.timezone);
 if(when.question)return pend('date',when.question);
 const explicitlyNew=/\b(?:another|new)\s+(?:[a-z]+\s+){0,2}(?:session|workout|completion)\b|\bagain\b/i.test(text);
 if(view.records.some(r=>r.status==='completed'&&r.completionDate===when.date)&&!explicitlyNew&&!bypassDuplicate)return pend("duplicate",copy.plans_Is_that_the_same_session_you_told);
 if(view.records.length>=MAX_RECORDS)return result('plan_clarification',copy.plans_The_test_completion_record_limit_was_reached);
 const id=await ctx.db.insert('planCompletions',{userId:user._id,jobId:user.jobId,planId:view.plan._id,rawText:text,messageReceivedAt:receivedAt,completionDate:when.date!,status:'completed'});
 await memoryChanged(ctx,user._id);
 return result('plan_completed',copy.plans_Nice({activity: view.plan.activity, date: dateLabel(when.date!,user.timezone), progress: (await planView(ctx,user)).progress}),{changedIds:[id]});
}
export async function resolvePlan(ctx:MutationCtx,args:{token:string,pendingId:Id<'planPending'>,choice:'confirm'|'discard'|'same'|'new',datePhrase?:string,timePhrase?:string,meaning?:Meaning,answerText?:string,completionTargetId?:Id<'planCompletions'>},receivedTime?:number){
 const user=await userFor(ctx,args.token);const pending=await ctx.db.get(args.pendingId);
 if(args.choice!=='discard')await assertPilotWrite(ctx,user);
 if(!pending||pending.userId!==user._id)throw new Error(copy.plans_That_plan_question_is_not_available_to);
 const receivedAt=receivedTime??Date.now();
 const result=async(outcome:string,message:string)=>({outcome,message,messageReceivedAt:receivedAt,originalMessageReceivedAt:pending.messageReceivedAt,planView:await planView(ctx,user)});
 if(user.safetyKind&&args.choice!=='discard')return result('safety_paused',copy.safetyReturnQuestion);
 if(args.choice==='discard'){await ctx.db.delete(pending._id);await memoryChanged(ctx,user._id);return result('discarded',copy.plans_Okay_I_ve_discarded_that_draft_No);}
 if(user.state==='stopped'||user.dataDeletedAt||pending.jobId!==user.jobId)return result('stopped',copy.plans_This_plan_message_belongs_to_a_stopped);
 if(pending.memoryVersion!==(user.memoryVersion??0))return result('dropped',copy.plans_Your_record_changed_while_this_question_was);
 const p=meaningSchema.parse(args.meaning??pending.proposal);
 if(args.meaning){const source=(pending.rawText+' '+(args.answerText??'')).toLowerCase();if((p.datePhrase&&!source.includes(p.datePhrase.toLowerCase()))||(p.timePhrase&&!source.includes(p.timePhrase.toLowerCase())))return result('plan_clarification',copy.plans_Which_day_did_this_happen_I_haven);}
 if(pending.kind==='confirmation'){
  if(args.choice!=='confirm')return result('plan_clarification',copy.plans_Please_confirm_or_discard_the_proposed_plan);
  const view=await planView(ctx,user);
  if(view.plan)return result('plan_exists',copy.plans_This_job_already_has_one_confirmed_plan);
  if(!p.activity||!p.targetNumber||p.intent!=='plan_proposal')throw new Error(copy.plans_Invalid_plan_proposal);
  await ctx.db.insert('plans',{userId:user._id,jobId:user.jobId,activity:p.activity,targetNumber:p.targetNumber,rawText:pending.rawText,messageReceivedAt:pending.messageReceivedAt,confirmedAt:receivedAt,state:'active'});
  await ctx.db.delete(pending._id);await memoryChanged(ctx,user._id);return result('plan_confirmed',copy.plans_Got_it({activity: p.activity, targetNumber: p.targetNumber, targetNumber2: p.targetNumber}));
 }
 if(pending.kind==='duplicate'&&args.choice==='same'){await ctx.db.delete(pending._id);await memoryChanged(ctx,user._id);return result('reference',copy.plans_Got_it_the_same_session({value: planReply(await planView(ctx,user))}));}
 if(pending.kind==='date'&&(args.choice!=='confirm'||!args.datePhrase))return result('plan_clarification',copy.plans_Please_give_the_day_this_happened_Nothing);
 if(pending.kind==='duplicate'&&args.choice!=='new')return result('plan_clarification',copy.plans_Please_choose_the_same_session_or_a);
 if(args.datePhrase)p.datePhrase=args.datePhrase;
 if(args.timePhrase){p.timePhrase=args.timePhrase;p.precision=/^(around|about|approximately|~)/.test(args.timePhrase)?'approximate':'exact';}
 const applied=await applyPlanMeaning(ctx,user,p.intent==='plan_proposal'&&args.answerText?pending.rawText+'\n'+args.answerText:pending.rawText,p,pending.messageReceivedAt,args.completionTargetId??pending.completionTargetId,Boolean(args.datePhrase)||Boolean(args.meaning)||pending.kind==='duplicate',args.choice==='new');
 await ctx.db.delete(pending._id);
 return {...applied,messageReceivedAt:receivedAt,originalMessageReceivedAt:pending.messageReceivedAt,planView:await planView(ctx,user)};
}
export const resolve=mutation({args:{token:v.string(),pendingId:v.id('planPending'),choice:v.union(v.literal('confirm'),v.literal('discard'),v.literal('same'),v.literal('new')),datePhrase:v.optional(v.string())},returns:v.any(),handler:async(ctx,args)=>resolvePlan(ctx,args)});
// Typed answers resolve the same confirmation as the button in one transaction.
export const resolveTyped=internalMutation({args:{token:v.string(),messageId:v.string(),text:v.string()},returns:v.any(),handler:async(ctx,args)=>{
 const word=args.text.trim().toLowerCase();
 if(!['yes','ok','confirm','haan','no','cancel'].includes(word))return null;
 const user=await userFor(ctx,args.token);
 const receipt=await ctx.db.query('receipts').withIndex('by_user_message',q=>q.eq('userId',user._id).eq('messageId',args.messageId)).unique();
 if(!receipt||receipt.state!=='received')return null;
 const pending=await ctx.db.query('planPending').withIndex('by_user_job',q=>q.eq('userId',user._id).eq('jobId',user.jobId)).take(20);
 const draft=pending.find(p=>p.kind==='confirmation');
 if(!draft)return null;
 const result=await resolvePlan(ctx,{token:args.token,pendingId:draft._id,choice:word==='no'||word==='cancel'?'discard':'confirm'},receipt.messageReceivedAt??receipt._creationTime);
 await ctx.db.patch(receipt._id,{state:'complete'});
 const current=await userFor(ctx,args.token);await saveReply(ctx,current,args.messageId,{...result,version:current.memoryVersion??0});
 return result;
}});

// Deterministic missing-target requests share proposal validation and confirmation.
export const requestTarget=internalMutation({args:{token:v.string(),messageId:v.string(),text:v.string(),activity:v.string()},returns:v.any(),handler:async(ctx,args)=>{
 const user=await userFor(ctx,args.token);
 const receipt=await ctx.db.query('receipts').withIndex('by_user_message',q=>q.eq('userId',user._id).eq('messageId',args.messageId)).unique();
 if(!receipt||receipt.state!=='received')return {outcome:'provider_duplicate',message:copy.messages_I_already_received_this_message_I_haven};
 if(receipt.memoryVersion!==(user.memoryVersion??0)||receipt.userState!==(user.state??'active'))return {outcome:'dropped',message:copy.tracking_Your_record_or_tracking_state_changed_while};
 const meaning:Meaning={intent:'plan_proposal',activity:args.activity,targetNumber:null,trackedItem:null,count:null,datePhrase:null,timePhrase:null,precision:'date-only',target:null,explicitNew:false,completionStatus:null};
 const result=await applyPlanMeaning(ctx,user,args.text,meaning,receipt.messageReceivedAt??receipt._creationTime);
 await ctx.db.patch(receipt._id,{state:'complete'});
 return {...result,messageReceivedAt:receipt.messageReceivedAt??receipt._creationTime};
}});
