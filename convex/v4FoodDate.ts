import {localDate} from './rules';
import type {Source} from './labModel';
/** An explicit owned day query can scope its immediate food-report answer.
 * This is source linkage, never a default that every undated event means today.
 * Recent sources/replies must be newest first for tied receipt timestamps.
 */
export function linkFoodReportDay(sources:Source[],replies:Array<{text?:string;messageId:string}>,currentId:string){
 const current=sources.find(s=>s.messageId===currentId);if(!current||current.canSave===false)return;
 const previous=sources.filter(s=>s.messageId!==currentId&&s.role==='user'&&s.canSave!==false&&s.at<=current.at).sort((a,b)=>b.at-a.at)[0];
 if(!previous||localDate(previous.at,'Asia/Kolkata')!==localDate(current.at,'Asia/Kolkata'))return;
 if(!/\b(?:what|show|report|log|track)\b/i.test(previous.text)||!/\b(?:food|meals?|protein intake)\b/i.test(previous.text))return;
 const days=[...previous.text.matchAll(/\b(today|yesterday|tonight)\b/gi)];if(days.length!==1)return;
 const reply=replies.find(r=>r.messageId===previous.messageId)?.text??'';
 if(!/\b(?:food|meals?|eaten|ate|intake)\b/i.test(reply)||!reply.toLowerCase().includes(days[0][0].toLowerCase()))return;
 current.eventDateContext={sourceMessageId:previous.messageId,datePhrase:days[0][0]};
}
/** Link a literal owned food-option answer to the one question actually sent.
 * The assistant contributes only the asked day/slot, never permission or food.
 */
export function linkAnsweredFoodQuestion(sources:Source[],replies:Array<{id:string;sourceMessageId:string;text:string;at:number}>,tasks:any[],records:any[],currentId:string){
 const current=sources.find(s=>s.messageId===currentId&&s.role==='user');
 if(!current||current.canSave===false||current.eventDateContext||current.text.trim().split(/\s+/).length>6||current.text.length>100||/\b(?:yes|no|both|none|not|yet|will|planning|tomorrow|cancel|stop|delete)\b/i.test(current.text))return;
 const asked=tasks.filter(t=>t.question);if(asked.length!==1)return;
 const task=asked[0],foods=records.filter(r=>r.kind==='food'&&(r.id===task.targetId||r.sourceMessageId===task.sourceMessageId));
 if(foods.length!==1)return;
 const prior=sources.filter(s=>s.role==='user'&&s.messageId!==currentId&&s.at<=current.at).sort((a,b)=>b.at-a.at)[0];
 const question=replies.filter(r=>r.text.includes(task.question)&&r.sourceMessageId===prior?.messageId&&r.at<=current.at).sort((a,b)=>b.at-a.at)[0];
 if(!question||localDate(question.at,'Asia/Kolkata')!==localDate(current.at,'Asia/Kolkata'))return;
 const q=task.question,days=[...q.matchAll(/\b(today|yesterday)\b/gi)];
 if(days.length!==1||!/(?:what|which).*(?:have|eat|eaten|ate)/i.test(q)||/\b(?:will|planning|tomorrow)\b/i.test(q))return;
 const option=current.text.trim().replace(/[.!]+$/,'').toLowerCase();
 const owned=sources.find(s=>s.messageId===foods[0].sourceMessageId&&s.role==='user');
 if(!option||![foods[0].text,foods[0].label,owned?.text??''].some(text=>(' '+text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ')+' ').includes(' '+option.replace(/[^\p{L}\p{N}]+/gu,' ')+' ')))return;
 const mode=/(?:did you (?:have|eat)|have you (?:had|eaten)|what (?:you )?ate)/i.test(q)?'intake':'choice';
 const id='answered-food-question:'+question.id;
 sources.push({messageId:id,text:q,role:'assistant',at:question.at,canSave:false,answeredFoodQuestion:{question:q,mode,targetId:foods[0].id}});
 current.eventDateContext={sourceMessageId:id,datePhrase:days[0][0]};
}
/** Normalize only the literal answer already linked to an owned sent question.
 * The food plan is a parent reference, never a record to overwrite.
 */
export function normalizeAnsweredFoodAction(action:any,current:Source,sources:Source[]){
 const question=current.eventDateContext&&sources.find(s=>s.messageId===current.eventDateContext!.sourceMessageId&&s.answeredFoodQuestion);
 if(!question||current.canSave===false||action.type!=='save'||!['event','meal_choice'].includes(action.kind)||action.sourceMessageId!==current.messageId)return null;
 action.kind=question.answeredFoodQuestion!.mode==='intake'?'event':'meal_choice';
 action.state=action.kind==='event'?'completed':'planned';
 if(!action.label||!current.text.toLowerCase().includes(action.label.toLowerCase()))action.label=action.evidence;
 if(!action.datePhrase)action.datePhrase=current.eventDateContext!.datePhrase;
 action.dateSourceRecordId=null;
 if(action.targetId===question.answeredFoodQuestion!.targetId){action.parentId=action.targetId;action.targetId=null;}
 return question;
}
export function foodReportDateSource(action:any,current:Source,sources:Source[]):Source|null{
 const scope=current.eventDateContext;if(/\b(?:will|planning|plan to|going to|intend)\b/i.test(current.text))return null;if(action.type!=='save'||!['event','meal_choice'].includes(action.kind)||!scope||!action.datePhrase||action.datePhrase.toLowerCase()!==scope.datePhrase.toLowerCase())return null;
 const question=sources.find(s=>s.messageId===scope.sourceMessageId&&s.role==='assistant'&&s.canSave===false&&s.answeredFoodQuestion);
 if(question){if(current.canSave===false||question.at>current.at||localDate(question.at,'Asia/Kolkata')!==localDate(current.at,'Asia/Kolkata')||!question.text.toLowerCase().includes(action.datePhrase.toLowerCase())||question.answeredFoodQuestion?.mode==='intake'&&action.kind!=='event'||question.answeredFoodQuestion?.mode==='choice'&&action.kind!=='meal_choice')return null;return question;}
 if(action.kind!=='event')return null;
 if(!/\b(?:ate|eaten|breakfast|lunch|dinner|snack)\b|\b\d+(?:\.\d+)?\s+\p{L}/iu.test(current.text))return null;
 const owner=sources.find(s=>s.messageId===scope.sourceMessageId);
 if(!owner||owner.role!=='user'||owner.canSave===false||current.canSave===false||owner.at>current.at||localDate(owner.at,'Asia/Kolkata')!==localDate(current.at,'Asia/Kolkata')||!owner.text.toLowerCase().includes(action.datePhrase.toLowerCase()))return null;
 return owner;
}
/** Keep a generic target-routine question dormant while logging actual intake. */
export function retireUnrelatedFoodRoutine(proposal:any,records:any[],sources:Source[]){
 if(!proposal.clarification||!/\broutine\b/i.test(proposal.clarification))return;
 const intake=proposal.actions.some((a:any)=>{const src=sources.find(s=>s.messageId===a.sourceMessageId);return !!src&&((a.type==='save'&&foodReportDateSource(a,src,sources))||(a.type==='correct'&&records.some(r=>r.id===a.targetId&&r.kind==='event')&&/\b\d+\s+\p{L}/u.test(src.text)));});
 if(!intake)return;
 const q=proposal.clarification;proposal.clarification=null;proposal.reply=proposal.reply.split(q).join('').trim();proposal.open_tasks=proposal.open_tasks.map((t:any)=>t.question===q?{...t,question:null}:t);
}
