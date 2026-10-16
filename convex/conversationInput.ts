import {z} from 'zod';
import {compactMeaningContext,compactSource} from './conversationPerformance';
import {zodSchema} from 'ai';
import {operationSchema,hasNumber,normalizeLabel,explicitNew,type Envelope} from './conversationProtocol';
import {resolveDate,resolveTime} from './rules';

// Split only for source addressing, never for intent/symptom interpretation.
// The model selects source IDs; the backend supplies the original words.
export function sourceUnits(text:string,preserveLists=false){
 const units:{id:string,text:string,start:number,end:number}[]=[];
 const protectedDots=new Set<number>();
 for(const match of text.matchAll(/\b(?:[ap]\.m\.?|(?:jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec|dr|mr|mrs|ms)\.)/gi))for(let i=0;i<match[0].length;i++)if(match[0][i]==='.')protectedDots.add(match.index!+i);
 let start=0;
 const add=(end:number)=>{const raw=text.slice(start,end),value=raw.trim();if(value){const begin=start+raw.indexOf(value);units.push({id:'u'+units.length,text:value,start:begin,end:begin+value.length});}};
 for(const match of text.matchAll(/[.!?;]|\b(?:and|but)\b/gi)){
  if(match[0]==='.'&&(protectedDots.has(match.index!)||/\d/.test(text[match.index!-1]??'')&&/\d/.test(text[match.index!+1]??'')))continue;
  // A shared time belongs to the complete weekday list, not a fragment
  // split off at its final 'and'. Keep the original source intact.
  if(/^and$/i.test(match[0])&&/\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s*,?\s*$/i.test(text.slice(start,match.index))&&/^\s*(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(text.slice(match.index!+match[0].length)))continue;
  // Preserve V3 sentence grammar. The language model assigns individual
  // meanings inside it; conjunctions never strip shared verbs or negations.
  if(preserveLists&&/^(?:and|but)$/i.test(match[0]))continue;
  const end=match.index!+(/[.!?;]/.test(match[0])?match[0].length:0);
  add(end);start=match.index!+match[0].length;
 }
 add(text.length);return units;
}
export function literalLabels(english:string){
 const words=[...english.matchAll(/\S+/g)];const labels=new Set<string>();
 for(let i=0;i<words.length;i++)for(let j=i;j<words.length;j++){
  const label=english.slice(words[i].index!,words[j].index!+words[j][0].length).replace(/^[,;:.!?]+|[,;:.!?]+$/g,'');
  if(label.length>120)break;if(label.trim())labels.add(label);
 }
 return [...labels];
}
export function allowedPurpose(purpose:string|undefined,kind:string,scope?:string){
 if(purpose==='profile')return kind==='profile'||kind==='question'&&(!scope||scope==='profile');
 if(purpose==='conversation')return kind==='conversation'||kind==='question';
 if(purpose==='experience')return kind==='experience';
 if(purpose==='reminder')return ['reminder','reminder_control'].includes(kind);
 if(purpose==='correction')return ['correct','item_correct','item_update','experience_correct'].includes(kind);
 if(purpose==='completion')return ['complete','item_complete','item_update'].includes(kind);
 if(purpose==='plan')return ['plan','item','reference'].includes(kind);
 if(purpose==='medical_question')return kind==='item'||kind==='question'&&(!scope||scope==='medical');
 return true;
}
export function extractionInput(text:string,context:any,semantic?:import('./semanticBridge').SemanticSource[]){
 const sources=semantic??sourceUnits(text);
 const enumerateLabels=!!semantic&&semantic.reduce((sum,s)=>sum+literalLabels(s.english).length+120,0)<=900;
 const pilotOnly=new Set(['experience','experience_correct','feedback','reminder','reminder_control','profile','item','item_update','item_complete','item_correct']);
 const variants=operationSchema.options.filter(op=>context.pilotMode==='v3'||!pilotOnly.has((op.shape.k as any).value)).map(op=>(op as z.ZodObject<z.ZodRawShape>).omit({q:true,e:true,o:true,h:true,c:true,g:true}));
 const perSource:Record<string,z.ZodType>={};
 for(const source of sources){
  const english=semantic?.find(s=>s.id===source.id)?.english;
  // Provider choices are grounded verbatim spans, not a fixed symptom vocabulary.
  // Any unfamiliar label can be represented; canonical counting remains in b.
  const labels=english?literalLabels(english):[];
  // Share one literal-choice definition per source. Fall back to bounded
  // strings only when the total choice budget is large; runtime parsing
  // and backend validation still reject invented literal labels.
  const literalLabel=enumerateLabels?z.enum(labels as [string,...string[]]):z.string().min(1).max(120).refine(value=>labels.some(label=>label.toLowerCase()===value.toLowerCase()),'Ungrounded literal label');
  const purpose=semantic?.find(s=>s.id===source.id)?.purpose;
  const stockOnly=semantic?.find(s=>s.id===source.id)?.stockOnly===true;
  const selected=variants.filter(op=>(stockOnly?['conversation','question'].includes((op.shape.k as any).value):allowedPurpose(purpose,(op.shape.k as any).value??'report'))&&!(context.pilotMode==='v3'&&(op.shape.k as any).value==='item_update'&&Array.isArray(context.responsibilities)&&!context.responsibilities.length)&&!(context.pilotMode==='v3'&&(op.shape.k as any).value==='item_correct'&&Array.isArray(context.itemEvents)&&!context.itemEvents.length));
  const targetsFor=(kind:string)=>['experience','experience_correct'].includes(kind)?context.experiences:kind==='item_correct'?context.itemEvents:kind==='item_update'?context.responsibilities:kind==='item_complete'?context.responsibilities?.filter((i:any)=>['plan','food','schedule','task','appointment'].includes(i.kind)):kind==='correct'?[...(context.body??[]),...(context.cycle??[]),...(context.completions??[])]:undefined;
  const targetSchema=(kind:string)=>{let rows=targetsFor(kind);if(!rows)return {};if(['experience','experience_correct','correct','item_correct'].includes(kind)&&context.conversation?.quoted?.recordIds?.length){const quoted=rows.filter((r:any)=>context.conversation.quoted.recordIds.includes(r.id));if(quoted.length)rows=quoted;}if(kind==='item_update'&&english){const asked=context.pending?.find((p:any)=>p.id===context.askedPendingId);rows=rows.filter((r:any)=>typeof r.title==='string'&&english.toLowerCase().includes(r.title.toLowerCase())||asked?.proposal?.target===r.id&&/\b(?:it|that|this|the same)\b/i.test(english));}const ids=rows.map((r:any)=>r.id);return {target:ids.length?z.enum(ids as [string,...string[]]).nullable():z.null()};};
  const grounded=selected.flatMap(op=>{
   if(context.pilotMode!=='v3'||(op.shape.k as any).value!=='item_update'||!semantic?.find(s=>s.id===source.id)?.grocery)return [op];
   const semanticSource=semantic.find(s=>s.id===source.id)!;
   const meanings=semanticSource.grocery!;
   const rows=context.responsibilities??[];
   const other=rows.filter((i:any)=>i.kind!=='grocery'&&semanticSource.english.toLowerCase().includes(i.title.toLowerCase())).map((i:any)=>i.id);
   const choices:z.ZodObject<any>[]=[];
   if(other.length)choices.push(op.extend({target:z.enum(other as [string,...string[]])}));
   for(const row of rows.filter((i:any)=>i.kind==='grocery')){
    const meaning=meanings.find(g=>g.item===row.title);
    if(semanticSource.stockOnly===undefined&&meaning&&['pending','held','ordered','received','paused','stopped'].includes(meaning.state))choices.push(op.extend({target:z.literal(row.id),state:z.literal(meaning.state),replacement:z.null()}));
    // A text correction does not assert a new stock state.
    if(purpose==='correction')choices.push(op.extend({target:z.literal(row.id),state:z.literal(row.state),replacement:z.string().min(1).max(2000)}));
   }
   return choices;
  });
  const located=english?grounded.map(op=>op.extend({
   ...(purpose==='profile'&&(op.shape.k as any).value==='question'?{scope:z.literal('profile')}:stockOnly&&(op.shape.k as any).value==='question'?{scope:z.literal('grocery')}:purpose==='medical_question'?{scope:z.literal('medical')}:{}),
   ...(context.pilotMode==='v3'&&!((op.shape.k as any).value==='item_update'&&semantic?.find(s=>s.id===source.id)?.grocery)?targetSchema((op.shape.k as any).value):{}),
   ...(context.pilotMode==='v3'&&(op.shape.k as any)?.value==='plan'?{activity:literalLabel}:{}),
   ...(context.pilotMode==='v3'&&op.shape.title?{title:literalLabel}:{}),
   ...(context.pilotMode==='v3'&&op.shape.name?{name:literalLabel}:{}),
   ...(['body','experience'].includes((op.shape.k as any)?.value)||op.shape.b?{l:literalLabel}:{}),
   ...(op.shape.x&&!explicitNew(english)?{x:z.literal(false)}:{}),
   a:z.string().min(1).max(2000).describe('Exact contiguous English support span including the chosen literal label, dates/counts and governing negation/context; never paraphrase.')
  })):variants;
  const semanticSource=semantic?.find(s=>s.id===source.id);
  const compactStock=semanticSource?.stockOnly===true&&!!semanticSource.grocery?.length;
  perSource[source.id]=z.array(z.union(located)).min(compactStock?0:Math.max(1,semanticSource?.commitments?.length??0)).max(12);
 }
 // Every source is a required property. The provider cannot silently omit a clause.
 const verification:Record<string,z.ZodBoolean>={};if(semantic)for(const source of sources)verification[source.id]=z.boolean();
 const schema=semantic?z.object({v:z.literal(2),meanings:z.object(perSource).strict(),verified:z.object(verification).strict()}).strict():z.object({v:z.literal(2),meanings:z.object(perSource).strict()}).strict();
 const prompt=JSON.stringify({message:text,sourceUnits:semantic?sources.map(s=>process.env.INTUNE_COMPACT_CONTEXT==='0'?({...s,original:s.text,text:(s as any).english}):compactSource(s)):sources,confirmedPlan:context.plan,context:process.env.INTUNE_COMPACT_CONTEXT==='0'?context:compactMeaningContext(context)});
 return {schema,providerSchema:zodSchema(schema,{useReferences:true}),prompt,sources};
}
export function decodeSources(value:any,sources:{id:string,text:string,start:number,end:number}[],anchor:number,timezone:string,text:string,semantic?:import('./semanticBridge').SemanticSource[],context?:{responsibilities?:any[]}):Envelope{
 if(semantic&&semantic.some(s=>value.verified?.[s.id]!==true))throw new Error('Unverified translation');
 if(value.meanings&&(Object.keys(value.meanings).length!==sources.length||sources.some(s=>!Array.isArray(value.meanings[s.id])||!value.meanings[s.id].length&&!(semantic?.find(source=>source.id===s.id)?.stockOnly===true&&!!semantic?.find(source=>source.id===s.id)?.grocery?.length))))throw new Error('Incomplete source meanings');
 for(const source of semantic??[]){for(const commitment of source.commitments??[]){const meanings=value.meanings?.[source.id]??[];if(!meanings.some((op:any)=>op.k==='reference'?context?.responsibilities?.some(i=>i.id===op.target&&i.kind===commitment):commitment==='plan'?op.k==='plan':op.k==='item'&&op.category===commitment))throw new Error('Incomplete commitment meanings');}}
 const proposed=value.meanings?sources.flatMap(source=>(value.meanings[source.id]??[]).map((op:any)=>({...op,q:[source.id]}))):value.ops;
 const ops=proposed.map((item:any)=>{
  const op={...item};
  if(semantic){
   const source=semantic.find(s=>s.id===op.q?.[0]);if(!source||op.q.length!==1)throw new Error('Invalid normalized evidence');
   // For an independently attested owned grocery, the backend supplies the
   // whole verified source as evidence. A second hand-copied quote is neither
   // needed nor trusted; item/state agreement and whole-source verification are.
   if(op.k==='item_update'&&!op.replacement&&source.grocery!==undefined){
    const item=context?.responsibilities?.find(i=>i.id===op.target&&i.kind==='grocery');
    if(item){const proof=source.grocery.filter(g=>g.item===item.title&&g.state===op.state);if(proof.length!==1||!['pending','held','ordered','received','paused','stopped'].includes(proof[0].state))throw new Error('Conflicting grocery meaning');op.g=proof[0];op.a=source.english;}
   }
   if(typeof op.a!=='string'||!source.english.toLowerCase().includes(op.a.toLowerCase()))throw new Error('Ungrounded English span');
   if(!allowedPurpose(source.purpose,op.k,op.scope)&&!(source.stockOnly&&(op.k==='conversation'||op.k==='question'&&op.scope==='grocery')))throw new Error('Conflicting source purpose');
   op.e=op.a;op.c=source.english;delete op.a;op.o=op.k==='cycle'&&source.observation;op.h=source.risk;
  }
  if(Array.isArray(op.q)){
   const indices=op.q.map((id:string)=>sources.findIndex(s=>s.id===id));
   if(indices.some((n:number)=>n<0)||new Set(indices).size!==indices.length)throw new Error('Unavailable source evidence');
   indices.sort((a:number,b:number)=>a-b);
   if(indices.at(-1)-indices[0]+1!==indices.length)throw new Error('Noncontiguous evidence');
   op.q=text.slice(sources[indices[0]].start,sources[indices.at(-1)].end);
  }
  // Restore a uniquely explicit date from the independently verified meaning span,
  // using V1 calendar grammar. Never pick between dates or borrow another clause.
  if(semantic&&(op.k==='body'||op.k==='cycle')&&op.s==='reported'&&!op.d&&!op.t){
   const dates=literalLabels(op.e).filter(phrase=>resolveDate(phrase,anchor,timezone));
   if(dates.length===1)op.d=dates[0];
  }
  if(op.k==='question'&&op.scope!=='body')op.l=null;
  if(op.k==='control'&&op.command!=='forget')op.target=null;
  if('d' in op&&'t' in op&&op.t&&resolveDate(op.t,anchor,timezone)&&!resolveTime(op.t)){
   if(!op.d||resolveDate(op.d,anchor,timezone)===resolveDate(op.t,anchor,timezone)){op.d=op.t;op.t=null;}
  }
  return op;
 });
 // An inherited subject is resolved from its explicitly selected prior report.
 // A copied temporal field is never itself a body label; other label conflicts still fail validation.
 // For the compact contract, independently verified state assertions already
 // contain the whole operation. Resolve IDs from owned context in the backend
 // instead of requiring the model to repeat source text and IDs for every item.
 if(semantic)for(const source of semantic){
  if(source.stockOnly===undefined)continue;
  if(source.stockOnly&&(source.risk!=='none'||source.observation||source.purpose&&!['other','correction'].includes(source.purpose)))throw new Error('Conflicting stock-only purpose');
  if(source.stockOnly&&ops.some((op:any)=>op.q===source.text&&!(op.k==='conversation'||op.k==='question'&&op.scope==='grocery'||op.k==='item_update'&&op.g)))throw new Error('Unexpected stock-only meaning');
  const seen=new Set<string>();
  for(const meaning of source.grocery??[]){
   if(seen.has(meaning.item))throw new Error('Conflicting grocery meaning');seen.add(meaning.item);
   if(!['pending','held','ordered','received','paused','stopped'].includes(meaning.state))continue;
   if(!allowedPurpose(source.purpose,'item_update'))throw new Error('Conflicting source purpose');
   const matches=context?.responsibilities?.filter(i=>i.kind==='grocery'&&i.title===meaning.item)??[];
   if(matches.length!==1)throw new Error('Unavailable grocery meaning');
   if(!ops.some((op:any)=>op.k==='item_update'&&op.target===matches[0].id&&op.q===source.text))ops.push({k:'item_update',q:source.text,e:source.english,c:source.english,o:false,h:source.risk,target:matches[0].id,state:meaning.state,replacement:null,g:meaning});
  }
  if(source.stockOnly&&!ops.some((op:any)=>op.q===source.text))ops.push({k:'conversation',q:source.text,e:source.english,c:source.english,o:false,h:source.risk,tone:source.grocery?.some(g=>g.state==='unclear')?'unclear':'context'});
 }
 // No partial list updates: every independently verified actionable item
 // must have its matching owned operation before entering the mutation.
 if(semantic)for(const source of semantic)for(const meaning of source.grocery??[]){
  if(!['pending','held','ordered','received','paused','stopped'].includes(meaning.state))continue;
  const matches=context?.responsibilities?.filter(i=>i.kind==='grocery'&&i.title===meaning.item)??[];
  if(matches.length!==1||ops.filter((op:any)=>op.k==='item_update'&&op.target===matches[0].id&&op.state===meaning.state&&op.g?.item===meaning.item&&op.q===source.text).length!==1)throw new Error('Incomplete grocery meanings');
 }
 for(const [index,op] of ops.entries())if((op.k==='body'||op.k==='cycle')&&op.r!==null&&op.r<index){
  const prior=ops[op.r];
  if(prior?.k===op.k&&(op.e??op.q).toLowerCase().includes(op.l.toLowerCase())&&normalizeLabel(op.l)!==normalizeLabel(prior.l)&&op.l!==op.d&&op.l!==op.t&&!(op.n!==null&&/^[\p{L}\p{N}]+$/u.test(op.l)&&hasNumber(op.l,op.n))){op.r=null;continue;}
  if(prior?.k===op.k&&(op.l===op.d||op.l===op.t||(op.n!==null&&/^[\p{L}\p{N}]+$/u.test(op.l)&&hasNumber(op.l,op.n)))){op.l=prior.l;op.b=prior.b;}
 }
 return {v:value.v,ops,...(semantic?{sources:semantic.map(s=>({q:s.text,e:s.english,o:s.observation,h:s.risk,...(s.purpose?{purpose:s.purpose}:{}),...(s.grocery!==undefined?{grocery:s.grocery}:{})}))}:{})} as Envelope;
}
