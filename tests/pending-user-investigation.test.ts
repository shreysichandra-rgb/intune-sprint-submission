import {test,expect,vi,afterEach} from 'vitest';
import {convexTest} from 'convex-test';
import {makeFunctionReference as ref} from 'convex/server';
import schema from '../convex/schema';
import {api,internal} from '../convex/_generated/api';
const generate=vi.hoisted(()=>vi.fn());
vi.mock('@convex-dev/agent',()=>({Agent:class{generateText=generate;}}));
const modules=import.meta.glob('../convex/**/*.*s');
const q=(n:string)=>ref<'query',any,any>(n);
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs();generate.mockReset();});
async function setup(badChecker=false){
for(const[k,v]of Object.entries({INTUNE_PILOT_MODE:'v3',INTUNE_V4_ENABLED:'1',INTUNE_IMPLIED_SAVING:'1',INTUNE_DEBUG_LOGGING:'1',INTUNE_CONVERSATION_GATE:'candidate',PAYMENT_MODE:'razorpay_test',OPENAI_API_KEY:'synthetic',INTUNE_CONVERSATION_ROLLOUT:'all',INTUNE_TRIAL_ENABLED:'1'}))vi.stubEnv(k,v);
const now=Date.parse('2026-10-16T09:33:00Z');vi.spyOn(Date,'now').mockReturnValue(now);
const t=convexTest(schema,modules),token=await t.mutation(internal.phoneUsers.getOrCreate,{phoneNumber:'+12025550188'});
const grant=await t.run(async ctx=>{const u=(await ctx.db.query('users').withIndex('by_token',q=>q.eq('token',token)).unique())!;await ctx.db.patch(u._id,{conversationConsent:true,pilotNameAsked:true,v4Context:{introduced:true,firstTaskStarted:false,resetKey:null,tasks:[]}});return ctx.db.insert('pilotEntitlements',{userId:u._id,source:'trial',grantKey:'fictional-active-trial',eligibleAt:now-120000,activationDeadline:now+86400000,startedAt:now-120000,endsAt:now-120000+86400000,welcomeState:'delivered',actor:'fictional'});});
generate.mockImplementation(async(_ctx:any,_user:any,o:any)=>{const p=JSON.parse(o.prompt);const reply='I can help organise the details you share. You can type one question you want to keep for later.';return {text:JSON.stringify(!p.task?{introduced:true,reply,actions:[],tasks:[]}:p.task.startsWith('Respond with')?{reply}:{complete:true,missing:[],conversationReply:reply,...(badChecker?{preferredName:{name:'InventedName',evidence:'InventedName'}}:{})})};});
return{t,token,grant,now};}
test.each(['Can you help me?','Tell me more please'])('short meaningful first request succeeds in active trial: %s',async text=>{const{t,token,grant,now}=await setup();const r=await t.action(api.messages.send,{token,messageId:'fictional-short-question',text});expect(r.outcome).not.toBe('error');expect(r.message).toContain('help');const c=await t.query(q('v4Store:context'),{token,messageId:'inspect',text:''});expect(c.state.records).toHaveLength(0);expect(c.state.profile.name).toBeNull();const g=await t.run(ctx=>ctx.db.get(grant));expect(g?.endsAt).toBe(now-120000+86400000);});
test('simulated unsupported checker output reproduces generic failure after coverage without saving',async()=>{const{t,token,grant,now}=await setup(true);const r=await t.action(api.messages.send,{token,messageId:'fictional-bad-checker',text:'Can you help me?'});expect(r.outcome).toBe('error');expect(r.message).toContain('Nothing new was saved');expect(generate).toHaveBeenCalledTimes(2);const c=await t.query(q('v4Store:context'),{token,messageId:'inspect',text:''});expect(c.state.records).toHaveLength(0);expect(c.state.profile.name).toBeNull();const g=await t.run(ctx=>ctx.db.get(grant));expect(g?.endsAt).toBe(now-120000+86400000);});

// Fictional structural failure probes, not replay of a customer request.
import {expandV4,completeV4ReminderDay} from '../convex/v4Action';
test('time-only fictional answer uses the one owned requested date and target',()=>{
 const p:any={reply:'What time?',clarification:'What time?',actions:[],open_tasks:[],safety:{intent:'none'}};
 const c:any={now:Date.parse('2026-10-17T09:00:00Z'),reminderDeliveryConfigured:true,state:{access:{mode:'active_paid'},control:{storage:true,tracking:'active',safetyPaused:false},records:[{id:'fictional-packing',kind:'task',date:'2026-10-18',time:null}],tasks:[{id:'reminder-pending:fictional-source',topic:'reminder time',question:'What time?',sourceMessageId:'fictional-source',targetId:'fictional-packing'}]},sources:[{messageId:'fictional-source',text:'Remind me tomorrow to review my fictional packing list',role:'user',canSave:true,at:Date.parse('2026-10-17T08:00:00Z')}]};
 expect(completeV4ReminderDay(p,c,{messageId:'fictional-clock',text:'6 pm'})).toBe(true);
 expect(p.actions.filter((x:any)=>x.type==='reminder')).toHaveLength(1);
 expect(p.actions[0]).toMatchObject({targetId:'fictional-packing',datePhrase:'2026-10-18',timePhrase:'6 pm',dateSourceRecordId:'fictional-packing'});
 expect(p.clarification).toBeNull();
});
test('simulated invalid interpretation and invalid repair remain rejected before validation',()=>{
 const malformed={reply:'Checking your reminder.',actions:[{type:'unsupported-fictional-action',evidence:'6 pm'}],tasks:[]};
 expect(()=>expandV4(malformed,'fictional-clock','6 pm')).toThrow();
 expect(()=>expandV4({...malformed,reply:'Checking again.'},'fictional-clock','6 pm')).toThrow();
 // This is a known failure class, not evidence of the historical malformed field.
});

async function seededClockReply(){
 const f=await setup();
 for(const[k,v]of Object.entries({WHATSAPP_ACCESS_TOKEN:'fictional',WHATSAPP_PHONE_NUMBER_ID:'123',INTUNE_REMINDER_TEMPLATE_APPROVED:'1',INTUNE_REMINDER_TEMPLATE:'intune_requested_reminder_v1',INTUNE_REMINDER_TEMPLATE_LANGUAGE:'en_US',INTUNE_LAB_ENABLED:'1'}))vi.stubEnv(k,v);
 const source='Remind me today to review my fictional packing list';
 const target=await f.t.run(async ctx=>{const u=(await ctx.db.query('users').withIndex('by_token',q=>q.eq('token',f.token)).unique())!;const id=await ctx.db.insert('pilotItems',{userId:u._id,kind:'task',title:'fictional packing list',text:'fictional packing list',state:'planned',createdAt:f.now-60000,updatedAt:f.now-60000});await ctx.db.patch(u._id,{v4Records:[{id,kind:'task',date:'2026-10-16',time:null,sourceMessageId:'fictional-purpose',evidence:source}],v4Context:{introduced:true,firstTaskStarted:true,resetKey:null,tasks:[{id:'reminder-pending:fictional-purpose',topic:'reminder time',question:'What time should I remind you?',targetId:id,sourceMessageId:'fictional-purpose'}]}});await ctx.db.insert('conversationLog',{userId:u._id,epoch:0,messageId:'fictional-purpose',direction:'incoming',type:'text',text:source,receivedAt:f.now-60000,outcome:'conversation',recordIds:[id],suppressed:false});return id;});
 return {...f,target};
}
test('clock reply survives invalid model proposal and invalid repair, validates and schedules exactly one owned reminder',async()=>{
 const f=await seededClockReply();
 const bad={reply:'Checking your reminder.',actions:[{type:'unsupported-fictional-action',evidence:'6 pm'}],tasks:[]};
 generate.mockResolvedValueOnce({text:JSON.stringify(bad)}).mockResolvedValueOnce({text:JSON.stringify(bad)});
 const r=await f.t.action(api.messages.send,{token:f.token,messageId:'fictional-clock-recovery',text:'6 pm'});
 expect(r.outcome,JSON.stringify(r)).not.toBe('error');
 const c=await f.t.query(q('v4Store:context'),{token:f.token,messageId:'inspect',text:''});
 expect(c.state.records).toHaveLength(1);expect(c.state.reminders).toHaveLength(1);expect(c.state.reminders[0].targetId).toBe(f.target);expect(c.state.reminders[0].dueAt).toBe(Date.parse('2026-10-16T12:30:00Z'));
 await f.t.action(api.messages.send,{token:f.token,messageId:'fictional-clock-recovery',text:'6 pm'});
 expect((await f.t.query(q('v4Store:context'),{token:f.token,messageId:'inspect-again',text:''})).state.reminders).toHaveLength(1);
 expect((await f.t.run(ctx=>ctx.db.get(f.grant)))?.endsAt).toBe(f.now-120000+86400000);
});

test('provider failure during repair is not recovered and writes no reminder',async()=>{
 const f=await seededClockReply();generate.mockResolvedValueOnce({text:JSON.stringify({reply:'Checking.',actions:[{type:'unsupported-fictional-action',evidence:'6 pm'}]})}).mockRejectedValueOnce(Error('fictional provider unavailable'));
 const r=await f.t.action(api.messages.send,{token:f.token,messageId:'fictional-provider-failure',text:'6 pm'});expect(r.outcome).toBe('error');
 const c=await f.t.query(q('v4Store:context'),{token:f.token,messageId:'inspect',text:''});expect(c.state.reminders).toHaveLength(0);expect(c.state.records).toHaveLength(1);expect(c.state.tasks.some((t:any)=>t.question)).toBe(true);
});
