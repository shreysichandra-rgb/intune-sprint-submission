import {test,expect,vi,beforeEach,afterEach} from 'vitest';
import {convexTest} from 'convex-test';
import schema from '../convex/schema';
import {api,internal} from '../convex/_generated/api';
import * as copy from '../convex/copy';
const generateObject=vi.hoisted(()=>vi.fn());
vi.mock('@convex-dev/agent',()=>({Agent:class{generateObject=generateObject;}}));
const modules=import.meta.glob('../convex/**/*.*s');
const record={intent:'record',trackedItem:'brain fog',count:1,datePhrase:'today',timePhrase:null,precision:'date-only',target:null,explicitNew:false,activity:null,targetNumber:null,completionStatus:null};
beforeEach(()=>{vi.stubEnv('OPENAI_API_KEY','synthetic');generateObject.mockReset();vi.spyOn(console,'info').mockImplementation(()=>{});});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs();});
async function setup(){const t=convexTest(schema,modules),token=await t.mutation(internal.phoneUsers.getOrCreate,{phoneNumber:'+12025550190'});return {t,token,send:(text:string,id=crypto.randomUUID())=>t.action(api.messages.send,{token,messageId:id,text})};}
test('explicit one/two supported changes are chosen without an occurrence; later reports use the existing capture',async()=>{
 const f=await setup();await f.send('Hi');expect((await f.send('brain fog and poor sleep')).message).toBe(copy.trackedItemsSavedReply({items:['brain fog','poor sleep']}));let view=await f.t.query(api.tracking.getSummary,{token:f.token});expect(view.records).toEqual([]);expect(view.user.trackedItems).toEqual(['brain fog','poor sleep']);generateObject.mockResolvedValue({object:record});await f.send('brain fog today');view=await f.t.query(api.tracking.getSummary,{token:f.token});expect(view.records).toHaveLength(1);
});
test('no assumed symptoms, reports prompt selection, and three choices cannot exceed the existing limit',async()=>{
 const f=await setup();generateObject.mockResolvedValue({object:record});expect((await f.send('brain fog today')).message).toBe("I’ll keep track of brain fog. You said brain fog today. Should I count those too?");expect((await f.send('track brain fog and poor sleep and bloating')).message).toBe(copy.chooseTrackedItemsReply);expect((await f.t.query(api.tracking.getSummary,{token:f.token})).user.trackedItems).toEqual([]);expect((await f.send('track brain fog')).outcome).toBe('tracking_setup');expect((await f.t.query(api.tracking.getSummary,{token:f.token})).records).toEqual([]);
});
test('workout stays a plan, safety category never becomes a tracked setup item, and stopped users cannot choose',async()=>{
 const f=await setup();expect((await f.send('Track my workouts?')).message).toBe(copy.planNeedsTarget);expect((await f.send('track headache')).message).toBe(copy.medicalSafetyReply);expect((await f.t.query(api.tracking.getSummary,{token:f.token})).user.trackedItems).toEqual([]);await f.send('Stop');await f.send('brain fog');expect((await f.t.query(api.tracking.getSummary,{token:f.token})).user.trackedItems).toEqual([]);
});
