import {impliedSavingEnabled} from './conversationPolicy';
import {purgeConversationLog} from './conversationLog';
import {readExperiences,applyExperience} from './pilotExperiences';
import {clearConversationContext,readConversationContext} from './conversationContext';
import {directStorageRequest,directTrackingEnabled,storageDeclined} from './directTracking';
import {ordinalSelection,questionMatchesScope} from './conversationFocus';
import {offerCycleGap} from './cycleReminderSetup';
import {offerScheduleReminders} from './scheduleReminderSetup';
import {readReminders,applyReminder} from './pilotReminders';
import {pilotEnabled,accessFor,inPilotPeriod} from './pilotAccess';
import {readItems,itemsReply,groceryReply,applyItem,forgetPilotRecord} from './pilotMemory';
import {assertPilotWrite} from './pilotAccess';
import {saveReply} from './deliveryState';
import {v} from 'convex/values';
import {makeFunctionReference} from 'convex/server';
import {internalQuery,internalMutation,query} from './_generated/server';
import {internal,api} from './_generated/api';
import type {MutationCtx,QueryCtx} from './_generated/server';
import type {Doc,Id} from './_generated/dataModel';
import {userFor,memoryChanged,applyMeaning,resolveSymptom,saveChoices,applyNaturalUpdates} from './tracking';
import {applyPlanMeaning,resolvePlan,planView} from './plans';
import {conversationSchema,validateEnvelope,normalizeLabel,reportIsAsserted,reportWhen,correctionTarget,correctionIntent,type Operation,type Envelope,type Report} from './conversationProtocol';
import {reportedTimePhrase,resolveWhen,inWindow,MAX_RECORDS} from './rules';
import {semanticSafetyEvidence} from './semanticSafety';
import {matchSafetyCategory,supportedSafetyEvidence} from './safety';
import {eventLabel,dateLabel} from './replyCopy';
import type {Meaning} from './interpretation';
import * as copy from './copy';
import * as words from './conversationCopy';

type Reader=QueryCtx|MutationCtx;
export const conversationRefs={
 context:makeFunctionReference<'query',any,any>('conversationStore:context'),
 apply:makeFunctionReference<'mutation',any,any>('conversationStore:apply'),
 delivery:makeFunctionReference<'query',any,any>('conversationStore:delivery'),
 send:makeFunctionReference<'action',any,any>('conversationAction:send'),
 view:makeFunctionReference<'query',any,any>('conversationStore:view'),
 route:makeFunctionReference<'query',any,any>('conversationStore:route'),
 enroll:makeFunctionReference<'mutation',any,any>('conversationStore:enroll'),
 enabled:makeFunctionReference<'query',any,boolean>('conversationStore:enabled'),
 consentGate:makeFunctionReference<'mutation',any,any>('conversationStore:consentGate'),
 history:makeFunctionReference<'query',any,any>('conversationStore:history'),
 recordReply:makeFunctionReference<'query',any,any>('conversationStore:recordReply'),
};
async function read(ctx:Reader,user:Doc<'users'>){
 const body=await ctx.db.query('occurrences').withIndex('by_user',q=>q.eq('userId',user._id)).order('desc').take(MAX_RECORDS);
 body.reverse();
 const cycle=await ctx.db.query('cycleEvents').withIndex('by_user',q=>q.eq('userId',user._id)).order('desc').take(MAX_RECORDS);
 cycle.reverse();
 if(body.length>MAX_RECORDS||cycle.length>MAX_RECORDS)throw new Error('Bounded read exceeded');
 const pending=(await ctx.db.query('pending').withIndex('by_user',q=>q.eq('userId',user._id)).take(50)).filter(p=>!p.jobId||p.jobId===user.jobId);
 const plan=await planView(ctx,user);
 const previousPlans=(await ctx.db.query('plans').withIndex('by_user',q=>q.eq('userId',user._id)).order('desc').take(12)).filter(p=>p.jobId!==user.jobId);
 const previousCompletions=(await ctx.db.query('planCompletions').withIndex('by_user',q=>q.eq('userId',user._id)).order('desc').take(MAX_RECORDS)).filter(p=>p.jobId!==user.jobId);
 const previousPending=(await ctx.db.query('pending').withIndex('by_user',q=>q.eq('userId',user._id)).order('desc').take(50)).filter(p=>p.jobId&&p.jobId!==user.jobId);
 const responsibilities=pilotEnabled()?await readItems(ctx,user):{items:[],events:[]};
 return {experiences:pilotEnabled()?await readExperiences(ctx,user):[],body,cycle,pending,plan,previousPlans,previousCompletions,previousPending,responsibilities,reminders:pilotEnabled()?await readReminders(ctx,user):[]};
}
async function fingerprint(data:Awaited<ReturnType<typeof read>>,id:string){
 const record=[...data.body,...data.cycle,...data.experiences,...data.plan.records,...data.responsibilities.items,...data.responsibilities.events].find(r=>r._id===id);
 const source=record&&'batchId' in record?data.body.filter(r=>r.batchId===record.batchId):record?[record]:[];
 return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(source))))).map(n=>n.toString(16).padStart(2,'0')).join('');
}
function summaryReply(data:Awaited<ReturnType<typeof read>>,user:Doc<'users'>,scope='week',label:string|null=null){
 const lines:string[]=[];
 if(scope==='week'&&pilotEnabled()&&user.pilotStartedAt!==undefined&&user.pilotEndsAt!==undefined){const fmt=(at:number)=>new Intl.DateTimeFormat('en-IN',{timeZone:user.timezone,dateStyle:'medium',timeStyle:'short'}).format(at);lines.push(`Your pilot record: ${fmt(user.pilotStartedAt)} to ${fmt(user.pilotEndsAt)} (${user.timezone}).`);}
 if(scope==='all')scope='history';
 if(scope==='history'){
  lines.push('Here are your recent saved changes across periods (up to 250 body and 250 cycle records):');
  const groups=new Map<string,typeof data.body>();for(const r of data.body){const key=JSON.stringify([r.batchId,r.trackedItem,r.occurrenceDate,r.occurrenceTime]);groups.set(key,[...(groups.get(key)??[]),r]);}
  for(const records of groups.values()){const r=records[0];lines.push(`${r.trackedItem}: ${records.length} time${records.length===1?'':'s'}, ${r.occurrenceDate}${r.occurrenceTime?' at '+r.occurrenceTime:''}.`);}
  for(const r of data.cycle)lines.push(`Cycle: ${r.label}, ${r.occurrenceDate}.`);
  for(const p of data.previousPlans){const completions=data.previousCompletions.filter(r=>r.planId===p._id&&r.status==='completed');lines.push(`Earlier plan: ${p.activity}, target ${p.targetNumber}; ${completions.length} recently saved completions.`);}
  for(const p of data.previousPending)lines.push(`Earlier unresolved update (not counted): “${p.rawText.slice(0,240)}”.`);
  if(!data.experiences.length&&!data.body.length&&!data.cycle.length&&!data.previousPlans.length&&!data.previousPending.length)lines.push('No body or cycle changes saved yet.');
 }
 if(scope==='week'||scope==='body'){
  const body=data.body.filter(r=>r.jobId===user.jobId&&inPilotPeriod(user,r.occurrenceDate,r.occurrenceTime,r.timePrecision)&&r.trackedItem!=='cycle changes'&&(scope!=='body'||!label||r.trackedItem===normalizeLabel(label)));
  const groups=new Map<string,typeof body>();
  for(const r of body)groups.set(r.trackedItem,[...(groups.get(r.trackedItem)??[]),r]);
  for(const [item,records] of groups)lines.push(`${item}: ${records.length} time${records.length===1?'':'s'}, ${[...new Set(records.map(r=>dateLabel(r.occurrenceDate,user.timezone)))].join(', ')}.`);
  if(!groups.size&&!data.experiences.some(e=>e.kind==='body'&&(!label||e.label.toLowerCase().includes(label.toLowerCase()))))lines.push(scope==='body'&&label?`No ${normalizeLabel(label)} saved in this seven-day record.`:'No body changes saved in this seven-day record.');
 }
 if(scope==='week'||scope==='cycle'){
  const cycles=data.cycle.filter(r=>r.jobId===user.jobId&&inPilotPeriod(user,r.occurrenceDate,r.occurrenceTime,r.timePrecision));
  for(const r of cycles)lines.push(`${r.dateKind==='observation'?'Cycle observation':'Cycle'}: ${r.label}, ${dateLabel(r.occurrenceDate,user.timezone)}.`);
  for(const r of data.body.filter(r=>r.jobId===user.jobId&&r.trackedItem==='cycle changes'&&inPilotPeriod(user,r.occurrenceDate,r.occurrenceTime,r.timePrecision)))lines.push(`Cycle change from your earlier record: ${dateLabel(r.occurrenceDate,user.timezone)}.`);
  if(scope==='cycle'&&!cycles.length)lines.push('No cycle events saved in this seven-day record.');
 }
 if((scope==='week'||scope==='plan')&&(!pilotEnabled()||data.plan.plan))lines.push(data.plan.plan?`${data.plan.plan.activity}: ${data.plan.progress} this week.`:copy.noConfirmedPlan);
 if(pilotEnabled()){if(['all','history','week','body','cycle'].includes(scope))for(const e of data.experiences.filter(e=>!['body','cycle'].includes(scope)||e.kind===scope))lines.push(`${e.status==='historical'?'Reported history':'Ongoing experience'}: ${e.label}. ${e.text} (${e.status}; not an episode count).`);lines.push(itemsReply(data.responsibilities,user,scope));if(['history','week','all'].includes(scope))for(const r of data.reminders)lines.push(`Reminder: ${r.title}, ${r.state}, ${new Intl.DateTimeFormat('en-IN',{timeZone:r.timezone,dateStyle:'medium',timeStyle:'short'}).format(r.dueAt)} (${r.timezone}), ${r.repeat}.`);}
 for(const event of [...data.body,...data.cycle])if(event.reportedTimePhrase)lines.push(`${'trackedItem' in event?event.trackedItem:event.label}: reported time ${event.reportedTimePhrase}.`);
 return lines.join('\n');
}
export const view=query({args:{token:v.string()},returns:v.any(),handler:async(ctx,args)=>{
 const user=await userFor(ctx,args.token),data=await read(ctx,user);
 return {...data,summary:summaryReply(data,user),state:user.state??'active',safetyPaused:!!user.safetyKind,consent:user.conversationConsent===true};
}});
export const context=internalQuery({args:{token:v.string(),messageId:v.string()},returns:v.any(),handler:async(ctx,args)=>{
 const user=await userFor(ctx,args.token),data=await read(ctx,user);
 const receipt=await ctx.db.query('receipts').withIndex('by_user_message',q=>q.eq('userId',user._id).eq('messageId',args.messageId)).unique();
 const conversation=await readConversationContext(ctx,user,args.messageId);
 const quotedAsked=conversation?.quoted?.role==='assistant'?conversation.quoted.askedPendingId:null;
 const shownAsked=conversation?.hasReplyDeliveryEvidence?conversation.displayedQuestionId:user.conversationQuestionId;
 const effectiveAsked=quotedAsked&&data.pending.some(p=>p._id===quotedAsked)?quotedAsked:shownAsked;
 const groups=new Map<string,typeof data.body>();for(const r of data.body){const key=JSON.stringify([r.batchId,r.occurrenceDate,r.occurrenceTime,r.trackedItem]);groups.set(key,[...(groups.get(key)??[]),r]);}
 return {experiences:data.experiences.map(e=>({id:e._id,kind:e.kind,label:e.label,text:e.text.slice(0,600),status:e.status})),conversation,userId:user._id,jobId:user.jobId,version:user.memoryVersion??0,safetyPaused:!!user.safetyKind,receivedAt:receipt?.messageReceivedAt??null,timezone:user.timezone,state:user.state??'active',consent:user.conversationConsent===true,askedPendingId:effectiveAsked??null,
  ...(pilotEnabled()?{pilotMode:'v3',preferredName:user.preferredName??null,nameAsked:user.pilotNameAsked??false,cycleReminderSetup:data.pending.find(p=>p._id===user.conversationQuestionId&&p.proposal?.mode?.startsWith('cycle_reminder_'))?.proposal?.mode??null,reminderSetup:data.pending.find(p=>p._id===user.conversationQuestionId&&['reminder_offer','reminder_lead'].includes(p.proposal?.mode))?.proposal?.mode??null,responsibilities:data.responsibilities.items.map(i=>({id:i._id,kind:i.kind,title:i.title,text:i.text,reportedAt:i.createdAt,target:i.target??null,state:i.state})),reminders:data.reminders.map(r=>({id:r._id,title:r.title,state:r.state,dueAt:r.dueAt,timezone:r.timezone,repeat:r.repeat})),itemEvents:data.responsibilities.events.slice(0,30).map(e=>({id:e._id,itemId:e.itemId,date:e.date,status:e.status}))}:{}),
  body:[...groups.values()].slice(-12).map(records=>{const r=records[0];return {id:r._id,label:r.trackedItem,reportedLabel:r.reportedLabel??r.trackedItem,reportedCount:records.length,context:r.rawText.slice(0,240),date:r.occurrenceDate,time:r.occurrenceTime,group:r.batchId,period:r.jobId===user.jobId?'current':'earlier'};}),
  cycle:data.cycle.slice(-12).map(r=>({id:r._id,label:r.label,date:r.occurrenceDate,time:r.occurrenceTime,period:r.jobId===user.jobId?'current':'earlier'})),
  previousPlans:data.previousPlans.map(p=>({activity:p.activity,target:p.targetNumber,recentCompleted:data.previousCompletions.filter(r=>r.planId===p._id&&r.status==='completed').length})),
  plan:data.plan.plan?{activity:data.plan.plan.activity,target:data.plan.plan.targetNumber,progress:data.plan.progress}:null,
  completions:data.plan.records.slice(-12).map(r=>({id:r._id,date:r.completionDate,status:r.status})),
  pending:[...data.pending.slice(-12).map(p=>({id:p._id,question:p.reason,proposal:p.proposal,receivedAt:p.messageReceivedAt})),...data.plan.pending.slice(-8).map(p=>({id:p._id,question:p.reason,proposal:p.proposal,receivedAt:p.messageReceivedAt}))],
 };
}});
export const recordReply=internalQuery({args:{token:v.string(),scope:v.union(v.literal('week'),v.literal('plan'))},returns:v.any(),handler:async(ctx,args)=>{const user=await userFor(ctx,args.token),data=await read(ctx,user);return {message:args.scope==='plan'?copy.planReply(data.plan):summaryReply(data,user),version:user.memoryVersion??0};}});
export const delivery=internalQuery({args:{token:v.string(),version:v.number(),readOnly:v.optional(v.boolean())},returns:v.boolean(),handler:async(ctx,args)=>{
 const user=await userFor(ctx,args.token);
 const gatePermits=!user.conversationEnabled||process.env.INTUNE_CONVERSATION_GATE==='candidate'||process.env.INTUNE_CONVERSATION_PROTOTYPE==='local';
 return !user.dataDeletedAt&&(args.readOnly||(!pilotEnabled()||(await accessFor(ctx,user)).state==='active')&&gatePermits&&user.state!=='stopped'&&!user.safetyKind)&&(user.memoryVersion??0)===args.version;
}});
const emptyMeaning:Meaning={intent:'record',trackedItem:null,count:null,datePhrase:null,timePhrase:null,precision:'date-only',target:null,explicitNew:false,activity:null,targetNumber:null,completionStatus:null};
function describe(op:Operation){
 if(op.k==='body'||op.k==='cycle')return `${op.n===null?'an unclear number of ':op.n===1?'':op.n+' '}${op.l}${op.k==='body'&&op.b&&op.b!==normalizeLabel(op.l)?' (understood as '+op.b+')':''}${op.d?' '+op.d:''}${op.t?' '+op.t:''}`;
 if(op.k==='complete')return `a completed session${op.d?' '+op.d:''}`;
 if(op.k==='correct')return `a correction: “${op.q}”`;
 return op.q;
}
function oneQuestion(pending:Doc<'pending'>[],planPending:Doc<'planPending'>[]){
 return pending[0]?.reason??planPending[0]?.reason;
}
export const apply=internalMutation({args:{token:v.string(),messageId:v.string(),text:v.string(),version:v.number(),envelope:v.any()},returns:v.any(),handler:async(ctx,args):Promise<any>=>{
 let user=await userFor(ctx,args.token);
 const receipt=await ctx.db.query('receipts').withIndex('by_user_message',q=>q.eq('userId',user._id).eq('messageId',args.messageId)).unique();
 if(user.conversationEnabled&&process.env.INTUNE_CONVERSATION_GATE!=='candidate'&&process.env.INTUNE_CONVERSATION_PROTOTYPE!=='local'){if(receipt)await ctx.db.patch(receipt._id,{state:'dropped'});return {outcome:'dropped',message:copy.tracking_Your_record_or_tracking_state_changed_while};}
 if(!receipt||receipt.state!=='processing'||receipt.memoryVersion!==(user.memoryVersion??0)||args.version!==(user.memoryVersion??0)||receipt.userState!==(user.state??'active')){
  if(receipt?.state==='processing')await ctx.db.patch(receipt._id,{state:'dropped'});
  return {outcome:'dropped',message:copy.tracking_Your_record_or_tracking_state_changed_while};
 }
 if(user.state==='stopped'||user.dataDeletedAt)return {outcome:'stopped',message:copy.stoppedReply};
 const packet=conversationSchema.parse(args.envelope);
 if(packet.sources){for(const source of packet.sources)if(!args.text.includes(source.q))throw new Error('Ungrounded normalized source');for(const op of packet.ops)if(!packet.sources.some(source=>source.q===op.q&&source.e.toLowerCase().includes((op.e??'').toLowerCase())&&source.e===op.c&&(!op.o||source.o)&&source.h===(op.h??'none')))throw new Error('Unattested normalized operation');}
 const canonical=packet.sources?.map(s=>s.e).join(' ; ');
 const risk=packet.sources?.find(s=>['suicidal_thoughts','self_harm_intent','immediate_danger_self'].includes(s.h))?.h??packet.sources?.find(s=>s.h==='concerning_bleeding')?.h;
 const riskEvidence=semanticSafetyEvidence(canonical,risk);
 const literalCategory=riskEvidence?matchSafetyCategory(riskEvidence):null;
 if(literalCategory||user.safetyKind){const safety=await ctx.runMutation(internal.tracking.safetyGuard,{token:args.token,messageId:args.messageId,text:riskEvidence??args.text,...(literalCategory?{category:literalCategory}:{})});if(safety)return safety;}
 const envelope=validateEnvelope(args.text,args.envelope);
 const turnContext=await readConversationContext(ctx,user,args.messageId);
 const quotedAsked=turnContext?.quoted?.role==='assistant'?turnContext.quoted.askedPendingId:null;
 const initialAsked=turnContext?.hasReplyDeliveryEvidence?turnContext.displayedQuestionId:user.conversationQuestionId;
 if(turnContext?.quotedUnavailable&&envelope.ops.some(op=>['reference','correct','experience_correct','item_correct','item_complete','answer'].includes(op.k))){
  await ctx.db.patch(receipt._id,{state:'complete',replyEntry:'conversation_quote_unavailable',repliedAt:Date.now()});
  const result={outcome:'conversation',readOnly:true,message:'I can’t find the message you replied to. Which saved update or question do you mean? Nothing from this message was saved.',version:user.memoryVersion??0};await saveReply(ctx,user,args.messageId,result);return result;
 }
 const initial=await read(ctx,user);
 const candidates=[...initial.body.filter(r=>r.jobId===user.jobId),...initial.cycle.filter(r=>r.jobId===user.jobId),...initial.plan.records];
 const groups=new Set(candidates.map(r=>'batchId' in r?r.batchId:r._id));
 // A counted group is one source report, not several competing correction targets.
 if(groups.size===1)for(const op of envelope.ops)if(op.k==='correct'&&op.target===null)op.target=candidates[0]._id;
 // Permission to clarify a correction is grounded in an existing owned record, never a new entry.
 const correctionCapability=(op:Operation,sources:Envelope['sources'])=>correctionTarget(op,sources)??(correctionIntent(op,sources)?op.k==='correct'?candidates[0]?._id:op.k==='item_correct'?initial.responsibilities.events[0]?._id:undefined:undefined);
 const allowedTargets=new Set([...initial.experiences.map(r=>r._id),...initial.body.map(r=>r._id),...initial.cycle.map(r=>r._id),...initial.plan.records.map(r=>r._id),...initial.pending.map(r=>r._id),...initial.plan.pending.map(r=>r._id),...initial.responsibilities.items.map(r=>r._id),...initial.responsibilities.events.map(r=>r._id),...initial.reminders.map(r=>r._id)]);
 for(const op of envelope.ops)if('target' in op&&op.target&&!allowedTargets.has(op.target as any))throw new Error('Unavailable private reference');
 for(const op of envelope.ops)if(op.k==='safety'){
  if(!supportedSafetyEvidence(op.category,canonical??args.text,op.e??op.q))continue;
  return await ctx.runMutation(internal.tracking.safetyGuard,{token:args.token,messageId:args.messageId,text:canonical??args.text,category:op.category});
 }
 for(const op of envelope.ops)if(!['question','conversation','safety','control','reference','feedback','reminder_control','answer'].includes(op.k))await assertPilotWrite(ctx,user,correctionCapability(op,envelope.sources));
 if(directTrackingEnabled()&&(storageDeclined(args.text)||!!canonical&&storageDeclined(canonical))&&!envelope.ops.some(op=>op.k==='control')){
  await clearConversationContext(ctx,user);
  await ctx.db.patch(receipt._id,{state:'complete',replyEntry:'conversation_storage_declined',repliedAt:Date.now()});
  const result={outcome:'conversation',controlOnly:true,readOnly:true,message:'I haven’t saved anything from this message.',version:user.memoryVersion??0};await saveReply(ctx,user,args.messageId,result);return result;
 }
 const lastCompleted=directTrackingEnabled()?await ctx.db.query('receipts').withIndex('by_user_state',q=>q.eq('userId',user._id).eq('state','complete')).order('desc').first():null;
 const answeringTrackingInvite=user.conversationConsentAsked&&['conversation_tracking_invite','pilot_social_tracking_invite'].includes(lastCompleted?.replyEntry??'');
 // A verified direct delegation supplies storage permission for this message,
 // not payment, reminder timing, name changes, safety return or prior messages.
 if(directTrackingEnabled()&&!user.storageWithdrawn&&(!user.conversationConsent||user.pilotFreshConsentPending)&&!user.safetyKind&&user.state!=='paused'&&!envelope.ops.some(op=>['control','safety'].includes(op.k))&&envelope.ops.some(op=>['experience','body','cycle','plan','item','remember','complete','item_complete','reminder'].includes(op.k))&&(answeringTrackingInvite||directStorageRequest(args.text)||!!canonical&&directStorageRequest(canonical))){
  await ctx.db.patch(user._id,{conversationConsent:true,pilotFreshConsentPending:undefined,conversationConsentAsked:undefined,pilotNameAsked:false});await memoryChanged(ctx,user._id);user=(await ctx.db.get(user._id))!;
 }
 if(impliedSavingEnabled()&&user.pilotNameAsked&&envelope.ops.some(op=>['experience','body','cycle','plan','item','remember','complete','item_complete'].includes(op.k))){await ctx.db.patch(user._id,{pilotNameAsked:false});await memoryChanged(ctx,user._id);user=(await ctx.db.get(user._id))!;}
 let attentionId:string|undefined;
 const statements:string[]=[],changedIds:string[]=[];let consentDetailsRequested=false;
 let conversationUnclear=false,contextAcknowledged=false,controlReply:string|null=null,correctedOnly=true,hasCorrection=false;
 if(envelope.ops.every(op=>op.k==='safety'))statements.push(words.unclearQuestion);
 const repeatDescription=(op:Operation)=>{
  if(op.k!=='correct'||!op.target)return describe(op);
  const record=[...initial.body,...initial.cycle,...initial.plan.records].find(r=>r._id===op.target);
  if(!record)return describe(op);
  const label='trackedItem' in record?record.trackedItem:'label' in record?record.label:initial.plan.plan?.activity??'completed session';
  const date='occurrenceDate' in record?record.occurrenceDate:record.completionDate;
  return `a correction to ${label} ${dateLabel(date,user.timezone)}: “${op.q}”`;
 };
 const refresh=async()=>{const fresh=await ctx.db.get(user._id);if(!fresh)throw new Error('Unavailable user');user=fresh;};
 const pend=async(mode:string,ops:Operation[],text:string,anchor:number,reason:string,target:string|null=null,choices?:{id:string,label:string}[])=>{
  const existing=await ctx.db.query('pending').withIndex('by_user',q=>q.eq('userId',user._id)).take(50);
  // The same unconfirmed shopping request must not create another question.
  // Compare declared names, not the woman's spelling/wording or model quotes.
  const groceryKey=(values:Operation[])=>values.length&&values.every(op=>op.k==='item'&&op.category==='grocery'&&op.ingredients.length)?JSON.stringify(values.map(op=>op.k==='item'?[...new Set(op.ingredients.map(i=>i.toLowerCase().trim()))].sort():[]).sort()):null;
  const key=mode==='batch'?groceryKey(ops):null;
  const repeated=key?existing.find(p=>p.proposal?.mode==='batch'&&groceryKey(p.proposal.ops??[])===key):mode==='batch'&&ops.some(op=>op.k==='plan'||op.k==='item')?existing.find(p=>p.jobId===user.jobId&&p.proposal?.mode==='batch'&&p.rawText.trim()===text.trim()):undefined;
  if(repeated){attentionId=repeated._id;return repeated._id;}
  if(existing.length>=50)throw new Error('Pending processing limit');
  const records=await read(ctx,user);
  const stamps:Record<string,string>={};
  for(const choice of choices??[])stamps[choice.id]=await fingerprint(records,choice.id);
  for(const op of ops)if((op.k==='correct'||op.k==='item_correct'||op.k==='item_update')&&op.target)stamps[op.target]=await fingerprint(records,op.target);
  const id=await ctx.db.insert('pending',{userId:user._id,jobId:user.jobId,rawText:text,messageReceivedAt:anchor,reason,kind:mode==='duplicate'?'possible_duplicate':'clarification',proposal:{v:2,mode,ops,target,stamps,...(choices?.length?{choices}:{}),...(envelope.sources?{sources:envelope.sources}:{})},relatedIds:[]});
  attentionId=id;await memoryChanged(ctx,user._id);await refresh();return id;
 };
 const addLabels=async(labels:string[])=>{
  const items=[...new Set([...user.trackedItems,...labels.map(normalizeLabel)])];
  if(items.length!==user.trackedItems.length){await ctx.db.patch(user._id,{trackedItems:items});await memoryChanged(ctx,user._id);await refresh();}
 };
 const execute=async(ops:Operation[],text:string,anchor:number,confirmed=false,bypassDuplicate=false,sources:Envelope['sources']=envelope.sources):Promise<void>=>{
  conversationSchema.parse({v:2,ops});
  for(const op of ops)if(!['question','conversation','safety','control','reference','feedback','reminder_control','answer'].includes(op.k))await assertPilotWrite(ctx,user,correctionCapability(op,sources));
  if(pilotEnabled()&&ops.length===1&&correctionTarget(ops[0],sources))confirmed=true;
  for(const op of ops)if(!['question','conversation','safety','control','reference','feedback','reminder_control','answer'].includes(op.k)){if(correctionCapability(op,sources))hasCorrection=true;else correctedOnly=false;}
  const denied=ops.filter(op=>(op.k==='body'||op.k==='cycle')&&(op.s==='negated'||op.s==='hypothetical'||!reportIsAsserted(op.c??op.e??text,op.e??op.q)));
  for(const op of denied)if('l' in op)statements.push(`I haven’t counted “${op.l}” from that message.`);
  ops=ops.filter(op=>!denied.includes(op));
  const reports=ops.filter(op=>op.k==='body'||op.k==='cycle'||op.k==='complete'||op.k==='correct');
  const needsConsent=(!user.conversationConsent||user.pilotFreshConsentPending)&&ops.some(op=>!['question','conversation','safety','profile','feedback','reminder_control'].includes(op.k));
  if(needsConsent){consentDetailsRequested=true;await ctx.db.patch(user._id,{conversationConsentAsked:true,pilotNameAsked:false});statements.push(words.currentConsentQuestion());return;} // No persistent health draft without consent.
  // Clear delegated records do not need another save-confirmation. Controls
  // still use their existing confirmation and safety rules. Missing facts and
  // possible duplicates remain clarification questions below.
  if((directTrackingEnabled()||impliedSavingEnabled())&&user.conversationConsent&&!user.pilotFreshConsentPending&&!ops.some(op=>['control','answer','safety'].includes(op.k)))confirmed=true;
  // Multi-part and unfamiliar reports are repeated back before any counting.
  const priorBody=(await read(ctx,user)).body;
  const labelFor=(op:Report)=>priorBody.find(r=>r.reportedLabel&&normalizeLabel(r.reportedLabel)===normalizeLabel(op.l))?.trackedItem??op.b??normalizeLabel(op.l);
  const unfamiliar=reports.some(op=>op.k==='body'&&(!user.trackedItems.includes(labelFor(op))||(op.b!==null&&op.b!==normalizeLabel(op.l)&&!priorBody.some(r=>r.reportedLabel&&normalizeLabel(r.reportedLabel)===normalizeLabel(op.l)&&r.trackedItem===op.b))));
  if(!confirmed&&(reports.length>1||unfamiliar||reports.some(op=>op.k==='correct'))){
   const mixedOnboarding=pilotEnabled()&&reports.every(op=>(op.k==='body'||op.k==='cycle')&&op.n===null&&op.d===null)&&ops.some(op=>op.k==='item'||op.k==='plan');
   if(mixedOnboarding){
    statements.push('You mentioned '+reports.map(op=>'l' in op?op.l:'').filter(Boolean).join(' and ')+'.');
    for(const op of ops)if(op.k==='item'||op.k==='plan')statements.push((op.k==='item'&&op.category==='food'?'Food instruction: ':'Existing plan: ')+op.q);
    if(ops.some(op=>op.k==='reminder'))statements.push('I’ll check any missing reminder details before setting one.');
   }else statements.push(`You said ${reports.map(repeatDescription).join('; ')}.`);
   await pend('batch',ops,text,anchor,mixedOnboarding?'Shall I keep these details and clarify what’s missing?':words.confirmQuestion);return;
  }
  for(const op of ops){
   await refresh();
   if(op.k==='feedback'){const old=await ctx.db.query('pilotFeedback').withIndex('by_user_message',q=>q.eq('userId',user._id).eq('messageId',args.messageId)).unique();if(!old)await ctx.db.insert('pilotFeedback',{userId:user._id,messageId:args.messageId,usefulness:op.usefulness,wouldUseAgain:op.wouldUseAgain,createdAt:Date.now()});statements.push('Thank you. I’ve saved your feedback about InTune.');continue;}
   // A validated new shopping addition already accounts for its own source.
   // Do not invent a missing saved-item target for that same addition when no
   // owned grocery is named. Retain real updates/corrections and mixed clauses.
   if(op.k==='item_update'&&op.target===null&&op.state==='pending'&&op.replacement===null&&ops.some(other=>other.k==='item'&&other.category==='grocery'&&other.ingredients.length>0&&other.q===op.q)&&!initial.responsibilities.items.some(i=>i.kind==='grocery'&&(op.c??op.q).toLowerCase().includes(i.title.toLowerCase())))continue;
   const item=await applyExperience(ctx,user,op,anchor,turnContext?.quoted?.recordIds??[])??await applyReminder(ctx,user,op,anchor,confirmed)??await applyItem(ctx,user,op,anchor,confirmed,correctionCapability(op,sources),bypassDuplicate);
   if(item){statements.push(item.message);changedIds.push(...(item.changedIds??[]));if(item.question&&item.mode)await pend(item.mode,[op],text,anchor,item.question,'target' in item?item.target??null:'target' in op?op.target:null,'choices' in item?item.choices:undefined);continue;}
   if(op.k==='body'||op.k==='cycle'){
    if(op.s==='unclear'){await pend('detail',[op],op.q,anchor,`Was the ${op.l} something that happened, or a question?`);continue;}
    if(op.s!=='reported'||!reportIsAsserted(op.c??op.e??text,op.e??op.q)){
     statements.push(`I haven’t counted “${op.l}” from that message.`);continue;
    }
    if(op.n===null){await pend('detail',[op],op.q,anchor,`How many ${op.l} did you mean?`);continue;}
    const when=reportWhen(op,anchor,user.timezone);
    if(when.question){await pend('detail',[op],op.q,anchor,op.d||op.t?when.question:`Which day was the ${op.l}?`);continue;}
    if(op.k==='body'){
     const label=labelFor(op);
     await addLabels([label]);
     const result:any=await applyMeaning(ctx,user,op.q,{...emptyMeaning,trackedItem:label,count:op.n,datePhrase:op.d,timePhrase:op.t,precision:op.t?/^(around|about|approximately|~)/i.test(op.t)?'approximate':'exact':op.d==='right now'?'exact':'date-only',explicitNew:op.x},anchor,undefined,bypassDuplicate,!!op.e,op.e);
     if(result.pendingId){
      const pending=await ctx.db.get(result.pendingId as Id<'pending'>);
      if(pending)await ctx.db.patch(pending._id,{proposal:{v:2,mode:result.outcome==='possible_duplicate'?'duplicate':'detail',ops:[op],target:null}});
     }else statements.push(result.message);
     if(result.outcome==='stored')for(const id of result.changedIds??[])await ctx.db.patch(id as Id<'occurrences'>,{reportedLabel:op.l});
     changedIds.push(...(result.changedIds??[]));
     await memoryChanged(ctx,user._id);await refresh();
    }else{
     const prior=await ctx.db.query('cycleEvents').withIndex('by_user_job',q=>q.eq('userId',user._id).eq('jobId',user.jobId)).take(MAX_RECORDS+1);
     if(prior.length>=MAX_RECORDS)throw new Error('Bounded cycle capacity');
     const label=op.l.trim().toLowerCase();
     if(!bypassDuplicate&&!op.x&&(prior.some(r=>r.label===label&&r.occurrenceDate===when.date)||(await read(ctx,user)).body.some(r=>r.trackedItem==='cycle changes'&&r.occurrenceDate===when.date&&r.rawText.toLowerCase().includes(label)))){
      await pend('duplicate',[op],text,anchor,`Was that the same ${label} you mentioned, or a new event?`);continue;
     }
     const id=await ctx.db.insert('cycleEvents',{userId:user._id,jobId:user.jobId,label,dateKind:op.o?'observation':'event',rawText:op.q,occurrenceDate:when.date!,occurrenceTime:when.time,reportedTimePhrase:reportedTimePhrase(op.d,op.t),timePrecision:when.time?op.t&&/^(around|about)/i.test(op.t)?'approximate':'exact':'date-only',messageReceivedAt:anchor});
     changedIds.push(id);statements.push(`Got it, ${label} ${dateLabel(when.date!,user.timezone)}.`);
     await memoryChanged(ctx,user._id);await refresh();
    }
   }else if(op.k==='remember'){
    if(pilotEnabled()&&op.labels.every(l=>/^(?:history|information|details|record|plans|groceries)$/i.test(l.trim()))){if(!ops.some(other=>['experience','body','cycle','item','plan'].includes(other.k)))statements.push('Which detail or plan would you like me to keep?');continue;}
    await addLabels(op.labels);statements.push(`I’ll keep track of ${op.labels.map(normalizeLabel).join(', ')}. Your cycle is separate.`);
   }else if(op.k==='plan'||op.k==='complete'){
    const current=await planView(ctx,user);
    const meaning:Meaning=op.k==='plan'?{...emptyMeaning,intent:'plan_proposal',activity:op.activity,targetNumber:op.n}:{...emptyMeaning,intent:'plan_complete',activity:current.plan?.activity??null,datePhrase:op.d,timePhrase:op.t};
    const result:any=await applyPlanMeaning(ctx,user,op.q,meaning,anchor,undefined,!!op.e,bypassDuplicate,op.e);
    if(!result.pendingId)statements.push(result.message);
    changedIds.push(...(result.changedIds??[]));await refresh();
   }else if(op.k==='reference'){
    const data=await read(ctx,user),record=op.target?[...data.body,...data.cycle,...data.experiences,...data.plan.records,...data.responsibilities.items,...data.responsibilities.events,...data.reminders].find(r=>r._id===op.target):null;
    if(pilotEnabled()&&(await accessFor(ctx,user)).state!=='active'){statements.push(record?'Got it, the same earlier saved update. I haven’t counted it again or added new information.':'Which earlier saved update do you mean? Nothing new was saved.');continue;}
    if(!record){await pend('target',[op],text,anchor,'Which earlier update do you mean?');continue;}
    // No occurrence is created. Existing symptom-reference logic stores only the link.
    if('trackedItem' in record){const result:any=await applyMeaning(ctx,user,op.q,{...emptyMeaning,intent:'reference',trackedItem:record.trackedItem},anchor,record._id);statements.push(result.message);await memoryChanged(ctx,user._id);}
    else statements.push('Got it, the same earlier update. I haven’t counted it again.');
   }else if(op.k==='correct'){
    const data=await read(ctx,user);
    const candidates=[...data.body,...data.cycle,...data.plan.records];
    const target=op.target?candidates.find(r=>r._id===op.target):candidates.length===1?candidates[0]:null;
    if(!target){await pend('target',[op],text,anchor,'Which earlier update should I correct?');continue;}
    if(!op.d&&!op.t&&op.n===null&&op.status===null){await pend('detail',[op],op.q,anchor,'What should I change about that update?',target._id);continue;}
    if('trackedItem' in target){
     const result:any=await applyMeaning(ctx,user,op.q,{...emptyMeaning,intent:'correct',count:op.n,datePhrase:op.d,timePhrase:op.t},anchor,target._id,false,!!op.e,op.e);
     if(result.pendingId)await ctx.db.patch(result.pendingId as Id<'pending'>,{proposal:{v:2,mode:'detail',ops:[{...op,target:target._id}],target:target._id}});
     else statements.push(result.message);
     changedIds.push(...(result.changedIds??[]));await memoryChanged(ctx,user._id);
    }else if('label' in target){
     const resolved=resolveWhen({datePhrase:op.d??target.occurrenceDate,timePhrase:op.t},anchor,user.timezone);
     const when={...resolved,time:op.t?resolved.time:target.occurrenceTime};
     if(when.question){await pend('detail',[op],op.q,anchor,when.question,target._id);continue;}
     for(const reminder of (await readReminders(ctx,user)))if(reminder.cycleId===target._id)await ctx.db.patch(reminder._id,{state:'stopped'});
     if(target.reminderPreference)await ctx.db.patch(target._id,{reminderPreference:{...target.reminderPreference,scheduled:false}});
     await ctx.db.patch(target._id,{occurrenceDate:when.date!,occurrenceTime:when.time,reportedTimePhrase:reportedTimePhrase(op.d,op.t),timePrecision:when.time?(op.t&&/^(around|about)/i.test(op.t)?'approximate':'exact'):'date-only',correctionText:op.q});
     statements.push(`Corrected, ${target.label} ${dateLabel(when.date!,user.timezone)}.`);changedIds.push(target._id);await memoryChanged(ctx,user._id);
    }else{
     const result:any=await applyPlanMeaning(ctx,user,op.q,{...emptyMeaning,intent:'plan_correct',datePhrase:op.d,timePhrase:op.t,completionStatus:op.status},anchor,target._id,!!op.e);
     if(!result.pendingId)statements.push(result.message);changedIds.push(...(result.changedIds??[]));
    }
   }else if(op.k==='answer'){
    const data=await read(ctx,user),all=[...data.pending,...data.plan.pending];
    const selectedQuestion=quotedAsked??initialAsked;
    const target=op.target?all.find(p=>p._id===op.target):pilotEnabled()&&selectedQuestion?all.find(p=>p._id===selectedQuestion):all.length===1?all[0]:null;
    if(!target){statements.push(all.length?'I haven’t applied that answer. There’s more than one update it could belong to.':'There isn’t an earlier question waiting for that answer.');continue;}
    if((turnContext?.hasReplyDeliveryEvidence||all.length>1||pilotEnabled()&&/^(?:yes|yes please|yep|yeah|ok|okay|confirm|haan|no|nah|nahi)[.!]?$/i.test((op.e??op.q).trim()))&&['confirm','discard','same','new'].includes(op.choice)&&target._id!==initialAsked&&target._id!==quotedAsked){statements.push('I haven’t applied that to another question. Please answer the question I just asked first.');continue;}
    if('memoryVersion' in target){
     const result:any=await resolvePlan(ctx,{token:args.token,pendingId:target._id,choice:op.choice==='discard'?'discard':op.choice==='same'?'same':op.choice==='new'?'new':'confirm',...(op.d?{datePhrase:op.d}:{}),...(op.t?{timePhrase:op.t}:{}),...(op.n?{meaning:{...target.proposal,targetNumber:op.n},answerText:op.e??op.q}:{})},receipt.messageReceivedAt??receipt._creationTime);
     statements.push(result.message);changedIds.push(...(result.changedIds??[]));continue;
    }
    const proposal=target.proposal;
    if(proposal?.mode==='grocery_state'){if(op.choice==='discard'){await ctx.db.delete(target._id);await memoryChanged(ctx,user._id);}else attentionId=target._id;continue;}
    if(['reminder_offer','reminder_lead'].includes(proposal?.mode)||proposal?.mode?.startsWith('cycle_reminder_')){statements.push(target.reason);continue;}
    if(proposal?.v!==2){
     if(proposal?.intent==='tracking_setup'){
      if(op.choice==='discard'){await ctx.db.delete(target._id);await memoryChanged(ctx,user._id);statements.push(words.discardReply);continue;}
      if(op.choice!=='confirm'){statements.push(target.reason);continue;}
      await saveChoices(ctx,user,proposal.items);await refresh();
      const result:any=proposal.updates.length?await applyNaturalUpdates(ctx,user,target.rawText,proposal.updates,target.messageReceivedAt):{message:copy.trackedItemsSavedReply({items:user.trackedItems}),changedIds:[]};
      await ctx.db.delete(target._id);await memoryChanged(ctx,user._id);statements.push(result.message);changedIds.push(...(result.changedIds??[]));continue;
     }
     const result:any=await resolveSymptom(ctx,{token:args.token,pendingId:target._id,choice:op.choice==='discard'?'discard':op.choice==='same'?'same':op.choice==='new'?'new':'clarify',answerText:op.e??op.q,...(op.d?{datePhrase:op.d}:{}),...(op.t?{timePhrase:op.t}:{}),...(op.n?{count:op.n}:{})},receipt.messageReceivedAt??receipt._creationTime);
     // Removing an unresolved question also invalidates older snapshots.
     await memoryChanged(ctx,user._id);statements.push(result.message);changedIds.push(...(result.changedIds??[]));continue;
    }
    if(op.choice!=='discard'&&proposal.stamps){
     let stale=false;for(const [id,stamp] of Object.entries(proposal.stamps))if(await fingerprint(data,id)!==stamp)stale=true;
     if(stale){await ctx.db.delete(target._id);await memoryChanged(ctx,user._id);statements.push('That record changed since I asked. Please tell me the correction again.');continue;}
    }
    if(proposal.mode==='item_identity'&&['confirm','same'].includes(op.choice)){
     await ctx.db.delete(target._id);await memoryChanged(ctx,user._id);statements.push('Kept the existing instruction. I haven’t added another copy.');continue;
    }
    if(op.choice==='discard'){
     await ctx.db.delete(target._id);await memoryChanged(ctx,user._id);statements.push(words.discardReply);continue;
    }
    if(op.choice==='same'&&proposal.mode==='duplicate'){
     await ctx.db.delete(target._id);await memoryChanged(ctx,user._id);statements.push(copy.tracking_Got_it_the_same_episode_I_haven);continue;
    }
    let next:Operation[]=proposal.ops;
    const ordinal=proposal.mode==='target'&&proposal.choices?.length?ordinalSelection(op.q):null;
    const selected=ordinal?proposal.choices[ordinal-1]:undefined;
    if(ordinal&&!selected){attentionId=target._id;statements.push('That option is not in the list.');continue;}
    if(selected){if(target._id!==initialAsked&&target._id!==quotedAsked){statements.push('Please ask for those choices again before choosing.');continue;}next=next.map(item=>['item_complete','experience'].includes(item.k)?{...item,target:selected.id}:item);}
    if(proposal.mode==='consent'){ // Legacy pre-consent draft: erase, do not replay into memory.
     await ctx.db.delete(target._id);await memoryChanged(ctx,user._id);statements.push(words.currentConsentQuestion());continue;
    }else if(['consent','batch','control'].includes(proposal.mode)&&op.choice!=='confirm'){statements.push('I haven’t counted that yet.');continue;}
    if(proposal.mode==='detail'||proposal.mode==='target'){
     next=next.map(item=>{
      if(item.k==='body'||item.k==='cycle')return {...item,q:item.q+'\n'+op.q,...(item.e||op.e?{e:(item.e??item.q)+'\n'+(op.e??op.q),c:(item.c??item.q)+'\n'+(op.c??op.q)}:{}),d:op.d??item.d,t:op.t??item.t,n:op.n??item.n};
      if(item.k==='reminder')return {...item,d:op.d??item.d,t:op.t??item.t,q:item.q+'\n'+op.q};
      if(item.k==='plan')return {...item,n:op.n??item.n,q:item.q+'\n'+op.q};
      if(item.k==='item_complete'||item.k==='item_correct')return {...item,d:op.d??item.d,q:item.q+'\n'+op.q};
      if(item.k==='correct')return {...item,q:item.q+'\n'+op.q,...(item.e||op.e?{e:(item.e??item.q)+'\n'+(op.e??op.q),c:(item.c??item.q)+'\n'+(op.c??op.q)}:{}),target:proposal.target??item.target,d:op.d??item.d,t:op.t??item.t,n:op.n??item.n};
      if(item.k==='complete')return {...item,q:item.q+'\n'+op.q,...(item.e||op.e?{e:(item.e??item.q)+'\n'+(op.e??op.q),c:(item.c??item.q)+'\n'+(op.c??op.q)}:{}),d:op.d??item.d,t:op.t??item.t};
      return item;
     });
    }
    if(proposal.mode==='duplicate'&&op.choice!=='new'){statements.push('I haven’t counted that again.');continue;}
    await ctx.db.delete(target._id);await memoryChanged(ctx,user._id);await refresh();
    await execute(next,target.rawText+'\n'+op.q,target.messageReceivedAt,true,['duplicate','item_identity'].includes(proposal.mode)&&op.choice==='new',proposal.sources?.map((s:any)=>({...s,q:next.find((i:any)=>i.q===s.q||i.q.startsWith(s.q+'\n'))?.q??s.q})));
   }else if(op.k==='question'){
    if(op.scope==='medical')statements.push(words.medicalBoundary);
    else if(op.scope==='privacy')statements.push(words.currentPrivacyReply());
    else if(op.scope==='profile'){statements.push(user.preferredName?`Your preferred name is ${user.preferredName}.`:'I don’t have a preferred name saved yet. What would you like me to call you?');if(!user.preferredName&&!user.safetyKind&&!user.dataDeletedAt&&user.state!=='stopped'&&user.state!=='paused'){await ctx.db.patch(user._id,{pilotNameAsked:true});await memoryChanged(ctx,user._id);await refresh();}}
    else if(op.scope==='capabilities')statements.push(words.currentCapabilities());
    // Record questions are rendered after all writes so they use the corrected truth.
   }else if(op.k==='control'){
    if(op.command==='forget'){
     const data=await read(ctx,user),target=op.target?[...data.body,...data.cycle,...data.experiences,...data.plan.records,...data.responsibilities.items,...data.responsibilities.events,...data.reminders].find(r=>r._id===op.target):null;
     if(!target){await pend('target',[op],text,anchor,'Which update should I forget?');continue;}
     if(!confirmed){await pend('control',[op],text,anchor,`Should I forget “${op.q}”?`,target._id);continue;}
     await purgeConversationLog(ctx,user);
     if('reportedAt' in target){await clearConversationContext(ctx,user);await ctx.db.delete(target._id);await memoryChanged(ctx,user._id);}else if('createdAt' in target||'label' in target)await forgetPilotRecord(ctx,user,target);
     else if('trackedItem' in target)await ctx.runMutation(api.tracking.forget,{token:args.token,occurrenceId:target._id});
     else{
      const pending=await ctx.db.query('pending').withIndex('by_user',q=>q.eq('userId',user._id)).take(50);
      for(const p of pending)if(p.rawText.includes(target.rawText)||p.proposal?.target===target._id||(p.proposal?.ops??[]).some((i:any)=>i.target===target._id))await ctx.db.delete(p._id);
      await ctx.db.delete(target._id);await memoryChanged(ctx,user._id);
     }
     statements.push(copy.tracking_Forgotten_that_episode_and_its_linked_notes);controlReply=copy.tracking_Forgotten_that_episode_and_its_linked_notes;
    }else{
     if(!confirmed){await pend('control',[op],text,anchor,op.command==='delete'?'Should I delete your stored health records?':`Should I ${op.command} this job?`);continue;}
     const result:any=await ctx.runMutation(internal.commands.execute,{token:args.token,messageId:args.messageId,command:op.command});controlReply=result.message;statements.push(result.message);
    }
   }else if(op.k==='conversation'){
    if(op.tone==='begin')statements.push(words.currentConsentQuestion());else if(op.tone==='context')contextAcknowledged=true;else if(op.tone==='unclear')conversationUnclear=true;else statements.push(op.tone==='greeting'?copy.returningGreetingReply:op.tone==='thanks'?'You’re welcome 🙂':copy.farewellReply);
   }
  }
 };
 // A control has priority over ordinary updates; never execute both from one message.
 const controls=envelope.ops.filter(op=>op.k==='control');
 if(controls.length>1)throw new Error('Conflicting controls');
 for(const op of envelope.ops)if(op.k==='question'&&op.scope==='medical')statements.push(words.medicalBoundary);
 for(const op of envelope.ops)if(op.k==='reference'&&op.target)for(const p of initial.pending)if(p.proposal?.v===2&&p.proposal.mode==='target'&&p.proposal.ops.every((i:any)=>i.k==='reference')&&(p._id===user.conversationQuestionId||initial.pending.length===1)){await ctx.db.delete(p._id);await memoryChanged(ctx,user._id);await refresh();}
 await execute(controls.length?controls:envelope.ops,args.text,receipt.messageReceivedAt??receipt._creationTime);
 const afterExecution=await readItems(ctx,user);
 for(const p of initial.pending)if(p._id===user.conversationQuestionId&&p.proposal?.mode==='target'&&(p.proposal.ops??[]).some((op:any)=>op.k==='item_complete'&&!op.target)&&envelope.ops.some(op=>op.k==='item_complete'&&op.target&&afterExecution.events.some(e=>changedIds.includes(e._id)&&e.itemId===op.target))&&await ctx.db.get(p._id)){await ctx.db.delete(p._id);await memoryChanged(ctx,user._id);}
 // A resolved owned stock question must not keep interrupting later turns.
 for(const p of initial.pending)if(p.proposal?.mode==='grocery_state'&&changedIds.includes(p.proposal.target)&&await ctx.db.get(p._id)){await ctx.db.delete(p._id);await memoryChanged(ctx,user._id);}
 const groceryUnclear=envelope.sources?.flatMap(s=>(s.grocery??[]).filter(g=>g.state==='unclear').map(g=>({g,q:s.q})))??[];
 if(!controls.length&&groceryUnclear.length&&user.conversationConsent&&(await accessFor(ctx,user)).state==='active'){
  const first=groceryUnclear[0],item=initial.responsibilities.items.find(i=>i.kind==='grocery'&&i.title===first.g.item);
  if(item){const existing=initial.pending.find(p=>p.proposal?.mode==='grocery_state'&&p.proposal.target===item._id);if(existing)attentionId=existing._id;else await pend('grocery_state',[{k:'question',q:first.q,scope:'grocery',l:null}],first.q,receipt.messageReceivedAt??receipt._creationTime,`For ${item.title}, do you need to buy it, already have it, or have an order on the way?`,item._id);}
 }
 // A clear correction supersedes older correction questions about the same record.
 for(const p of initial.pending)if(p.proposal?.ops?.length&&p.proposal.ops.every((op:any)=>['correct','item_correct','item_update'].includes(op.k)&&changedIds.includes(op.target))&&await ctx.db.get(p._id)){await ctx.db.delete(p._id);await memoryChanged(ctx,user._id);}
 await refresh();
 const savedItems=(await readItems(ctx,user)).items.filter(item=>changedIds.includes(item._id)&&!initial.responsibilities.items.some(old=>old._id===item._id));
 await offerScheduleReminders(ctx,user,savedItems);await refresh();
 await offerCycleGap(ctx,user,(await read(ctx,user)).cycle.filter(event=>changedIds.includes(event._id)&&!initial.cycle.some(old=>old._id===event._id)));await refresh();
 const data=await read(ctx,user);
 for(const p of data.plan.pending)if(!initial.plan.pending.some(old=>old._id===p._id)&&p.memoryVersion!==(user.memoryVersion??0))await ctx.db.patch(p._id,{memoryVersion:user.memoryVersion??0});
 const recordQuestions=envelope.ops.filter(op=>op.k==='question'&&['week','history','body','cycle','plan','all','food','grocery','schedule','doctor_question','appointment','task'].includes(op.scope));
 // A confirmed batch can carry a retrieval question across turns.
 const answeredOps=envelope.ops.filter(op=>op.k==='answer').flatMap(op=>{
  const p=initial.pending.find(p=>p._id===op.target)||(op.target===null?initial.pending.find(p=>p._id===user.conversationQuestionId)??(initial.pending.length===1?initial.pending[0]:undefined):undefined);return p?.proposal?.mode==='grocery_state'?[]:op.choice==='confirm'||op.choice==='detail'?(p?.proposal?.ops??[]):[];
 });
 const allRecordQuestions=[...recordQuestions,...answeredOps.filter((i:any)=>i.k==='question'&&['week','history','body','cycle','plan','all','food','grocery','schedule','doctor_question','appointment','task'].includes(i.scope))];
 if(changedIds.length&&allRecordQuestions.some((op:any)=>op.scope==='week')){
  statements.length=0;statements.push('Got it. Here’s your updated record:');
  for(const op of [...envelope.ops,...answeredOps])if(op.k==='question'&&op.scope==='medical')statements.push(words.medicalBoundary);
 }
 const foodDraft=data.pending.some(p=>(p.proposal?.ops??[]).some((op:any)=>op.k==='item'&&op.category==='food'));
 const groceryDraft=data.pending.some(p=>(p.proposal?.ops??[]).some((op:any)=>op.k==='item'&&op.category==='grocery'&&op.ingredients?.length));
 const groceryChanged=changedIds.some(id=>data.responsibilities.items.some(i=>i._id===id&&i.kind==='grocery'))&&[...envelope.ops,...answeredOps].some(op=>op.k==='item_update'||op.k==='item'&&['grocery','task'].includes(op.category));
 const groceryMentioned=envelope.sources?.some(s=>s.grocery?.length);
 if(groceryChanged)statements.push(groceryReply(data.responsibilities.items,!groceryUnclear.length&&!groceryDraft));
 else if(groceryMentioned&&!groceryDraft&&!controls.length&&!allRecordQuestions.some(op=>op.k==='question'&&op.scope==='grocery')){statements.push('I haven’t changed your grocery list.');statements.push(groceryReply(data.responsibilities.items,!groceryUnclear.length&&!groceryDraft));}

 for(const op of allRecordQuestions)if(op.k==='question'&&!(op.scope==='grocery'&&(foodDraft||groceryChanged)))statements.push(summaryReply(data,user,op.scope,op.l));
 const allPending=[...data.pending,...data.plan.pending];
 const newPlan=data.plan.pending.filter(p=>!initial.plan.pending.some(old=>old._id===p._id)).at(-1);
 const relatedScopes=[...recordQuestions.map((op:any)=>op.scope),...answeredOps.filter((op:any)=>op.k==='item').map((op:any)=>op.category)];
 const related=pilotEnabled()?relatedScopes.flatMap(scope=>allPending.filter(p=>questionMatchesScope(p,scope))).at(-1):undefined;
 const replyingToAsked=envelope.ops.some(op=>op.k==='answer'&&(op.target===user.conversationQuestionId||op.target===null&&!!user.conversationQuestionId))||conversationUnclear;
 const newQuestion=allPending.filter(p=>!initial.pending.some(old=>old._id===p._id)&&!initial.plan.pending.some(old=>old._id===p._id)).at(-1);
 const asked=attentionId??newPlan?._id??(pilotEnabled()?newQuestion?._id??related?._id??(replyingToAsked&&allPending.some(p=>p._id===user.conversationQuestionId)?user.conversationQuestionId:undefined):(allPending.some(p=>p._id===user.conversationQuestionId)?user.conversationQuestionId:allPending[0]?._id));
 const askedRecord=allPending.find(p=>p._id===asked);
 const shoppingNames=(askedRecord?.proposal?.mode==='batch'?(askedRecord.proposal.ops??[]):[]).flatMap((op:any)=>op.k==='item'&&op.category==='grocery'?op.ingredients??[]:[]);
 // Also make pre-fix stored questions specific when they return to attention.
 const askedQuestion=shoppingNames.length?`Shall I add ${[...new Set(shoppingNames)].join(', ')} to your shopping list?`:askedRecord?.reason;
 if(user.conversationQuestionId!==asked){await ctx.db.patch(user._id,{conversationQuestionId:asked});if(pilotEnabled())await memoryChanged(ctx,user._id);await refresh();}
 if(contextAcknowledged&&!statements.length&&!data.pending.length&&!data.plan.pending.length)statements.push(pilotEnabled()?words.currentConsentQuestion():'I haven’t added a new occurrence from that.');
 const trackingFollowup=directTrackingEnabled()&&(!user.conversationConsent||user.pilotFreshConsentPending)&&user.conversationConsentAsked&&!askedRecord&&(conversationUnclear||!statements.some(Boolean));
 if(trackingFollowup)await ctx.db.patch(user._id,{conversationConsentAsked:true});
 await ctx.db.patch(receipt._id,{state:'complete',replyEntry:(!user.conversationConsent||user.pilotFreshConsentPending)&&(trackingFollowup||statements.some(s=>s.includes(words.currentConsentQuestion())))?(directTrackingEnabled()?'conversation_tracking_invite':consentDetailsRequested?'conversation_consent_details_question':'conversation_consent_question'):'conversation_v2',repliedAt:Date.now()});
 const readOnly=envelope.ops.some(op=>op.k==='question'||op.k==='reference')&&envelope.ops.every(op=>['question','reference','conversation'].includes(op.k))&&changedIds.length===0;
 if(pilotEnabled()&&allRecordQuestions.some((op:any)=>op.scope==='week')&&await ctx.runMutation(makeFunctionReference<'mutation'>('pilotSummary:offer'),{token:args.token,messageId:args.messageId,version:user.memoryVersion??0}))statements.push('You can correct an existing record, or say “go ahead” to approve this summary as accurate.');
 const result={outcome:'conversation',readOnly,message:controlReply??words.compose(statements,askedQuestion??(conversationUnclear||!statements.some(Boolean)?words.currentUnclearQuestion():undefined)),correctionOnly:hasCorrection&&correctedOnly,controlOnly:controlReply!==null||controls.length>0||answeredOps.some((op:any)=>op.k==='control'),changedIds,version:user.memoryVersion??0};
 await saveReply(ctx,user,args.messageId,result);return result;
}});

// Server-owned allowlist plus a separate kill switch; callers cannot enable themselves.
export const enabled=internalQuery({args:{token:v.string()},returns:v.boolean(),handler:async(ctx,args)=>{
 if(process.env.INTUNE_CONVERSATION_GATE!=='candidate')return false;
 return (await userFor(ctx,args.token)).conversationEnabled===true;
}});
export const consentGate=internalMutation({args:{token:v.string(),messageId:v.string(),text:v.string(),askOnly:v.optional(v.boolean())},returns:v.any(),handler:async(ctx,args)=>{
 const user=await userFor(ctx,args.token);
 if(impliedSavingEnabled()&&!user.storageWithdrawn)return null;
 if(user.storageWithdrawn)return {outcome:'privacy',controlOnly:true,message:'Saving is off. You can still ask for your saved records. Send Save again to turn saving back on.'};
 if(user.conversationConsent&&!user.pilotFreshConsentPending)return null;
 if(user.state==='stopped'||user.dataDeletedAt)return {outcome:'stopped',message:copy.stoppedReply};
 const receipt=await ctx.db.query('receipts').withIndex('by_user_message',q=>q.eq('userId',user._id).eq('messageId',args.messageId)).unique();
 if(args.askOnly){await ctx.db.patch(user._id,{conversationConsentAsked:true});if(receipt)await ctx.db.patch(receipt._id,{state:'complete',replyEntry:directTrackingEnabled()?'conversation_tracking_invite':'conversation_consent_question',repliedAt:Date.now()});return {outcome:'consent_pending',message:words.currentConsentQuestion()};}
 if(receipt?.state==='complete')return {outcome:'provider_duplicate',message:copy.messages_I_already_received_this_message_I_haven};
 // Only a standalone answer to this consent question grants storage. Mixed updates never grant it.
 const yes=['yes','yes please','yep','yeah','okay','ok','confirm','haan'].includes(args.text.trim().toLowerCase().replace(/[.!]$/,''));
 const last=await ctx.db.query('receipts').withIndex('by_user_state',q=>q.eq('userId',user._id).eq('state','complete')).order('desc').first();
 const grants=user.conversationConsentAsked&&['conversation_consent_question','conversation_consent_details_question','conversation_tracking_invite','pilot_social_tracking_invite'].includes(last?.replyEntry??'')&&yes;
 if(grants){await ctx.db.patch(user._id,{conversationConsent:true,pilotFreshConsentPending:undefined,conversationConsentAsked:undefined,pilotNameAsked:false});await memoryChanged(ctx,user._id);}
 // The apply transaction marks consent as asked only when that question is actually shown.
 if(grants){if(receipt)await ctx.db.patch(receipt._id,{state:'complete',replyEntry:'conversation_consent',repliedAt:Date.now()});return {outcome:'consent',message:last?.replyEntry==='conversation_consent_details_question'?words.consentDetailsAccepted:words.currentConsentAccepted()};}
 return {outcome:'consent_pending',message:words.currentConsentQuestion()};
}});
export const history=internalQuery({args:{token:v.string()},returns:v.any(),handler:async(ctx,args)=>{
 const user=await userFor(ctx,args.token);return {message:summaryReply(await read(ctx,user),user,'history'),version:user.memoryVersion??0};
}});

export const route=internalQuery({args:{token:v.string()},returns:v.union(v.literal('v1'),v.literal('candidate'),v.literal('hold')),handler:async(ctx,args)=>{
 const user=await userFor(ctx,args.token);return user.conversationEnabled?process.env.INTUNE_CONVERSATION_GATE==='candidate'?'candidate':'hold':'v1';
}});
export const enroll=internalMutation({args:{token:v.string()},returns:v.null(),handler:async(ctx,args)=>{
 if(process.env.INTUNE_CONVERSATION_GATE!=='candidate')throw new Error('Candidate enrollment is disabled');
 const user=await userFor(ctx,args.token);if(user.dataDeletedAt)throw new Error('Deleted user cannot be enrolled');
 await ctx.db.patch(user._id,{conversationEnabled:true});await memoryChanged(ctx,user._id);return null;
}});
