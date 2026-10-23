import {test,expect,vi,beforeEach,afterEach} from 'vitest';
import {convexTest} from 'convex-test';
import schema from '../convex/schema';
import {api,internal} from '../convex/_generated/api';
import {conversationRefs} from '../convex/conversationStore';
import * as copy from '../convex/copy';
const generateObject=vi.hoisted(()=>vi.fn());
vi.mock('@convex-dev/agent',()=>({Agent:class{generateObject=generateObject;}}));
const modules=import.meta.glob('../convex/**/*.*s');
const now=Date.parse('2026-10-07T09:00:00+05:30');
const body=(q:string,l='hot flash',d:string|null='today')=>({k:'body',q,l,b:null,r:null,n:1,d,t:null,x:false,s:'reported'});
const answer=(q='yes')=>({k:'answer',q,target:null,choice:'confirm',d:null,t:null,n:null});
beforeEach(()=>{vi.stubEnv('INTUNE_SEMANTIC_BRIDGE','legacy');vi.spyOn(Date,'now').mockReturnValue(now);vi.stubEnv('OPENAI_API_KEY','synthetic');vi.stubEnv('INTUNE_CONVERSATION_PROTOTYPE','disabled');vi.stubEnv('INTUNE_CONVERSATION_GATE','candidate');generateObject.mockReset();vi.spyOn(console,'info').mockImplementation(()=>{});});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs();});
async function fixture(consent=true){
 const t=convexTest(schema,modules),token=await t.mutation(internal.phoneUsers.getOrCreate,{phoneNumber:'+12025550197'});
 await t.mutation(conversationRefs.enroll,{token});
 await t.run(async ctx=>{const u=(await ctx.db.query('users').withIndex('by_token',q=>q.eq('token',token)).unique())!;await ctx.db.patch(u._id,{conversationConsent:consent,trackedItems:['hot flashes']});});
 const send=(text:string,ops?:any[],messageId=crypto.randomUUID())=>{if(ops)generateObject.mockResolvedValueOnce({object:{v:2,ops}});return t.action(api.messages.send,{token,messageId,text});};
 const view=()=>t.query(conversationRefs.view,{token});return {t,token,send,view};
}
test('candidate requires internal enrollment and server gate; ordinary users stay V1',async()=>{
 const f=await fixture();expect(await f.t.query(conversationRefs.route,{token:f.token})).toBe('candidate');const other=await f.t.mutation(internal.phoneUsers.getOrCreate,{phoneNumber:'+12025550198'});expect(await f.t.query(conversationRefs.route,{token:other})).toBe('v1');const r=await f.t.action(api.messages.send,{token:other,messageId:'hi',text:'hi'});expect(r.message).toBe(copy.greetingReply);expect(generateObject).not.toHaveBeenCalled();
});
test('kill switch holds enrolled users rather than falling back into incompatible V1; Delete remains available',async()=>{
 const f=await fixture();await f.send('hot flash today',[body('hot flash today')]);vi.stubEnv('INTUNE_CONVERSATION_GATE','off');expect(await f.t.query(conversationRefs.route,{token:f.token})).toBe('hold');generateObject.mockReset();expect((await f.send('brain fog today')).outcome).toBe('disabled');expect(generateObject).not.toHaveBeenCalled();expect((await f.view()).body).toHaveLength(1);expect((await f.send('Delete my pilot data')).outcome).toBe('deleted');expect((await f.view()).body).toHaveLength(0);
});
test('switching gate off rejects an already running candidate result',async()=>{
 const f=await fixture();let finish:any,started:any;const ready=new Promise(r=>started=r);generateObject.mockImplementationOnce(()=>{started();return new Promise(r=>finish=r);});const waiting=f.send('hot flash today');await ready;vi.stubEnv('INTUNE_CONVERSATION_GATE','off');finish({object:{v:2,ops:[body('hot flash today')]}});expect((await waiting).outcome).toBe('dropped');expect((await f.view()).body).toHaveLength(0);
});
test('preconsent processing retains neither source nor unresolved health drafts; mixed yes cannot grant consent',async()=>{
 const f=await fixture(false);await f.send('had a hot flash',[body('had a hot flash','hot flash',null)]);expect((await f.view()).pending).toHaveLength(0);expect((await f.view()).body).toHaveLength(0);await f.send('yes and hot flash today',[{...answer('yes'),q:'yes'},body('hot flash today')]);expect((await f.view()).consent).toBe(false);await f.send('yes');expect((await f.view()).consent).toBe(true);expect((await f.view()).body).toHaveLength(0);const receipts=await f.t.run(async ctx=>{const u=(await ctx.db.query('users').withIndex('by_token',q=>q.eq('token',f.token)).unique())!;return ctx.db.query('receipts').withIndex('by_user_state',q=>q.eq('userId',u._id).eq('state','complete')).take(10);});expect(JSON.stringify(receipts)).not.toContain('hot flash');
});
test('preconsent semantic safety remains active without storing health drafts',async()=>{
 const f=await fixture(false);const r=await f.send('I am struggling for air',[{k:'safety',q:'I am struggling for air',category:'breathing'}]);expect(r.message).toBe(copy.medicalSafetyReply);expect((await f.view()).consent).toBe(false);expect((await f.view()).pending).toHaveLength(0);
});
test('consented unresolved draft survives time and disappears on discard',async()=>{
 const f=await fixture();await f.send('had a hot flash',[body('had a hot flash','hot flash',null)]);vi.mocked(Date.now).mockReturnValue(now+60*86400000);expect((await f.view()).pending).toHaveLength(1);await f.send('no',[{...answer('no'),choice:'discard'}]);expect((await f.view()).pending).toHaveLength(0);expect((await f.view()).body).toHaveLength(0);
});
test('renewal keeps consent and previous history without current-week recounting; Delete erases both periods',async()=>{
 const f=await fixture();await f.send('hot flash yesterday',[body('hot flash yesterday','hot flash','yesterday')]);await f.send('Stop');await f.send('Start');let v=await f.view();expect(v.consent).toBe(true);expect(v.body).toHaveLength(1);expect(v.summary).not.toContain('hot flashes: 1');const context=await f.t.query(conversationRefs.context,{token:f.token,messageId:'none'});expect(context.body[0].period).toBe('earlier');const history=await f.t.query(conversationRefs.history,{token:f.token});expect(history.message).toContain('hot flashes: once');await f.send('hot flash today',[body('hot flash today')]);expect((await f.view()).body).toHaveLength(2);await f.send('Delete my pilot data');expect((await f.view()).body).toHaveLength(0);expect((await f.t.query(conversationRefs.context,{token:f.token,messageId:'none'})).body).toHaveLength(0);
});
test('older saved event remains correctable after a new period',async()=>{
 const f=await fixture();await f.send('hot flash yesterday',[body('hot flash yesterday','hot flash','yesterday')]);const old=(await f.view()).body[0];await f.send('Stop');await f.send('Start');const q='actually that hot flash was today';await f.send(q,[{k:'correct',q,target:old._id,n:null,d:'today',t:null,status:null}]);await f.send('yes',[answer()]);expect((await f.view()).body).toHaveLength(1);expect((await f.view()).body[0].occurrenceDate).toBe('2026-10-07');expect((await f.view()).summary).not.toContain('hot flashes: 1');
});
test('history exceeding old lifetime cap does not block a new period',async()=>{
 const f=await fixture();await f.t.run(async ctx=>{const u=(await ctx.db.query('users').withIndex('by_token',q=>q.eq('token',f.token)).unique())!;for(let n=0;n<260;n++)await ctx.db.insert('occurrences',{userId:u._id,jobId:'previous-period',trackedItem:'hot flashes',rawText:'synthetic historical report',occurrenceDate:'2026-08-01',occurrenceTime:null,timePrecision:'date-only',messageReceivedAt:now-60*86400000,source:'user',status:'active',confirmationState:'confirmed',batchId:String(n)});});const r=await f.send('hot flash today',[body('hot flash today')]);expect(r.outcome).toBe('conversation');expect((await f.view()).body.some((r:any)=>r.jobId!=='previous-period')).toBe(true);const count=await f.t.run(async ctx=>{const u=(await ctx.db.query('users').withIndex('by_token',q=>q.eq('token',f.token)).unique())!;return (await ctx.db.query('occurrences').withIndex('by_user',q=>q.eq('userId',u._id)).take(300)).length;});expect(count).toBe(261);
});
test('normal messages in safety pause are never buffered or silently replayed',async()=>{
 const f=await fixture();await f.send('heavy bleeding');const r=await f.send('hot flash today');expect(r.message).toBe(copy.safetyReturnQuestion);expect((await f.view()).pending).toHaveLength(0);await f.send('yes');expect((await f.view()).body).toHaveLength(0);await f.send('hot flash today',[body('hot flash today')]);expect((await f.view()).body).toHaveLength(1);
});

test('a medical question before consent cannot secretly make yes into storage consent',async()=>{
 const f=await fixture(false);await f.send('would HRT help me?', [{k:'question',q:'would HRT help me?',scope:'medical',l:null}]);expect((await f.view()).consent).toBe(false);await f.send('yes',[answer()]);expect((await f.view()).consent).toBe(false);expect((await f.view()).pending).toHaveLength(0);await f.send('yes');expect((await f.view()).consent).toBe(true);
});
test('prior plans and unresolved drafts remain inspectable after renewal without becoming the new plan',async()=>{
 const f=await fixture();await f.t.run(async ctx=>{const u=(await ctx.db.query('users').withIndex('by_token',q=>q.eq('token',f.token)).unique())!;await ctx.db.insert('plans',{userId:u._id,jobId:u.jobId,activity:'strength train',targetNumber:3,rawText:'synthetic plan',messageReceivedAt:now,confirmedAt:now,state:'active'});});await f.send('had a hot flash',[body('had a hot flash','hot flash',null)]);await f.send('Stop');await f.send('Start');const h=await f.t.query(conversationRefs.history,{token:f.token});expect(h.message).toContain('Earlier plans:\n• strength train');expect(h.message).toContain('Not counted yet, still unclear:');expect((await f.view()).plan.plan).toBeNull();await f.send('Delete my pilot data');expect((await f.t.query(conversationRefs.history,{token:f.token})).message).not.toContain('hot flash');
});

test('greeting offers consent before asking her to share a story, with one question and no model call',async()=>{
 const f=await fixture(false);const r=await f.send('hi');expect(r.message).toContain('Shall I keep this record');expect(r.message.match(/\?/g)).toHaveLength(1);expect(generateObject).not.toHaveBeenCalled();await f.send('yes');expect((await f.view()).consent).toBe(true);await f.send('hot flash today',[body('hot flash today')]);expect((await f.view()).body).toHaveLength(1);
});

test('gate is rechecked after apply before releasing a candidate reply; read-only retrieval remains available',async()=>{
 const f=await fixture();const result=await f.send('hot flash today',[body('hot flash today')]);expect(await f.t.query(conversationRefs.delivery,{token:f.token,version:result.version})).toBe(true);
 vi.stubEnv('INTUNE_CONVERSATION_GATE','off');expect(await f.t.query(conversationRefs.delivery,{token:f.token,version:result.version})).toBe(false);expect(await f.t.query(conversationRefs.delivery,{token:f.token,version:result.version,readOnly:true})).toBe(true);
});
test('natural Stop confirmation contains only the approved control reply, never retained health questions',async()=>{
 const f=await fixture();await f.send('please stop this job',[{k:'control',q:'please stop this job',command:'stop',target:null}]);const controlQuestion=(await f.view()).pending[0];
 await f.t.run(async ctx=>{const u=(await ctx.db.query('users').withIndex('by_token',q=>q.eq('token',f.token)).unique())!;await ctx.db.insert('pending',{userId:u._id,jobId:u.jobId,rawText:'synthetic private change',messageReceivedAt:now,reason:'Which day was the synthetic private change?',kind:'clarification',proposal:{v:2,mode:'detail',ops:[body('synthetic private change','synthetic private change',null)]},relatedIds:[]});});
 const result=await f.send('yes',[{...answer(),target:controlQuestion._id}]);expect(result.message).toBe(copy.stoppedReply);expect(result.message).not.toContain('private change');expect(result.controlOnly).toBe(true);expect((await f.view()).state).toBe('stopped');
});
test('gate off and no enrollment preserve full V1 behavior, including negation and medical boundary',async()=>{
 vi.stubEnv('INTUNE_CONVERSATION_GATE','off');const t=convexTest(schema,modules);const token=await t.mutation(internal.phoneUsers.getOrCreate,{phoneNumber:'+12025550199'});
 expect(await t.query(conversationRefs.route,{token})).toBe('v1');await t.run(async ctx=>{const u=(await ctx.db.query('users').withIndex('by_token',q=>q.eq('token',token)).unique())!;await ctx.db.patch(u._id,{trackedItems:['hot flashes']});});
 const meaning={intent:'record',trackedItem:'hot flashes',count:1,datePhrase:'today',timePhrase:null,precision:'date-only',target:null,explicitNew:false,activity:null,targetNumber:null,completionStatus:null};
 generateObject.mockResolvedValueOnce({object:meaning});await t.action(api.messages.send,{token,messageId:'negation',text:'no hot flashes today'});expect((await t.query(api.tracking.getSummary,{token})).records).toHaveLength(0);
 generateObject.mockResolvedValueOnce({object:{...meaning,intent:'out_of_scope_medical',trackedItem:null,count:null,datePhrase:null}});const r=await t.action(api.messages.send,{token,messageId:'medical',text:'would HRT help me?'});expect(r.message).toBe(copy.medicalQuestionReply);expect((await t.query(api.tracking.getSummary,{token})).records).toHaveLength(0);
});
