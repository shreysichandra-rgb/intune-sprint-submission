import {test,expect,vi,beforeEach,afterEach} from 'vitest';
import {convexTest} from 'convex-test';
import schema from '../convex/schema';
import {api} from '../convex/_generated/api';
const generateObject=vi.hoisted(()=>vi.fn());
vi.mock('@convex-dev/agent',()=>({Agent:class{generateObject=generateObject;}}));
const modules=import.meta.glob('../convex/**/*.*s');
beforeEach(()=>{vi.spyOn(Date,'now').mockReturnValue(Date.parse('2026-10-06T10:00:00+05:30'));vi.stubEnv('OPENAI_API_KEY','');generateObject.mockReset();});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs();});
async function setup(withPlan=false,symptoms=false){
 const t=convexTest(schema,modules),pair=await t.mutation(api.tracking.createTestPair,{});
 await t.run(async ctx=>{
  const u=(await ctx.db.query('users').withIndex('by_token',q=>q.eq('token',pair.A)).unique())!;
  if(symptoms)await ctx.db.insert('occurrences',{userId:u._id,jobId:u.jobId,trackedItem:'brain fog',rawText:'Brain fog today',occurrenceDate:'2026-10-06',occurrenceTime:null,timePrecision:'date-only',messageReceivedAt:Date.now(),source:'user',status:'active',confirmationState:'confirmed',batchId:'fictional'});
  if(withPlan){const planId=await ctx.db.insert('plans',{userId:u._id,jobId:u.jobId,activity:'strength train',targetNumber:3,rawText:'strength train 3 times this week',messageReceivedAt:Date.now(),confirmedAt:Date.now(),state:'active'});await ctx.db.insert('planCompletions',{userId:u._id,jobId:u.jobId,planId,rawText:'did my strength session today',messageReceivedAt:Date.now(),completionDate:'2026-10-06',status:'completed'});}
 });
 const health=()=>t.run(async ctx=>{const out:any={};for(const name of ['occurrences','plans','planCompletions','pending','planPending'] as const)out[name]=await ctx.db.query(name).collect();return out;});
 return {t,pair,health,send:(text:string)=>t.action(api.messages.send,{token:pair.A,messageId:crypto.randomUUID(),text})};
}
test.each([[false,false],[false,true],[true,true]])('plan retrieval with plan=%s and symptoms=%s is read only',async(plan,symptoms)=>{
 const f=await setup(plan,symptoms),before=await f.health();
 for(const question of ['What’s my current plan?',"What's my current plan?",'How is my plan going?']){
  const reply=await f.send(question);
  expect(reply.outcome).toBe(plan?'plan_summary':'no_plan');
  if(plan){expect(reply.message).toContain('strength train, 3 times this week. You’re at 1/3.');expect(reply.planView.dates).toEqual(['2026-10-06']);}
  else expect(reply.message).toBe('We haven’t saved a plan yet.');
  expect(await f.health()).toEqual(before);
 }
 expect(generateObject).not.toHaveBeenCalled();
});
test('Stop then Start gives a new job without an active plan or carried completion count',async()=>{
 const f=await setup(true,true),before=await f.health();const old=await f.t.query(api.plans.getPlan,{token:f.pair.A});
 await f.send('Stop');const stopped=await f.t.query(api.plans.getPlan,{token:f.pair.A});expect(stopped.plan.state).toBe('closed');expect(stopped.count).toBe(1);
 await f.send('Start');const fresh=await f.t.query(api.plans.getPlan,{token:f.pair.A});expect(fresh.jobId).not.toBe(old.jobId);expect(fresh.plan).toBeNull();expect(fresh.count).toBe(0);expect(fresh.records).toEqual([]);
 const stored=await f.health();expect(stored.planCompletions).toEqual(before.planCompletions);expect(stored.occurrences).toEqual(before.occurrences);expect(stored.plans).toHaveLength(1);expect(stored.plans[0].state).toBe('closed');
 expect((await f.send('What’s my current plan?')).message).toBe('We haven’t saved a plan yet.');
});
