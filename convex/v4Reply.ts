/** Clear first-contact copy, shared by delivered welcome and recovery. */
export const V4_INTRODUCTION="Hi, I’m InTune 👋 I help you keep your health plans and everyday details together during perimenopause. One less thing to hold in your head.\n\nText or paste a plan you already have. I can turn your food plan into a grocery list, or help you track your physio sessions.\n\nText only for now. Your details stay until you ask me to delete them.";
// The action question follows confirmed delivery and expiry information.
export const V4_FIRST_ACTION="What would you like a hand remembering first? You can tell me about symptoms you’re experiencing, a question for your doctor, or a workout or nutrition plan you’re following.\n\nFor example:\n• “I’ve been waking up tired this week.”\n• “Remind me to ask my doctor about my irregular periods.”\n• “My physio sessions are Monday, Wednesday and Friday at 9 am.”\n• “Here’s my nutrition plan. Help me make a grocery list.”\n\nJust type it as you’d tell a friend. We’ll take it one thing at a time.";
export const V4_WELCOME=V4_INTRODUCTION;

/** Preserve an introduction without attaching a second empty greeting. */
export function preserveV4Introduction(reply:string,previous:string,required:boolean):string {
 if(!required)return reply;
 const cleaned=reply.trim().replace(/(?:^|\s)(?:Hi|Hello|Hey)[!.]?\s*$/i,'').trim();
 if(/\bInTune\b/i.test(cleaned)&&/text[ -]only/i.test(cleaned)&&/delete/i.test(cleaned)&&/perimenopause/i.test(cleaned))return cleaned;
 const remainder=cleaned.replace(/^Hi[,!]?\s*(?:I[’']m|I am) InTune[.!]?\s*/i,'').replace(/^(?:Hi|Hello|Hey)[!.]\s*/i,'').trim();
 return V4_INTRODUCTION+(remainder?'\n\n'+remainder:'');
}

/** A quoted saved question is data, not a new clarification request. */
export function lastV4Question(reply:string):string|null {
 const unquoted=reply.replace(/“[^”\n]*\?[^”\n]*”|"[^"\n]*\?[^"\n]*"/g,'.');
 return unquoted.match(/[^.!?]*\?/g)?.at(-1)?.trim()||null;
}

/** A reply writer may reword confirmations, but must not replace an unanswered question. */
export function preserveV4Question(reply:string,question:string|null):string {
 const quotes:string[]=[];
 const protectedReply=reply.replace(/“[^”\n]*\?[^”\n]*”|"[^"\n]*\?[^"\n]*"/g,quoted=>{const index=quotes.push(quoted)-1;return '\uE000'+index+'\uE001.';});
 let statements=protectedReply.replace(/[^.!?]*\?/g,'').trim().replace(/\uE000(\d+)\uE001\./g,(_match,index)=>quotes[Number(index)]);
 if(!question)return statements;
 // A backend question can include a helpful second sentence; keep it once.
 for(const sentence of question.match(/[^.!?]+[.!]/g)??[])statements=statements.split(sentence.trim()).join('').trim();
 return (statements?statements+' ':'')+question;
}

/** Keep capability limits truthful without repeating equivalent explanations. */
export function explainUnavailableReminders(reply:string):string {
 const seen=new Set<string>();
 reply=(reply.match(/[^.!?]+[.!?]?/g)??[reply]).filter(sentence=>{
  if(!/reminders?|reminder delivery/i.test(sentence))return true;
  const key=sentence.trim().toLowerCase();if(seen.has(key))return false;seen.add(key);return true;
 }).join('').trim();
 if(/(?:reminders?|reminder delivery)[^.?!]{0,120}(?:unavailable|(?:isn['’]t|aren['’]t|not) (?:available|configured|enabled))|(?:can['’]t|cannot)[^.?!]{0,60}(?:send|set|schedule)[^.?!]{0,50}reminders?/i.test(reply))return reply;
 return reply+' Automatic reminders aren’t available yet.';
}

/** A profile-only update cannot answer or discard an independent health question. */
export function preserveTasksOnProfileUpdate(previous:any[],proposed:any[],actions:any[]):any[] {
 if(!actions.length||actions.some(action=>action.type!=='profile'))return proposed;
 const result=[...proposed];
 for(const task of previous){
  const setup=/^(?:name|optional name|onboarding name)$/i.test(task.topic??'')||/call you|your (?:preferred )?name|help remembering|remembering first/i.test(task.question??'');
  if(!setup&&!result.some(next=>next.id===task.id))result.push({...task,question:null});
 }
 return result;
}

/** Batching the same incoming message must not lose newly proposed unanswered tasks. */
export function mergeNewTurnTasks(parts:any[],finalTasks:any[],messageId:string):any[] {
 const result=[...finalTasks];
 for(const part of parts)for(const task of part.tasks??part.open_tasks??[]){
  if((task.sourceMessageId??messageId)!==messageId)continue;
  if(!result.some(next=>next.id===task.id||next.sourceMessageId===messageId&&next.topic===task.topic))result.push({...task,sourceMessageId:messageId});
 }
 return result;
}

/** Ask one proposed concrete question, keeping other tasks dormant. */
export function focusV4Question(proposal:any,messageId:string):void {
 const specific=proposal.open_tasks.filter((task:any)=>task.question&&task.sourceMessageId===messageId&&!task.id.startsWith('clarify:'));
 if(specific.length>1&&proposal.clarification&&!specific.some((task:any)=>task.question===proposal.clarification)){
  const combined=proposal.clarification;proposal.clarification=specific[0].question;
  proposal.open_tasks=proposal.open_tasks.filter((task:any)=>!(task.id.startsWith('clarify:')&&task.sourceMessageId===messageId&&task.question===combined));
  proposal.reply=preserveV4Question(proposal.reply,proposal.clarification);
 }
 for(const task of proposal.open_tasks)if(task.question!==proposal.clarification)task.question=null;
}

/** The final wording pass needs changed/referenced records, not every unrelated saved fact. */
export function confirmationRecords(before:any[],after:any[],actions:any[],text:string,reply:string):any[] {
 if(actions.some(a=>a.type==='retrieve'&&!a.targetId))return after;
 const old=new Set(before.map(r=>r.id)),targets=new Set(actions.flatMap(a=>[a.targetId,a.parentId]).filter(Boolean));
 const mentioned=(text+' '+reply).toLowerCase();
 const selected=after.filter(r=>!old.has(r.id)||targets.has(r.id)||r.label&&mentioned.includes(r.label.toLowerCase()));
 const parents=new Set(selected.map(r=>r.parentId).filter(Boolean));
 return after.filter(r=>selected.includes(r)||parents.has(r.id));
}

/** A substantive update already supplies the focus; optional naming must not block it. */
export function retireV4OptionalName(proposal:any,allowFirstSaveName=false){
 if(!proposal.actions.some((a:any)=>['save','correct','complete'].includes(a.type)))return proposal;
 const isName=(question:any)=>typeof question==='string'&&/call (?:you|me)|your (?:preferred )?name/i.test(question);
 if(allowFirstSaveName&&proposal.actions.some((a:any)=>a.type==='save')&&!proposal.open_tasks.some((t:any)=>!isName(t.question)&&!/^(?:name|optional name|onboarding name)$/i.test(t.topic??'')))return proposal;
 proposal.open_tasks=proposal.open_tasks.filter((t:any)=>!isName(t.question)&&!/^(?:name|optional name|onboarding name)$/i.test(t.topic??''));
 if(isName(proposal.clarification)){proposal.clarification=null;proposal.reply=preserveV4Question(proposal.reply,null)||'Checking the details you shared.';}
 return proposal;
}

/** The optional profile question is about the woman, never the assistant. */
export function normalizeV4NameQuestion(proposal:any,needsName:boolean){
 if(!needsName||proposal.safety.intent!=='none')return proposal;
 const isName=(q:any)=>typeof q==='string'&&/what (?:would you like|should|can).*call (?:me|you)|your (?:preferred )?name/i.test(q);
 if(!isName(proposal.clarification))return proposal;
 const question='What would you like me to call you?';
 proposal.open_tasks=proposal.open_tasks.map((t:any)=>isName(t.question)?{...t,question}:t);
 proposal.clarification=question;
 const statements=preserveV4Question(proposal.reply,null).replace(/(?:You can (?:also )?send a plan instead[.!]?\s*)+/gi,'').trim();
 proposal.reply=statements+' '+question+' You can skip this and send your plan instead.';
 return proposal;
}

/** Retire a pantry question only when every owned item it concerns has known stock. */
export function retireV4ResolvedStock(proposal:any,before:any[]){
 const resolved=proposal.open_tasks.filter((t:any)=>/grocery stock|home.stock|at home/i.test(t.topic+' '+(t.question??''))).filter((t:any)=>{
  const groceries=before.filter((r:any)=>r.kind==='grocery'&&(r.sourceMessageId===t.sourceMessageId||r.id===t.targetId));
  return groceries.length>0&&groceries.every((r:any)=>{const update=proposal.actions.find((x:any)=>x.type==='correct'&&x.targetId===r.id);return ['held','pending','ordered','received'].includes(update?.state??r.state);});
 });
 if(!resolved.length)return;
 const questions=new Set(resolved.map((t:any)=>t.question).filter(Boolean));
 proposal.open_tasks=proposal.open_tasks.filter((t:any)=>!resolved.includes(t)&&!questions.has(t.question));
 if(questions.has(proposal.clarification)){proposal.clarification=null;proposal.reply=preserveV4Question(proposal.reply,null);}
}

/** A grocery update must not reopen a different saved plan's setup question. */
export function finishV4GroceryReply(p:any,before:any[],previousTasks:any[],outcomes:any[],introRequired:boolean){
 const groceries=p.actions.length&&p.actions.every((a:any)=>['save','correct'].includes(a.type)&&(a.kind==='grocery'||before.some((r:any)=>r.id===a.targetId&&r.kind==='grocery')));
 if(!groceries)return;
 const oldPlan=before.find((r:any)=>['plan','schedule','appointment'].includes(r.kind)&&r.label?.length>=3&&p.clarification&&(p.clarification.toLowerCase().includes(r.label.toLowerCase())||p.open_tasks.some((t:any)=>t.question===p.clarification&&(t.targetId===r.id||t.topic?.toLowerCase().includes(r.label.toLowerCase()))))&&!p.actions.some((a:any)=>a.label?.toLowerCase().includes(r.label.toLowerCase())));
 if(oldPlan){const question=p.clarification,old=previousTasks.find((t:any)=>t.targetId===oldPlan.id||t.topic?.toLowerCase().includes(oldPlan.label.toLowerCase())||t.question===question);p.clarification=null;p.reply=preserveV4Question(p.reply,null);p.open_tasks=p.open_tasks.filter((t:any)=>!(t.question===question&&old&&t.id!==old.id)).map((t:any)=>({...t,question:null}));if(old&&!p.open_tasks.some((t:any)=>t.id===old.id))p.open_tasks.push({...old,question:null});}
 if(/already/i.test(p.reply)&&p.actions.every((a:any)=>a.type==='save'&&a.kind==='grocery'&&a.state==='pending')&&outcomes.length&&outcomes.every((o:any)=>o.status==='saved')){
  const labels=p.actions.map((a:any)=>a.label).filter(Boolean);if(labels.length===p.actions.length)p.reply=preserveV4Introduction('Added '+labels.join(', ')+' to your shopping list.'+(p.clarification?' '+p.clarification:''),p.reply,introRequired);
 }
}

/** Guidance only after independent review confirms there is no interpretable fact or request. */
export function guidedUnclearReply(state:any,reminderAvailable:boolean):{reply:string;question:string;task?:any}{
 let question='Could you type it again?',lead='I didn’t catch that message.';
 if(state.control.tracking==='stopped'||!state.control.storage){question='What would you like help with?';lead+=' You can type Help to see your available controls.';}
 else if(state.access.mode==='unpaid'){question='Could you type your question in a short sentence?';lead+=' InTune helps keep your notes and agreed reminders together. Send Join to see the ₹99 seven-day offer.';}
 else if(state.access.mode==='eligible'){question='Could you type your question in a short sentence?';lead+=' Your payment or coupon is already accepted. I’m waiting for WhatsApp to confirm your welcome arrived.';}
 else if(!['active_paid','active_test'].includes(state.access.mode)){question='What would you like to look up?';lead+=' You can still ask for your saved notes, for example: Show my saved notes.';}
 else{
  const pending=state.tasks.filter((t:any)=>t.question&&!/conversation clarification|name|first task invitation/i.test(t.topic??'')&&(!/reminder|check-in/i.test(t.topic??'')||reminderAvailable&&state.control.tracking==='active'));
  if(pending.length===1){const task=pending[0];question=task.question;if(/\btime\b/i.test(question)&&!/day|date|which plan|which session/i.test(question))lead+=' For the time, you can type 8:30 am.';else lead+=' You can answer the last question in a short sentence.';return {reply:lead+' '+question,question,task};}
  lead+=' You can send one thing at a time. For example: '+(reminderAvailable&&state.control.tracking==='active'?'Remind me tomorrow at 9 am to review my doctor questions.':'Keep this note: ask my doctor about my routine.');
 }
 return {reply:lead+' '+question,question};
}

/** Keep response rewrites in the language of the current participant message. */
export function v4ReplyLanguage(text:string):string|null {
 const languageRequest=/(?:\b(?:explain|reply|respond|speak|talk|samjha\w*|samja\w*|samjaye|bata\w*|bolo|boliye)\b|समझ|बताइ|बता|बोल)/iu.test(text);
 if(languageRequest&&/\benglish\b/iu.test(text)&&!/\b(?:hindi|hinglish)\b|हिंदी|हिन्दी/iu.test(text))return 'English';
 if(languageRequest&&/\bhinglish\b/iu.test(text))return 'Hinglish (natural Roman Hindi mixed with English)';
 if(/[\u0900-\u097f]/u.test(text))return 'Hindi';
 if(languageRequest&&/\bhindi\b/iu.test(text))return 'Hinglish (natural Roman Hindi mixed with English)';
 return /\b(?:aaj|yaad|dilana|mera|meri|mere|mein|hain|hai|hoon|mujhe|batao|dikhao|karo|karna|chahiye|nahi|nhi|haan|kaise|khaya|bhejo)\b/i.test(text)?'Hinglish (natural Roman Hindi mixed with English)':/[A-Za-z]/.test(text)?'English':null;
}
