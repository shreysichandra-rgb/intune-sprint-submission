import {localDate} from './rules';
import {v} from 'convex/values';import {makeFunctionReference as ref} from 'convex/server';
import {internalQuery,internalMutation} from './_generated/server';import type {MutationCtx,QueryCtx} from './_generated/server';import type {Doc} from './_generated/dataModel';
import {accessFor,pilotUser,pilotEnabled} from './pilotAccess';import {reminderDue,nextDue} from './pilotReminderRules';import type {Operation} from './conversationProtocol';
const send=ref<'action'>('pilotReminderDelivery:send');type Reader=MutationCtx|QueryCtx;
export async function readReminders(ctx:Reader,u:Doc<'users'>){const r=await ctx.db.query('pilotReminders').withIndex('by_user',q=>q.eq('userId',u._id)).take(101);if(r.length>100)throw new Error('Reminder page required');return r;}
export async function orderingStillNeeded(ctx:Reader,r:Doc<'pilotReminders'>,occurrenceAt=r.dueAt){
 if(r.cycleId){const event=await ctx.db.get(r.cycleId);if(!event||event.userId!==r.userId||event.occurrenceDate!==r.cycleStartDate)return false;}
 if(r.progressCheckIn){
  if(!r.itemId)return false;
  const plan=await ctx.db.get(r.itemId);if(!plan||plan.userId!==r.userId||!['plan','schedule'].includes(plan.kind)||plan.state==='stopped')return false;
  const reports=await ctx.db.query('pilotItemEvents').withIndex('by_item',q=>q.eq('itemId',r.itemId!)).take(251);
  if(reports.length>250)throw Error('Session report page required');
  if(reports.some(e=>e.userId===r.userId&&e.date===localDate(occurrenceAt,r.timezone)&&['completed','skipped'].includes(e.status)))return false;
 }
 if(!r.groceryOrder)return true;
 const items=await ctx.db.query('pilotItems').withIndex('by_user_kind',q=>q.eq('userId',r.userId).eq('kind','grocery')).take(251);
 if(items.length>250)throw new Error('Grocery page required');
 return items.some(i=>i.state==='pending'&&(r.groceryOrderGlobal||!r.itemId||(i._id===r.itemId||i.parentId===r.itemId)));
}
export function reminderConfigured(){return !!process.env.WHATSAPP_ACCESS_TOKEN&&!!process.env.WHATSAPP_PHONE_NUMBER_ID&&(process.env.INTUNE_SYNTHETIC_TRANSPORT==='1'||process.env.INTUNE_REMINDER_TEMPLATE_APPROVED==='1'&&!!process.env.INTUNE_REMINDER_TEMPLATE);}
export async function applyReminder(ctx:MutationCtx,u:Doc<'users'>,op:Operation,anchor:number,confirmed:boolean){
 if(!pilotEnabled()||!['reminder','reminder_control'].includes(op.k))return null;const reminders=await readReminders(ctx,u);
 if(op.k==='reminder_control'){
  const r=reminders.find(r=>r._id===op.target);if(!r)return {message:'No reminder changed.',question:'Which reminder should I change?',mode:'target'};
  if(op.command==='resume'){if(r.kind!=='renewal'&&(await accessFor(ctx,u)).state!=='active')return {message:'Tracking reminders need active paid access.'};const due=nextDue(r.dueAt,r.repeat,r.timezone,r.localTime,Date.now());if(!due)return {message:'That reminder time has passed. Please choose a new future time.'};await ctx.db.patch(r._id,{state:'active',dueAt:due,scheduleVersion:(r.scheduleVersion??0)+1});await ctx.scheduler.runAt(due,send,{id:r._id,dueAt:due});}else await ctx.db.patch(r._id,{state:op.command==='pause'?'paused':'stopped'});
  await ctx.db.patch(u._id,{memoryVersion:(u.memoryVersion??0)+1});return {message:`That reminder is ${op.command==='pause'?'paused':op.command==='stop'?'stopped':'active'}.`,changedIds:[r._id]};
 }
 if(op.k!=='reminder')return null;
 if(!u.conversationConsent)return {message:'Storage permission is needed before saving reminders.'};
 if(op.kind==='renewal')return {message:'Renewal reminder timing and terms still need approval. I haven’t scheduled one.'};
 if((await accessFor(ctx,u)).state!=='active')return {message:'Tracking reminders need active paid access.'};
 if(u.dataDeletedAt||u.safetyKind||u.state==='stopped')return {message:'Reminders are stopped for this account.'};
 if(!reminderConfigured())return {message:'Reminder delivery is not configured yet. I haven’t scheduled or promised a message.'};
 const due=reminderDue(op.d,op.t,anchor,u.timezone,op.repeat??'once');if(due.question)return {message:'Nothing has been scheduled yet.',question:due.question,mode:'detail'};
 const access=await accessFor(ctx,u);if(due.dueAt!>=access.endsAt!)return {message:'That time is after this paid pilot ends. No tracking reminder was scheduled.'};

 const progressCheckIn=(op as any).progressCheckIn===true;
 const linked=op.target?await ctx.db.get(op.target as Doc<'pilotItems'>['_id']):null;
 if(progressCheckIn&&(!linked||linked.userId!==u._id||!['plan','schedule'].includes(linked.kind)))throw Error('A check-in needs an owned activity plan');
 const groceryOrder=/\border(?:ing)?\b/i.test(op.q)&&(linked?.kind==='grocery'||/\bgrocer(?:y|ies)\b/i.test(op.q));
 const groceryOrderGlobal=groceryOrder&&linked?.kind==='task';
 if(groceryOrder&&op.repeat!=='once')return {message:'I can send one agreed ordering nudge. Please choose a single day and time.'};
 if(groceryOrder){const items=await ctx.db.query('pilotItems').withIndex('by_user_kind',q=>q.eq('userId',u._id).eq('kind','grocery')).take(251);if(items.length>250)throw new Error('Grocery page required');if(!items.some(i=>i.state==='pending'&&(groceryOrderGlobal||!op.target||(i._id===op.target||i.parentId===op.target))))return {message:'There are no confirmed items left to order. I haven’t scheduled an ordering nudge.'};}
 if(op.target){const item=await ctx.db.get(op.target as Doc<'pilotItems'>['_id']);if(!item||item.userId!==u._id)throw new Error('Unavailable reminder item');}
 if(reminders.length>=100)throw new Error('Reminder capacity reached');const prior=reminders.find(r=>r.state==='active'&&r.title===op.title&&(progressCheckIn?r.progressCheckIn&&r.itemId===op.target&&localDate(r.dueAt,r.timezone)===localDate(due.dueAt!,u.timezone):r.dueAt===due.dueAt&&!r.progressCheckIn));if(prior)return {message:'That reminder is already scheduled. I haven’t added another.'};
 const id=await ctx.db.insert('pilotReminders',{userId:u._id,...(op.target?{itemId:op.target as Doc<'pilotItems'>['_id']} :{}),kind:op.kind,title:op.title,...(progressCheckIn?{progressCheckIn:true,permissionContext:(op as any).permissionContext??op.q}:{}),...(groceryOrder?{groceryOrder:true,...(groceryOrderGlobal?{groceryOrderGlobal:true}:{})}:{}),permissionText:op.q,timezone:u.timezone,localTime:due.time!,dueAt:due.dueAt!,repeat:op.repeat,state:u.state==='paused'?'paused':'active',createdAt:Date.now()});if(u.state!=='paused')await ctx.scheduler.runAt(due.dueAt!,send,{id,dueAt:due.dueAt!});await ctx.db.patch(u._id,{memoryVersion:(u.memoryVersion??0)+1});return {message:u.state==='paused'?'Saved the reminder as paused. No message will be sent while reminders are paused.':`Scheduled your reminder for ${op.title}: ${new Intl.DateTimeFormat('en-IN',{timeZone:u.timezone,dateStyle:'medium',timeStyle:'short'}).format(due.dueAt!)} (${u.timezone}), ${op.repeat==='once'?'once':op.repeat+' until your pilot ends'}.`,changedIds:[id]};
}
export const claim=internalMutation({args:{id:v.id('pilotReminders'),dueAt:v.number()},returns:v.any(),handler:async(ctx,a)=>{
 const r=await ctx.db.get(a.id);if(!r||r.dueAt!==a.dueAt||Date.now()<a.dueAt)return null;const old=await ctx.db.query('pilotReminderDeliveries').withIndex('by_due',q=>q.eq('reminderId',r._id).eq('dueAt',a.dueAt)).unique();if(old)return null;const u=await ctx.db.get(r.userId);if(!u)return null;
 const priorChecks=r.progressCheckIn?await ctx.db.query('pilotReminderDeliveries').withIndex('by_user',q=>q.eq('userId',r.userId)).take(501):[];if(priorChecks.length>500)throw Error('Check-in delivery page required');
 let alreadyChecked=false;for(const d of priorChecks){if(d.status==='suppressed'||localDate(d.dueAt,r.timezone)!==localDate(a.dueAt,r.timezone))continue;const previous=await ctx.db.get(d.reminderId);if(previous?.progressCheckIn&&previous.itemId===r.itemId){alreadyChecked=true;break;}}
 const access=await accessFor(ctx,u);const permitted=!alreadyChecked&&pilotEnabled()&&r.state==='active'&&await orderingStillNeeded(ctx,r)&&u.state!=='paused'&&u.state!=='stopped'&&!u.dataDeletedAt&&!u.safetyKind&&u.conversationConsent===true&&!!u.phoneNumber&&reminderConfigured()&&r.kind!=='renewal'&&(access.state==='active'||r.summary===true&&r.repeat==='once'&&r.dueAt===access.endsAt&&access.state==='expired');
 const id=await ctx.db.insert('pilotReminderDeliveries',{userId:u._id,reminderId:r._id,dueAt:a.dueAt,scheduleVersion:r.scheduleVersion??0,status:permitted?'sending':'suppressed'});
 const next=nextDue(r.dueAt,r.repeat,r.timezone,r.localTime,Date.now());if(next&&access.endsAt!==null&&next<access.endsAt){await ctx.db.patch(r._id,{dueAt:next});await ctx.scheduler.runAt(next,send,{id:r._id,dueAt:next});}else if(!permitted)await ctx.db.patch(r._id,{state:'stopped'});
 if(!permitted)return null;return {id,debugEpoch:u.debugEpoch??0,...(r.summary?{summary:true,token:u.token}:{}),to:u.phoneNumber!.slice(1),body:(u.preferredName?'Hey '+u.preferredName+' 👋 ':'')+(r.progressCheckIn?'Were you able to do your '+r.title+' session today? You can reply done, skipped, or tell me if plans changed.':r.groceryOrder?'Have you placed your grocery order? Just the one nudge you asked for.':'Your reminder: '+r.title+'. As you asked.'),insideWindow:!!u.lastInboundAt&&Date.now()-u.lastInboundAt<86400000};
}});
export const finish=internalMutation({args:{id:v.id('pilotReminderDeliveries'),status:v.union(v.literal('accepted'),v.literal('unknown'),v.literal('failed')),providerMessageId:v.optional(v.string())},returns:v.null(),handler:async(ctx,a)=>{const d=await ctx.db.get(a.id);if(d?.status==='sending'){await ctx.db.patch(d._id,{status:a.status,...(a.providerMessageId?{providerMessageId:a.providerMessageId}:{})});const r=await ctx.db.get(d.reminderId);if(r&&r.state==='active'&&r.dueAt===d.dueAt&&(r.scheduleVersion??0)===(d.scheduleVersion??0))await ctx.db.patch(r._id,{state:'stopped'});}return null;}});
export const deliveryCheck=internalQuery({args:{id:v.id('pilotReminderDeliveries'),version:v.optional(v.number())},returns:v.boolean(),handler:async(ctx,a)=>{const d=await ctx.db.get(a.id);if(!d||d.status!=='sending')return false;const r=await ctx.db.get(d.reminderId),u=await ctx.db.get(d.userId);return !!r&&r.state==='active'&&(r.scheduleVersion??0)===(d.scheduleVersion??0)&&await orderingStillNeeded(ctx,r,d.dueAt)&&!!u&&(a.version===undefined||(u.memoryVersion??0)===a.version)&&u.state!=='paused'&&u.state!=='stopped'&&!u.dataDeletedAt&&!u.safetyKind&&u.conversationConsent===true&&r.kind!=='renewal'&&((await accessFor(ctx,u)).state==='active'||r.summary===true&&r.repeat==='once'&&r.dueAt===(await accessFor(ctx,u)).endsAt&&(await accessFor(ctx,u)).state==='expired');}});
export const view=internalQuery({args:{token:v.string()},returns:v.any(),handler:async(ctx,a)=>readReminders(ctx,await pilotUser(ctx,a.token))});

export const scheduleSummary=internalMutation({args:{token:v.string(),text:v.string()},returns:v.any(),handler:async(ctx,a)=>{
 const u=await pilotUser(ctx,a.token),access=await accessFor(ctx,u);
 if(!/\b(?:send|give)\b.*\b(?:summary|recap)\b.*\b(?:when|at)\b.*\b(?:pilot|seven days|7 days)\b.*\b(?:ends?|over|finish)/i.test(a.text))throw new Error('Explicit end-summary permission required');
 if(access.state!=='active'||!access.endsAt)return {outcome:'summary',controlOnly:true,message:'An end-of-pilot summary can be scheduled during your active paid pilot. You can ask for your saved summary now.'};
 if(!u.conversationConsent||u.dataDeletedAt||u.safetyKind||u.state==='stopped')return {outcome:'summary',controlOnly:true,message:'I haven’t scheduled a summary. Storage permission and open contact are needed.'};
 if(!reminderConfigured()||process.env.INTUNE_SYNTHETIC_TRANSPORT!=='1'&&!(process.env.INTUNE_SUMMARY_TEMPLATE_APPROVED==='1'&&process.env.INTUNE_SUMMARY_TEMPLATE))return {outcome:'summary',controlOnly:true,message:'Summary delivery is not configured yet. You can still ask for Summary here.'};
 const reminders=await readReminders(ctx,u),old=reminders.find(r=>r.summary&&r.dueAt===access.endsAt&&r.state!=='stopped');
 if(!old){if(reminders.length>=100)throw new Error('Reminder capacity reached');const id=await ctx.db.insert('pilotReminders',{userId:u._id,summary:true,kind:'closure',title:'Your seven-day summary',permissionText:a.text,timezone:u.timezone,localTime:new Intl.DateTimeFormat('en-GB',{timeZone:u.timezone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(access.endsAt),dueAt:access.endsAt,repeat:'once',state:u.state==='paused'?'paused':'active',createdAt:Date.now()});if(u.state!=='paused')await ctx.scheduler.runAt(access.endsAt,send,{id,dueAt:access.endsAt});await ctx.db.patch(u._id,{memoryVersion:(u.memoryVersion??0)+1});}
 return {outcome:'summary',controlOnly:true,message:u.state==='paused'?'Saved your final summary as paused. No message will be sent while contact is paused.':'I’ll send your saved seven-day summary when your paid pilot ends, once. Pause or Stop will cancel that message. You can also ask for Summary anytime.'};
}});
