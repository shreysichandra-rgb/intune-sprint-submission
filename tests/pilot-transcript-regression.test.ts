import {test,expect,vi,afterEach} from 'vitest';
import {convexTest} from 'convex-test';
import {writeFileSync} from 'node:fs';
import schema from '../convex/schema';
import {api,internal} from '../convex/_generated/api';
import * as copy from '../convex/copy';
const generateObject=vi.hoisted(()=>vi.fn());
vi.mock('@convex-dev/agent',()=>({Agent:class{generateObject=generateObject;}}));
const modules=import.meta.glob('../convex/**/*.*s');
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs();});
// Operator-authorized regression from the reported pilot failure; no identity/contact data.
const turns=[
 'Hi',
 "hi! ok so honestly where do I even start. I'm 46 and the last few months have been weird. Hot flashes mostly, and I'm waking up at like 3am drenched in sweat. Can we track those?",
 'umm I just said 😅 hot flashes and night sweats. had 3 hot flashes yesterday, one right in the middle of a work meeting which was mortifying. and woke up soaked around 3am last night',
 'Hot flashes',
 'and night sweats too please. had one last night around 3am, had to change my tshirt',
 'ugh having a hot flash right now 🥵',
 'today lol, like literally right now',
 'today',
 'Night sweats',
 'track night sweats',
 'Brain fog today',
 '3 hot flashes yesterday',
 'how many hot flashes this week?',
 "honestly I've been feeling really low and anxious lately, crying for no reason. is this part of it? should I ask my doctor about HRT?",
 'Period started today',
 'yes',
 'Period started today',
];
test('permanent reported pilot transcript preserves setup, dates, duplicates and the two-tracker limit without false crisis',async()=>{
 vi.spyOn(Date,'now').mockReturnValue(Date.parse('2026-10-07T09:00:00+05:30'));vi.stubEnv('OPENAI_API_KEY','synthetic');vi.spyOn(console,'info').mockImplementation(()=>{});
 // Medical interpretation uses the approved bounded reply; no model-generated clinical answer.
 generateObject.mockResolvedValue({object:{intent:'out_of_scope_medical',trackedItem:null,count:null,datePhrase:null,timePhrase:null,precision:'date-only',target:null,explicitNew:false,safetyCategory:'mental',safetyEvidence:'feeling really low and anxious',activity:null,targetNumber:null,completionStatus:null}});
 const t=convexTest(schema,modules),token=await t.mutation(internal.phoneUsers.getOrCreate,{phoneNumber:'+12025550193'});
 const replay:{input:string;reply:string;outcome:string;stored:number}[]=[];
 for(let i=0;i<turns.length;i++){
  const r=await t.action(api.messages.send,{token,messageId:'pilot-regression-'+i,text:turns[i]});const view=await t.query(api.tracking.getSummary,{token});
  replay.push({input:turns[i],reply:r.message,outcome:r.outcome,stored:view.records.length});
  expect(view.user.trackedItems).toEqual(i===0?[]:['hot flashes','night sweats']);expect(view.records).toHaveLength(i<2?0:i<5?4:5);
  expect(view.records.every(x=>['hot flashes','night sweats'].includes(x.trackedItem))).toBe(true);
  expect(r.outcome).not.toMatch(/^safety/);
  expect(r.message).not.toContain('What would you like me to keep track of this week?');
 }
 expect(replay[13].reply).toBe(copy.medicalQuestionReply);expect(replay[13].outcome).toBe('out_of_scope_medical');
 expect(replay[0].reply).toBe(copy.greetingReply);expect(replay[4].outcome).toBe('possible_duplicate');expect(replay[6].reply).toBe(copy.tracking_Got_it_the_same_episode_I_haven);expect(replay[10].outcome).toBe('tracking_limit');expect(replay[11].outcome).toBe('possible_duplicate');expect(replay[14].outcome).toBe('tracking_limit');expect(replay[15].outcome).toBe('tracking_limit');
 const view=await t.query(api.tracking.getSummary,{token});expect(view.pending.filter(p=>p.proposal?.intent==='clarify')).toHaveLength(0);expect((await t.query(api.plans.getPlan,{token})).plan).toBeNull();
 writeFileSync('/tmp/intune-pilot-corrected-replay.json',JSON.stringify(replay,null,2));
});
