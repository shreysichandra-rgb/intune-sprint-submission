import {hasReportNegation,type Meaning} from './interpretation';
// Text interpretation only. Existing backend rules still own dates, counts and writes.
const aliases:[string,RegExp][]=[
 ['hot flashes',/\bhot flash(?:es)?\b/gi],['night sweats',/\bnight sweats?\b|\b(?:waking|woke|wake)[^.!?]{0,55}\b(?:drenched|soaked|sweat)\b/gi],
 ['brain fog',/\bbrain fog\b/gi],['poor sleep',/\bpoor sleep\b/gi],['low energy',/\blow energy\b/gi],['mood changes',/\bmood changes\b/gi],
 ['bloating',/\bbloating\b/gi],['cycle changes',/\bcycle changes\b|\b(?:period(?:s)?|menstrual bleeding|(?:ordinary )?spotting|cycle came early)\b/gi],['joint pain',/\bjoint pain\b/gi],
];
// The quick setup path accepts only tracking questions, never broader interpretation questions.
function trackingOnlyQuestion(question:string){
 const request=question.trim().replace(/[?]$/,'').trim().match(/^(?:(?:can|could|would|will) (?:you|we) )?(?:track|remember|keep track of) (.+)$/);
 if(!request)return false;
 if(['those','these','them'].includes(request[1]))return true;
 let rest=request[1];
 for(const [,alias] of aliases)rest=rest.replace(alias,'');
 return !rest.replace(/\b(?:and|my|please|too|also)\b|[\s,]/g,'');
}
export function dateAnswer(text:string):string|null {
 const value=text.trim().toLowerCase();
 const dates:string[]=value.match(/\btoday\b|\byesterday\b|\bright now\b|\blast night\b|\bthis morning\b|\b\d{1,3} days? ago\b|\b\d{4}-\d{2}-\d{2}\b/g)??[];
 if(!dates.length)return null;
 const groups=new Set(dates.map(d=>['today','right now','this morning','last night'].includes(d)?'today':d));
 if(groups.size!==1)return null;
 const rest=value.replace(/\btoday\b|\byesterday\b|\bright now\b|\blast night\b|\bthis morning\b|\b\d{1,3} days? ago\b|\b\d{4}-\d{2}-\d{2}\b/g,'').replace(/\b(?:lol|like|literally|actually|yes|it was|was|just|around|at)\b/g,'').replace(/[\s,.!?🥵😅]+/g,'');
 return rest?null:dates.includes('right now')?'right now':dates[0]??null;
}
export function naturalTracking(text:string){
 const value=text.toLowerCase();
 // Leave negated or mixed-polarity messages to the existing constrained interpreter.
 if(hasReportNegation(text))return null;
 // Corrections, references, questions and plan updates retain their established routes.
 if(/\b(?:actually|correction|correct that|same episode|same one|how many|how often|summary|latest|not today|instead)\b/.test(value))return null;
 const mentions=aliases.flatMap(([item,re])=>[...value.matchAll(re)].map(m=>({item,start:m.index!,end:m.index!+m[0].length}))).sort((a,b)=>a.start-b.start);
 if(!mentions.length)return null;
 const items=[...new Set(mentions.map(m=>m.item))];
 const setup=/\b(?:track|tracking|remember|keep track)\b/.test(value)||/\b(?:and|also)\b[^.!?]*\b(?:too|please)\b/.test(value);
 const bare=value.replace(/\b(?:and|my|please|too|also)\b|[, .!?]/g,'');
 const bareItems=mentions.map(m=>value.slice(m.start,m.end).replace(/\s/g,'')).join('');
 const labelsOnly=bare===bareItems;
 // Missing punctuation does not make a question an occurrence. These cues only
 // defer to interpretation; they do not classify medical meaning or safety.
 const questionClauses=value.split(/[.!?]/).filter(clause=>/\b(?:should|would|could|why|what(?:’s|'s| is) causing|is (?:this|that|it)|do you think|i(?:’m|'m| am)? wondering|i wonder)\b/.test(clause));
 if(questionClauses.some(clause=>!trackingOnlyQuestion(clause)))return null;
 if(value.includes('?')&&(!setup||(value.match(/[^.!?]*\?/g)??[]).some(question=>!trackingOnlyQuestion(question))))return null;
 const updates:Meaning[]=[];
 for(let i=0;i<mentions.length;i++){
  const m=mentions[i];
  const before=value.slice(i?mentions[i-1].end:0,m.start);
  const after=value.slice(m.end,mentions[i+1]?.start??value.length);
  // Dates/counts belong to their clause, not the next item in an 'and' list.
  const prefix=before.split(/[.;!?]|\band\b/).at(-1)??'';
  const tail=mentions.length===1?after:after.split(/[.;!?]|\band\b/)[0];
  const clause=prefix+' '+value.slice(m.start,m.end)+' '+tail;
  const dateMatches:string[]=clause.match(/\btoday\b|\byesterday\b|\bright now\b|\blast night\b|\bthis morning\b|\b\d{1,3} days? ago\b|\b\d{4}-\d{2}-\d{2}\b/g)??[];
  const unique=new Set(dateMatches.map(d=>['today','right now','this morning','last night'].includes(d)?'today':d));
  const date=unique.size===1?(dateMatches.includes('right now')?'right now':dateMatches[0]??null):null;
  const amount=prefix.match(/\b(\d+|one|two|three|once|twice|a|an)\s*$/)??tail.match(/\b(once|twice|\d+ times?|one|two|three)\b/); 
  const count=amount?({one:1,two:2,three:3,once:1,twice:2,a:1,an:1}[amount[1]]??Number(amount[1].replace(/ times?$/,''))):1;
  const time=clause.match(/\b(?:around |about |at )?\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/)?.[0]??null;
  const reporting=/\b(?:had|having|got|started|happened|woke|waking|late|missed|came early)\b/.test(clause)||!!dateMatches.length||!!amount;
  if(!reporting||labelsOnly||(!dateMatches.length&&!amount&&setup))continue;
  updates.push({intent:'record',trackedItem:m.item,count:Number.isInteger(count)&&count>=1&&count<=10?count:null,datePhrase:date,timePhrase:time,precision:time?/^(?:around|about)/.test(time)?'approximate':'exact':date==='right now'?'exact':'date-only',target:null,explicitNew:/\b(?:another|again|new)\b/.test(clause)});
 }
 return {items,setup:setup||labelsOnly,updates};
}
