import {v4ReplyLanguage} from './v4Reply';

/** InTune leads (founder decision 23 October 2026): after saving something with a schedule, offer one reminder she can accept in a word. */
const DAYS=['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];
const SUPPLEMENT=/\b(?:vitamin|supplement|tablet|capsule|medicine|medication|pill|dose|iron|calcium|omega|b12|d3|thyroid|thyronorm|metformin|hrt|progesterone|estrogen|oestrogen|syrup|drops|injection)\b/i;
const DAILY=/\b(?:daily|every ?day|each day|every morning|every night|every evening|roz|rozana|har din)\b/i;
const FREQUENCY=/\b(?:once|twice|thrice|\d+|one|two|three|four|five|six|seven)\s+(?:times?\s+)?(?:a|per|every)\s+week\b|\bweekly\b/i;
const TIME=/\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/i;
const plural=(d:string)=>d[0].toUpperCase()+d.slice(1)+'s';
const join=(xs:string[])=>xs.length>1?xs.slice(0,-1).join(', ')+' and '+xs[xs.length-1]:xs[0];

export function reminderOfferQuestion(kind:string,text:string,date:string|null,messageText:string):string|null{
 if(!['food','plan','schedule','appointment'].includes(kind))return null;
 if(kind==='food'&&!SUPPLEMENT.test(text))return null;
 const lower=text.toLowerCase(),days=DAYS.filter(d=>new RegExp('\\b'+d+'s?\\b').test(lower)),time=text.match(TIME)?.[0]?.replace(/\s+/g,' ').toLowerCase()??null;
 const language=v4ReplyLanguage(messageText);
 if(language==='Hindi')return kind==='appointment'?(date?'क्या एक दिन पहले रिमाइंडर चाहिए? बस समय बता दीजिए 🙂':null):days.length||DAILY.test(text)||FREQUENCY.test(text)?'क्या इसके लिए रिमाइंडर चाहिए? बस दिन और समय बता दीजिए 🙂':null;
 const hinglish=language?.startsWith('Hinglish');
 if(kind==='appointment')return date?(hinglish?'Ek din pehle reminder chahiye? Bas time bata dijiye 🙂':'Want a reminder the day before? Just tell me what time 🙂'):null;
 if(days.length){const on=join(days.map(plural));return time?(hinglish?`${on} ko ${time} par yaad dilaun? Bas haan bol dijiye 🙂`:`Want me to remind you on ${on} at ${time}? Just say yes 🙂`):(hinglish?`${on} ko reminder chahiye? Bas time bata dijiye 🙂`:`Want a reminder on ${on}? Just tell me what time 🙂`);}
 if(DAILY.test(text))return time?(hinglish?`Roz ${time} par yaad dilaun? Bas haan bol dijiye 🙂`:`Want me to remind you every day at ${time}? Just say yes 🙂`):(hinglish?'Roz ka reminder chahiye? Bas time bata dijiye 🙂':'Want a daily reminder? Just tell me what time 🙂');
 if(FREQUENCY.test(text))return hinglish?'Iske liye reminder chahiye? Bas din aur time bata dijiye 🙂':'Want reminders for it? Just tell me the days and time 🙂';
 return null;
}

export const REMINDER_OFFER_TOPIC='reminder offer';
const HINGLISH_CLOCK=/(?:\b(?:subah|sube|savere|sawere|dopahar|dopehar|shaam|sham|raat)\s+\d{1,2}(?::\d{2})?\s*baje\b|\b\d{1,2}(?::\d{2})?\s*baje\s+(?:subah|sube|savere|sawere|dopahar|dopehar|shaam|sham|raat)\b)/i;
const YES=/^(?:yes|yes please|yeah|yep|sure|ok|okay|please|please do|haan|haa|han|ha|haan ji|ji|ji haan|theek hai|thik hai|हाँ|हां|जी)\b/i;
const NO=/^(?:no|nope|nah|no thanks|no thank you|not now|no need|skip|nahi|nahin|nhi|na|mat|नहीं|ना)\b/i;
/** Her short answer to InTune's own reminder offer, read without the AI: a clock time, a yes when the time is already known, or a no. Anything else goes to the AI. */
export function reminderOfferAnswer(state:any,sources:any[],messageId:string,text:string){
 const task=state.tasks.find((t:any)=>t.topic===REMINDER_OFFER_TOPIC&&t.question&&t.targetId);if(!task)return null;
 const users=sources.filter((m:any)=>m.role==='user').sort((x:any,y:any)=>y.at-x.at);const current=users.find((m:any)=>m.messageId===messageId),previous=users.find((m:any)=>m.messageId!==messageId&&(!current||m.at<=current.at));
 if(!current||previous?.messageId!==task.sourceMessageId)return null;
 const said=text.trim();if(said.split(/\s+/).length>8)return null;
 const target=state.records.find((r:any)=>r.id===task.targetId);const origin=sources.find((m:any)=>m.messageId===task.sourceMessageId);if(!target||!origin)return null;
 if(NO.test(said))return {kind:'decline' as const,task,origin};
 const own=said.match(TIME)?.[0]??said.match(HINGLISH_CLOCK)?.[0]??null,known=origin.text.match(TIME)?.[0]??null;
 const timePhrase=own??(YES.test(said)&&known?known:null);if(!timePhrase)return null;
 const lower=origin.text.toLowerCase(),days=DAYS.filter(d=>new RegExp('\\b'+d+'s?\\b').test(lower));
 const schedule=target.kind==='appointment'?(target.date?{repeat:'once' as const,days:[null]}:null):days.length?{repeat:'weekly' as const,days}:DAILY.test(origin.text)?{repeat:'daily' as const,days:[null]}:null;
 if(!schedule)return null;
 return {kind:'accept' as const,task,target,origin,current,timePhrase,timeFromOrigin:!own,...schedule};
}

/** Offer only a reminder that can really fire before her access ends. */
export function reminderOfferFits(kind:string,text:string,date:string|null,now:number,endsAt:number|null|undefined){
 if(!endsAt||endsAt<=now+3600000)return false;
 const ist=(d:string)=>Date.parse(d+'T00:00:00+05:30'),today=new Date(now+19800000).toISOString().slice(0,10);
 if(kind==='appointment'){if(!date)return false;const eve=new Date(ist(date)-86400000+19800000).toISOString().slice(0,10);return eve>=today&&ist(eve)<endsAt;}
 const lower=text.toLowerCase(),days=DAYS.filter(d=>new RegExp('\\b'+d+'s?\\b').test(lower));
 if(!days.length)return true;
 const wd=new Date(ist(today)+43200000).getUTCDay(),idx=days.map(d=>(DAYS.indexOf(d)+1)%7);
 const gap=Math.min(...idx.map(i=>(i-wd+7)%7));return ist(today)+gap*86400000<endsAt;
}
