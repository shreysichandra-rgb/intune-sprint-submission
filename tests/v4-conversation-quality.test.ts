import {test,expect} from 'vitest';
import {v4ConversationContext,hasV4ResultStatement,retireV4IrrelevantQuestion} from '../convex/v4ConversationQuality';
test('a question-only reply cannot confirm successful changes',()=>{
 expect(hasV4ResultStatement('What would you like to ask your doctor?')).toBe(false);
 expect(hasV4ResultStatement('Added oats and yogurt. What would you like to ask your doctor?')).toBe(true);
 expect(hasV4ResultStatement('Saved your question: “Can we review my plan?”')).toBe(true);
});
test('independent relevance review can remove an unrelated question from a save, while preserving dormant work',()=>{
 const question='What would you like to ask your doctor?';
 const old={id:'earlier',topic:'unrelated unfinished plan',sourceMessageId:'old',question:'Which days?'};
 const p:any={reply:'Oats are marked as at home. '+question,clarification:question,actions:[{type:'correct'}],safety:{intent:'none'},open_tasks:[{id:'new',sourceMessageId:'current',question},old]};
 expect(retireV4IrrelevantQuestion(p,{complete:true,conversationEvidence:'Back to shopping.',irrelevantConversationQuestion:question},'current','Back to shopping.')).toBe(true);
 expect(p.reply).toBe('Oats are marked as at home.');expect(p.clarification).toBeNull();expect(p.open_tasks).toEqual([{...old,question:null}]);
});
test.each(['reminder','complete','remove'])('relevance review does not retire a question around a %s action',type=>{
 const p:any={reply:'Which one?',clarification:'Which one?',actions:[{type}],safety:{intent:'none'},open_tasks:[]};expect(retireV4IrrelevantQuestion(p,{complete:true,conversationEvidence:'message',irrelevantConversationQuestion:'Which one?'},'current','message')).toBe(false);
});
test('unverified, mismatched and incomplete reviews cannot remove a question',()=>{
 for(const check of [{complete:false},{complete:true,missing:['detail']},{complete:true,conversationEvidence:'different'},{complete:true,irrelevantConversationQuestion:'Different?'}]){
 const p:any={reply:'Which one?',clarification:'Which one?',actions:[{type:'save'}],safety:{intent:'none'},open_tasks:[]};expect(retireV4IrrelevantQuestion(p,{complete:true,conversationEvidence:'message',irrelevantConversationQuestion:'Which one?',...check},'current','message')).toBe(false);
 }
});
test('the reply writer gets a bounded recent dialogue and the current focus, with no permission authority from earlier replies',()=>{
 const h=Array.from({length:12},(_,i)=>({role:i%2?'assistant':'user',text:'turn '+i,at:i,messageId:'m'+i}));const c=v4ConversationContext(h,[{id:'t',topic:'doctor',question:'Which question?'}]);expect(c.recentDialogue).toHaveLength(6);expect(c.recentDialogue[0].text).toBe('turn 6');expect(c.unfinishedTasks[0].topic).toBe('doctor');expect(c.historyGrantsPermission).toBe(false);
 expect(v4ConversationContext([{role:'user',text:'x'.repeat(9000)}],[]).recentDialogue).toEqual([]);
});
test('a verified completion can close without repeating unrelated setup, but an unvalidated one keeps its question',()=>{
 const make=()=>({reply:'Logged your session. Which days?',clarification:'Which days?',actions:[{type:'complete',targetId:'owned'}],safety:{intent:'none'},open_tasks:[{id:'old',sourceMessageId:'earlier',topic:'schedule setup',question:'Which days?'}]});
 const check={complete:true,conversationEvidence:'Done today',irrelevantConversationQuestion:'Which days?'};
 expect(retireV4IrrelevantQuestion(make(),check,'current','Done today')).toBe(false);
 const p=make();expect(retireV4IrrelevantQuestion(p,check,'current','Done today',true)).toBe(true);expect(p.reply).toBe('Logged your session.');expect(p.open_tasks[0].question).toBeNull();
});
