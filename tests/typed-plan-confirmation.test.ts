import {test,expect,vi,beforeEach,afterEach} from 'vitest';
import {convexTest} from 'convex-test';
import schema from '../convex/schema';
import {api} from '../convex/_generated/api';
const generateObject=vi.hoisted(()=>vi.fn());
vi.mock('@convex-dev/agent',()=>({Agent:class{generateObject=generateObject;}}));
const modules=import.meta.glob('../convex/**/*.*s');
const proposal={intent:'plan_proposal',activity:'strength train',targetNumber:3,trackedItem:null,count:null,datePhrase:null,timePhrase:null,precision:'date-only',target:null,explicitNew:false,completionStatus:null};
beforeEach(()=>{vi.stubEnv('OPENAI_API_KEY','test-placeholder');generateObject.mockReset();});afterEach(()=>vi.unstubAllEnvs());
async function fixture(){const t=convexTest(schema,modules);const pair=await t.mutation(api.tracking.createTestPair,{});generateObject.mockResolvedValueOnce({object:proposal});const draft=await t.action(api.messages.send,{token:pair.A,messageId:'draft',text:'strength train 3 times this week'});return {t,pair,draft};}
test.each(['yes','ok','confirm','haan'])('%s confirms the pending repeat-back using the same rules and reply as the button, without AI',async word=>{
 const {t,pair,draft}=await fixture();vi.stubEnv('OPENAI_API_KEY','');const result=await t.action(api.messages.send,{token:pair.A,messageId:'answer',text:word});expect(result.outcome).toBe('plan_confirmed');expect(result.message).toBe('Got it 👍 Your plan is strength train, 3 times this week. You’re starting at 0/3.');expect(result.originalMessageReceivedAt).toBe(draft.messageReceivedAt);expect(result.planView.plan.rawText).toBe('strength train 3 times this week');expect(result.planView.pending).toEqual([]);expect(generateObject).toHaveBeenCalledTimes(1);
});
test.each(['no','cancel'])('%s discards only the pending repeat-back without AI',async word=>{
 const {t,pair}=await fixture();const result=await t.action(api.messages.send,{token:pair.A,messageId:'answer',text:word});expect(result.outcome).toBe('discarded');expect(result.message).toBe('Okay, I’ve discarded that draft. No plan was saved.');expect(result.planView.plan).toBeNull();expect(result.planView.pending).toEqual([]);expect(generateObject).toHaveBeenCalledTimes(1);
});
test('no pending repeat-back, other users and date questions retain the existing interpretation path',async()=>{
 const {t,pair}=await fixture();const clarification={...proposal,intent:'clarify',activity:null,targetNumber:null};
 for(const text of ['yes','ok','confirm','haan','no','cancel']){generateObject.mockResolvedValueOnce({object:clarification});const r=await t.action(api.messages.send,{token:pair.B,messageId:crypto.randomUUID(),text});expect(r.outcome).toBe('clarification');}
 expect((await t.query(api.plans.getPlan,{token:pair.A})).pending).toHaveLength(1);expect((await t.query(api.plans.getPlan,{token:pair.B})).plan).toBeNull();expect(generateObject).toHaveBeenCalledTimes(7);
});
test('case and surrounding spaces are accepted; repeated yes cannot confirm a newer draft',async()=>{
 const {t,pair}=await fixture();await t.action(api.messages.send,{token:pair.A,messageId:'answer',text:' YES '});await t.action(api.messages.send,{token:pair.A,messageId:'stop',text:'Stop'});await t.action(api.messages.send,{token:pair.A,messageId:'start',text:'Start'});generateObject.mockResolvedValueOnce({object:proposal});await t.action(api.messages.send,{token:pair.A,messageId:'new-draft',text:'strength train 3 times this week'});const repeat=await t.action(api.messages.send,{token:pair.A,messageId:'answer',text:'yes'});expect(repeat.outcome).toBe('provider_duplicate');expect((await t.query(api.plans.getPlan,{token:pair.A})).plan).toBeNull();expect((await t.query(api.plans.getPlan,{token:pair.A})).pending).toHaveLength(1);
});
test('typed confirmation still works with an exhausted app cap and no AI key',async()=>{
 const {t,pair}=await fixture();await t.run(async ctx=>{const quota=await ctx.db.query('quotas').withIndex('by_key',q=>q.eq('key','global')).unique();await ctx.db.patch(quota!._id,{times:Array(500).fill(Date.now())});});vi.stubEnv('OPENAI_API_KEY','');const r=await t.action(api.messages.send,{token:pair.A,messageId:'answer',text:'yes'});expect(r.outcome).toBe('plan_confirmed');expect(generateObject).toHaveBeenCalledTimes(1);await t.run(async ctx=>{expect((await ctx.db.query('quotas').withIndex('by_key',q=>q.eq('key','global')).unique())!.times).toHaveLength(500);});
});
test('yes does not resolve a pending completion-date question',async()=>{
 const {t,pair,draft}=await fixture();await t.mutation(api.plans.resolve,{token:pair.A,pendingId:draft.pendingId,choice:'confirm'});generateObject.mockResolvedValueOnce({object:{...proposal,intent:'plan_complete',targetNumber:null}});const date=await t.action(api.messages.send,{token:pair.A,messageId:'completion',text:'did my strength session'});expect(date.outcome).toBe('plan_clarification');generateObject.mockResolvedValueOnce({object:{...proposal,intent:'clarify',activity:null,targetNumber:null}});const yes=await t.action(api.messages.send,{token:pair.A,messageId:'answer',text:'yes'});expect(yes.outcome).toBe('clarification');const view=await t.query(api.plans.getPlan,{token:pair.A});expect(view.pending[0]._id).toBe(date.pendingId);expect(view.count).toBe(0);expect(generateObject).toHaveBeenCalledTimes(3);
});
