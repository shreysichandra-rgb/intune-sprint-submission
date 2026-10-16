import {v} from 'convex/values';
import {internalMutation} from './_generated/server';
import type {MutationCtx} from './_generated/server';
import type {Doc,Id} from './_generated/dataModel';
import {pilotEnabled,accessFor} from './pilotAccess';
import {userFor,memoryChanged} from './tracking';
import {shiftDate,localDate,resolveTime} from './rules';
import {reminderDue} from './pilotReminderRules';
import {applyReminder} from './pilotReminders';
import {saveReply} from './deliveryState';
const gapQuestion='How many days are there usually between the start of one period and the next?';
export function periodStart(event:Pick<Doc<'cycleEvents'>,'label'|'rawText'|'dateKind'>){return event.dateKind!=='observation'&&/\b(?:period|menstrual)\b/i.test(event.label)&&/\b(?:last period|period started|period began|start of (?:my |the )?period)\b/i.test(event.rawText)&&! /\b(?:ended|finished|stopped|not|maybe|might)\b/i.test(event.rawText);}
export function cycleSetupAnswer(text:string){const clean=text.trim().replace(/[.!]$/,'');if(/^(yes|yes please|no|no thanks)$/i.test(clean))return {choice:clean.toLowerCase().startsWith('no')?'no':'yes'};if(/^(?:it varies|varies|not sure|i don'?t know|irregular)$/i.test(clean))return {unknown:true};const gap=clean.match(/^(?:usually |every )?(\d{1,3})(?:\s*days?)?$/i);if(gap)return {gapDays:Number(gap[1])};const clock=clean.replace(/\./g,'').replace(/^at /i,'');const time=resolveTime(clock)??(/^([01]\d|2[0-3]):[0-5]\d$/.test(clock)?clock:null);return time?{time}:null;}
export async function offerCycleGap(ctx:MutationCtx,u:Doc<'users'>,events:Doc<'cycleEvents'>[]){
 if(!pilotEnabled()||!u.conversationConsent||u.state==='stopped'||u.state==='paused'||u.safetyKind||u.dataDeletedAt||(await accessFor(ctx,u)).state!=='active')return;
 const pending=await ctx.db.query('pending').withIndex('by_user',q=>q.eq('userId',u._id)).take(50);
 // Several reported starts need a reference clarification rather than choosing one.
 const starts=events.filter(periodStart);if(starts.length!==1||pending.length>=50)return;const event=starts[0];
 if(pending.some(p=>p.proposal?.target===event._id&&p.proposal?.mode?.startsWith('cycle_reminder_')))return;
 await ctx.db.insert('pending',{userId:u._id,jobId:u.jobId,rawText:event.rawText,messageReceivedAt:Date.now(),kind:'clarification',reason:gapQuestion,proposal:{v:2,mode:'cycle_reminder_gap',ops:[],target:event._id,startDate:event.occurrenceDate,eventText:event.rawText},relatedIds:[]});await memoryChanged(ctx,u._id);
}
export const answer=internalMutation({args:{token:v.string(),messageId:v.string(),text:v.string(),version:v.number()},returns:v.any(),handler:async(ctx,a)=>{
 let u=await userFor(ctx,a.token);const receipt=await ctx.db.query('receipts').withIndex('by_user_message',q=>q.eq('userId',u._id).eq('messageId',a.messageId)).unique();if(!receipt||receipt.state!=='processing'||receipt.memoryVersion!==(u.memoryVersion??0)||a.version!==(u.memoryVersion??0))return {outcome:'dropped',message:'Your record changed. Please answer the current question.'};
 const pending=await ctx.db.query('pending').withIndex('by_user',q=>q.eq('userId',u._id)).take(50);const p=pending.find(p=>p._id===u.conversationQuestionId&&p.proposal?.mode?.startsWith('cycle_reminder_'));if(!p)return {outcome:'dropped',message:'No cycle reminder question is pending.'};
 const event=await ctx.db.get(p.proposal.target as Id<'cycleEvents'>),access=await accessFor(ctx,u),response=cycleSetupAnswer(a.text);let message=p.reason;
 if(!event||event.userId!==u._id||event.occurrenceDate!==p.proposal.startDate||event.rawText!==p.proposal.eventText||!periodStart(event)){await ctx.db.delete(p._id);message='That period record changed. Please share the period start date you want me to use.';}
 else if(!u.conversationConsent||u.state==='stopped'||u.state==='paused'||u.safetyKind||u.dataDeletedAt||access.state!=='active'){await ctx.db.delete(p._id);message='I haven’t set up a reminder. Active paid access and open contact permission are needed.';}
 else if(response?.choice==='no'||response?.unknown){await ctx.db.delete(p._id);message=response.unknown?'I won’t guess a cycle gap. Your period record is saved. You can ask for a check-in on a date you choose.':'No cycle reminder will be added. Your period record stays available.';}
 else if(p.proposal.mode==='cycle_reminder_gap'&&response?.gapDays!==undefined){
  if(response.gapDays<1)message=gapQuestion;
  else{const date=shiftDate(event.occurrenceDate,response.gapDays);await ctx.db.patch(event._id,{reminderPreference:{gapDays:response.gapDays,checkInDate:date,scheduled:false}});
   if(date<localDate(Date.now(),u.timezone)){await ctx.db.delete(p._id);message=`Using your ${response.gapDays}-day gap, the check-in date was ${date}, which has passed. Nothing was scheduled. What date did your most recent period start? Please include the year.`;}
   else if(date>localDate(access.endsAt!,u.timezone)){await ctx.db.delete(p._id);message=`Using your ${response.gapDays}-day gap, the check-in date is ${date}. It falls after your paid pilot ends, so nothing was scheduled. Your period record and gap are saved.`;}
   else{message=`Using your ${response.gapDays}-day gap, the cycle-tracking check-in date is ${date}. Would you like one reminder on that date? This is a check-in, not a prediction of when your period will start.`;await ctx.db.patch(p._id,{reason:message,proposal:{...p.proposal,mode:'cycle_reminder_confirm',gapDays:response.gapDays,date,offer:message}});}
  }
 }
 else if(p.proposal.mode==='cycle_reminder_confirm'&&response?.choice==='yes'){message=`What time should I remind you on ${p.proposal.date} (${u.timezone})?`;await ctx.db.patch(p._id,{reason:message,proposal:{...p.proposal,mode:'cycle_reminder_time',permissionAnswer:a.text}});}
 else if(p.proposal.mode==='cycle_reminder_time'&&response?.time){
  const due=reminderDue(p.proposal.date,response.time,Date.now(),u.timezone);
  if(due.question)message=due.question;
  else{const permissionText='InTune asked: '+p.proposal.offer+'\nUser answered: '+p.proposal.permissionAnswer+'\nTime: '+a.text;const result=await applyReminder(ctx,u,{k:'reminder',q:permissionText,target:null,title:'Cycle-tracking check-in',d:p.proposal.date,t:response.time,repeat:'once',kind:'tracking'},Date.now(),true);const scheduled=!!result?.changedIds?.length;if(scheduled)for(const id of result!.changedIds!)await ctx.db.patch(id as Id<'pilotReminders'>,{cycleId:event._id,cycleStartDate:event.occurrenceDate});await ctx.db.patch(event._id,{reminderPreference:{gapDays:p.proposal.gapDays,checkInDate:p.proposal.date,permissionText,localTime:response.time,scheduled}});await ctx.db.delete(p._id);message=scheduled?result!.message:`Your check-in preference is saved. ${result?.message??'Nothing has been scheduled.'}`;}
 }
 await memoryChanged(ctx,u._id);u=(await ctx.db.get(u._id))!;const remaining=await ctx.db.query('pending').withIndex('by_user',q=>q.eq('userId',u._id)).take(50);const next=remaining.find(p=>p._id===u.conversationQuestionId)??remaining[0];await ctx.db.patch(u._id,{conversationQuestionId:next?._id});if(next&&next._id!==p._id)message+='\n\n'+next.reason;await ctx.db.patch(receipt._id,{state:'complete',replyEntry:'cycle_reminder_setup',repliedAt:Date.now()});const result={outcome:'conversation',message,version:u.memoryVersion??0};await saveReply(ctx,u,a.messageId,result);return result;
}});
