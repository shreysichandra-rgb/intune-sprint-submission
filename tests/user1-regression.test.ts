import {test,expect,vi,afterEach} from 'vitest';
import {convexTest} from 'convex-test';
import {readFileSync} from 'node:fs';
import schema from '../convex/schema';
import {api,internal} from '../convex/_generated/api';
const generateObject=vi.hoisted(()=>vi.fn());
vi.mock('@convex-dev/agent',()=>({Agent:class{generateObject=generateObject;}}));
const modules=import.meta.glob('../convex/**/*.*s');
function catalogue(name:string,values:Record<string,string>={}){
 // V1 compatibility only: its reviewed confirmation is superseded for V3.
 if(name==='planConfirmation')return values.activity+', '+values.target+' times this week. Have I got that right? Say yes to save it, or no to leave it unsaved.';
 const doc=readFileSync('COPY.md','utf8');const match=doc.match(new RegExp('^\\| `'+name+'`(?: \\*\\*DRAFT\\*\\*)? \\| ([\\s\\S]*?)\\|','m'));if(!match)throw new Error('Missing catalogue entry');
 let text=match[1].trim().replace(/\\n/g,'\n');if(name==='greetingReply')text=text.replace(/\n/g,'\n\n');
 for(const [key,value] of Object.entries(values))text=text.replaceAll('{'+key+'}',value);return text;
}
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs();});
test('permanent User 1 nine-turn replay uses catalogue replies and confirms before saving',async()=>{
 vi.stubEnv('OPENAI_API_KEY','');vi.spyOn(console,'info').mockImplementation(()=>{});const t=convexTest(schema,modules),token=await t.mutation(internal.phoneUsers.getOrCreate,{phoneNumber:'+12025550189'});
 const turns=[['Hi','greetingReply'],['Going good.','doingWellReply'],['What are your capabilities?','helpReply'],['You tell me what all can you help me with?','helpReply'],['I don’t know, you tell me','uncertaintyReply'],['Track my workouts?','planNeedsTarget'],['3','planConfirmation'],['yes','plans_Got_it'],['Okay bye.','farewellReply']];
 for(let i=0;i<turns.length;i++){const r=await t.action(api.messages.send,{token,messageId:'regression-'+i,text:turns[i][0]});expect(r.message).toBe(catalogue(turns[i][1],{activity:'workouts',target:'3',targetNumber:'3',targetNumber2:'3'}));const plan=await t.query(api.plans.getPlan,{token});if(i<7)expect(plan.plan).toBeNull();else expect(plan.plan?.targetNumber).toBe(3);expect(plan.records).toEqual([]);expect(r.message).not.toBe('What would you like me to keep track of this week?');}
 const view=await t.query(api.tracking.getSummary,{token});expect(view.records).toEqual([]);expect(view.pending).toEqual([]);expect(view.user.trackedItems).toEqual([]);expect(generateObject).not.toHaveBeenCalled();
});
