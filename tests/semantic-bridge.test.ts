import {test,expect,vi,beforeEach,afterEach} from 'vitest';
import {convexTest} from 'convex-test';
import schema from '../convex/schema';
import {api,internal} from '../convex/_generated/api';
import {conversationRefs} from '../convex/conversationStore';
import {extractionInput,decodeSources} from '../convex/conversationInput';
import {normalizedSources,normalizationInput,normalizationGroups} from '../convex/semanticBridge';
import {validateEnvelope} from '../convex/conversationProtocol';
const generate=vi.hoisted(()=>vi.fn());vi.mock('@convex-dev/agent',()=>({Agent:class{generateObject=generate;}}));
const modules=import.meta.glob('../convex/**/*.*s'),now=Date.parse('2026-10-07T09:00:00+05:30');
beforeEach(()=>{vi.stubEnv('INTUNE_CONVERSATION_GATE','candidate');vi.stubEnv('INTUNE_SEMANTIC_BRIDGE','verified');vi.stubEnv('OPENAI_API_KEY','synthetic');vi.spyOn(Date,'now').mockReturnValue(now);generate.mockReset();});afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs();});
const body=(s='reported')=>({k:'body',l:'hot flashes',b:'hot flashes',r:null,n:s==='reported'?2:null,d:'today',t:null,x:false,s});
async function fixture(){const t=convexTest(schema,modules),token=await t.mutation(internal.phoneUsers.getOrCreate,{phoneNumber:'+12025550130'});await t.mutation(conversationRefs.enroll,{token});await t.run(async ctx=>{const u=(await ctx.db.query('users').withIndex('by_token',q=>q.eq('token',token)).unique())!;await ctx.db.patch(u._id,{conversationConsent:true,trackedItems:['hot flashes']});});return {t,token,view:()=>t.query(conversationRefs.view,{token}),send:async(text:string,english:string,ops:any[],observation=false)=>{const c=await t.query(conversationRefs.context,{token,messageId:'fixture'});if(!(/^(yes|yes please|no)[.!]?$/i.test(text)&&c.askedPendingId&&c.consent&&!c.safetyPaused))generate.mockResolvedValueOnce({object:{u0:{english,observation,risk:ops.some(o=>o.k==='safety'&&o.category==='mental')?'self_harm_intent':'none'}}}).mockResolvedValueOnce({object:{v:2,meanings:{u0:ops.map(op=>({...op,a:english}))},verified:{u0:true}}});return t.action(api.messages.send,{token,text,messageId:crypto.randomUUID()});}};}
test('Hindi dates reach unchanged calendar arithmetic; original text remains stored',async()=>{const f=await fixture();const r=await f.send('aaj 2 hot flashes hue','2 hot flashes today',[body()]);expect(r.outcome).toBe('conversation');const v=await f.view();expect(v.body).toHaveLength(2);expect(v.body[0]).toMatchObject({rawText:'aaj 2 hot flashes hue',occurrenceDate:'2026-10-07'});expect(generate).toHaveBeenCalledTimes(2);});
test('negated unfamiliar report cannot become a count confirmation even with incorrect reported status',async()=>{const f=await fixture();const r=await f.send('aaj hot flashes nahi hue','no hot flashes today',[{...body(),s:'reported',n:null}]);expect(r.message).not.toContain('Have I got');expect((await f.view()).pending).toHaveLength(0);expect((await f.view()).body).toHaveLength(0);});
test('Hindi self harm is checked against approved canonical safety rules without storing an occurrence',async()=>{const f=await fixture();const r=await f.send('मेरा खुद को नुकसान पहुंचाने का इरादा है','I intend to harm myself',[{k:'safety',category:'mental'}]);expect(r.outcome).toBe('safety');expect((await f.view()).safetyPaused).toBe(true);expect((await f.view()).body).toHaveLength(0);});
test('normal current late-cycle observation is distinct from onset date and duration count',async()=>{const f=await fixture();await f.send('period 4 din late hai','My period is 4 days late',[{k:'cycle',l:'period is 4 days late',b:null,r:null,n:1,d:null,t:null,x:false,s:'reported'}],true);expect((await f.view()).cycle[0]).toMatchObject({label:'period is 4 days late',occurrenceDate:'2026-10-07',rawText:'period 4 din late hai'});});
test('verification rejection and forged evidence save nothing',()=>{const source=normalizedSources({u0:{english:'2 hot flashes today',observation:false,risk:'none'}},normalizationInput('aaj 2 hot flashes hue').sources);expect(()=>decodeSources({v:2,meanings:{u0:[{...body(),a:'2 hot flashes today'}]},verified:{u0:false}},source,now,'Asia/Kolkata','aaj 2 hot flashes hue',source)).toThrow('Unverified');expect(()=>validateEnvelope('aaj 2 hot flashes hue',{v:2,ops:[{...body(),q:'aaj 2 hot flashes hue',e:'2 hot flashes today'}]})).toThrow('Unattested');expect(extractionInput('aaj 2 hot flashes hue',{},source).schema.safeParse({v:2,meanings:{u0:[body()]}}).success).toBe(false);});
test('later plan question gets focus without discarding the older duplicate question',async()=>{const f=await fixture();await f.send('2 hot flashes today','2 hot flashes today',[body()]);await f.send('hot flashes today','hot flashes today',[{...body(),n:1}]);await f.send('workout 3 times this week','workout 3 times this week',[{k:'plan',activity:'workout',n:3}]);const v=await f.view();expect(v.pending).toHaveLength(1);const ctx=await f.t.query(conversationRefs.context,{token:f.token,messageId:'none'});expect(ctx.askedPendingId).toBe(v.plan.pending[0]._id);const r=await f.send('yes','yes',[{k:'answer',target:ctx.askedPendingId,choice:'confirm',d:null,t:null,n:null}]);expect(r.message).toContain('0/3');expect((await f.view()).pending).toHaveLength(1);});
test('new correction gets focus ahead of retained duplicate and confirms without another model call',async()=>{const f=await fixture();await f.send('1 hot flashes today','1 hot flashes today',[{...body(),n:1}]);await f.send('hot flashes today','hot flashes today',[{...body(),n:1}]);let v=await f.view();await f.send('actually that was yesterday','actually that was yesterday',[{k:'correct',target:v.body[0]._id,n:null,d:'yesterday',t:null,status:null}]);v=await f.view();const calls=generate.mock.calls.length;await f.send('yes','yes',[{k:'answer',target:null,choice:'confirm',d:null,t:null,n:null}]);expect(generate).toHaveBeenCalledTimes(calls);v=await f.view();expect(v.body.every((r:any)=>r.occurrenceDate==='2026-10-06')).toBe(true);expect(v.pending).toHaveLength(1);});
test('per-meaning spans retain different counts and dates within one translated source',async()=>{const f=await fixture(),text='kal 3 hot flashes hue aur aaj 1 aur hua',english='3 hot flashes yesterday and 1 today';generate.mockResolvedValueOnce({object:{u0:{english,observation:false,risk:'none'}}}).mockResolvedValueOnce({object:{v:2,verified:{u0:true},meanings:{u0:[{...body(),a:'3 hot flashes yesterday',n:3,d:'yesterday'},{...body(),a:'1 today',r:0,n:1}]}}});await f.t.action(api.messages.send,{token:f.token,messageId:'dense',text});await f.send('yes','yes',[{k:'answer',target:null,choice:'confirm',d:null,t:null,n:null}]);const v=await f.view();expect(v.body).toHaveLength(4);expect(v.body.filter((r:any)=>r.occurrenceDate==='2026-10-06')).toHaveLength(3);});
test('translated consent is accepted only after the explicit storage question, not after a medical reply',async()=>{const f=await fixture();await f.t.run(async ctx=>{const u=(await ctx.db.query('users').withIndex('by_token',q=>q.eq('token',f.token)).unique())!;await ctx.db.patch(u._id,{conversationConsent:false});});await f.t.action(api.messages.send,{token:f.token,messageId:'hello',text:'hi'});await f.send('हाँ','yes',[{k:'answer',target:null,choice:'confirm',d:null,t:null,n:null}]);expect((await f.view()).consent).toBe(true);});

test('provider schema permits unfamiliar literal labels and rejects inferred synonyms',()=>{const original='kal raat sweating hui',sources=normalizedSources({u0:{english:'I was sweating last night',observation:false,risk:'none'}},normalizationInput(original).sources),schema=extractionInput(original,{},sources).schema;const value=(l:string)=>({v:2,verified:{u0:true},meanings:{u0:[{...body(),l,b:null,n:1,d:'last night',a:'I was sweating last night'}]}});expect(schema.safeParse(value('sweating')).success).toBe(true);expect(schema.safeParse(value('night sweats')).success).toBe(false);});
test('provider schema cannot claim explicit new-event wording absent from source',()=>{const original='kal 3 hot flashes hue aur aaj 1 hua',sources=normalizedSources({u0:{english:'3 hot flashes yesterday and 1 today',observation:false,risk:'none'}},normalizationInput(original).sources),schema=extractionInput(original,{},sources).schema;expect(schema.safeParse({v:2,verified:{u0:true},meanings:{u0:[{...body(),a:'3 hot flashes yesterday',d:'yesterday',n:3,x:true}]}}).success).toBe(false);});

test('verified support preserves an omitted explicit present date through confirmation',async()=>{const f=await fixture();await f.send('hot flsh rn 😓','Hot flash right now 😓',[{...body(),l:'Hot flash',n:1,d:null}]);let v=await f.view();if(v.pending.length)await f.send('yes','yes',[]);v=await f.view();expect(v.body).toHaveLength(1);expect(v.body[0].occurrenceDate).toBe('2026-10-07');expect(v.pending).toHaveLength(0);});
test('safety return to the server-owned question does not depend on another model call',async()=>{const f=await fixture();await f.send('मेरा खुद को नुकसान पहुंचाने का इरादा है','I intend to harm myself',[{k:'safety',category:'mental'}]);await f.send('aaj hot flash hua','Hot flash today',[{...body(),n:1}]);generate.mockReset();generate.mockRejectedValue(new Error('Provider unavailable'));const r=await f.t.action(api.messages.send,{token:f.token,messageId:'return',text:'yes'});expect(r.outcome).toBe('safety_resumed');expect(generate).not.toHaveBeenCalled();expect((await f.view()).safetyPaused).toBe(false);expect((await f.view()).body).toHaveLength(0);});
test('two different dates in support stay unresolved rather than choosing one',()=>{const original='hot flash yesterday or today',source=normalizedSources({u0:{english:original,observation:false,risk:'none'}},normalizationInput(original).sources);const result=decodeSources({v:2,verified:{u0:true},meanings:{u0:[{...body(),l:'hot flash',n:1,d:null,a:original}]}},source,now,'Asia/Kolkata',original,source);expect((result.ops[0] as any).d).toBeNull();});

test('medical question retains its boundary alongside an older missing-date question',async()=>{const f=await fixture();await f.send('hot flash','Hot flash',[{...body(),l:'Hot flash',n:1,d:null}]);let v=await f.view();expect(v.pending).toHaveLength(1);const r=await f.send('doctor ko HRT ke baare mein poochna hai','I want to ask my doctor about HRT',[{k:'question',scope:'medical',l:null}]);expect(r.message).toContain('HRT');expect(r.message).toContain('doctor');expect((await f.view()).pending).toHaveLength(1);expect((await f.view()).body).toHaveLength(0);});
test('yes before the safety-return question asks rather than resumes',async()=>{const f=await fixture();await f.send('मेरा खुद को नुकसान पहुंचाने का इरादा है','I intend to harm myself',[{k:'safety',category:'mental'}]);generate.mockReset();const r=await f.t.action(api.messages.send,{token:f.token,messageId:'premature',text:'yes'});expect(r.outcome).toBe('safety_paused');expect((await f.view()).safetyPaused).toBe(true);expect(generate).not.toHaveBeenCalled();});

test('independently classified correction cannot decode as a second event',()=>{const original='actually that hot flash was yesterday',sources=normalizedSources({u0:{english:original,observation:false,risk:'none',purpose:'correction'}},normalizationInput(original).sources);const value={v:2,verified:{u0:true},meanings:{u0:[{...body(),l:'hot flash',d:'yesterday',n:1,a:original}]}};expect(extractionInput(original,{},sources).schema.safeParse(value).success).toBe(false);expect(()=>decodeSources(value,sources,now,'Asia/Kolkata',original,sources)).toThrow('Conflicting source purpose');});
test('correction stays a correction and completion stays a completion in provider schemas',()=>{for(const [purpose,k] of [['correction','correct'],['completion','complete']] as const){const text=purpose==='correction'?'Actually that was yesterday':'Workout completed yesterday';const sources=normalizedSources({u0:{english:text,observation:false,risk:'none',purpose}},normalizationInput(text).sources);const schema=extractionInput(text,{},sources).schema;const op=k==='correct'?{k,target:null,n:null,d:'yesterday',t:null,status:null,a:text}:{k,d:'yesterday',t:null,x:false,a:text};expect(schema.safeParse({v:2,verified:{u0:true},meanings:{u0:[op]}}).success).toBe(true);}});
test('misclassified correction fails closed instead of increasing the saved count',async()=>{const f=await fixture();await f.send('hot flash today','Hot flash today',[{...body(),l:'Hot flash',n:1}]);const before=await f.view(),text='actually that hot flash was yesterday';generate.mockResolvedValueOnce({object:{u0:{english:text,observation:false,risk:'none',purpose:'correction'}}}).mockResolvedValueOnce({object:{v:2,verified:{u0:true},meanings:{u0:[{...body(),l:'hot flash',n:1,d:'yesterday',a:text}]}}});const r=await f.t.action(api.messages.send,{token:f.token,messageId:'bad-correction',text});expect(r.outcome).toBe('error');expect((await f.view()).body).toEqual(before.body);});
test('independently classified correction changes one owned truth after confirmation',async()=>{const f=await fixture();await f.send('hot flash today','Hot flash today',[{...body(),l:'Hot flash',n:1}]);const old=(await f.view()).body[0],text='actually that hot flash was yesterday';generate.mockResolvedValueOnce({object:{u0:{english:text,observation:false,risk:'none',purpose:'correction'}}}).mockResolvedValueOnce({object:{v:2,verified:{u0:true},meanings:{u0:[{k:'correct',target:old._id,n:null,d:'yesterday',t:null,status:null,a:text}]}}});await f.t.action(api.messages.send,{token:f.token,messageId:'good-correction',text});await f.t.action(api.messages.send,{token:f.token,messageId:'confirm-correction',text:'yes'});const v=await f.view();expect(v.body).toHaveLength(1);expect(v.body[0].occurrenceDate).toBe('2026-10-06');expect(v.body[0].status).toBe('corrected');});

test('a denied completion remains rejected even when the model calls it complete',()=>{const text='I did not complete my workout today',sources=normalizedSources({u0:{english:text,observation:false,risk:'none',purpose:'completion'}},normalizationInput(text).sources);const envelope=decodeSources({v:2,verified:{u0:true},meanings:{u0:[{k:'complete',d:'today',t:null,x:false,a:text}]}},sources,now,'Asia/Kolkata',text,sources);expect(()=>validateEnvelope(text,envelope)).toThrow('Negated or uncertain completion');});

test('verified physical danger with a generic self-danger flag uses medical safety and saves nothing',async()=>{
 const f=await fixture();const english='I cannot breathe and have chest pain';
 generate.mockResolvedValueOnce({object:{u0:{english,observation:false,risk:'immediate_danger_self'}}}).mockResolvedValueOnce({object:{v:2,meanings:{u0:[{k:'safety',category:'mental',a:english}]},verified:{u0:true}}});
 const r=await f.t.action(api.messages.send,{token:f.token,messageId:'physical-risk',text:'mujhe saans nahi aa rahi aur seene mein dard hai'});
 expect(r.message).toContain('seek urgent medical care');expect(r.message).not.toContain('crisis service');
 const view=await f.view();expect(view.safetyPaused).toBe(true);expect(view.body).toHaveLength(0);expect(view.cycle).toHaveLength(0);expect(view.pending).toHaveLength(0);
});

test('V3 reminder purpose cannot become another workout plan or task',()=>{
 const text='Remind me about strength training tomorrow at 9am';const sources=normalizedSources({u0:{english:text,observation:false,risk:'none',purpose:'reminder'}},normalizationInput(text,true).sources);const schema=extractionInput(text,{pilotMode:'v3'},sources).schema;
 const value=(op:any)=>({v:2,verified:{u0:true},meanings:{u0:[{a:text,...op}]}});
 expect(schema.safeParse(value({k:'reminder',target:null,title:'strength training',d:'tomorrow',t:'9am',repeat:'once',kind:'tracking'})).success).toBe(true);
 expect(schema.safeParse(value({k:'plan',activity:'strength training',n:null})).success).toBe(false);
 expect(schema.safeParse(value({k:'item',category:'task',title:'strength training',ingredients:[]})).success).toBe(false);
 expect(normalizationInput(text).schema.safeParse({u0:{english:text,observation:false,risk:'none',purpose:'reminder'}}).success).toBe(false);
});

test('the V2 provider schema does not expose V3-only memory or reminder operations',()=>{const text='My existing plan is strength training 3 times this week',sources=normalizedSources({u0:{english:text,observation:false,risk:'none',purpose:'plan'}},normalizationInput(text).sources);const value={v:2,verified:{u0:true},meanings:{u0:[{k:'item',category:'task',title:'strength training',ingredients:[],a:text}]}};expect(extractionInput(text,{},sources).schema.safeParse(value).success).toBe(false);expect(extractionInput(text,{pilotMode:'v3'},sources).schema.safeParse(value).success).toBe(true);});


test('V3 stock lists preserve shared verbs while distinct actions and denials remain separate',()=>{
 const units=(text:string)=>normalizationInput(text,true).sources.map(s=>s.text);
 expect(units('My existing food plan is rice, lentils and beans')).toEqual(['My existing food plan is rice, lentils and beans']);
 expect(units('I need to order rice, lentils and beans')).toEqual(['I need to order rice, lentils and beans']);
 expect(units('I need to shop for rice, lentils and beans')).toEqual(['I need to shop for rice, lentils and beans']);
 expect(units('I have rice and beans at home')).toEqual(['I have rice and beans at home']);
 expect(units('I have rice and I need to order beans')).toEqual(['I have rice and I need to order beans']);
 expect(units('I have rice and no beans')).toEqual(['I have rice and no beans']);
 expect(units('I have three hot flashes yesterday and one today')).toEqual(['I have three hot flashes yesterday and one today']);
 expect(normalizationInput('I need to order rice and beans').sources).toHaveLength(2);
});


test('a forged grocery proof needs an attested source, not just a state field',()=>{
 const text='I will pick up rice',op={k:'item_update',q:text,e:text,c:text,target:'owned-rice',state:'held',replacement:null,g:{item:'rice',state:'held'}};
 expect(()=>validateEnvelope(text,{v:2,ops:[op],sources:[{q:text,e:text,o:false,h:'none',grocery:[{item:'rice',state:'pending'}]}]})).toThrow('Unattested grocery meaning');
});


test('new shopping names cannot update unrelated saved groceries in the provider schema',()=>{
 const text='I need to order apples, pears, beans n rice';
 const sources=normalizedSources({u0:{english:'I need to order apples, pears, beans and rice',observation:false,risk:'none',purpose:'other',grocery:[]}},normalizationInput(text,true).sources);
 const context={pilotMode:'v3',responsibilities:[{id:'owned-oats',kind:'grocery',title:'oats',state:'planned'}]};
 const schema=extractionInput(text,context,sources).schema;
 const value=(op:any)=>({v:2,verified:{u0:true},meanings:{u0:[{a:sources[0].english,...op}]}});
 expect(schema.safeParse(value({k:'item_update',target:'owned-oats',state:'pending',replacement:null})).success).toBe(false);
 expect(schema.safeParse(value({k:'item',category:'grocery',title:'apples',ingredients:['apples','pears','beans','rice']})).success).toBe(true);
});
test('mixed shopping schema permits only the independently verified saved target and state',()=>{
 const text='I need rice and apples',sources=normalizedSources({u0:{english:text,observation:false,risk:'none',purpose:'other',grocery:[{item:'rice',state:'pending'}]}},normalizationInput(text,true).sources);
 const context={pilotMode:'v3',responsibilities:[{id:'rice-id',kind:'grocery',title:'rice',state:'held'},{id:'oats-id',kind:'grocery',title:'oats',state:'planned'}]};
 const schema=extractionInput(text,context,sources).schema;
 const value=(target:string,state:string)=>({v:2,verified:{u0:true},meanings:{u0:[{k:'item_update',target,state,replacement:null,a:text}]}});
 expect(schema.safeParse(value('rice-id','pending')).success).toBe(true);
 expect(schema.safeParse(value('rice-id','ordered')).success).toBe(false);
 expect(schema.safeParse(value('oats-id','pending')).success).toBe(false);
});


test('larger histories are normalized in intact bounded source groups',()=>{
 const text='I need rice and beans. I have oats at home. I ordered apples. Pears arrived. Show my shopping list.';
 const input=normalizationInput(text,true),groups=normalizationGroups(input.sources);
 expect(groups.map(g=>g.length)).toEqual([2,2,1]);expect(groups.flat()).toEqual(input.sources);expect(groups[0][0].text).toContain('rice and beans');
 for(const group of groups){const part=normalizationInput(text,true,[],undefined,group);expect(part.sources).toEqual(group);expect(JSON.parse(part.prompt).message).toBe(text);expect(Object.keys(part.schema.shape)).toEqual(group.map(s=>s.id));}
});
test('compact stock still requires independent verification and rejects empty unrelated meanings',()=>{
 const text='I bought rice',sources=normalizedSources({u0:{english:text,observation:false,risk:'none',purpose:'other',stockOnly:true,grocery:[{item:'rice',state:'held'}]}},normalizationInput(text,true).sources);
 const context={pilotMode:'v3',responsibilities:[{id:'rice-id',title:'rice',kind:'grocery',state:'planned'}]};const value={v:2,verified:{u0:true},meanings:{u0:[]}};
 expect(extractionInput(text,context,sources).schema.safeParse(value).success).toBe(true);expect(()=>decodeSources({...value,verified:{u0:false}},sources,now,'Asia/Kolkata',text,sources,context)).toThrow('Unverified');
 expect(extractionInput(text,context,[{...sources[0],stockOnly:false}]).schema.safeParse(value).success).toBe(false);
});


test('decimal quantities, dotted times and date abbreviations do not split their own source',()=>{
 for(const text of ['My food plan includes 30.5 g protein at 9:00 a.m.','My food instruction is yoghurt, 2.5 kg','My last period started on 1 Sept. 2026'])expect(normalizationInput(text,true).sources.map(s=>s.text)).toEqual([text]);
 const sentences='I have oats. I need rice.';expect(normalizationInput(sentences,true).sources.map(s=>s.text)).toEqual(['I have oats.','I need rice.']);
});


test('an explicit stock clarification answer cannot be misclassified as a new plan or generic pending answer',()=>{
 const text='I need it again',owned=[{id:'onions-id',kind:'grocery',title:'onions',state:'held'}];
 const sources=normalizedSources({u0:{english:text,observation:false,risk:'none',purpose:'other',stockOnly:true,grocery:[{item:'onions',state:'pending'}]}},normalizationInput(text,true).sources);
 const schema=extractionInput(text,{pilotMode:'v3',responsibilities:owned},sources).schema;
 const value=(ops:any[])=>({v:2,verified:{u0:true},meanings:{u0:ops}});
 expect(schema.safeParse(value([])).success).toBe(true);
 expect(schema.safeParse(value([{k:'answer',target:'asked-onions',choice:'new',d:null,t:null,n:null,a:text}])).success).toBe(false);
 expect(schema.safeParse(value([{k:'plan',activity:'need it',n:null,a:text}])).success).toBe(false);
 expect(decodeSources(value([]),sources,now,'Asia/Kolkata',text,sources,{responsibilities:owned}).ops).toMatchObject([{k:'item_update',target:'onions-id',state:'pending'}]);
 const normalization=normalizationInput(text,true,owned,{item:'onions',question:'Do you need to buy it?'}).schema;
 expect(normalization.safeParse({u0:{english:text,observation:false,risk:'none',purpose:'plan',stockOnly:true,grocery:[{item:'onions',state:'pending'}]}}).success).toBe(false);
});
