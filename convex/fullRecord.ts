import type {Doc} from './_generated/dataModel';
import {inPilotPeriod} from './pilotAccess';
import {summaryText,groceryReply} from './pilotMemory';
import {dateLabel} from './replyCopy';

// "What all are you keeping track of for me?" and "Show my saved records":
// the complete owned record as short WhatsApp lines. Read-only; her saved words
// are shown as she wrote them. WhatsApp rejects text over 4096 characters.
export const FULL_RECORD_LIMIT=3800,FULL_ITEM_LIMIT=1000;
const SECTIONS:[string,string][]=[['plan','Plans'],['schedule','Schedules'],['doctor_question','Questions for your doctor'],['appointment','Appointments'],['task','To do'],['food','Food and supplement plans'],['meal_choice','Meal choices']];
const REPEAT:Record<string,string>={once:'once',daily:'every day',weekly:'every week'};
const clean=(s:string)=>s.replace(/\s+/g,' ').trim();
const fold=(s:string)=>clean(s).toLowerCase().replace(/[.!?]+$/,'');
const dates=(days:string[],tz:string)=>{const shown=[...new Set(days)].sort();return shown.slice(0,4).map(d=>dateLabel(d,tz)).join(', ')+(shown.length>4?` and ${shown.length-4} more dates`:'');};

// One saved title and its saved words, without repeating either.
export function recordWords(title:string,text:string,when=''){
 const t=clean(title),x=clean(text);
 if(!x||fold(t).includes(fold(x)))return t+when;
 if(!t||fold(x).includes(fold(t)))return x+when;
 // Two whole questions (a doctor question corrected before 22 October kept its
 // earlier wording as text): show one question, the fuller of the two.
 if(/\?$/.test(t)&&/\?$/.test(x))return (x.length>t.length?x:t)+when;
 // Her own correction wording ("Actually three times, not twice.") reads as a correction of the title.
 const fix=x.match(/^(?:actually|no|sorry|oops|correction)\b[,:!.]?\s*(.+?)[.!]*$/i);
 if(fix)return t+' — correction: '+fix[1]+when;
 return t+when+': '+x;
}

export function fullRecordReply(data:any,user:Doc<'users'>){
 const tz=user.timezone,sections=new Map<string,string[]>();
 const add=(title:string,lines:string[])=>{if(lines.length)sections.set(title,[...(sections.get(title)??[]),...lines]);};
 add('What you’ve told me',data.experiences.map((e:any)=>summaryText(recordWords(e.label,e.text),FULL_ITEM_LIMIT)+(e.status==='historical'?' (from your history)':'')));
 // Repeats of one change are counted together; a corrected report is shown with her correction, never as a bare count.
 const body=new Map<string,any[]>(),worded:string[]=[];for(const r of data.body){if(r.rawText&&recordWords(r.trackedItem,r.rawText).includes(' — correction: '))worded.push(recordWords(r.trackedItem,r.rawText)+', '+dateLabel(r.occurrenceDate,tz));else body.set(r.trackedItem,[...(body.get(r.trackedItem)??[]),r]);}
 add('Body changes',[...[...body].map(([item,rows])=>`${item}: ${rows.length===1?'once':rows.length+' times'}, ${dates(rows.map(r=>r.occurrenceDate),tz)}`),...worded]);
 add('Cycle',data.cycle.map((r:any)=>`${r.dateKind==='observation'?'Noticed: ':''}${r.label}, ${dateLabel(r.occurrenceDate,tz)}`));
 const items=data.responsibilities.items as Doc<'pilotItems'>[],events=data.responsibilities.events as Doc<'pilotItemEvents'>[];
 const meta=(i:Doc<'pilotItems'>)=>(user.v4Records as any[]|undefined)?.find(r=>r.id===i._id);
 const kind=(i:Doc<'pilotItems'>)=>meta(i)?.kind==='meal_choice'?'meal_choice':i.kind;
 const line=(i:Doc<'pilotItems'>)=>{
  const m=meta(i),savedDate=typeof m?.date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(m.date)?dateLabel(m.date,tz):null,time=typeof m?.time==='string'?clean(m.time):null;
  let detail=summaryText(recordWords(i.title,i.text,savedDate||time?' ('+[savedDate,time].filter(Boolean).join(' at ')+')':''),FULL_ITEM_LIMIT);
  const mine=events.filter(e=>e.itemId===i._id&&inPilotPeriod(user,e.date)),done=mine.filter(e=>e.status==='completed'),skipped=mine.filter(e=>e.status==='skipped');
  if(['plan','schedule'].includes(i.kind)||mine.length){
   detail+=i.target!==undefined?`. ${done.length} of ${i.target} done this pilot`:done.length?`. Done this pilot: ${dates(done.map(e=>e.date),tz)}`:'. Nothing marked done yet';
   if(skipped.length)detail+=`, ${skipped.length} skipped`;
  }
  if(!['planned','pending'].includes(i.state))detail+=` (${i.state})`;
  return detail;
 };
 for(const [k,title]of SECTIONS)add(title,items.filter(i=>kind(i)===k).map(line));
 if(data.plan?.plan)add('Plans',[`${data.plan.plan.activity}: ${data.plan.progress} this week`]);
 if(items.some(i=>i.kind==='grocery'))add('Groceries',groceryReply(items,false).split('\n'));
 add('Other saved notes',items.filter(i=>i.kind!=='grocery'&&!SECTIONS.some(([k])=>k===kind(i))).map(line));
 add('Earlier plans',data.previousPlans.map((p:any)=>`${p.activity}: ${data.previousCompletions.filter((r:any)=>r.planId===p._id&&r.status==='completed').length} of ${p.targetNumber} done`));
 if(data.reminders.length){
  const active=data.reminders.filter((r:any)=>r.state==='active');
  // Stopped and paused reminders stay in the full record, one short line each group.
  const names=(state:string)=>{const n=new Map<string,number>();for(const r of data.reminders.filter((r:any)=>r.state===state))n.set(clean(r.title),(n.get(clean(r.title))??0)+1);return [...n].map(([t,c])=>summaryText(t,60)+(c>1?` (${c})`:'')).join(', ');};
  const paused=names('paused'),stopped=names('stopped');
  add('Reminders (India time)',[...active.map((r:any)=>`${summaryText(r.title,100)}: ${new Intl.DateTimeFormat('en-IN',{timeZone:r.timezone,dateStyle:'medium',timeStyle:'short'}).format(r.dueAt)}, ${REPEAT[r.repeat]??r.repeat}`),...active.length?[]:['None active right now'],...paused?['Paused: '+paused]:[],...stopped?['Earlier reminders, now stopped: '+stopped]:[]]);
 }
 add('Not counted yet, still unclear',[...data.pending,...data.previousPending].map((p:any)=>'“'+summaryText(p.rawText,160)+'”'));
 if(!sections.size)return 'I’m not keeping track of anything for you yet. Tell me something you’d like me to remember.';
 const opening='Here’s everything I’m keeping track of for you 👇',closing='That’s everything you’ve asked me to keep track of.';
 // Keep whole lines within the limit and say how many were left out.
 let used=opening.length+closing.length+4,hidden=0;const blocks:string[]=[];
 for(const [title,lines]of sections){const kept:string[]=[];for(const l of lines){const cost=l.length+3+(kept.length?0:title.length+3);if(used+cost>FULL_RECORD_LIMIT-160){hidden++;continue;}kept.push(l);used+=cost;}if(kept.length)blocks.push(title+':\n'+kept.map(l=>'• '+l).join('\n'));}
 return [opening,...blocks,hidden?`${hidden} more saved item${hidden===1?'':'s'} didn’t fit in one message. Ask me about a specific plan or topic to see the rest.`:closing].join('\n\n');
}
