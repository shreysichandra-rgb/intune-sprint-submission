import {clearConversationContext} from './conversationContext';
import {preferredNameAnswer,explicitNameIntroduction} from './pilotName';
import {currentConsentQuestion} from './conversationCopy';
import {v} from 'convex/values';
import {internalQuery} from './_generated/server';
import type {QueryCtx,MutationCtx} from './_generated/server';
import type {Doc,Id} from './_generated/dataModel';
import {pilotUser,assertPilotWrite,pilotEnabled,accessFor,inPilotPeriod} from './pilotAccess';
import {resolveWhen,inWindow} from './rules';
import type {Operation} from './conversationProtocol';
type Reader=QueryCtx|MutationCtx;
// Typography does not make a different instruction; preserve the original text.
export function itemIdentityTitle(title:string){return title.trim().toLowerCase().replace(/[‘’]/g,"'").replace(/\s+/g,' ');}
export async function readItems(ctx:Reader,u:Doc<'users'>){const items=await ctx.db.query('pilotItems').withIndex('by_user',q=>q.eq('userId',u._id)).order('desc').take(251);const events=await ctx.db.query('pilotItemEvents').withIndex('by_user',q=>q.eq('userId',u._id)).order('desc').take(501);if(items.length>250||events.length>500)throw new Error('Record page required; no partial overview returned');return {items,events};}
export function itemsReply(data:Awaited<ReturnType<typeof readItems>>,u:Doc<'users'>,scope='all'){
 if(scope==='grocery')return groceryReply(data.items);
 const rows=data.items.filter(i=>scope==='all'||scope==='history'||scope==='week'||i.kind===scope);const lines=rows.map(i=>{
  const meta=(u.v4Records as any[]|undefined)?.find(r=>r.id===i._id);
  const shownKind=meta?.kind==='meal_choice'?'meal choice':i.kind.replaceAll('_',' ');
  const savedDate=typeof meta?.date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(meta.date)?new Intl.DateTimeFormat('en-IN',{timeZone:'Asia/Kolkata',dateStyle:'medium'}).format(new Date(meta.date+'T12:00:00Z')):null;
  const timing=savedDate||meta?.time?` [${[savedDate,meta?.time].filter(Boolean).join(' at ')}]`:'';
  const events=data.events.filter(e=>e.itemId===i._id);const completed=events.filter(e=>e.status==='completed'&&inPilotPeriod(u,e.date));const skipped=events.filter(e=>e.status==='skipped'&&inPilotPeriod(u,e.date));
  return `${shownKind}: ${i.title}${timing}${['plan','schedule'].includes(i.kind)?` (${completed.length}/${i.target??'?'} in ${u.startDate} to ${u.endDate}; ${skipped.length} reported skipped; completed dates: ${completed.map(e=>e.date).join(', ')||'none'}; skipped dates: ${skipped.map(e=>e.date).join(', ')||'none'})`:events.length?` (completed dates: ${completed.map(e=>e.date).join(', ')||'none'}; skipped dates: ${events.filter(e=>e.status==='skipped'&&inPilotPeriod(u,e.date)).map(e=>e.date).join(', ')||'none'})`:''}. ${i.state}.${i.kind!=='grocery'?' '+i.text:''}`;
 });return lines.length?lines.join('\n'):'No additional responsibilities saved yet.';
}
// A recap is a bounded view of the record, not a rewrite or deletion of it.
export function summaryText(text:string,max=180){const clean=text.replace(/\s+/g,' ').trim();return clean.length>max?clean.slice(0,max-1).trimEnd()+'…':clean;}
// A short title and its saved description can carry different facts. Keep both.
export function summaryFactText(label:string,text:string){
 const clean=(s:string)=>s.replace(/\s+/g,' ').trim();
 const a=clean(label),b=clean(text),fold=(s:string)=>s.toLowerCase().replace(/[.!?]+$/,'');
 if(!a)return b;if(!b)return a;
 if(fold(b).includes(fold(a)))return b;
 if(fold(a).includes(fold(b)))return a;
 return a.replace(/[.!?]+$/,'')+'. '+b;
}
// Rephrase only recognised question forms. Keep uncertainty and clinical choices
// as questions for the doctor; never turn them into advice or infer a plan name.
export function doctorQuestionSummary(title:string,text:string){
 const original=summaryFactText(title,text).replace(/\s+/g,' ').trim();
 const question=original.replace(/^(?:please\s+)?save (?:this |a )?question for my doctor:\s*/i,'').replace(/[?.!]+$/,'').trim();
 if(/["“”‘’]|'[^']+'/u.test(original))return 'Question to discuss with your doctor: “'+original+'”';
 const perspective=(s:string)=>s.replace(/\bmy\b/gi,'your').replace(/\bme\b/gi,'you').replace(/\bI am\b/g,'you are').replace(/\bI\b/g,'you');
 const review=question.match(/^(?:can|could) we review ((?:my|the|your|this) .+)$/i);
 if(review){
  const next=/\s+at (?:the|my|our|your) next appointment$/i.test(review[1]);
  const object=perspective(review[1].replace(/\s+at (?:the|my|our|your) next appointment$/i,''));
  const unspecified=/^(?:your|the|this) (?:(?:existing|current) )?plan$/i.test(object);
  return (next?'At your next appointment, ask':'Ask')+' your doctor to review '+object+'.'+(unspecified?' The saved note does not specify which plan.':'');
 }
 const forms:[RegExp,string][]=[
  [/^should I (.+)$/i,'whether you should '],
  [/^can I (.+)$/i,'whether you can '],
  [/^could I (.+)$/i,'whether you could '],
  [/^do I need to (.+)$/i,'whether you need to '],
  [/^what should I (.+)$/i,'what you should '],
  [/^how can I (.+)$/i,'how you can '],
 ];
 for(const [pattern,prefix]of forms){const m=question.match(pattern);if(m)return 'Ask your doctor '+prefix+perspective(m[1])+'.';}
 return 'Question to discuss with your doctor: “'+original+'”';
}
export function conciseItemsReply(data:Awaited<ReturnType<typeof readItems>>,u:Doc<'users'>){
 const tests=data.items.filter(i=>/\b(?:fictional|synthetic|test (?:note|question|packing|record|reminder))\b/i.test(i.title+' '+i.text));
 const groups=new Map<string,string[]>();let shown=0,hidden=0;
 for(const i of data.items){
  if(tests.includes(i))continue;
  const meta=(u.v4Records as any[]|undefined)?.find(r=>r.id===i._id);
  const category=meta?.kind==='meal_choice'?'Meal choices':({plan:'Plans',schedule:'Schedules',doctor_question:'Doctor follow-up',task:'Tasks',food:'Food and supplement plans',grocery:'Groceries',appointment:'Appointments'} as Record<string,string>)[i.kind]??'Saved information';
  const rows=groups.get(category)??[];
  if(rows.length>=3||shown>=8){hidden++;continue;}
  const same=i.text.trim().toLowerCase().includes(i.title.trim().toLowerCase());
  let detail=summaryText(i.kind==='doctor_question'?doctorQuestionSummary(i.title,i.text):i.kind==='grocery'?i.title:same?i.text:i.title+': '+i.text,i.kind==='doctor_question'?260:180);
  const date=typeof meta?.date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(meta.date)?new Intl.DateTimeFormat('en-IN',{timeZone:u.timezone,dateStyle:'medium'}).format(new Date(meta.date+'T12:00:00Z')):null;
  if(date||meta?.time)detail+=' ['+[date,meta?.time?summaryText(meta.time,40):null].filter(Boolean).join(' at ')+']';
  const events=data.events.filter(e=>e.itemId===i._id&&inPilotPeriod(u,e.date)),completed=events.filter(e=>e.status==='completed'),skipped=events.filter(e=>e.status==='skipped');
  if(['plan','schedule'].includes(i.kind)||events.length){
   const dates=(rows:typeof events)=>{const days=[...new Set(rows.map(e=>e.date))];return days.length?' ('+days.slice(0,3).join(', ')+(days.length>3?', '+(days.length-3)+' more dates':'')+')':'';};
   detail+=`; ${i.target!==undefined?completed.length+'/'+i.target:completed.length} reported completed${dates(completed)}; ${skipped.length} reported skipped${dates(skipped)}`;
  }
  if(i.state!=='planned'&&i.state!=='pending')detail+=' ('+i.state+')';
  rows.push(detail);groups.set(category,rows);shown++;
 }
 return [...groups].map(([label,rows])=>label+':\n'+rows.map(r=>'• '+r).join('\n')).concat(hidden?[hidden+' more saved items available in your full record.']:[],tests.length?['Test notes: '+tests.length+' saved separately; available in your full record.']:[]).join('\n\n');
}
export function groceryReply(items:Doc<'pilotItems'>[],askStock=true){
 const groceries=items.filter(i=>i.kind==='grocery'&&!['stopped','paused'].includes(i.state));
 if(!groceries.length)return items.some(i=>i.kind==='grocery')?'Your shopping list is empty. Your saved information is still available.':'Share the foods in your existing plan and I can help make your grocery list.';
 const names=(states:string[])=>groceries.filter(i=>states.includes(i.state)).map(i=>i.title).join(', ');
 const needed=names(['pending']),home=names(['held','received']),ordered=names(['ordered']),unchecked=names(['planned']);
 return [needed?'Your shopping list: '+needed+'.':'No items confirmed as needing an order.',home?'Already at home: '+home+'.':null,ordered?'Already ordered: '+ordered+'.':null,unchecked?'Still to check: '+unchecked+'.'+(askStock?' Which of these do you already have, and which do you need to order?':''):needed?'You can ask for one ordering nudge with a day and time.':null].filter(Boolean).join('\n');
}
export const overview=internalQuery({args:{token:v.string(),scope:v.optional(v.string())},returns:v.any(),handler:async(ctx,a)=>{const u=await pilotUser(ctx,a.token);const data=await readItems(ctx,u);return {...data,message:itemsReply(data,u,a.scope),name:u.preferredName??null};}});
export async function applyItem(ctx:MutationCtx,u:Doc<'users'>,op:Operation,anchor:number,confirmed:boolean,allowedCorrectionTarget?:string,allowSeparate=false):Promise<{message:string,target?:string,question?:string,mode?:string,changedIds?:string[],choices?:{id:string,label:string}[]}|null>{
 if(!pilotEnabled()||!['profile','plan','item','item_update','item_complete','item_correct','complete'].includes(op.k))return null;
 await assertPilotWrite(ctx,u,allowedCorrectionTarget);if(!u.conversationConsent&&op.k!=='profile')return {message:'Please agree to storage before sharing what you want saved.'};
 const data=await readItems(ctx,u);const source=op.e??op.q;const changed=async()=>{const current=await ctx.db.get(u._id);if(current)await ctx.db.patch(u._id,{memoryVersion:(current.memoryVersion??0)+1});};
 if(op.k==='profile'){
  const name=preferredNameAnswer(op.q);const proposed=preferredNameAnswer(op.name)??op.name.trim().replace(/[.!]+$/,'');
  if(u.storageWithdrawn||!name||!proposed||name.toLowerCase()!==proposed.toLowerCase()||!u.pilotNameAsked&&!explicitNameIntroduction(op.q))return {message:'I haven’t changed your preferred name.'};
  await ctx.db.patch(u._id,{preferredName:name,pilotNameAsked:false});await changed();
  if(!u.conversationConsent||u.pilotFreshConsentPending){await ctx.db.patch(u._id,{conversationConsentAsked:true});return {message:`Nice to meet you, ${name}. ${currentConsentQuestion()}`};}
  return {message:`Hi ${name} 👋 What would you like me to remember or help you stay on top of?`};
 }

 if(op.k==='plan'){
  if(op.n===null)return {message:`Your existing plan is ${op.activity}.`,question:`How many times is your plan for ${u.startDate} to ${u.endDate}?`,mode:'detail'};
  if(!confirmed)return {message:`Your plan is ${op.activity}, ${op.n} times, ${u.startDate} to ${u.endDate}.`,question:'Shall I keep that plan?',mode:'batch'};
  if(data.items.some(i=>i.kind==='plan'&&i.title.toLowerCase()===op.activity.toLowerCase()&&i.state!=='stopped'))return {message:'That plan is already saved. I haven’t added another copy.'};
  const id=await ctx.db.insert('pilotItems',{userId:u._id,kind:'plan',title:op.activity,text:op.q,target:op.n,createdAt:anchor,updatedAt:Date.now(),state:'planned'});await changed();return {message:`Plan saved: ${op.activity}, ${op.n} times (${u.startDate} to ${u.endDate}). Text me when you finish a session.`,changedIds:[id]};
 }
 if(op.k==='item'){
  if(!op.ingredients.length&&/^(?:groceries|grocery list|shopping list|list)$/i.test(op.title.trim())&&/^(?:please\s+)?(?:make|create|show|prepare)(?:\s+me)?\s+(?:a |the |my )?(?:grocery|shopping) list[.!?]*$/i.test(source.trim()))return {message:''};
  if(op.category==='grocery'&&!op.ingredients.length&&/^(?:groceries|grocery list|shopping list|list|food plan)$/i.test(op.title.trim()))return {message:''};
  if(op.category==='grocery'&&op.ingredients.length){
   const names=[...new Set(op.ingredients.map(i=>i.trim()))];
   if(!confirmed)return {message:`Items to add to your shopping list: ${names.join(', ')}.`,question:`Shall I add ${names.join(', ')} to your shopping list?`,mode:'batch'};
   const missing=names.filter(name=>!data.items.some(i=>i.kind==='grocery'&&i.title.toLowerCase()===name.toLowerCase()));
   if(data.items.length+missing.length>250)throw new Error('Item capacity reached');
   const ids:string[]=[];
   for(const name of missing)ids.push(await ctx.db.insert('pilotItems',{userId:u._id,kind:'grocery',title:name,text:op.q,createdAt:anchor,updatedAt:Date.now(),state:'pending'}));
   if(ids.length)await changed();
   return {message:ids.length?'Added to your shopping list.':'Those items are already saved. I haven’t added another copy.',changedIds:ids};
  }
  const shoppingCandidates=data.items.filter(i=>i.kind==='grocery'&&(op.category==='grocery'?i.title.toLowerCase()===op.title.toLowerCase().replace(/^(?:order|buy|get)\s+/,''):op.category==='task'&&/\bneed\b/i.test(source)&&/\border\b/i.test(source)&&op.title.toLowerCase().includes(i.title.toLowerCase())));
  const shoppingItem=shoppingCandidates.length===1?shoppingCandidates[0]:null;
  if(shoppingItem&&/\b(?:(?:do not|don't|don’t|not)\s+(?:need|want|buy|order|shop|purchase)|no need(?: to)?)\b/i.test(source))return {message:'I haven’t added that to your shopping list.'};
  if(shoppingItem&&/\b(?:need|buy|shop|purchase|out of|run out|don't have|do not have)\b/i.test(source))return applyItem(ctx,u,{k:'item_update',q:op.q,target:shoppingItem._id,state:'pending',replacement:null,...(op.e?{e:op.e}:{})},anchor,confirmed);
  if(!confirmed)return op.category==='food'?{message:op.ingredients.length?`I’ve picked out these items from the diet plan you shared: ${[...new Set(op.ingredients)].length>1?[...new Set(op.ingredients)].slice(0,-1).join(', ')+' and '+[...new Set(op.ingredients)].at(-1):op.ingredients[0]}.\nGrocery list to check: ${[...new Set(op.ingredients)].join(', ')}.`:`From your food plan: ${op.q}`,question:op.ingredients.length?'Shall I keep this food plan and list so we can check what you already have?':'Shall I keep this food instruction?',mode:'batch'}:{message:`You asked me to keep: ${op.q}`,question:'Shall I save that?',mode:'batch'};
  if(data.items.some(i=>i.kind===op.category&&i.text===op.q))return {message:'That information is already saved. I haven’t added a second copy.'};
  const matching=data.items.filter(i=>i.kind===op.category&&itemIdentityTitle(i.title)===itemIdentityTitle(op.title)&&!['stopped'].includes(i.state));
  if(op.category!=='grocery'&&!allowSeparate&&matching.length)return {message:'I haven’t added a second instruction.',question:`I already have “${op.title}” saved. Is this the same instruction?`,mode:'item_identity',target:matching.length===1?matching[0]._id:undefined};
  if(data.items.length+1+op.ingredients.length>250)throw new Error('Item capacity reached');
  const id=await ctx.db.insert('pilotItems',{userId:u._id,kind:op.category,title:op.title,text:op.q,createdAt:anchor,updatedAt:Date.now(),state:'pending'});const ids:string[]=[id];
  if(op.category==='food')for(const ingredient of [...new Set(op.ingredients)]){const existing=data.items.find(i=>i.kind==='grocery'&&i.title.toLowerCase()===ingredient.toLowerCase());if(!existing)ids.push(await ctx.db.insert('pilotItems',{userId:u._id,kind:'grocery',title:ingredient,text:ingredient,parentId:id,createdAt:anchor,updatedAt:Date.now(),state:'planned'}));}
  await changed();return {message:op.category==='food'?`Kept your food plan.${op.ingredients.length?'\n'+groceryReply((await readItems(ctx,u)).items):' You can ask for a reminder at a day and time you choose.'}`:`Saved ${op.category.replaceAll('_',' ')}: ${op.title}.`,changedIds:ids};
 }
 if(op.k==='item_update'){
  const item=data.items.find(i=>i._id===op.target);if(!item)return {message:'I haven’t changed another item.',question:'Which saved item do you mean?',mode:'target'};
  if(item.kind!=='grocery'&&op.replacement===null&&op.state==='pending'&&/\b(?:order|ordering|buy|shop|shopping|purchase)\b/i.test(source))throw new Error('Conflicting grocery meaning');
  if(op.g&&(item.kind!=='grocery'||item.title!==op.g.item||op.state!==op.g.state))throw new Error('Unavailable grocery meaning');
  if(op.replacement&&!confirmed)return {message:`Change ${item.title} to ${op.replacement}.`,question:'Shall I make that correction?',mode:'batch'};
  if(item.kind==='grocery'&&!op.g&&op.state==='pending'&&/\b(?:do not|don't|don’t|not)\s+(?:need|want|buy|order|shop|purchase)\b/i.test(source))return {message:'I haven’t added that to your shopping list.'};
  if(item.kind==='grocery'&&!op.g&&op.state==='pending'&&!/\b(?:need|buy|order|shop|purchase|out of|run out|don't have|do not have)\b/i.test(source))return {message:'I haven’t added that to your shopping list.',question:'Do you need to order that item?'};
  await ctx.db.patch(item._id,{state:allowedCorrectionTarget&&(await accessFor(ctx,u)).state!=='active'?item.state:op.state,...(op.replacement?{text:op.replacement}:{}),updatedAt:Date.now()});await changed();if(item.kind==='grocery'){const groceries=(await readItems(ctx,u)).items.filter(i=>i.kind==='grocery');const reminders=await ctx.db.query('pilotReminders').withIndex('by_user',q=>q.eq('userId',u._id)).take(101);if(reminders.length>100)throw new Error('Reminder page required');for(const r of reminders)if(r.groceryOrder&&r.state!=='stopped'&&!groceries.some(i=>i.state==='pending'&&(!r.itemId||(i._id===r.itemId||i.parentId===r.itemId))))await ctx.db.patch(r._id,{state:'stopped'});}return {message:item.kind==='grocery'?'':op.replacement?`Corrected your saved ${item.kind.replaceAll('_',' ')} text.`:`${item.title}: ${op.state}.`,changedIds:[item._id]};
 }
 if(op.k==='item_complete'||op.k==='complete'){
  const plans=data.items.filter(i=>['plan','food','schedule','task','appointment'].includes(i.kind)&&i.state!=='stopped');const target=op.k==='item_complete'?op.target:null;const item=target?plans.find(i=>i._id===target):plans.length===1?plans[0]:null;
  if(!item){const choices=plans.length>1&&plans.length<=8?plans.map(i=>({id:i._id,label:i.title})):[];return {message:'I haven’t counted that against a plan.',question:choices.length?'Which saved plan or instruction does this update belong to?\n'+choices.map((i,n)=>(n+1)+'. '+i.label).join('\n'):'Which saved plan or instruction does this update belong to?',mode:'target',...(choices.length?{choices}:{})};}
  const when=resolveWhen({datePhrase:op.d,timePhrase:op.k==='complete'?op.t:null},anchor,u.timezone);if(when.question)return {message:'I haven’t counted that yet.',question:when.question,mode:'detail'};
  const status=op.k==='item_complete'?op.status:'completed';if(!op.x&&data.events.some(e=>e.itemId===item._id&&e.date===when.date&&e.status===status))return {message:'That plan already has this update on that date. I haven’t added another.',question:'Was this another session? Please say another and the day if it was.'};
  if(data.events.length>=500)throw new Error('Completion capacity reached');const id=await ctx.db.insert('pilotItemEvents',{userId:u._id,itemId:item._id,text:op.q,date:when.date!,status,createdAt:anchor});await changed();const count=data.events.filter(e=>e.itemId===item._id&&e.status==='completed'&&inPilotPeriod(u,e.date)).length+(status==='completed'&&inPilotPeriod(u,when.date!)?1:0);return {message:`${item.title}: ${status} on ${when.date}. ${item.target!==undefined?count+' of '+item.target+' sessions ('+u.startDate+' to '+u.endDate+').':'Your dated update is saved.'}`,changedIds:[id]};
 }
 if(op.k==='item_correct'){
  const event=data.events.find(e=>e._id===op.target);if(!event)return {message:'I haven’t changed a completion.',question:'Which completed or skipped action should I correct?',mode:'target'};
  if(!confirmed)return {message:`Correction: ${op.q}`,question:'Shall I make that correction?',mode:'batch'};
  const when=op.d?resolveWhen({datePhrase:op.d,timePhrase:null},anchor,u.timezone):null;if(when?.question)return {message:'Nothing changed yet.',question:when.question,mode:'detail'};if(!when?.date&&!op.status)return {message:'Nothing changed yet.',question:'What should change about that action?',mode:'detail'};
  await ctx.db.patch(event._id,{...(when?.date?{date:when.date}:{}),...(op.status?{status:op.status}:{}),text:op.q,correctedAt:Date.now()});await changed();const item=data.items.find(i=>i._id===event.itemId);const updated=await readItems(ctx,u);const count=updated.events.filter(e=>e.itemId===event.itemId&&e.status==='completed'&&inPilotPeriod(u,e.date)).length;return {message:`Corrected that session${when?.date?' to '+when.date:''}. ${item?.target!==undefined?count+' of '+item.target+' sessions ('+u.startDate+' to '+u.endDate+').':'The old dated update was replaced.'}`,changedIds:[event._id]};
 }
 return null;
}

// Privacy erasure is available without paid access. Remove owned linked copies too.
export async function forgetPilotRecord(ctx:MutationCtx,u:Doc<'users'>,record:Doc<'pilotItems'>|Doc<'pilotItemEvents'>|Doc<'pilotReminders'>|Doc<'cycleEvents'>){
 if(record.userId!==u._id)throw new Error('Unavailable private record');
 await clearConversationContext(ctx,u);
 const data=await readItems(ctx,u),ids=new Set<string>([record._id]);
 if('kind' in record&&!('repeat' in record)){for(const item of data.items)if(item.parentId===record._id)ids.add(item._id);for(const e of data.events)if(ids.has(e.itemId))ids.add(e._id);}
 const reminders=await ctx.db.query('pilotReminders').withIndex('by_user',q=>q.eq('userId',u._id)).take(101);if(reminders.length>100)throw new Error('Reminder erasure requires paging');for(const r of reminders)if(ids.has(r._id)||r.itemId&&ids.has(r.itemId)||r.cycleId&&ids.has(r.cycleId)){ids.add(r._id);const deliveries=await ctx.db.query('pilotReminderDeliveries').withIndex('by_user',q=>q.eq('userId',u._id)).collect();for(const d of deliveries)if(d.reminderId===r._id)await ctx.db.delete(d._id);}
 const pending=await ctx.db.query('pending').withIndex('by_user',q=>q.eq('userId',u._id)).take(50);const texts=data.items.filter(i=>ids.has(i._id)).map(i=>i.text);
 for(const p of pending)if(ids.has(p.proposal?.target)||(p.proposal?.ops??[]).some((op:any)=>ids.has(op.target)||texts.some(t=>op.q?.includes(t))))await ctx.db.delete(p._id);
 // Saved replies may repeat several records; clear their content instead of guessing which spans remain.
 const replies=await ctx.db.query('whatsappReplies').withIndex('by_user',q=>q.eq('userId',u._id)).collect();for(const r of replies)if(!r.control)await ctx.db.patch(r._id,{body:undefined,...(['queued','sending'].includes(r.status)?{status:'dropped' as const}:{})});
 const synthetic=await ctx.db.query('verificationDeliveries').withIndex('by_user',q=>q.eq('userId',u._id)).collect();for(const d of synthetic)await ctx.db.delete(d._id);
 for(const id of ids)await ctx.db.delete(id as Id<'pilotItems'>);const current=await ctx.db.get(u._id);if(current)await ctx.db.patch(u._id,{memoryVersion:(current.memoryVersion??0)+1});
}
