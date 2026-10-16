import {v} from 'convex/values';
import {internalMutation} from './_generated/server';
import type {MutationCtx} from './_generated/server';
import type {Doc,Id} from './_generated/dataModel';
import {pilotEnabled,accessFor} from './pilotAccess';
import {userFor,memoryChanged} from './tracking';
import {resolveTime,localDate,shiftDate} from './rules';
import {zonedInstant} from './pilotReminderRules';
import {applyReminder,reminderConfigured} from './pilotReminders';
import {saveReply} from './deliveryState';
const weekdays=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
export function scheduleDetails(text:string){
 if(/\b(?:not|never|don't|do not|won't|maybe|might|if)\b/i.test(text))return null;
 const days=weekdays.filter(day=>new RegExp('\\b'+day+'\\b','i').test(text));
 const clocks=[...text.matchAll(/\b(?:[1-9]|1[0-2])(?::[0-5]\d)?\s*(?:a\.?m\.?|p\.?m\.?)\b/gi)].map(m=>resolveTime(m[0].replace(/\./g,''))).filter(Boolean);
 const times=[...new Set(clocks)];return days.length&&times.length===1?{days,time:times[0]!}:null;
}
export function setupAnswer(text:string){const clean=text.trim().replace(/[.!]$/,'');if(/^(?:yes|yes please|no)$/i.test(clean))return {choice:clean.toLowerCase().startsWith('no')?'no':'yes'};if(/^half an hour(?: before| earlier)?$/i.test(clean))return {minutes:30};if(/^(?:an|one) hour(?: before| earlier)?$/i.test(clean))return {minutes:60};const m=clean.match(/^(\d{1,5})(?:\s*(?:minutes?|mins?))?(?:\s*(?:before|earlier))?$/i);return m?{minutes:Number(m[1])}:null;}
export async function offerScheduleReminders(ctx:MutationCtx,u:Doc<'users'>,items:Doc<'pilotItems'>[]){
 if(!pilotEnabled()||!u.conversationConsent||u.state==='stopped'||u.state==='paused'||u.safetyKind||u.dataDeletedAt||(await accessFor(ctx,u)).state!=='active')return;
 const pending=await ctx.db.query('pending').withIndex('by_user',q=>q.eq('userId',u._id)).take(50);
 for(const item of items){if(!['plan','schedule','appointment','task'].includes(item.kind)||!scheduleDetails(item.text)||pending.length>=50||pending.some(p=>p.proposal?.target===item._id&&p.proposal?.mode?.startsWith('reminder_')))continue;
  const reason=`Your saved schedule: ${item.text}. Would you like reminders before each of these sessions during your pilot?`;
  const id=await ctx.db.insert('pending',{userId:u._id,jobId:u.jobId,rawText:item.text,messageReceivedAt:Date.now(),kind:'clarification',reason,proposal:{v:2,mode:'reminder_offer',ops:[],target:item._id,itemText:item.text,offer:reason},relatedIds:[]});pending.push((await ctx.db.get(id))!);await memoryChanged(ctx,u._id);
 }
}
export const answer=internalMutation({args:{token:v.string(),messageId:v.string(),text:v.string(),version:v.number()},returns:v.any(),handler:async(ctx,a)=>{
 let u=await userFor(ctx,a.token);const receipt=await ctx.db.query('receipts').withIndex('by_user_message',q=>q.eq('userId',u._id).eq('messageId',a.messageId)).unique();
 if(!receipt||receipt.state!=='processing'||receipt.memoryVersion!==(u.memoryVersion??0)||a.version!==(u.memoryVersion??0))return {outcome:'dropped',message:'Your record changed. Please answer the current question.'};
 const pending=await ctx.db.query('pending').withIndex('by_user',q=>q.eq('userId',u._id)).take(50);const p=pending.find(p=>p._id===u.conversationQuestionId&&['reminder_offer','reminder_lead'].includes(p.proposal?.mode));if(!p)return {outcome:'dropped',message:'No reminder setup question is pending.'};
 const item=await ctx.db.get(p.proposal.target as Id<'pilotItems'>);let message:string;
 const access=await accessFor(ctx,u);const response=setupAnswer(a.text);
 if(!item||item.userId!==u._id||item.text!==p.proposal.itemText||['stopped','paused','completed','skipped'].includes(item.state)){await ctx.db.delete(p._id);message='That schedule changed. Please confirm the current schedule before setting reminders.';}
 else if(!u.conversationConsent||u.state==='stopped'||u.state==='paused'||u.safetyKind||u.dataDeletedAt||access.state!=='active'){await ctx.db.delete(p._id);message='I haven’t set up reminders. Active paid access and open contact permission are needed.';}
 else if(response?.choice==='no'){await ctx.db.delete(p._id);message='No reminders will be added for that schedule. Your saved schedule stays available.';}
 else if(p.proposal.mode==='reminder_offer'&&response?.choice==='yes'){await ctx.db.patch(p._id,{reason:'How many minutes before each session should I remind you?',proposal:{...p.proposal,mode:'reminder_lead',permissionAnswer:a.text}});message='How many minutes before each session should I remind you?';}
 else if(p.proposal.mode==='reminder_lead'&&response?.minutes!==undefined){
  const details=scheduleDetails(item.text);if(!details)throw new Error('Unresolved schedule');const permissionText='InTune asked: '+p.proposal.offer+'\nUser answered: '+p.proposal.permissionAnswer+'\nAdvance time: '+a.text;let scheduled=false;
  if(reminderConfigured()){
   const dates:{date:string,time:string}[]=[];for(let n=0;n<8;n++){const date=shiftDate(localDate(Date.now(),u.timezone),n);const day=weekdays[new Date(date+'T12:00:00Z').getUTCDay()];if(!details.days.includes(day))continue;const session=zonedInstant(date,details.time,u.timezone);const due=session-response.minutes*60000;if(due<=Date.now()||session>=access.endsAt!||due>=access.endsAt!)continue;dates.push({date:localDate(due,u.timezone),time:new Intl.DateTimeFormat('en-GB',{timeZone:u.timezone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(due)});}
   for(const due of dates){u=(await ctx.db.get(u._id))!;const result=await applyReminder(ctx,u,{k:'reminder',q:permissionText,target:item._id,title:item.title,d:due.date,t:due.time,repeat:'once',kind:'tracking'},Date.now(),true);if(!result?.changedIds?.length)throw new Error('Reminder setup incomplete');}scheduled=dates.length>0;
  }
  await ctx.db.patch(item._id,{reminderPreference:{minutesBefore:response.minutes,permissionText,requestedAt:Date.now(),scheduled},updatedAt:Date.now()});await ctx.db.delete(p._id);
  message=scheduled?`Scheduled reminders ${response.minutes} minutes before each saved session during your pilot (${u.timezone}).`:`Your preference is saved: ${response.minutes} minutes before each session. ${reminderConfigured()?'No future session fits the remaining paid pilot.':'WhatsApp reminder delivery isn’t set up yet.'} Nothing has been scheduled.`;
 }else message=p.reason;
 await memoryChanged(ctx,u._id);u=(await ctx.db.get(u._id))!;const remaining=await ctx.db.query('pending').withIndex('by_user',q=>q.eq('userId',u._id)).take(50);const next=remaining.find(p=>p._id===u.conversationQuestionId)??remaining[0];await ctx.db.patch(u._id,{conversationQuestionId:next?._id});await ctx.db.patch(receipt._id,{state:'complete',replyEntry:'schedule_reminder_setup',repliedAt:Date.now()});
 if(next&&next._id!==p._id)message+='\n\n'+next.reason;
 const result={outcome:'conversation',message,version:u.memoryVersion??0};await saveReply(ctx,u,a.messageId,result);return result;
}});

export function setupRequest(text:string){return text.trim().match(/^(?:set up|setup|help me set up) reminders (?:for|about) (.+?)[.!]?$/i)?.[1]?.trim()??null;}
export const begin=internalMutation({args:{token:v.string(),messageId:v.string(),text:v.string(),version:v.number()},returns:v.any(),handler:async(ctx,a)=>{
 let u=await userFor(ctx,a.token);const receipt=await ctx.db.query('receipts').withIndex('by_user_message',q=>q.eq('userId',u._id).eq('messageId',a.messageId)).unique();if(!receipt||receipt.state!=='processing'||a.version!==(u.memoryVersion??0)||receipt.memoryVersion!==(u.memoryVersion??0))return {outcome:'dropped',message:'Your record changed. Please try the current schedule.'};
 const subject=setupRequest(a.text)?.toLowerCase();if(!subject)throw new Error('Explicit setup request required');let message='Which saved schedule should I use? Please name the activity.';
 if(!u.conversationConsent||u.state==='paused'||u.state==='stopped'||u.safetyKind||u.dataDeletedAt||(await accessFor(ctx,u)).state!=='active')message='I haven’t set up reminders. Active paid access and open contact permission are needed.';
 else{const items=await ctx.db.query('pilotItems').withIndex('by_user',q=>q.eq('userId',u._id)).take(251);if(items.length>250)throw new Error('Item page required');const matches=items.filter(i=>['plan','schedule','task','appointment'].includes(i.kind)&&!['stopped','paused','completed','skipped'].includes(i.state)&&(i.title.toLowerCase().includes(subject)||i.text.toLowerCase().includes(subject))&&scheduleDetails(i.text));if(matches.length===1){await offerScheduleReminders(ctx,u,matches);const pending=await ctx.db.query('pending').withIndex('by_user',q=>q.eq('userId',u._id)).take(50);const p=pending.find(p=>p.proposal?.target===matches[0]._id&&['reminder_offer','reminder_lead'].includes(p.proposal?.mode));if(p){await ctx.db.patch(u._id,{conversationQuestionId:p._id});message=p.reason;}}else if(matches.length>1)message='There is more than one matching schedule. Which saved schedule should I use?';}
 u=(await ctx.db.get(u._id))!;await ctx.db.patch(receipt._id,{state:'complete',replyEntry:'schedule_reminder_setup',repliedAt:Date.now()});const result={outcome:'conversation',message,version:u.memoryVersion??0};await saveReply(ctx,u,a.messageId,result);return result;
}});
