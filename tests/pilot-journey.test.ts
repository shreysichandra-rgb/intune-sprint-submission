import {test,expect,vi,afterEach} from 'vitest';
import {convexTest} from 'convex-test';import {makeFunctionReference as ref} from 'convex/server';import {createHmac} from 'node:crypto';
import schema from '../convex/schema';import {api,internal} from '../convex/_generated/api';import {conversationRefs} from '../convex/conversationStore';
const generate=vi.hoisted(()=>vi.fn());vi.mock('@convex-dev/agent',()=>({Agent:class{generateObject=generate;}}));
const modules=import.meta.glob('../convex/**/*.*s');const start=Date.parse('2026-10-09T04:30:00Z');
const query=(n:string)=>ref<'query',any,any>(n),mutation=(n:string)=>ref<'mutation',any,any>(n),action=(n:string)=>ref<'action',any,any>(n);
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs();vi.unstubAllGlobals();});
test('complete fictional paid journey across all seven days and expiry (provider and AI responses simulated)',async()=>{
 for(const [k,v] of Object.entries({INTUNE_PILOT_MODE:'v3',PAYMENT_MODE:'razorpay_test',RAZORPAY_KEY_ID:'rzp_test_synthetic',RAZORPAY_KEY_SECRET:'synthetic-key',RAZORPAY_WEBHOOK_SECRET:'synthetic-webhook',INTUNE_CONVERSATION_GATE:'candidate',INTUNE_CONVERSATION_ROLLOUT:'all',INTUNE_SEMANTIC_BRIDGE:'legacy',OPENAI_API_KEY:'synthetic',WHATSAPP_ACCESS_TOKEN:'synthetic',WHATSAPP_PHONE_NUMBER_ID:'123',INTUNE_SYNTHETIC_TRANSPORT:'1'}))vi.stubEnv(k,v);
 vi.spyOn(Date,'now').mockReturnValue(start);vi.spyOn(console,'info').mockImplementation(()=>{});generate.mockReset();
 const t=convexTest(schema,modules);const token=await t.mutation(internal.phoneUsers.getOrCreate,{phoneNumber:'+12025550196'});
 let pace=false;const send=async(text:string,ops?:any[],id=crypto.randomUUID())=>{if(pace)vi.mocked(Date.now).mockReturnValue(Date.now()+6000);if(ops)generate.mockResolvedValueOnce({object:{v:2,ops}});return t.action(api.messages.send,{token,messageId:id,text});};
 const view=()=>t.query(query('pilotMemory:overview'),{token});const reminders=()=>t.query(query('pilotReminders:view'),{token});
 const confirm=()=>send('yes',[{k:'answer',q:'yes',target:null,choice:'confirm',d:null,t:null,n:null}]);
 expect((await send('hello')).outcome).toBe('unpaid');
 const order:any=await t.mutation(mutation('pilotPaymentsStore:reserveOrder'),{token,linkHash:'synthetic-journey'});await t.mutation(mutation('pilotPaymentsStore:finishOrder'),{id:order.id,orderId:'order_journey'});
 const payment={id:'pay_journey',order_id:'order_journey',amount:9900,currency:'INR',status:'captured',captured:true};vi.stubGlobal('fetch',vi.fn().mockImplementation(async()=>new Response(JSON.stringify(payment),{status:200})));
 const raw=JSON.stringify({event:'payment.captured',payload:{payment:{entity:payment}}});const notification={raw,signature:createHmac('sha256','synthetic-webhook').update(raw).digest('hex'),eventId:'event_journey'};
 await t.action(action('pilotPayments:webhook'),notification);await t.action(action('pilotPayments:webhook'),notification);
 const eligible:any=await t.query(query('pilotAccess:status'),{token});expect(eligible.state).toBe('eligible');expect(eligible.startedAt).toBe(null);
 await t.mutation(mutation('pilotAccess:welcomeAccepted'),{grantId:eligible.id,providerMessageId:'wamid.journey'});await t.mutation(mutation('pilotAccess:welcomeDelivered'),{providerMessageId:'wamid.journey',recipient:'12025550196',deliveredAt:start});expect((await t.query(query('pilotAccess:status'),{token})).state).toBe('active');pace=true;
 await send('My name is Maya',[{k:'profile',q:'My name is Maya',name:'My name is Maya'}]);expect((await view()).name).toBe('Maya');await send('yes');
 async function save(text:string,op:any){const proposed=await send(text,[{q:text,...op}]);expect(proposed.outcome,text).not.toBe('error');const saved=await confirm();expect(saved.outcome,text).not.toBe('error');}
 await save('My plan is strength training 3 times this week',{k:'plan',activity:'strength training',n:3});await save('My plan is brainstorming 2 times this week',{k:'plan',activity:'brainstorming',n:2});
 await save('My food plan: oats with yoghurt',{k:'item',category:'food',title:'oats with yoghurt',ingredients:['oats','yoghurt']});await save('My existing supplement instruction is magnesium at 9pm',{k:'item',category:'schedule',title:'magnesium',ingredients:[]});
 const body={k:'body',q:'Brain fog today',l:'Brain fog',b:'brain fog',r:null,n:1,d:'today',t:null,x:false,s:'reported'};await send(body.q,[body]);await confirm();
 const cycle={...body,k:'cycle',q:'My period started today',l:'period started',b:null};await send(cycle.q,[cycle]);
 await send('no'); // Decline the new cycle-gap offer before the next responsibility.
 await save('Save a question for my doctor: should I discuss HRT?',{k:'item',category:'doctor_question',title:'should I discuss HRT?',ingredients:[]});
 await save('Remind me about strength training 2026-10-12 at 9am every day',{k:'reminder',target:null,title:'strength training',d:'2026-10-12',t:'9am',repeat:'daily',kind:'tracking'});
 const r=(await reminders())[0];expect(r).toBeDefined();const training=(await view()).items.find((i:any)=>i.title==='strength training');
 await send('I completed strength training today',[{k:'item_complete',q:'I completed strength training today',target:training._id,d:'today',status:'completed',x:false}]);
 const e=(await view()).events[0];await save('Actually strength training was yesterday',{k:'item_correct',target:e._id,d:'yesterday',status:null});expect((await view()).events).toHaveLength(1);
 vi.mocked(Date.now).mockReturnValue(r.dueAt);const summary=await send('What all are you keeping track of for me?');for(const word of ['strength training','brainstorming','oats','yoghurt','magnesium','brain fog','period started','HRT','Reminder'])expect(summary.message.toLowerCase()).toContain(word.toLowerCase());
 const job:any=await t.mutation(mutation('pilotReminders:claim'),{id:r._id,dueAt:r.dueAt});expect(job).not.toBe(null);expect(await t.query(query('pilotReminders:deliveryCheck'),{id:job.id})).toBe(true);await t.mutation(mutation('pilotReminders:finish'),{id:job.id,status:'accepted',providerMessageId:'wamid.reminder'});
 await send('Pause my strength training reminder',[{k:'reminder_control',q:'Pause my strength training reminder',target:r._id,command:'pause'}]);expect((await reminders())[0].state).toBe('paused');expect((await send('Show my saved records')).message).toContain('magnesium');
 const other=await t.mutation(internal.phoneUsers.getOrCreate,{phoneNumber:'+12025550197'});expect((await t.query(conversationRefs.view,{token:other})).responsibilities.items).toHaveLength(0);
 for(const day of [4,5,6]){vi.mocked(Date.now).mockReturnValue(start+day*86400000);const text='I completed strength training today';await send(text,[{k:'item_complete',q:text,target:training._id,d:'today',status:'completed',x:false}]);expect((await send('Summary')).message).toContain(`${day-3}/3`);}
 vi.mocked(Date.now).mockReturnValue(start+604800000);const blocked=await send('Brain fog today');expect(blocked.outcome).toBe('unpaid');expect(blocked.message).toContain('useful');expect((await view()).items).toHaveLength(7);expect((await send('Show my saved records')).message).toContain('oats');
 await send('InTune was useful and I would use it again',[{k:'feedback',q:'InTune was useful and I would use it again',usefulness:'useful',wouldUseAgain:true}]);await t.run(async c=>{expect(await c.db.query('pilotFeedback').collect()).toHaveLength(1);expect(await c.db.query('pilotEntitlements').collect()).toHaveLength(1);});
});
