import {resolveTime} from './rules';
import {reminderDue} from './pilotReminderRules';
/** Restore only the adjacent, owned workout-purpose clarification chain.
 * No transcript search, inferred purpose, failed-source replay or customer writes.
 * Scheduling still passes independent permission review and normal validation.
 */
export function restoreV4WorkoutReminderLink(c:any,a:any):boolean {
 const state=c.state,clock=resolveTime(a.text);
 if(a.quotedMessageId||!/^\s*\d{1,2}(?::\d{2})?\s*(?:am|pm)[.! ]*$/i.test(a.text)||!clock||!c.reminderDeliveryConfigured||state.access.mode!=='active_paid'||!state.control.storage||state.control.tracking!=='active'||state.control.safetyPaused)return false;
 const asked=state.tasks.filter((t:any)=>t.question);
 if(asked.length!==1||asked[0].targetId||asked[0].topic!=='conversation clarification'||!/what time.*remind/i.test(asked[0].question))return false;
 const history=c.history.filter((h:any)=>h.messageId!==a.messageId).slice(-4);
 if(history.length!==4)return false;
 const [request,question,detail,timeQuestion]=history;
 if(request.role!=='user'||question.role!=='assistant'||detail.role!=='user'||timeQuestion.role!=='assistant'||asked[0].sourceMessageId!==detail.messageId||timeQuestion.text!==asked[0].question&&!timeQuestion.text.endsWith(asked[0].question)||!/what (?:kind|type) of workout|what workout/i.test(question.text))return false;
 const source=c.sources.find((s:any)=>s.messageId===request.messageId&&s.role==='user'&&s.canSave!==false);
 const description=c.sources.find((s:any)=>s.messageId===detail.messageId&&s.role==='user'&&s.canSave!==false);
 if(!source||!description||source.at>description.at||description.at>c.now||!/^remind me\b.*\bworkout\b/i.test(source.text)||/\b(?:daily|weekly|every|each)\b/i.test(source.text))return false;
 const simple=/^remind me (?:of|about|to do) (?:my )?workout (?:at \d{1,2}(?::\d{2})?\s*(?:am|pm) (?:on )?(?:today|tomorrow|tonight|monday|tuesday|wednesday|thursday|friday|saturday|sunday)|(?:on )?(?:today|tomorrow|tonight|monday|tuesday|wednesday|thursday|friday|saturday|sunday) at \d{1,2}(?::\d{2})?\s*(?:am|pm))[.! ]*$/i;
 if(!simple.test(source.text))return false;
 const originalClock=source.text.match(/\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/i)?.[0];
 const days=[...source.text.matchAll(/\b(?:today|tomorrow|tonight|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi)];
 if(!originalClock||resolveTime(originalClock)!==clock||days.length!==1||(reminderDue(days[0][0],originalClock,source.at,'Asia/Kolkata').dueAt??0)<=c.now)return false;
 const targets=state.records.filter((r:any)=>r.kind==='task'&&r.sourceMessageId===description.messageId&&r.label===description.text&&r.text===description.text);
 if(targets.length!==1||state.reminders.some((r:any)=>r.targetId===targets[0].id&&r.state!=='cancelled'))return false;
 state.tasks=state.tasks.map((t:any)=>t.id===asked[0].id?{...t,id:'reminder-pending:'+t.id,topic:'workout reminder timing',sourceMessageId:source.messageId,targetId:targets[0].id}:t);
 return true;
}
