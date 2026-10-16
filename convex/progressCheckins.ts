import type {LabState,Source} from './labModel';
export const checkinOfferTopic='session check-in permission';
export const checkinTimingTopic='session check-in timing';
const positive=/^(?:yes|yes please|please do|sure|okay|ok|go ahead)[.! ]*$/i;
const negative=/^(?:no|never|don['’]?t|do not|stop|cancel)\b|\b(?:don['’]?t|do not|never)\s+(?:send|check|remind|nudge)/i;
export function explicitCheckin(text:string){return !negative.test(text)&&/\bcheck[ -]?in\b/i.test(text);}
export function checkinPermission(state:LabState,sources:Source[],targetId:string,sourceId:string){
 const current=sources.find(s=>s.messageId===sourceId&&s.role==='user'&&s.canSave!==false);if(!current)return null;
 if(explicitCheckin(current.text))return {source:current,context:current.text};
 if(/\b(?:remind|nudge)\b/i.test(current.text))return null;
 const timing=state.tasks.find(t=>t.targetId===targetId&&t.topic===checkinTimingTopic);
 const approved=timing&&sources.find(s=>s.messageId===timing.sourceMessageId&&s.role==='user'&&s.canSave!==false);
 if(approved&&!negative.test(current.text))return {source:approved,context:timing.permissionContext??approved.text};
 const offer=state.tasks.find(t=>t.targetId===targetId&&t.topic===checkinOfferTopic&&t.question);
 if(offer&&positive.test(current.text.trim()))return {source:current,context:offer.question};
 return null;
}
/** A displayed offer is context; only the woman's later agreement grants permission. */
export function validateCheckinTasks(original:LabState,next:LabState,tasks:any[],sources:Source[],reply:string,currentId:string){
 return tasks.map(t=>{
  if(![checkinOfferTopic,checkinTimingTopic].includes(t.topic))return t;
  const plan=next.records.find(r=>r.id===t.targetId&&['plan','schedule'].includes(r.kind));if(!plan)throw Error('A session check-in needs an owned activity plan.');
  if(t.topic===checkinOfferTopic){
   const old=original.tasks.find(o=>o.id===t.id&&o.targetId===t.targetId&&o.topic===t.topic);
   if(old)return {...t,question:t.question?old.question:null};
   if(!t.question||!reply.includes(t.question)||!/one check[ -]?in/i.test(t.question)||!/(?:not reported|haven.t reported|unreported)/i.test(t.question))throw Error('Check-in permission must be asked clearly in the displayed reply.');
   return t;
  }
  const permission=checkinPermission(original,sources,t.targetId,currentId);
  if(!permission||t.sourceMessageId!==permission.source.messageId)throw Error('A check-in timing question needs the woman’s agreement first.');
  return {...t,permissionContext:permission.context};
 });
}

/** Optional offers stay dormant on subsequent unrelated turns. */
export function silenceRepeatedCheckinOffer(p:any,original:LabState,currentText:string){
 if(explicitCheckin(currentText)||positive.test(currentText.trim()))return false;
 const repeated=p.open_tasks.filter((t:any)=>t.topic===checkinOfferTopic&&original.tasks.some(o=>o.topic===checkinOfferTopic&&o.targetId===t.targetId));
 const questions=new Set(repeated.map((t:any)=>t.question).filter(Boolean));
 for(const t of repeated)t.question=null;
 if(questions.has(p.clarification)){p.clarification=null;p.open_tasks=p.open_tasks.filter((t:any)=>t.topic===checkinOfferTopic||!questions.has(t.question));return true;}
 return false;
}
