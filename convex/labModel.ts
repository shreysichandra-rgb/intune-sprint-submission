import {checkinPermission,explicitCheckin,validateCheckinTasks} from './progressCheckins';
import {z} from 'zod';
import {foodReportDateSource} from './v4FoodDate';
import {localDate,resolveTime} from './rules';
import {resolveLabDate as resolveDate} from './labTime';
import {reminderDue,nextDue} from './pilotReminderRules';
const nullableText=z.string().max(2000).nullable();
export const labResponse=z.object({onboarding:z.object({introduced:z.boolean()}).strict(),reply:z.string().min(1).max(3000),clarification:nullableText,actions:z.array(z.object({type:z.enum(['save','correct','complete','remove','profile','reminder','control','retrieve']),useSourceText:z.boolean().nullable(),sourceMessageId:z.string(),evidence:z.string().min(1),targetId:nullableText,tempId:nullableText,kind:z.enum(['history','experience','event','plan','food','meal_choice','grocery','schedule','appointment','question','task']).nullable(),label:nullableText,text:nullableText,datePhrase:nullableText,timePhrase:nullableText,dateSourceRecordId:nullableText.optional(),timeSourceMessageId:nullableText.optional(),targetNumber:z.number().nullable(),state:nullableText,parentId:nullableText,permissionEvidence:nullableText,repeat:z.enum(['once','daily','weekly']).nullable()}).strict()).max(30),open_tasks:z.array(z.object({id:z.string(),sourceMessageId:z.string(),targetId:nullableText,topic:z.string(),question:nullableText}).strict()).max(30),safety:z.object({intent:z.enum(['none','emergency','return']),sourceMessageId:nullableText,evidence:nullableText,reason:nullableText}).strict()}).strict();
/** Strict provider schema: every nullable property must still be required on the wire.
 * Backend labResponse retains optional contextual fields for older owned proposals. */
export const labWireResponse=labResponse.extend({actions:z.array(labResponse.shape.actions.element.extend({dateSourceRecordId:nullableText,timeSourceMessageId:nullableText})).max(30)});
export type LabRecord={id:string;kind:string;label:string;text:string;date:string|null;time:string|null;targetNumber:number|null;state:string;parentId:string|null;sourceMessageId:string;evidence:string;reportedAt:number};
export type LabState={firstTaskStarted?:boolean;onboardingIntroduced?:boolean;profile:{name:string|null;timezone:string};access:{mode:string;startedAt:number|null;endsAt:number|null;source?:string|null;welcomeState?:string|null};control:{tracking:string;storage:boolean;safetyPaused:boolean;safetyAsked:boolean};records:LabRecord[];tasks:any[];reminders:any[]};
export type Source={messageId:string;text:string;role:string;at:number;canSave?:boolean;confirmedCalendarYear?:string;eventDateContext?:{sourceMessageId:string;datePhrase:string}};
export function freshLabState(now:number):LabState{return {onboardingIntroduced:false,profile:{name:null,timezone:'Asia/Kolkata'},access:{mode:'active_test',startedAt:now,endsAt:now+604800000},control:{tracking:'active',storage:true,safetyPaused:false,safetyAsked:false},records:[],tasks:[],reminders:[]};}
export function activeLab(s:LabState,now:number){return ['active_paid','active_test'].includes(s.access.mode)&&s.access.startedAt!==null&&s.access.startedAt<=now&&s.access.endsAt!==null&&now<s.access.endsAt;}
export function labSummaryWindow(s:LabState){const startDate=s.access.startedAt!==null?localDate(s.access.startedAt,'Asia/Kolkata'):null,endDate=s.access.endsAt!==null?localDate(s.access.endsAt,'Asia/Kolkata'):null;return {progress:s.records.filter(r=>r.kind==='plan'||r.kind==='schedule'&&r.targetNumber!==null).map(p=>({id:p.id,label:p.label,target:p.targetNumber,completed:s.records.filter(r=>r.parentId===p.id&&r.state==='completed'&&r.date&&startDate&&endDate&&r.date>=startDate&&r.date<=endDate).length,skipped:s.records.filter(r=>r.parentId===p.id&&r.state==='skipped'&&r.date&&startDate&&endDate&&r.date>=startDate&&r.date<=endDate).length})),startDate,endDate,startedAt:s.access.startedAt,endsAt:s.access.endsAt,datedRecords:s.records.filter(r=>r.date&&startDate&&endDate&&r.date>=startDate&&r.date<=endDate).map(r=>r.id),outsidePeriod:s.records.filter(r=>r.date&&startDate&&(r.date<startDate||endDate&&r.date>endDate)).map(r=>r.id),boundaryDayPrecision:'Date-only records on the start/end day have no clock time. Do not invent exact within-hour eligibility.'};}
export function labFailureReply(error:string){if(error.startsWith('Your seven days have ended.'))return error;const stamp=error.match(/separate lab AI budget.*after (\d{4}-\d\d-\d\dT[\d:.]+Z)/s)?.[1];if(stamp){const at=new Intl.DateTimeFormat('en-IN',{timeZone:'Asia/Kolkata',dateStyle:'medium',timeStyle:'short'}).format(new Date(stamp));return `The test AI allowance is temporarily full. Try again after ${at}, India time. Nothing new was saved. Your earlier records and unfinished questions are still here.`;}return 'I couldn’t keep that update just now. Nothing new was saved. Your earlier records and unfinished questions are still here.';}
export function displayLabReply(reply:string){return reply.replace(/[—–]/g,(dash,offset)=>{const before=reply.slice(0,offset).trimEnd(),after=reply.slice(offset+1).trimStart();return /\d$/.test(before)&&/^\d/.test(after)?dash:', ';}).replace(/\s+,/g,',').replace(/, +/g,', ');}
/** Reuse owned schedule facts, never fabricate spans in a short reply. */
export function reminderFieldSources(a:any,state:LabState,sources:Source[]){
 const current=sources.find(s=>s.messageId===a.sourceMessageId&&s.role==='user');if(!current)throw Error('Reminder source unavailable');
 const target=state.records.find(r=>r.id===a.targetId),pending=state.tasks.find(t=>t.targetId===a.targetId&&(t.id.startsWith('reminder-pending:')||/reminder/i.test(t.topic??'')));
 const checkin=checkinPermission(state,sources,a.targetId,current.messageId);
 const purpose=checkin?.source??(current.canSave!==false&&/(remind|nudge|check[ -]?in)/i.test(current.text)?current:pending?sources.find(s=>s.messageId===pending.sourceMessageId&&s.role==='user'&&s.canSave!==false&&/(remind|nudge|check[ -]?in)/i.test(s.text)):null);
 if(a.dateSourceRecordId){const savedTaskDate=target?.kind==='task'&&!!pending&&!!purpose&&target.date===a.datePhrase&&/^\d{4}-\d{2}-\d{2}$/.test(target.date??'');const weeklySchedule=!!target&&['plan','schedule'].includes(target.kind)&&!!a.datePhrase&&target.text.toLowerCase().includes(a.datePhrase.toLowerCase())&&/^(monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/i.test(a.datePhrase)&&!!purpose;if(!target||target.id!==a.dateSourceRecordId||!savedTaskDate&&!weeklySchedule)throw Error('Reminder days must come from the owned requested schedule');}
 let timeSource=current;
 if(a.timeSourceMessageId){if(!purpose||purpose.messageId!==a.timeSourceMessageId)throw Error('Reminder clock must come from its owned pending request');timeSource=purpose;}
 if(a.timePhrase&&!timeSource.text.toLowerCase().includes(a.timePhrase.toLowerCase()))throw Error('Reminder clock is unsupported by its source');
 const inheritedClock=purpose?.text.match(/\b\d{1,2}:\d{2}(?:\s*(?:am|pm))?\b|\b\d{1,2}\s*(?:am|pm)\b/i)?.[0]??null;
 const time=a.timePhrase??inheritedClock??(pending&&target?.kind==='task'?target.time:null);
 return {current,target,pending,purpose,time,checkin,scheduleGrounded:!!a.dateSourceRecordId&&!!target&&['plan','schedule'].includes(target.kind)};
}
/** Repair an owned reminder setup link only when the request has one clear purpose. */
export function linkReminderTasks(state:LabState,sources:Source[]){
 return state.tasks.map(t=>{
  const request=sources.find(s=>s.messageId===t.sourceMessageId&&s.role==='user'&&s.canSave!==false);
  if(!request||!/remind|nudge|check[ -]?in/i.test(request.text)||!/reminder/i.test(t.topic??'')||!t.question)return t;
  const targets=t.targetId?state.records.filter(r=>r.id===t.targetId):state.records.filter(r=>r.kind==='task'&&r.sourceMessageId===request.messageId);
  if(targets.length!==1)return t;
  return {...t,targetId:targets[0].id,id:t.id.startsWith('reminder-pending:')?t.id:'reminder-pending:'+t.id};
 });
}
/** Daily opt-in supplies recurrence, not a fabricated user date. */
export function requestedReminderDue(a:any,fields:ReturnType<typeof reminderFieldSources>,source:Source){
 const daily=a.repeat==='daily'&&/daily|every day|each day/i.test(source.text+' '+(fields.purpose?.text??''));
 const clock=a.timePhrase??fields.time??null;
 let due=reminderDue(a.datePhrase??(daily?'today':null),clock,source.at,'Asia/Kolkata',a.repeat??'once');
 if(daily&&!a.datePhrase&&!due.dueAt&&due.time)due=reminderDue('tomorrow',clock,source.at,'Asia/Kolkata','daily');
 return due;
}
export function applyLabResponse(original:LabState,value:unknown,sources:Source[],now:number,messageId:string){
 const response=labResponse.parse(value),s:LabState=structuredClone(original),outcomes:any[]=[],ids=new Map<string,string>();
 if(response.onboarding.introduced&&!original.onboardingIntroduced&&!/\bInTune\b/i.test(response.reply))throw Error('The introduction was not included in the reply.');
 s.onboardingIntroduced=original.onboardingIntroduced===true||response.onboarding.introduced;
 const source=(id:string,evidence:string)=>{const m=sources.find(m=>m.messageId===id&&m.role==='user');if(!m||!m.text.toLowerCase().includes(evidence.toLowerCase()))throw Error('An action has no supporting owned user message.');return m;};
 const owned=(id:string|null)=>{const r=s.records.find(r=>r.id===(ids.get(id??'')??id));if(!r)throw Error('The intended saved record is unavailable for this test user.');return r;};
 const ground=(m:Source,v:string|null)=>{if(v&&!m.text.toLowerCase().includes(v.toLowerCase()))throw Error('An action contains unsupported text.');};
 if(response.clarification&&!response.reply.toLowerCase().includes(response.clarification.toLowerCase()))throw Error('The pending question was not included in the proposed reply.');
 if(response.safety.intent!=='none'){
  const m=source(response.safety.sourceMessageId??'',response.safety.evidence??'');
  if(response.safety.intent==='emergency'){
   if(!response.safety.reason?.trim())throw Error('Emergency intent has no explanation.');
   if(response.actions.some(a=>!['retrieve','control','remove'].includes(a.type)))throw Error('Health saves cannot accompany an emergency pause.');
   s.control.safetyPaused=true;s.control.safetyAsked=false;outcomes.push({type:'safety',status:'paused',evidence:response.safety.evidence});
  }else{
   if(!s.control.safetyPaused||!s.control.safetyAsked||m.messageId!==messageId)throw Error('An explicit answer to the safety return question is required.');
   if(response.actions.some(a=>!['retrieve','control','remove'].includes(a.type)))throw Error('Returning cannot replay paused health details.');
   s.control.safetyPaused=false;s.control.safetyAsked=false;outcomes.push({type:'safety',status:'resumed'});
  }
 }
 for(const a of response.actions){
  if(a.type!=='reminder'&&(a.dateSourceRecordId||a.timeSourceMessageId))throw Error('Contextual sources are only permitted for reminders');
  const m=source(a.sourceMessageId,a.evidence);
  if(['correct','reminder'].includes(a.type)&&a.state==='cancelled'&&s.records.some(r=>r.id===a.targetId)){const linked=s.reminders.filter(r=>r.targetId===a.targetId&&r.state!=='cancelled');if(linked.length===1)a.targetId=linked[0].id;}
  if(a.useSourceText===true&&(a.type!=='save'||a.kind!=='food'||a.text!==null))throw Error('Whole source text can only retain a new food plan with text unset.');
  if(['save','correct','complete','profile','reminder'].includes(a.type)&&/\b(?:don['’]?t|do not|never)\s+(?:save|keep|store|remember)\b/i.test(m.text))throw Error('The user explicitly declined saving this information.');
  if(a.type==='retrieve'){if(a.targetId&&!s.reminders.some(r=>r.id===a.targetId))owned(a.targetId);outcomes.push({type:a.type,status:'read',targetId:a.targetId});continue;}
  if(a.type==='profile'){if(!s.control.storage||s.control.tracking==='stopped')throw Error('Profile saving is blocked by storage controls.');ground(m,a.label);if(!a.label?.trim()||a.label.length>80)throw Error('A supplied preferred name is required.');s.profile.name=a.label;outcomes.push({type:a.type,status:'saved'});continue;}
  if(a.type==='control'){
   if(a.state==='delete'&&!/\b(?:delete|forget|erase|remove)\b/i.test(a.evidence)||a.state==='delete'&&/\b(?:don['’]?t|do not|never)\b/i.test(a.evidence))throw Error('Deletion has no explicit supporting request.');
   if(!['pause','resume','stop','start','delete','withdraw'].includes(a.state??''))throw Error('Unknown control change.');
   if(a.state==='delete'){s.records=[];s.tasks=[];s.reminders=[];s.profile.name=null;s.control.storage=false;s.control.tracking='stopped';}
   else if(a.state==='withdraw'){s.control.storage=false;s.reminders.forEach(r=>r.state='cancelled');}
   else s.control.tracking=({pause:'paused',resume:'active',stop:'stopped',start:'active'} as any)[a.state!];
   if(s.control.tracking!=='active')s.reminders.forEach(r=>{if(r.state==='scheduled')r.state='suppressed';});
   outcomes.push({type:a.type,status:a.state});continue;
  }
  if((a.type==='correct'||a.type==='reminder'&&a.state==='cancelled')&&s.reminders.some(r=>r.id===a.targetId)){const reminder=s.reminders.find(r=>r.id===a.targetId)!;if(a.state==='cancelled'){const replacing=/change|replace|switch/i.test(a.evidence)&&response.actions.some(x=>x.type==='reminder'&&x.state!=='cancelled'&&x.targetId===reminder.targetId&&x.repeat==='weekly'&&x.sourceMessageId===a.sourceMessageId);if(!/cancel|stop|no longer|don't|do not|ordered|received/i.test(a.evidence)&&!replacing)throw Error('Reminder cancellation needs an explicit request.');reminder.state='cancelled';}else{if(!activeLab(s,now)||!s.control.storage||s.control.tracking!=='active'||s.control.safetyPaused)throw Error('Reminder changes need active access and tracking.');ground(m,a.datePhrase);ground(m,a.timePhrase);const due=reminderDue(a.datePhrase??localDate(reminder.dueAt,'Asia/Kolkata'),a.timePhrase??reminder.time,m.at,'Asia/Kolkata',a.repeat??reminder.repeat??'once');if(!due.dueAt)throw Error(due.question??'Reminder time is unclear.');reminder.dueAt=due.dueAt;reminder.time=due.time;reminder.repeat=a.repeat??reminder.repeat;reminder.state='scheduled';}outcomes.push({type:a.type,status:'corrected',id:reminder.id});continue;}
  if(a.type==='remove'){const r=owned(a.targetId);s.records=s.records.filter(x=>x.id!==r.id&&x.parentId!==r.id);s.reminders=s.reminders.filter(x=>x.targetId!==r.id);s.tasks=s.tasks.filter(x=>x.targetId!==r.id);outcomes.push({type:a.type,status:'removed',id:r.id});continue;}
  if(!s.control.storage||s.control.tracking==='stopped'||s.control.safetyPaused)throw Error('Tracking is blocked by the current storage or safety controls. No health changes were applied.');
  if(a.type!=='correct'&&!activeLab(s,now))throw Error('New health information and reminders need active test access. Existing records can still be read, corrected or deleted.');
  if(a.type!=='correct'&&m.canSave===false)throw Error('This earlier message was blocked when received; it cannot be replayed into health memory.');
  if(a.type==='reminder'){
   const r=owned(a.targetId),permission=a.permissionEvidence??'',fields=reminderFieldSources(a,original,sources);ground(m,permission);
   const progressCheckIn=a.state==='checkin'||!!fields.checkin;
   if(progressCheckIn&&(!fields.checkin||!['plan','schedule'].includes(r.kind)))throw Error('A session check-in needs explicit purpose permission and an owned activity plan.');
   const contextualPurpose=(original.reminders.some(old=>old.targetId===r.id&&/(remind|nudge|check[ -]?in)/i.test(old.permission??'')&&m.text.toLowerCase().includes(r.label.toLowerCase()))||!!fields.purpose)&&(a.timePhrase!==null||a.datePhrase!==null);
   if(!permission||!/(remind|nudge|check[ -]?in|send.*summary|send.*recap)/i.test(permission)&&!contextualPurpose)throw Error('A reminder needs an explicit request, not a timing preference.');
   if(!a.dateSourceRecordId)ground(m,a.datePhrase);if(!a.timeSourceMessageId)ground(m,a.timePhrase);
   const pendingPurpose=!!fields.purpose;
   const recurrenceText=m.text+' '+(fields.purpose?.text??'');
   const due=requestedReminderDue(a,fields,m);if(!due.dueAt)throw Error(due.question??'Reminder time is unclear.');
   if(progressCheckIn&&r.time&&due.time&&resolveTime(r.time)&&due.time<=resolveTime(r.time)!)throw Error('Choose a check-in time after the saved session time.');
   if(progressCheckIn&&a.repeat!=='once'&&a.repeat!==null&&!/every|each|weekly|daily/i.test(fields.checkin!.source.text))throw Error('One check-in permission does not authorise repeated check-ins.');
   if(a.repeat==='daily'&&!/daily|every day|each day/i.test(recurrenceText)||a.repeat==='weekly'&&!(fields.scheduleGrounded&&/\bweek(?:ly)?\b/i.test(r.text+' '+(sources.find(s=>s.messageId===r.sourceMessageId&&s.role==='user')?.text??'')))&&!/weekly|every week|each week|(?:every|each)\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i.test(m.text))throw Error('Reminder recurrence is not explicitly supported.');
   const prior=progressCheckIn?s.reminders.find(old=>old.progressCheckIn&&old.targetId===r.id&&old.state==='scheduled'&&localDate(old.dueAt,'Asia/Kolkata')===localDate(due.dueAt!,'Asia/Kolkata')):null;
   if(prior){outcomes.push({type:a.type,status:'duplicate',id:prior.id});continue;}
   const id=`${messageId}:${a.tempId??'reminder'}`;
   if(s.reminders.some(old=>old.id===id))throw Error('Independent reminders need distinct temporary IDs.');
   s.reminders.push({id,targetId:r.id,title:r.label,dueAt:due.dueAt,time:due.time,repeat:a.repeat??'once',permission:fields.purpose?.text??permission,...(progressCheckIn?{progressCheckIn:true,permissionContext:fields.checkin!.context}:{}),groceryOrder:/\border(?:ing)?\b/i.test(permission)&&(r.kind==='grocery'||/\bgrocer(?:y|ies)\b/i.test(permission)),groceryOrderGlobal:r.kind==='task'&&/\border(?:ing)?\b/i.test(permission)&&/\bgrocer(?:y|ies)\b/i.test(permission),sourceMessageId:m.messageId,state:'scheduled',deliveries:[]});outcomes.push({type:a.type,status:'scheduled_simulation',id});continue;
  }
  if(a.type==='complete'){
   const r=owned(a.targetId);if(!['plan','food','schedule','task','appointment'].includes(r.kind))throw Error('That record cannot have a completion.');
   const current=sources.find(m=>m.messageId===messageId)?.text.trim().replace(/[.!?]+$/,'').toLowerCase();const selected=s.records.filter(x=>['plan','food','schedule','task','appointment'].includes(x.kind)&&x.label.toLowerCase()===current);if(selected.length===1&&selected[0].id!==r.id)throw Error('Completion target conflicts with the explicitly selected owned plan.');
   if(a.datePhrase!=='today')ground(m,a.datePhrase);const day=resolveDate(a.datePhrase,m.at,'Asia/Kolkata')??(!a.datePhrase?localDate(m.at,'Asia/Kolkata'):null);if(!day)throw Error('The completion date needs clarification.');
   if(a.state!=='completed'&&a.state!=='skipped')throw Error('An explicit completion or skip is required.');
   const duplicate=s.records.find(x=>x.kind==='event'&&x.parentId===r.id&&x.date===day&&x.state===a.state&&(a.state==='skipped'||x.evidence.toLowerCase()===a.evidence.toLowerCase()||outcomes.some(o=>o.type==='complete'&&o.id===x.id)));
   const id=duplicate?.id??`${messageId}:${a.tempId??outcomes.length}`;if(!duplicate)s.records.push({id,kind:'event',label:r.label,text:a.evidence,date:day,time:null,targetNumber:null,state:a.state,parentId:r.id,sourceMessageId:m.messageId,evidence:a.evidence,reportedAt:m.at});for(const reminder of s.reminders)if(reminder.progressCheckIn&&reminder.targetId===r.id&&reminder.repeat==='once'&&localDate(reminder.dueAt,'Asia/Kolkata')===day)reminder.state='cancelled';
   outcomes.push({type:a.type,status:duplicate?'duplicate':'saved',id});continue;
  }
  const target=a.type==='correct'?owned(a.targetId):null;
  const context=a.type==='save'&&a.targetId?owned(a.targetId):null;
  if(context&&(!['event','experience'].includes(a.kind??'')||!['event','experience'].includes(context.kind)))throw Error('A contextual save must reference an owned experience or event.');
  if(!a.kind&&!target)throw Error('A saved record needs a type.');
  if(a.label&&a.label!==target?.label&&a.label!==context?.label)ground(m,a.label);if(a.text&&a.text!==target?.text)ground(m,a.text);const eventDateSource=foodReportDateSource(a,m,sources)??m;ground(eventDateSource,a.datePhrase);ground(m,a.timePhrase);
  if(a.targetNumber!==null&&(!Number.isInteger(a.targetNumber)||a.targetNumber<1||a.targetNumber>100||!new RegExp(`\\b(?:${a.targetNumber}|${(['zero','one|once','two|twice','three|thrice','four','five','six','seven','eight','nine','ten'][a.targetNumber]??'(?!)')})\\b`,'i').test(m.text)))throw Error('The target quantity is unsupported.');
  if(a.timePhrase&&!resolveTime(a.timePhrase))throw Error('The stated clock time needs clarification.');
  const date=a.datePhrase?(resolveDate(a.datePhrase,eventDateSource.at,'Asia/Kolkata')??(m.confirmedCalendarYear?resolveDate(a.datePhrase+' '+m.confirmedCalendarYear,m.at,'Asia/Kolkata'):null)):target?.date??null;if(a.datePhrase&&!date)throw Error('The stated date needs clarification.');
  const label=a.label??target?.label??context?.label;if(!label?.trim())throw Error('A source-grounded label is required.');
  const id=target?.id??`${messageId}:${a.tempId??outcomes.length}`;if(a.tempId)ids.set(a.tempId,id);
  const parent=a.parentId?owned(a.parentId).id:target?.parentId??null;
  if((a.kind??target?.kind)==='meal_choice'&&parent&&owned(parent).kind!=='food')throw Error('A meal choice can only reference its owned original food plan.');
  if(a.kind==='food'&&parent&&s.records.find(r=>r.id===parent)?.kind!=='food')throw Error('A nutrition plan can only refer to another owned nutrition plan.');
  const record:LabRecord={id,kind:a.kind??target!.kind,label,text:a.useSourceText===true?m.text:a.text??target?.text??a.evidence,date,time:a.timePhrase??target?.time??null,targetNumber:a.targetNumber??target?.targetNumber??null,state:a.state??target?.state??(a.kind==='experience'?'ongoing':a.kind==='history'?'historical':a.kind==='grocery'?'unchecked':'planned'),parentId:parent,sourceMessageId:m.messageId,evidence:a.evidence,reportedAt:target?.reportedAt??m.at};
  if(a.type==='save'){
   const same=s.records.find(r=>r.kind===record.kind&&r.label.toLowerCase()===record.label.toLowerCase()&&r.date===record.date&&(record.kind==='grocery'||r.parentId===record.parentId)&&(record.kind!=='event'||r.sourceMessageId===record.sourceMessageId&&r.evidence.toLowerCase()===record.evidence.toLowerCase()));
   if(same){if(a.tempId)ids.set(a.tempId,same.id);outcomes.push({type:a.type,status:'duplicate',id:same.id});continue;}
  }
  if(record.kind==='event'&&!record.date)throw Error('An event needs a reported date. Retain a missing-date question instead of claiming a save.');
  if(record.kind==='food'&&['held','ordered','received'].includes(record.state))throw Error('Grocery purchase states cannot change a nutrition plan.');
  s.records=target?s.records.map(r=>r.id===id?record:r):[...s.records,record];outcomes.push({type:a.type,status:target?'corrected':'saved',id});
  if(record.kind==='grocery'&&['ordered','received','held'].includes(record.state))for(const reminder of s.reminders){const siblings=s.records.filter(x=>x.kind==='grocery'&&x.parentId===record.parentId);if(reminder.groceryOrderGlobal&&!s.records.some(x=>x.kind==='grocery'&&x.state==='pending')||reminder.targetId===id||record.parentId&&reminder.targetId===record.parentId&&siblings.every(x=>['ordered','received','held'].includes(x.state)))reminder.state='cancelled';}
 }
 if(outcomes.every(o=>o.status==='read')&&/^(?:noted|kept|recorded)\b/i.test(response.reply))throw Error(!activeLab(s,now)?'Your seven days have ended. Nothing new was saved. You can still retrieve, correct or delete existing records.':'The reply claims an action that did not succeed.');
 const replyTimes=[...response.reply.matchAll(/\b(?:\d{1,2}(?::\d{2})?\s*(?:am|pm)|(?:[01]\d|2[0-3]):[0-5]\d)\b/gi)].map(m=>resolveTime(m[0])??m[0]);const reminderRead=response.actions.every(a=>a.type==='retrieve')&&original.reminders.some(r=>r.state==='scheduled'&&response.reply.toLowerCase().includes(r.title.toLowerCase())&&replyTimes.includes(r.time))&&!/\bi(?:['’]ve| have)? (?:set|scheduled|changed|updated)/i.test(response.reply);
 if(!reminderRead&&!outcomes.some(o=>!['read','duplicate'].includes(o.status))&&/(?:\bi(?:['’]ve| have)? (?:saved|kept|noted|recorded|added|updated|corrected|scheduled|deleted)|^(?:saved|added|corrected|scheduled|deleted)\b|reminder (?:is |has been )?(?:set|scheduled))/i.test(response.reply))throw Error('The reply claims an action that did not succeed.');
 if(outcomes.some(o=>o.status==='delete'))s.tasks=[];
 else{
  for(const task of response.open_tasks){source(task.sourceMessageId,sources.find(m=>m.messageId===task.sourceMessageId)?.text??'');if(task.targetId)owned(task.targetId);}
  s.tasks=response.open_tasks.map(t=>({...t,targetId:ids.get(t.targetId??'')??t.targetId}));
  s.tasks=validateCheckinTasks(original,s,s.tasks,sources,response.reply,messageId);
  s.tasks=linkReminderTasks(s,sources);
 }
 if(s.control.safetyPaused&&response.clarification==='Are you okay to continue with normal tracking now?')s.control.safetyAsked=true;
 return {state:s,reply:displayLabReply(response.reply),outcomes,response};
}
export function simulateLabClock(s:LabState,now:number){const state=structuredClone(s),deliveries:any[]=[];for(const r of state.reminders){if(r.state!=='scheduled'||r.dueAt>now)continue;if(!activeLab(state,now)||state.control.tracking!=='active'||!state.control.storage||state.control.safetyPaused){r.state='suppressed';deliveries.push({id:r.id,status:'suppressed',at:now});continue;}const d={id:r.id,title:r.title,status:'simulated',dueAt:r.dueAt,at:now};r.deliveries.push(d);deliveries.push(d);const next=nextDue(r.dueAt,r.repeat,'Asia/Kolkata',r.time,now);r.state=next?'scheduled':'delivered';if(next)r.dueAt=next;}return {state,deliveries};}
