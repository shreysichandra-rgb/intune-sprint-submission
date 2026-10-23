import {test,expect,vi,afterEach} from 'vitest';
import {convexTest} from 'convex-test';
import {makeFunctionReference as ref} from 'convex/server';
import schema from '../convex/schema';import {api,internal} from '../convex/_generated/api';
const generate=vi.hoisted(()=>vi.fn());vi.mock('@convex-dev/agent',()=>({Agent:class{generateText=generate;}}));
const modules=import.meta.glob('../convex/**/*.*s');
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs();});
test('a short owned food-choice answer saves its child without rewriting the original routine (simulated AI)',async()=>{
 const now=Date.parse('2026-10-21T06:00:00Z');vi.spyOn(Date,'now').mockReturnValue(now);
 for(const[k,v]of Object.entries({INTUNE_PILOT_MODE:'v3',INTUNE_V4_ENABLED:'1',INTUNE_IMPLIED_SAVING:'1',INTUNE_DEBUG_LOGGING:'1',INTUNE_CONVERSATION_GATE:'candidate',PAYMENT_MODE:'razorpay_test',OPENAI_API_KEY:'fictional',INTUNE_CONVERSATION_ROLLOUT:'all'}))vi.stubEnv(k,v);
 const t=convexTest(schema,modules),token=await t.mutation(internal.phoneUsers.getOrCreate,{phoneNumber:'+12025550178'});
 await t.run(async c=>{const u=(await c.db.query('users').withIndex('by_token',q=>q.eq('token',token)).unique())!;await c.db.patch(u._id,{pilotNameAsked:true});await c.db.insert('pilotEntitlements',{userId:u._id,source:'operator_test',grantKey:'fictional-choice-quality',eligibleAt:now,activationDeadline:now+604800000,startedAt:now,endsAt:now+604800000,welcomeState:'delivered',actor:'fictional'});});
 generate.mockImplementation(async(_c:any,_u:any,o:any)=>{const p=JSON.parse(o.prompt);return {text:JSON.stringify(p.task?.startsWith('Respond with')?{reply:p.proposal.reply}:{complete:true,missing:[]})};});
 generate.mockResolvedValueOnce({text:JSON.stringify({introduced:true,reply:'I’m InTune. Your usual breakfast is oats or toast.',actions:[{type:'save',kind:'food',label:'breakfast',text:'My usual breakfast is oats or toast',evidence:'My usual breakfast is oats or toast'}],tasks:[]})});
 await t.action(api.messages.send,{token,messageId:'routine',text:'My usual breakfast is oats or toast'});
 let c:any=await t.query(ref<'query',any,any>('v4Store:context'),{token,messageId:'inspect',text:''});const parent=c.state.records.find((r:any)=>r.kind==='food');expect(parent).toBeTruthy();
 generate.mockResolvedValueOnce({text:JSON.stringify({introduced:true,reply:'Both options are kept for your breakfast.',actions:[{type:'save',kind:'meal_choice',targetId:parent.id,parentId:parent.id,label:'breakfast',text:'Both, on different days.',evidence:'Both, on different days.',state:'planned'}],tasks:[]})});
 const r=await t.action(api.messages.send,{token,messageId:'choice',text:'Both, on different days.'});expect(r.outcome).toBe('conversation');
 c=await t.query(ref<'query',any,any>('v4Store:context'),{token,messageId:'inspect2',text:''});expect(c.state.records.find((r:any)=>r.id===parent.id)).toEqual(parent);expect(c.state.records.find((r:any)=>r.kind==='meal_choice')).toMatchObject({parentId:parent.id,text:'Both, on different days.'});expect(c.state.records.filter((r:any)=>r.kind==='grocery')).toHaveLength(0);
});
test('an independently reviewed no-write chat reply replaces a rejected draft before final validation (simulated AI)',async()=>{
 const now=Date.parse('2026-10-21T06:00:00Z');vi.spyOn(Date,'now').mockReturnValue(now);
 for(const[k,v]of Object.entries({INTUNE_PILOT_MODE:'v3',INTUNE_V4_ENABLED:'1',INTUNE_IMPLIED_SAVING:'1',INTUNE_DEBUG_LOGGING:'1',INTUNE_CONVERSATION_GATE:'candidate',PAYMENT_MODE:'razorpay_test',OPENAI_API_KEY:'fictional',INTUNE_CONVERSATION_ROLLOUT:'all'}))vi.stubEnv(k,v);
 const t=convexTest(schema,modules),token=await t.mutation(internal.phoneUsers.getOrCreate,{phoneNumber:'+12025550179'});
 await t.run(async c=>{const u=(await c.db.query('users').withIndex('by_token',q=>q.eq('token',token)).unique())!;await c.db.patch(u._id,{pilotNameAsked:true,v4Context:{introduced:true,firstTaskStarted:true,resetKey:null,tasks:[]}});await c.db.insert('pilotEntitlements',{userId:u._id,source:'operator_test',grantKey:'fictional-chat-quality',eligibleAt:now,activationDeadline:now+604800000,startedAt:now,endsAt:now+604800000,welcomeState:'delivered',actor:'fictional'});});
 generate.mockReset();generate.mockResolvedValueOnce({text:JSON.stringify({introduced:true,reply:'You’re welcome. Your reminder is set for 6:45 pm.',actions:[],tasks:[]})}).mockResolvedValueOnce({text:JSON.stringify({complete:true,missing:[],conversationReply:'You’re welcome!'})});
 const r=await t.action(api.messages.send,{token,messageId:'thanks',text:'Thanks, that is all.'});expect(r.outcome).toBe('conversation');expect(r.message).toBe('You’re welcome!');expect(generate).toHaveBeenCalledTimes(2);
 const c:any=await t.query(ref<'query',any,any>('v4Store:context'),{token,messageId:'inspect',text:''});expect(c.state.records).toEqual([]);expect(c.state.reminders).toEqual([]);
});
