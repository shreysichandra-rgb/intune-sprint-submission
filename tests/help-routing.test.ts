import {test,expect,vi,beforeEach,afterEach} from 'vitest';
import {convexTest} from 'convex-test';
import schema from '../convex/schema';
import {api} from '../convex/_generated/api';
import {matchHelp} from '../convex/commandRoute';
import {helpReply} from '../convex/copy';

const generateObject=vi.hoisted(()=>vi.fn());
vi.mock('@convex-dev/agent',()=>({Agent:class{generateObject=generateObject;}}));
const modules=import.meta.glob('../convex/**/*.*s');
beforeEach(()=>{vi.stubEnv('OPENAI_API_KEY','');generateObject.mockReset();vi.spyOn(console,'info').mockImplementation(()=>{});});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs();});

test.each([
 'What are your capabilities',
 'Hi, what are your capabilities',
 'So what are your capabilities?',
 'Ok what are your capabilities?',
 'Hey what are your capabilities?',
 'And what are your capabilities?',
 'Okay, what are your capabilties?',
 'Please tell me what you can do',
 'What are your capabilties?',
 'What are your capablities?',
 'What are your capabilites?',
 'What are your capabilitites?',
 'What are your capabilties ??',
 'Whta are your capabilities?',
 'What are your capabilities???',
 '  WHAT   ARE YOUR CAPABILITIES ?!  ',
 'What can you hepl me with?',
 'How does this wrok?',
 'What can u do?',
 'What are ur capabilities?',
 'Tell me what you can do',
])('help question %s gives approved copy without AI or health-state changes',async text=>{
 const t=convexTest(schema,modules),pair=await t.mutation(api.tracking.createTestPair,{});
 const snapshot=()=>t.run(async ctx=>{
  const state:Record<string,unknown>={};
  for(const table of ['users','occurrences','pending','plans','planPending','planCompletions','references','proactiveOutputs','quotas','deletionMarkers'] as const)state[table]=await ctx.db.query(table).collect();
  return state;
 });
 const before=await snapshot();
 const result=await t.action(api.messages.send,{token:pair.A,messageId:'synthetic-help',text});
 expect(result.outcome).toBe('help');expect(result.message).toBe(helpReply);
 expect(await snapshot()).toEqual(before);expect(generateObject).not.toHaveBeenCalled();
});

test.each(['active','paused','stopped'] as const)('help preserves open questions and %s controls',async state=>{
 const t=convexTest(schema,modules),pair=await t.mutation(api.tracking.createTestPair,{});
 await t.run(async ctx=>{
  const u=(await ctx.db.query('users').withIndex('by_token',q=>q.eq('token',pair.A)).unique())!;
  await ctx.db.patch(u._id,{state});
  await ctx.db.insert('pending',{userId:u._id,jobId:u.jobId,rawText:'synthetic ambiguous update',messageReceivedAt:Date.now(),reason:'Which day?',kind:'clarification',proposal:{intent:'record'},relatedIds:[]});
 });
 const before=await t.query(api.tracking.getSummary,{token:pair.A});
 const result=await t.action(api.messages.send,{token:pair.A,messageId:'synthetic-help',text:'What are your capabilties?'});
 expect(result.message).toBe(helpReply);expect(await t.query(api.tracking.getSummary,{token:pair.A})).toEqual(before);
 expect(generateObject).not.toHaveBeenCalled();
});

test.each([
 'What are your capabilities? Brain fog today.',
 'What can you do about my workout yesterday?',
 'What can you not do?',
 'What can you delete?',
 'Delete my pilot data',
 'Delte my pilot data',
 'Brain fog twice yesterday',
 'Track my workouts?',
 '3',
])('help matching does not swallow content or controls: %s',text=>{
 expect(matchHelp(text)).toBe(false);
});
