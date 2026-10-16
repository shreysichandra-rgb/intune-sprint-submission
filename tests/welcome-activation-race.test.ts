import {test,expect,vi,afterEach} from 'vitest';
import {convexTest} from 'convex-test';
import {makeFunctionReference as ref,getFunctionName} from 'convex/server';
import schema from '../convex/schema';
import {api,internal} from '../convex/_generated/api';
const control=vi.hoisted(()=>({afterSnapshot:null as null|((ctx:any)=>Promise<void>),generate:vi.fn()}));
vi.mock('@convex-dev/agent',()=>({Agent:class{generateText=control.generate;}}));
vi.mock('../convex/conversationTiming',async importOriginal=>{
 const original:any=await importOriginal();
 return {...original,measuredContext:(ctx:any,timer:any)=>{
  const measured=original.measuredContext(ctx,timer);
  return {...measured,runQuery:async(name:any,args:any)=>{const result=await measured.runQuery(name,args);if(getFunctionName(name)==='v4Store:context'&&control.afterSnapshot){const hook=control.afterSnapshot;control.afterSnapshot=null;await hook(ctx);}return result;}};
 }};
});
const modules=import.meta.glob('../convex/**/*.*s');const now=Date.parse('2026-10-16T14:40:00Z');
const q=(n:string)=>ref<'query',any,any>(n),m=(n:string)=>ref<'mutation',any,any>(n);
afterEach(()=>{control.afterSnapshot=null;control.generate.mockReset();vi.restoreAllMocks();vi.unstubAllEnvs();});
async function setup(){
 for(const[k,v]of Object.entries({INTUNE_PILOT_MODE:'v3',INTUNE_V4_ENABLED:'1',INTUNE_IMPLIED_SAVING:'1',INTUNE_DEBUG_LOGGING:'1',INTUNE_CONVERSATION_GATE:'candidate',PAYMENT_MODE:'razorpay_test',OPENAI_API_KEY:'synthetic',INTUNE_CONVERSATION_ROLLOUT:'all'}))vi.stubEnv(k,v);
 vi.spyOn(Date,'now').mockReturnValue(now);
 const t=convexTest(schema,modules),token=await t.mutation(internal.phoneUsers.getOrCreate,{phoneNumber:'+12025550177'});
 const grant=await t.run(async ctx=>{const u=(await ctx.db.query('users').withIndex('by_token',q=>q.eq('token',token)).unique())!;await ctx.db.patch(u._id,{conversationConsent:true,pilotNameAsked:true});return ctx.db.insert('pilotEntitlements',{userId:u._id,source:'coupon',grantKey:'fictional-race',eligibleAt:now-10000,activationDeadline:now+604800000,welcomeState:'accepted',welcomeMessageId:'fictional-welcome',actor:'test'});});
 control.afterSnapshot=async ctx=>{await ctx.runMutation(m('pilotAccess:welcomeDelivered'),{providerMessageId:'fictional-welcome',recipient:'12025550177',deliveredAt:now});};
 return {t,token,grant};
}
test.each(['My name is Mina','I have a headache today'])('welcome activation before first AI call gives a clear retry, without replay or quota use: %s',async text=>{
 const {t,token,grant}=await setup();
 const result=await t.action(api.messages.send,{token,messageId:'activation-race',text});
 expect(result.outcome).toBe('dropped');expect(result.failure).toEqual({kind:'conversation_changed'});
 expect(result.message).toContain('Please send it again');expect(result.message).not.toContain('couldn’t keep');expect(control.generate).not.toHaveBeenCalled();
 const c=await t.query(q('v4Store:context'),{token,messageId:'inspect',text:''});expect(c.state.records).toEqual([]);expect(c.state.profile.name).toBeNull();expect(c.state.access.mode).toBe('active_paid');
 const access=await t.run(ctx=>ctx.db.get(grant));expect(access?.startedAt).toBe(now);expect(access?.endsAt).toBe(now+604800000);
 expect(await t.run(ctx=>ctx.db.query('quotas').take(10))).toEqual([]);
 expect((await t.action(api.messages.send,{token,messageId:'activation-race',text})).outcome).toBe('provider_duplicate');
 expect((await t.query(q('v4Store:context'),{token,messageId:'inspect2',text:''})).state.records).toEqual([]);
});
test('a new user resend after activation can save her optional name without changing the access clock',async()=>{
 const {t,token,grant}=await setup();await t.action(api.messages.send,{token,messageId:'before',text:'My name is Mina'});
 control.generate.mockImplementation(async(_ctx:any,_u:any,o:any)=>{const p=JSON.parse(o.prompt);return {text:JSON.stringify(p.task?.startsWith('Respond with')?{reply:p.proposal?.reply??'Hello Mina. What would you like help remembering?'}:p.task?{complete:true,missing:[]}:{introduced:true,reply:'Hello Mina. What would you like help remembering?',actions:[{type:'profile',label:'Mina',evidence:'Mina'}],tasks:[]})};});
 const result=await t.action(api.messages.send,{token,messageId:'fresh-resend',text:'My name is Mina'});expect(result.outcome).toBe('conversation');
 const c=await t.query(q('v4Store:context'),{token,messageId:'inspect',text:''});expect(c.state.profile.name).toBe('Mina');expect(c.state.records).toEqual([]);
 const access=await t.run(ctx=>ctx.db.get(grant));expect(access?.startedAt).toBe(now);expect(access?.endsAt).toBe(now+604800000);
});
