import {test,expect,vi,beforeEach,afterEach} from 'vitest';
import {convexTest} from 'convex-test';
import {makeFunctionReference as ref} from 'convex/server';
import schema from '../convex/schema';
import {api,internal} from '../convex/_generated/api';
import {completionShorthand} from '../convex/conversationFocus';
import {conversationRefs} from '../convex/conversationStore';
const generate=vi.hoisted(()=>vi.fn());
vi.mock('@convex-dev/agent',()=>({Agent:class{generateObject=generate;}}));
const modules=import.meta.glob('../convex/**/*.*s'),now=Date.parse('2026-10-09T04:30:00Z');
beforeEach(()=>{vi.spyOn(Date,'now').mockReturnValue(now);vi.spyOn(console,'info').mockImplementation(()=>{});for(const [k,v] of Object.entries({INTUNE_PILOT_MODE:'v3',INTUNE_CONVERSATION_GATE:'candidate',INTUNE_CONVERSATION_ROLLOUT:'all',INTUNE_SEMANTIC_BRIDGE:'legacy',OPENAI_API_KEY:'synthetic'}))vi.stubEnv(k,v);generate.mockReset();});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs();});
// All interpretation replies below are simulated. Real Convex functions/database rules run.
async function fixture(t=convexTest(schema,modules),phone='+12025550161',consent=true){
 const token=await t.mutation(internal.phoneUsers.getOrCreate,{phoneNumber:phone});
 const g:any=await t.mutation(ref<'mutation'>('pilotAccess:grantTest'),{token,grantKey:'conversation-audit-'+phone.slice(1)});
 await t.mutation(ref<'mutation'>('pilotAccess:welcomeAccepted'),{grantId:g.id,providerMessageId:'wamid.audit'+phone});
 await t.mutation(ref<'mutation'>('pilotAccess:welcomeDelivered'),{providerMessageId:'wamid.audit'+phone,recipient:phone.slice(1),deliveredAt:now});
 if(consent)await t.run(async c=>{const u=(await c.db.query('users').withIndex('by_token',q=>q.eq('token',token)).unique())!;await c.db.patch(u._id,{conversationConsent:true,pilotNameAsked:false});});
 const send=(text:string,ops?:any[],messageId=crypto.randomUUID())=>{if(ops)generate.mockResolvedValueOnce({object:{v:2,ops}});return t.action(api.messages.send,{token,text,messageId});};
 return {t,token,send,view:()=>t.query(ref<'query',any,any>('pilotMemory:overview'),{token})};
}
const yes={k:'answer',q:'yes',target:null,choice:'confirm',d:null,t:null,n:null};
async function plan(f:Awaited<ReturnType<typeof fixture>>,activity:string,n:number){const q=`My plan is ${activity} ${n} times this week`;await f.send(q,[{k:'plan',q,activity,n}]);await f.send('yes',[yes]);return (await f.view()).items.find((i:any)=>i.title===activity);}
test('audit: skipped name retires the name question, asks storage consent, and does not save the plan',async()=>{
 const f=await fixture(undefined,undefined,false),q='Skip my name. My plan is walking 3 times this week';
 const r=await f.send(q,[{k:'conversation',q:'Skip my name.',tone:'context'},{k:'plan',q:'My plan is walking 3 times this week',activity:'walking',n:3}]);
 expect(r.message).toContain('May I save');expect((await f.view()).items).toHaveLength(0);
 const c:any=await f.t.query(conversationRefs.context,{token:f.token,messageId:'inspect'});expect(c.preferredName).toBe(null);expect(c.nameAsked).toBe(false);
 await f.send('yes');expect((await f.view()).items).toHaveLength(0); // Pre-consent content intentionally is not replayed.
});
test('audit: two plans make done ambiguous, one named answer resolves it without affecting the other',async()=>{
 const f=await fixture(),walk=await plan(f,'walking',3),swim=await plan(f,'swimming',2);
 const r=await f.send('Done today',[{k:'item_complete',q:'Done today',target:null,d:'today',status:'completed',x:false}]);
 expect(r.message).toContain('walking');expect(r.message).toContain('swimming');expect((await f.view()).events).toHaveLength(0);expect(r.message.match(/\?/g)).toHaveLength(1);
 const q='I completed walking today';await f.send(q,[{k:'item_complete',q,target:walk._id,d:'today',status:'completed',x:false}]);
 const v=await f.view();expect(v.events).toHaveLength(1);expect(v.events[0].itemId).toBe(walk._id);expect(v.events.some((e:any)=>e.itemId===swim._id)).toBe(false);
 const e=v.events[0],correction='Actually walking was yesterday';await f.send(correction,[{k:'item_correct',q:correction,target:e._id,d:'yesterday',status:null}]);await f.send('yes',[yes]);
 expect((await f.view()).events).toHaveLength(1);expect((await f.view()).events[0].date).toBe('2026-10-08');
});
test('audit: topic switch preserves grocery question quietly and resumes it only on a grocery request',async()=>{
 const f=await fixture();await plan(f,'walking',3);
 const q='I need to buy rice';await f.send(q,[{k:'item',q,category:'grocery',title:'rice',ingredients:['rice']}]);
 const before:any=await f.t.query(conversationRefs.view,{token:f.token});expect(before.pending).toHaveLength(1);
 const text='Show my workout plan';const r=await f.send(text,[{k:'question',q:text,scope:'plan',l:null}]);
 expect(r.message).toContain('walking');expect(r.message).not.toContain('Shall I add rice');
 expect((await f.t.query(conversationRefs.view,{token:f.token})).pending).toHaveLength(1); // Pending information is preserved without interrupting an unrelated topic.
 const cq:any=await f.t.query(conversationRefs.context,{token:f.token,messageId:'inspect-focus'});expect(cq.askedPendingId).toBe(null);
 const returnText='Show my grocery list';const resumed=await f.send(returnText,[{k:'question',q:returnText,scope:'grocery',l:null}]);expect(resumed.message).toContain('Shall I add rice');
 expect((await f.send('yes',[yes])).message).toContain('Added to your shopping list');
});
test('audit: two women with identical plans keep updates, corrections and deletion separate',async()=>{
 const a=await fixture(),b=await fixture(a.t,'+12025550162');const ap=await plan(a,'walking',3),bp=await plan(b,'walking',3);
 for(const f of [a,b]){const p=f===a?ap:bp,q='I completed walking today';await f.send(q,[{k:'item_complete',q,target:p._id,d:'today',status:'completed',x:false}]);}
 const ae=(await a.view()).events[0],q='Actually walking was yesterday';await a.send(q,[{k:'item_correct',q,target:ae._id,d:'yesterday',status:null}]);await a.send('yes',[yes]);
 expect((await a.view()).events[0].date).toBe('2026-10-08');expect((await b.view()).events[0].date).toBe('2026-10-09');
 const text='I completed walking today';const forged=await a.send(text,[{k:'item_complete',q:text,target:bp._id,d:'today',status:'completed',x:false}]);expect(forged.outcome).toBe('error');
 await a.send('Delete my pilot data');expect((await a.view()).items).toHaveLength(0);expect((await b.view()).items).toHaveLength(1);expect((await b.view()).events).toHaveLength(1);
});
test('audit: refused capacity save keeps prior records and draft, says no save, retries do not insert',async()=>{
 const f=await fixture();await f.t.run(async c=>{const u=(await c.db.query('users').withIndex('by_token',q=>q.eq('token',f.token)).unique())!;for(let n=0;n<250;n++)await c.db.insert('pilotItems',{userId:u._id,kind:'task',title:'Fictional task '+n,text:'Fictional task '+n,state:'pending',createdAt:now,updatedAt:now});});
 const q='Save a question for my doctor: should I discuss my sleep?';await f.send(q,[{k:'item',q,category:'doctor_question',title:'should I discuss my sleep?',ingredients:[]}]);
 for(let n=0;n<2;n++){const r=await f.send('yes',[yes]);expect(r.outcome).toBe('error');expect(r.message).toContain('No health record was saved');expect((await f.view()).items).toHaveLength(250);expect((await f.t.query(conversationRefs.view,{token:f.token})).pending).toHaveLength(1);}
});

// Selection uses the exact server-displayed order, not database order at reply time.
test('a short ordinal chooses the displayed plan, skips AI, and clears only that question',async()=>{
 const f=await fixture();vi.stubEnv('INTUNE_SEMANTIC_BRIDGE','verified');
 const ids=await f.t.run(async c=>{const u=(await c.db.query('users').withIndex('by_token',q=>q.eq('token',f.token)).unique())!;const ids=[];for(const title of ['walking','swimming'])ids.push(await c.db.insert('pilotItems',{userId:u._id,kind:'plan',title,text:title,target:3,state:'planned',createdAt:now,updatedAt:now}));return ids;});
 generate.mockRejectedValue(new Error('AI unavailable')); // Neither the clear shorthand nor displayed choice needs AI.
 const r=await f.send('Done today');expect(r.message).toContain('1.');expect(r.message).toContain('2.');
 const c:any=await f.t.query(conversationRefs.context,{token:f.token,messageId:'inspect-choice'});const p=c.pending.find((p:any)=>p.id===c.askedPendingId);expect(p.proposal.choices).toHaveLength(2);const second=p.proposal.choices[1].id;const calls=generate.mock.calls.length;
 vi.mocked(Date.now).mockReturnValue(now+86400000);const done=await f.send('the second one',undefined,'ordinal-reply');expect(done.outcome).toBe('conversation');expect(generate.mock.calls.length).toBe(calls);const v=await f.view();expect(v.events).toHaveLength(1);expect(v.events[0].itemId).toBe(second);expect(v.events[0].date).toBe('2026-10-09');expect(ids).toContain(second);await f.send('the second one',undefined,'ordinal-reply');expect((await f.view()).events).toHaveLength(1);expect((await f.t.query(conversationRefs.view,{token:f.token})).pending).toHaveLength(0);
});
test('yes after an unrelated topic cannot approve the hidden grocery draft',async()=>{
 const f=await fixture();const q='I need to buy rice';await f.send(q,[{k:'item',q,category:'grocery',title:'rice',ingredients:['rice']}]);
 const text='What can you do?';await f.send(text,[{k:'question',q:text,scope:'capabilities',l:null}]);
 await f.send('yes',[yes]);expect((await f.view()).items).toHaveLength(0);expect((await f.t.query(conversationRefs.view,{token:f.token})).pending).toHaveLength(1);
});

test.each(['expired','changed','out of range'])('displayed-plan selection refuses %s choices without a completion',async state=>{
 const f=await fixture();await plan(f,'walking',3);await plan(f,'swimming',2);const text='Done today';await f.send(text,[{k:'item_complete',q:text,target:null,d:'today',status:'completed',x:false}]);
 const before:any=await f.t.query(conversationRefs.context,{token:f.token,messageId:'selection-state'});const p=before.pending.find((p:any)=>p.id===before.askedPendingId);expect(p.proposal.choices).toHaveLength(2);
 if(state==='expired')vi.mocked(Date.now).mockReturnValue(now+604800000);
 if(state==='changed')await f.t.run(async c=>{await c.db.patch(p.proposal.choices[1].id,{text:'Changed fictional plan',updatedAt:now+1});});
 vi.stubEnv('INTUNE_SEMANTIC_BRIDGE','verified');const calls=generate.mock.calls.length;const r=await f.send(state==='out of range'?'the eighth one':'the second one');expect((await f.view()).events).toHaveLength(0);expect(generate.mock.calls.length).toBe(calls);if(state==='expired')expect(r.outcome).toBe('unpaid');else expect(r.message).toContain(state==='changed'?'changed since I asked':'not in the list');
});

test.each(['not done','done tomorrow','done today and I felt dizzy','finished shopping','done maybe'])('completion shorthand does not consume ambiguous or mixed text: %s',text=>expect(completionShorthand(text)).toBe(null));
test('done without a date asks for that missing day after selecting a plan',async()=>{
 const f=await fixture();await plan(f,'walking',3);await plan(f,'swimming',2);vi.stubEnv('INTUNE_SEMANTIC_BRIDGE','verified');generate.mockRejectedValue(new Error('AI unavailable'));await f.send('done');const r=await f.send('the first one');expect((await f.view()).events).toHaveLength(0);expect(r.message).toContain('day');
});
