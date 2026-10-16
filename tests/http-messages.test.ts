import {localDate} from '../convex/rules';
import {test,expect,vi,beforeEach,afterEach} from 'vitest';
import {convexTest} from 'convex-test';
import schema from '../convex/schema';
import {api,internal} from '../convex/_generated/api';
const generateObject=vi.hoisted(()=>vi.fn());
vi.mock('@convex-dev/agent',()=>({Agent:class{generateObject=generateObject;}}));
const modules=import.meta.glob('../convex/**/*.*s');
const phoneA='+12025550181',phoneB='+12025550182';
const base={trackedItem:null,count:null,datePhrase:null,timePhrase:null,precision:'date-only',target:null,explicitNew:false,activity:null,targetNumber:null,completionStatus:null};
const record={...base,intent:'record',trackedItem:'brain fog',count:1,datePhrase:'today'};
const proposal={...base,intent:'plan_proposal',activity:'strength train',targetNumber:3};
beforeEach(()=>{vi.stubEnv('MESSAGE_HTTP_SECRET','synthetic-test-secret');vi.stubEnv('OPENAI_API_KEY','synthetic-test-key');generateObject.mockReset();});
afterEach(()=>vi.unstubAllEnvs());
const request=(body:any,secret='synthetic-test-secret')=>({method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${secret}`},body:JSON.stringify(body)});
test('missing or wrong secret rejects before creating users, calling AI or writing health data',async()=>{
 const t=convexTest(schema,modules);
 for(const headers of [{},{Authorization:'Bearer wrong'},{Authorization:'Bearer '+ 'x'.repeat(5000)}]){const r=await t.fetch('/api/messages',{method:'POST',headers,body:JSON.stringify({phoneNumber:phoneA,text:'Brain fog today'})});expect(r.status).toBe(401);expect(await r.text()).toBe('{"error":"Unauthorised request."}');}
 expect(generateObject).not.toHaveBeenCalled();await t.run(async ctx=>{expect(await ctx.db.query('users').collect()).toEqual([]);});
 vi.stubEnv('MESSAGE_HTTP_SECRET','');expect((await t.fetch('/api/messages',request({phoneNumber:phoneA,text:'Stop'}))).status).toBe(503);
});
test('malformed, oversized and extra JSON fields cannot create a phone user',async()=>{
 const t=convexTest(schema,modules);
 for(const body of [{phoneNumber:'invalid',text:'Stop'},{phoneNumber:phoneA,text:''},{phoneNumber:phoneA,text:'x'.repeat(2001)},{phoneNumber:phoneA,text:'Stop',token:'other-user'},{phoneNumber:phoneA,text:'Stop',messageId:'x'.repeat(101)}])expect((await t.fetch('/api/messages',request(body))).status).toBe(400);
 expect((await t.fetch('/api/messages',{...request({}),body:'{not-json'})).status).toBe(400);
 expect((await t.fetch('/api/messages',{...request({}),body:'x'.repeat(16385)})).status).toBe(413);
 expect(generateObject).not.toHaveBeenCalled();await t.run(async ctx=>{expect(await ctx.db.query('users').collect()).toEqual([]);});
});
test('phone route reuses records, plan confirmation, retrieval and Stop while keeping phones and A/B separate',async()=>{
 const t=convexTest(schema,modules);const pair=await t.mutation(api.tracking.createTestPair,{});const webBefore=await t.query(api.tracking.getSummary,{token:pair.A});
 const chosenToken=await t.mutation(internal.phoneUsers.getOrCreate,{phoneNumber:phoneA});await t.run(async ctx=>{const u=(await ctx.db.query('users').withIndex('by_token',q=>q.eq('token',chosenToken)).unique())!;await ctx.db.patch(u._id,{trackedItems:['brain fog']});});
 generateObject.mockResolvedValueOnce({object:record});const first=await t.fetch('/api/messages',request({phoneNumber:phoneA,text:'Brain fog today',messageId:'first'}));expect(await first.json()).toEqual({reply:`Got it, brain fog today.`});
 generateObject.mockResolvedValueOnce({object:proposal});const plan=await t.fetch('/api/messages',request({phoneNumber:phoneA,text:'strength train 3 times this week'}));expect((await plan.json()).reply).toContain('Have I got that right?');
 const yes=await t.fetch('/api/messages',request({phoneNumber:phoneA,text:'yes'}));expect(await yes.json()).toEqual({reply:'Got it 👍 Your plan is strength train, 3 times this week. You’re starting at 0/3.'});
 const a=await t.fetch('/api/messages',request({phoneNumber:phoneA,text:'how is my plan going?'}));expect(await a.json()).toEqual({reply:'strength train, 3 times this week. You’re at 0/3. Completed dates: none.'});
 const b=await t.fetch('/api/messages',request({phoneNumber:phoneB,text:'how is my plan going?'}));expect((await b.json()).reply).toBe('We haven’t saved a plan yet.');
 const stop=await t.fetch('/api/messages',request({phoneNumber:phoneA,text:'Stop'}));const stopped=await stop.json();expect(stopped.reply).toContain('I’ve stopped tracking this');
 const blocked=await t.fetch('/api/messages',request({phoneNumber:phoneA,text:'Brain fog today'}));expect(await blocked.json()).toEqual(stopped);
 expect(generateObject).toHaveBeenCalledTimes(2);expect(await t.query(api.tracking.getSummary,{token:pair.A})).toEqual(webBefore);expect((await t.query(api.tracking.getSummary,{token:pair.B})).records).toEqual([]);
 const token=await t.mutation(internal.phoneUsers.getOrCreate,{phoneNumber:phoneA});expect((await t.query(api.tracking.getSummary,{token})).sevenDayCount).toBe(1);
});
test('same phone created concurrently stays one user; provider message IDs remain deduplicated',async()=>{
 const t=convexTest(schema,modules);const tokens=await Promise.all([t.mutation(internal.phoneUsers.getOrCreate,{phoneNumber:phoneA}),t.mutation(internal.phoneUsers.getOrCreate,{phoneNumber:phoneA})]);expect(tokens[0]).toBe(tokens[1]);await t.run(async ctx=>{const u=(await ctx.db.query('users').withIndex('by_token',q=>q.eq('token',tokens[0])).unique())!;await ctx.db.patch(u._id,{trackedItems:['brain fog']});});generateObject.mockResolvedValue({object:record});const body={phoneNumber:phoneA,text:'Brain fog today',messageId:'same'};
 await t.fetch('/api/messages',request(body));const repeated=await t.fetch('/api/messages',request(body));expect((await repeated.json()).reply).toContain('already received');expect(generateObject).toHaveBeenCalledTimes(1);expect((await t.query(api.tracking.getSummary,{token:tokens[0]})).records).toHaveLength(1);
});
test('commands still work with missing AI key and exhausted cap; AI failure remains visible without exposing secret or phone',async()=>{
 const t=convexTest(schema,modules);await t.run(async ctx=>{await ctx.db.insert('quotas',{key:'global',times:Array(500).fill(Date.now())});});vi.stubEnv('OPENAI_API_KEY','');
 for(const text of ['Pause','Resume','Stop','Delete my pilot data','What have I told you this week?'])expect((await t.fetch('/api/messages',request({phoneNumber:phoneA,text}))).status).toBe(200);expect(generateObject).not.toHaveBeenCalled();
 const r=await t.fetch('/api/messages',request({phoneNumber:phoneB,text:'Something happened today'}));expect(r.status).toBe(503);const raw=await r.text();expect(raw).toContain('shared app capacity');expect(raw).not.toContain('synthetic-test-secret');expect(raw).not.toContain(phoneB);
});
