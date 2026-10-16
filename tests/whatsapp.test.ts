import {localDate} from '../convex/rules';
import {test,expect,vi,beforeEach,afterEach} from 'vitest';
import {createHmac} from 'node:crypto';
import {convexTest} from 'convex-test';
import schema from '../convex/schema';
import {api,internal} from '../convex/_generated/api';
const generateObject=vi.hoisted(()=>vi.fn());
vi.mock('@convex-dev/agent',()=>({Agent:class{generateObject=generateObject;}}));
const modules=import.meta.glob('../convex/**/*.*s');
const send=vi.fn();const secret='fake-app-secret';const phoneId='123456789';
const payload=(from='12025550184',text='Brain fog today',id='wamid.fake-1')=>({object:'whatsapp_business_account',entry:[{changes:[{field:'messages',value:{metadata:{phone_number_id:phoneId},messages:[{from,id,type:'text',text:{body:text}}]}}]}]});
const signed=(body:any)=>{const raw=JSON.stringify(body);return {method:'POST',headers:{'X-Hub-Signature-256':'sha256='+createHmac('sha256',secret).update(raw).digest('hex'),'Content-Type':'application/json'},body:raw};};
beforeEach(()=>{for(const [k,v] of Object.entries({WHATSAPP_VERIFY_TOKEN:'fake-verify',WHATSAPP_APP_SECRET:secret,WHATSAPP_ACCESS_TOKEN:'fake-access',WHATSAPP_PHONE_NUMBER_ID:phoneId,OPENAI_API_KEY:'fake-ai'}))vi.stubEnv(k,v);generateObject.mockReset();send.mockReset().mockImplementation(async()=>Response.json({messages:[{id:'wamid.provider.fixture.'+send.mock.calls.length}]}));vi.stubGlobal('fetch',send);});
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
test('signed unpaid Join creates the same ₹99 order and sends one private checkout button',async()=>{
 for(const [k,v] of Object.entries({INTUNE_PILOT_MODE:'v3',PAYMENT_MODE:'razorpay_live',RAZORPAY_KEY_ID:'rzp_live_synthetic',RAZORPAY_KEY_SECRET:'synthetic-payment-secret',RAZORPAY_WEBHOOK_SECRET:'synthetic-webhook',INTUNE_PILOT_WEB_URL:'https://fictional-checkout.convex.site'}))vi.stubEnv(k,v);
 send.mockImplementation(async(url:string)=>url==='https://api.razorpay.com/v1/orders'?Response.json({id:'order_fictionalCTA',amount:9900,currency:'INR'}):Response.json({messages:[{id:'wamid.fictionalCTA'}]}));
 const t=convexTest(schema,modules),body=payload('12025550184','Join','wamid.fictionalJoinCTA');
 expect((await t.fetch('/whatsapp/webhook',signed(body))).status).toBe(200);
 expect((await t.fetch('/whatsapp/webhook',signed(body))).status).toBe(200);
 const orderCalls=send.mock.calls.filter(([url])=>url==='https://api.razorpay.com/v1/orders');
 const messages=send.mock.calls.filter(([url])=>url.includes('graph.facebook.com'));
 expect(orderCalls).toHaveLength(1);expect(JSON.parse(orderCalls[0][1].body)).toMatchObject({amount:9900,currency:'INR',partial_payment:false});
 expect(messages).toHaveLength(1);const p=JSON.parse(messages[0][1].body);
 expect(p.type).toBe('interactive');expect(p.interactive.action.parameters.display_text).toBe('Pay ₹99 securely');
 const orders=await t.run(c=>c.db.query('pilotOrders').collect());expect(orders).toHaveLength(1);
 expect(p.interactive.action.parameters.url).toBe('https://fictional-checkout.convex.site/pilot/checkout.html#'+orders[0].checkoutToken);
 expect(p.interactive.body.text).not.toMatch(/https:|checkout.html/);expect(generateObject).not.toHaveBeenCalled();
 expect(await t.run(c=>c.db.query('pilotEntitlements').collect())).toHaveLength(0);
});
test('WhatsApp GET returns the challenge only for the configured verify token and subscribe mode',async()=>{
 const t=convexTest(schema,modules);
 const r=await t.fetch('/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=fake-verify&hub.challenge=12345');expect(r.status).toBe(200);expect(await r.text()).toBe('12345');
 for(const query of ['hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=12345','hub.mode=other&hub.verify_token=fake-verify&hub.challenge=12345','hub.mode=subscribe&hub.verify_token=fake-verify'])expect((await t.fetch('/whatsapp/webhook?'+query)).status).toBe(403);
 vi.stubEnv('WHATSAPP_VERIFY_TOKEN','');expect((await t.fetch('/whatsapp/webhook')).status).toBe(503);expect(send).not.toHaveBeenCalled();
});
test('WhatsApp rejects missing, wrong and tampered signatures before any user or AI writes',async()=>{
 const t=convexTest(schema,modules);const valid=signed(payload());
 for(const req of [{...valid,headers:{}},{...valid,headers:{'X-Hub-Signature-256':'sha256='+'0'.repeat(64)}},{...valid,body:valid.body+' '}])expect((await t.fetch('/whatsapp/webhook',req)).status).toBe(401);
 expect(generateObject).not.toHaveBeenCalled();expect(send).not.toHaveBeenCalled();await t.run(async ctx=>{expect(await ctx.db.query('users').collect()).toEqual([]);});
});
test('signed WhatsApp status updates and non-text events are ignored without send credentials',async()=>{
 const t=convexTest(schema,modules);vi.stubEnv('WHATSAPP_ACCESS_TOKEN','');vi.stubEnv('WHATSAPP_PHONE_NUMBER_ID','');
 const statuses={object:'whatsapp_business_account',entry:[{changes:[{field:'messages',value:{statuses:[{id:'fake',status:'delivered'}]}}]}]};
 const nontext=payload();(nontext.entry[0].changes[0].value.messages[0] as any).type='image';
 for(const body of [statuses,nontext]){const r=await t.fetch('/whatsapp/webhook',signed(body));expect(r.status).toBe(200);expect(await r.text()).toBe('EVENT_RECEIVED');}
 expect(send).not.toHaveBeenCalled();expect(generateObject).not.toHaveBeenCalled();await t.run(async ctx=>{expect(await ctx.db.query('users').collect()).toEqual([]);});
});
test('WhatsApp text uses the same message logic, sends exact replies and ignores repeated provider IDs',async()=>{
 const t=convexTest(schema,modules);
 const chosenToken=await t.mutation(internal.phoneUsers.getOrCreate,{phoneNumber:'+12025550184'});await t.run(async ctx=>{const user=(await ctx.db.query('users').withIndex('by_token',q=>q.eq('token',chosenToken)).unique())!;await ctx.db.patch(user._id,{trackedItems:['brain fog']});});
 generateObject.mockResolvedValue({object:{intent:'record',trackedItem:'brain fog',count:1,datePhrase:'today',timePhrase:null,precision:'date-only',target:null,explicitNew:false,activity:null,targetNumber:null,completionStatus:null}});
 const body=payload();expect((await t.fetch('/whatsapp/webhook',signed(body))).status).toBe(200);
 expect(send).toHaveBeenCalledTimes(1);const [url,options]=send.mock.calls[0];expect(url).toBe(`https://graph.facebook.com/v23.0/${phoneId}/messages`);expect(options.headers.Authorization).toBe('Bearer fake-access');expect(JSON.parse(options.body)).toEqual({messaging_product:'whatsapp',to:'12025550184',type:'text',text:{body:`Got it, brain fog today.`,preview_url:false}});
 expect((await t.fetch('/whatsapp/webhook',signed(body))).status).toBe(200);expect(send).toHaveBeenCalledTimes(1);expect(generateObject).toHaveBeenCalledTimes(1);
 const token=await t.mutation(internal.phoneUsers.getOrCreate,{phoneNumber:'+12025550184'});expect((await t.query(api.tracking.getSummary,{token})).sevenDayCount).toBe(1);
});
test('WhatsApp commands and typed plan confirmation share existing logic and isolate two senders',async()=>{
 const t=convexTest(schema,modules);const base={trackedItem:null,count:null,datePhrase:null,timePhrase:null,precision:'date-only',target:null,explicitNew:false,completionStatus:null};
 generateObject.mockResolvedValueOnce({object:{...base,intent:'plan_proposal',activity:'strength train',targetNumber:3}});
 for(const [from,text,id] of [['12025550184','strength train 3 times this week','p'],['12025550184','yes','y'],['12025550185','how is my plan going?','b'],['12025550184','Stop','s'],['12025550184','Brain fog today','blocked']])expect((await t.fetch('/whatsapp/webhook',signed(payload(from,text,id)))).status).toBe(200);
 const replies=send.mock.calls.map(([,o])=>JSON.parse(o.body).text.body);expect(replies[0]).toContain('Have I got that right?');expect(replies[1]).toBe('Got it 👍 Your plan is strength train, 3 times this week. You’re starting at 0/3.');expect(replies[2]).toBe('We haven’t saved a plan yet.');expect(replies[3]).toContain('I’ve stopped tracking this');expect(replies[4]).toContain('I’ve stopped tracking this');expect(generateObject).toHaveBeenCalledTimes(1);
});
test('WhatsApp rejects invalid payloads, wrong receiving phone and missing configuration before storage',async()=>{
 const t=convexTest(schema,modules);
 for(const body of [payload('invalid'),payload('12025550184','x'.repeat(2001)),{object:'wrong',entry:[]}])expect((await t.fetch('/whatsapp/webhook',signed(body))).status).toBe(400);
 const wrong=payload();wrong.entry[0].changes[0].value.metadata.phone_number_id='999';expect((await t.fetch('/whatsapp/webhook',signed(wrong))).status).toBe(400);
 vi.stubEnv('WHATSAPP_ACCESS_TOKEN','');expect((await t.fetch('/whatsapp/webhook',signed(payload()))).status).toBe(503);
 expect(send).not.toHaveBeenCalled();await t.run(async ctx=>{expect(await ctx.db.query('users').collect()).toEqual([]);});
});
test('WhatsApp delivery failures return a safe error without provider text or secrets',async()=>{
 const t=convexTest(schema,modules);send.mockResolvedValueOnce(new Response('private provider error',{status:401}));
 const r=await t.fetch('/whatsapp/webhook',signed(payload('12025550184','Pause')));expect(r.status).toBe(502);expect(await r.text()).toBe('WhatsApp reply delivery failed.');
});

// Diagnostic: records the current retry gap, rather than claiming reliable delivery.
test('failed outbound reply is retried without reprocessing or recounting the inbound message',async()=>{
 const t=convexTest(schema,modules);
 send.mockResolvedValueOnce(new Response('synthetic failure',{status:500}));
 const token=await t.mutation(internal.phoneUsers.getOrCreate,{phoneNumber:'+12025550184'});await t.run(async ctx=>{const u=(await ctx.db.query('users').withIndex('by_token',q=>q.eq('token',token)).unique())!;await ctx.db.patch(u._id,{trackedItems:['brain fog']});});
 generateObject.mockResolvedValue({object:{intent:'record',trackedItem:'brain fog',count:1,datePhrase:'today',timePhrase:null,precision:'date-only',target:null,explicitNew:false,activity:null,targetNumber:null,completionStatus:null}});
 const body=payload('12025550184','brain fog today','synthetic-outbound-retry');
 expect((await t.fetch('/whatsapp/webhook',signed(body))).status).toBe(502);
 expect((await t.fetch('/whatsapp/webhook',signed(body))).status).toBe(200);
 expect(send).toHaveBeenCalledTimes(2);expect(generateObject).toHaveBeenCalledTimes(1);expect((await t.query(api.tracking.getSummary,{token})).sevenDayCount).toBe(1);
});

test('operator restriction rejects another signed sender before creating users or calling AI',async()=>{
 vi.stubEnv('CONVEX_SITE_URL','https://disciplined-mammoth-312.convex.site');vi.stubEnv('INTUNE_SYNTHETIC_TRANSPORT','0');vi.stubEnv('INTUNE_CONVERSATION_GATE','candidate');vi.stubEnv('INTUNE_OPERATOR_PHONE','+12025550190');vi.stubEnv('INTUNE_OPERATOR_PHONE_EXPIRES',String(Date.now()+600000));
 const t=convexTest(schema,modules);expect((await t.fetch('/whatsapp/webhook',signed(payload()))).status).toBe(403);
 expect(generateObject).not.toHaveBeenCalled();expect(send).not.toHaveBeenCalled();await t.run(async ctx=>{expect(await ctx.db.query('users').collect()).toEqual([]);});
});

test('an expired operator lease blocks an already queued real outbound reply',async()=>{
 vi.stubEnv('CONVEX_SITE_URL','https://disciplined-mammoth-312.convex.site');vi.stubEnv('INTUNE_SYNTHETIC_TRANSPORT','0');vi.stubEnv('INTUNE_CONVERSATION_GATE','candidate');vi.stubEnv('INTUNE_OPERATOR_PHONE','+12025550190');vi.stubEnv('INTUNE_OPERATOR_PHONE_EXPIRES',String(Date.now()+600000));
 const t=convexTest(schema,modules),token=await t.mutation(internal.phoneUsers.getOrCreate,{phoneNumber:'+12025550190'});
 const id=await t.mutation(internal.whatsappDelivery.enqueue,{token,messageId:'lease-reply',result:{outcome:'paused',message:'Paused',controlOnly:true}});
 expect(id).not.toBeNull();vi.stubEnv('INTUNE_OPERATOR_PHONE_EXPIRES','0');expect(await t.action(internal.whatsappDelivery.deliver,{id:id!})).toBe(false);expect(send).not.toHaveBeenCalled();
});

test.each(['image','document','audio','video','sticker'])('V3 explains unsupported %s without reading attachments, saving health or using AI',async type=>{
 vi.stubEnv('INTUNE_PILOT_MODE','v3');const t=convexTest(schema,modules);
 const token=await t.mutation(internal.phoneUsers.getOrCreate,{phoneNumber:'+12025550184'});
 await t.run(async c=>{const u=(await c.db.query('users').withIndex('by_token',q=>q.eq('token',token)).unique())!;const id=await c.db.insert('pending',{userId:u._id,jobId:u.jobId,rawText:'Fictional pending plan',messageReceivedAt:Date.now(),reason:'Shall I keep walking?',kind:'clarification',proposal:{v:2,mode:'batch',ops:[],target:null},relatedIds:[]});await c.db.patch(u._id,{conversationQuestionId:id});});
 const before=await t.run(async c=>({users:await c.db.query('users').collect(),pending:await c.db.query('pending').collect()}));
 const body=payload();const m:any=body.entry[0].changes[0].value.messages[0];m.type=type;delete m.text;m[type]={id:'private-upload-id',caption:'private-upload-caption',filename:'private-upload-file.pdf'};
 expect((await t.fetch('/whatsapp/webhook',signed(body))).status).toBe(200);
 expect(send).toHaveBeenCalledTimes(1);const reply=JSON.parse(send.mock.calls[0][1].body);expect(reply.text.body).toBe("I can only read text messages right now. I can’t read PDFs, photos or voice notes yet. Please paste or type the details here. Nothing from this upload was saved.");
 expect(generateObject).not.toHaveBeenCalled();expect(send.mock.calls[0][0]).toContain('/messages');
 const after=await t.run(async c=>({users:await c.db.query('users').collect(),pending:await c.db.query('pending').collect(),items:await c.db.query('pilotItems').collect(),occurrences:await c.db.query('occurrences').collect(),quotas:await c.db.query('quotas').collect(),requests:await c.db.query('whatsappRequests').collect(),replies:await c.db.query('whatsappReplies').collect()}));
 expect(after.pending).toEqual(before.pending);expect(after.users[0].conversationQuestionId).toBe(before.users[0].conversationQuestionId);expect(after.users[0].conversationConsent).toBe(before.users[0].conversationConsent);expect(after.users[0].pilotNameAsked).toBe(before.users[0].pilotNameAsked);
 expect(after.items).toHaveLength(0);expect(after.occurrences).toHaveLength(0);expect(after.quotas).toHaveLength(0);expect(JSON.stringify(after)).not.toContain('private-upload');
 expect((await t.fetch('/whatsapp/webhook',signed(body))).status).toBe(200);expect(send).toHaveBeenCalledTimes(1);
});
test('V3 rejects an attachment for the wrong receiving phone before writes',async()=>{
 vi.stubEnv('INTUNE_PILOT_MODE','v3');const t=convexTest(schema,modules),body=payload();const value=body.entry[0].changes[0].value;value.metadata.phone_number_id='999';(value.messages[0] as any).type='image';
 expect((await t.fetch('/whatsapp/webhook',signed(body))).status).toBe(400);expect(send).not.toHaveBeenCalled();expect(await t.run(c=>c.db.query('users').collect())).toHaveLength(0);
});
test('V3 attachment notice retries delivery without interpreting or duplicating the upload',async()=>{
 vi.stubEnv('INTUNE_PILOT_MODE','v3');const t=convexTest(schema,modules),body=payload();(body.entry[0].changes[0].value.messages[0] as any).type='audio';send.mockResolvedValueOnce(new Response('synthetic failure',{status:500}));
 expect((await t.fetch('/whatsapp/webhook',signed(body))).status).toBe(502);expect((await t.fetch('/whatsapp/webhook',signed(body))).status).toBe(200);expect(generateObject).not.toHaveBeenCalled();expect(send).toHaveBeenCalledTimes(2);expect(await t.run(c=>c.db.query('whatsappReplies').collect())).toHaveLength(1);
});

test.each(['missing_id','timeout'])('uncertain outbound %s is not retried on inbound replay',async mode=>{vi.stubEnv('INTUNE_PILOT_MODE','v3');const t=convexTest(schema,modules),body=payload();(body.entry[0].changes[0].value.messages[0] as any).type='audio';if(mode==='timeout')send.mockRejectedValueOnce(new Error('fictional timeout'));else send.mockResolvedValueOnce(Response.json({}));expect((await t.fetch('/whatsapp/webhook',signed(body))).status).toBe(502);expect((await t.fetch('/whatsapp/webhook',signed(body))).status).toBe(200);expect(send).toHaveBeenCalledTimes(1);const rows=await t.run(c=>c.db.query('whatsappReplies').collect());expect(rows).toHaveLength(1);expect(rows[0].uncertainDelivery).toBe(true);expect(rows[0].status).toBe('dropped');expect(rows[0].body).toBeUndefined();expect(generateObject).not.toHaveBeenCalled();});

test('V3 typed webhook retains one complete owned log with quoted context and provider time after removing duplicate logging',async()=>{
 vi.stubEnv('INTUNE_PILOT_MODE','v3');vi.stubEnv('INTUNE_DEBUG_LOGGING','1');
 const t=convexTest(schema,modules),body=payload('12025550184','Pause','wamid.logging-speed');
 const m:any=body.entry[0].changes[0].value.messages[0];m.context={id:'wamid.quoted-fictional'};m.timestamp=String(Math.floor(Date.now()/1000)-2);
 expect((await t.fetch('/whatsapp/webhook',signed(body))).status).toBe(200);
 const rows=await t.run(c=>c.db.query('conversationLog').collect());
 const incoming=rows.filter(r=>r.direction==='incoming'),outgoing=rows.filter(r=>r.direction==='outgoing');
 expect(incoming).toHaveLength(1);expect(incoming[0]).toMatchObject({messageId:m.id,text:'Pause',quotedMessageId:m.context.id,providerSentAt:Number(m.timestamp)*1000});expect(outgoing).toHaveLength(1);expect(outgoing[0].delivery).toBe('accepted');
 expect((await t.fetch('/whatsapp/webhook',signed(body))).status).toBe(200);expect(await t.run(c=>c.db.query('conversationLog').collect())).toHaveLength(2);expect(send).toHaveBeenCalledTimes(1);
});

test('signed read-only welcome callback starts coupon/test access; unsigned read cannot activate',async()=>{vi.stubEnv('INTUNE_PILOT_MODE','v3');const t=convexTest(schema,modules);const token=await t.mutation(internal.phoneUsers.getOrCreate,{phoneNumber:'+12025550184'});const g:any=await t.mutation(internal.pilotAccess.grantTest,{token,grantKey:'fictional-read-webhook'});await t.mutation(internal.pilotAccess.welcomeAccepted,{grantId:g.id,providerMessageId:'wamid.readCallback'});const b={object:'whatsapp_business_account',entry:[{changes:[{field:'messages',value:{metadata:{phone_number_id:phoneId},statuses:[{id:'wamid.readCallback',recipient_id:'12025550184',status:'read',timestamp:String(Math.floor(Date.now()/1000))}]}}]}]};expect((await t.fetch('/whatsapp/webhook',{...signed(b),headers:{'X-Hub-Signature-256':'sha256='+'0'.repeat(64)}})).status).toBe(401);expect((await t.query(internal.pilotAccess.status,{token})).state).toBe('eligible');expect((await t.fetch('/whatsapp/webhook',signed(b))).status).toBe(200);expect((await t.query(internal.pilotAccess.status,{token})).state).toBe('active');});


test('first incoming Meta ad referral is kept privately without sending conversion events',async()=>{
 for(const [k,v] of Object.entries({INTUNE_PILOT_MODE:'v3',INTUNE_DEBUG_LOGGING:'1',INTUNE_V4_ENABLED:'1',RAZORPAY_KEY_ID:'',RAZORPAY_KEY_SECRET:''}))vi.stubEnv(k,v);
 const t=convexTest(schema,modules),body=payload('12025550184','Join','wamid.private-ad-first');
 (body.entry[0].changes[0].value.messages[0] as any).referral={source_type:'ad',source_id:'120000000001',ctwa_clid:'private-click-not-retained',source_url:'https://example.invalid/private',headline:'private-ad-copy',body:'private-ad-text',image_url:'https://example.invalid/image'};
 expect((await t.fetch('/whatsapp/webhook',signed(body))).status).toBe(200);
 expect((await t.fetch('/whatsapp/webhook',signed(body))).status).toBe(200);
 const snapshot=await t.run(async c=>({acquisition:await c.db.query('pilotAcquisitions').collect(),requests:await c.db.query('whatsappRequests').collect()}));
 expect(snapshot.acquisition).toMatchObject([{source:'meta_ad:120000000001',firstMessageId:'wamid.private-ad-first',isNew:true}]);
 const stored=JSON.stringify(snapshot);for(const secret of ['private-click-not-retained','private-ad-copy','private-ad-text','example.invalid'])expect(stored).not.toContain(secret);
 expect(send.mock.calls.every(([url])=>String(url).endsWith('/messages'))).toBe(true);
 const later=payload('12025550184','Join','wamid.private-ad-later');(later.entry[0].changes[0].value.messages[0] as any).referral={source_type:'ad',source_id:'120000000002'};
 expect((await t.fetch('/whatsapp/webhook',signed(later))).status).toBe(200);
 expect(await t.run(async c=>(await c.db.query('pilotAcquisitions').collect())[0].source)).toBe('meta_ad:120000000001');
});
