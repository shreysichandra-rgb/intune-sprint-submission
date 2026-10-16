import {test, expect, vi, afterEach} from 'vitest';
import {convexTest} from 'convex-test';
import {makeFunctionReference as ref} from 'convex/server';
import schema from '../convex/schema';
import {internal} from '../convex/_generated/api';
import {checkoutCopy, checkoutMessage, checkoutButton, whatsappReplyPayload} from '../convex/checkoutPresentation';
const root='https://fictional-checkout.convex.site', link=root+'/pilot/checkout.html#'+'a'.repeat(64);
const modules=import.meta.glob('../convex/**/*.*s');
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
test('live button preserves the private URL and removes it only from the displayed body',()=>{
 const p=whatsappReplyPayload('12025550193',checkoutMessage(link),root);
 expect(p).toMatchObject({type:'interactive',interactive:{type:'cta_url',body:{text:checkoutCopy()},action:{name:'cta_url',parameters:{display_text:'Pay ₹99 securely',url:link}}}});
 expect(JSON.stringify((p as any).interactive.body)).not.toContain(link);
});
test('test checkout clearly labels both copy and button as testing',()=>{
 const b=checkoutButton(checkoutMessage(link,true),root)!;
 expect(b.text).toContain('Test Mode');expect(b.label).toBe('Try ₹99 test payment');expect(b.url).toBe(link);
});
test.each([root+'/pilot/checkout.html#short','https://evil.example/pilot/checkout.html#'+'a'.repeat(64),root+'/other#'+'a'.repeat(64),root+'/pilot/checkout.html?x=1#'+'a'.repeat(64),'http://fictional-checkout.convex.site/pilot/checkout.html#'+'a'.repeat(64)])('untrusted or malformed checkout remains text, not a trusted payment button: %s',url=>{
 expect(checkoutButton(checkoutMessage(url),root)).toBeNull();
});
test('ordinary messages, old queued links and missing configuration remain text',()=>{
 for(const text of ['Hello','Your existing reminder', 'Old checkout: '+link])expect(whatsappReplyPayload('12025550193',text,root)).toEqual({messaging_product:'whatsapp',to:'12025550193',type:'text',text:{body:text,preview_url:false}});
 expect(whatsappReplyPayload('12025550193',checkoutMessage(link)).type).toBe('text');
});
test('queued checkout sends one CTA on retries of the same inbound ID and never starts access',async()=>{
 vi.stubEnv('INTUNE_PILOT_WEB_URL',root);vi.stubEnv('WHATSAPP_PHONE_NUMBER_ID','123456789');vi.stubEnv('WHATSAPP_ACCESS_TOKEN','synthetic-secret');
 const fetch=vi.fn().mockResolvedValue(Response.json({messages:[{id:'wamid.fictional.button'}]}));vi.stubGlobal('fetch',fetch);
 const t=convexTest(schema,modules),token=await t.mutation(internal.phoneUsers.getOrCreate,{phoneNumber:'+12025550193'});
 const args={token,messageId:'fictional-join',result:{outcome:'unpaid',controlOnly:true,message:checkoutMessage(link)}};
 const id=await t.mutation(ref<'mutation',any,any>('whatsappDelivery:enqueue'),args);
 expect(await t.mutation(ref<'mutation',any,any>('whatsappDelivery:enqueue'),args)).toBe(id);
 expect(await t.action(ref<'action',any,any>('whatsappDelivery:deliver'),{id})).toBe(true);
 expect(await t.action(ref<'action',any,any>('whatsappDelivery:deliver'),{id})).toBe(true);
 expect(fetch).toHaveBeenCalledTimes(1);expect(JSON.parse(fetch.mock.calls[0][1].body).interactive.action.parameters.url).toBe(link);
 expect((await t.run(c=>c.db.get(id)))?.body).toBeUndefined();
 expect(await t.run(c=>c.db.query('pilotEntitlements').collect())).toHaveLength(0);
});


test('trusted checkout queued with the earlier wording keeps its original private button',()=>{
 const body='Your seven days with InTune cost ₹99, with no automatic renewal.\n\nPay securely through Razorpay. Your week starts when your WhatsApp welcome arrives.';
 expect(checkoutButton(body+'\n\n'+link,root)).toEqual({text:body,url:link,label:'Pay ₹99 securely'});
});
