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
export function foodReportDateSource(action:any,current:Source,sources:Source[]):Source|null{
 const scope=current.eventDateContext;if(/\b(?:will|planning|plan to|going to|intend)\b/i.test(current.text))return null;if(action.type!=='save'||action.kind!=='event'||!scope||!action.datePhrase||action.datePhrase.toLowerCase()!==scope.datePhrase.toLowerCase())return null;
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
