import {v} from 'convex/values';
import {makeFunctionReference as ref} from 'convex/server';
import {internalMutation,internalAction,internalQuery} from './_generated/server';
import type {MutationCtx} from './_generated/server';
import type {Doc} from './_generated/dataModel';
import {userFor} from './tracking';
import {accessFor,pilotEnabled,WEEK} from './pilotAccess';
import {saveReply} from './deliveryState';
import {v4ReplyLanguage} from './v4Reply';
import {TRIAL_END_TEMPLATE_TEXT,weekEndNudgeText} from './checkoutPresentation';
export {TRIAL_END_TEMPLATE_TEXT};
export const DAY=86400000;
export const trialEndTemplateReady=()=>process.env.INTUNE_TRIAL_END_TEMPLATE_APPROVED==='1';
// Detailed trial welcome approved by the founder on 23 October 2026 (clear capabilities and instructions for new users and Build Sprint judges).
export const TRIAL_WELCOME='Hi, I’m InTune 👋 Your helper on WhatsApp for perimenopause. Tell me things the way you’d tell a friend, and I’ll remember them for you.\n\nHere’s what I can do:\n📝 Note body changes with dates: “Slept badly last night”, “Hot flush at 4pm”\n📋 Keep plans from your doctor, dietitian or physio, and track the sessions you do\n🛒 Turn your food plan into a grocery list and keep track of what’s at home\n🩺 Save questions for your next doctor visit\n⏰ Remind you when you ask: “Remind me tomorrow at 9 am to call the clinic”\n🔎 Give it all back: “What all are you keeping track of for me?”\n\nMade a mistake? Just tell me and I’ll correct it. I don’t give medical advice.\n\nYour free 24-hour trial starts now. No payment needed. After that, continuing is optional at ₹99 for seven days, with no automatic charge.\n\nText only for now. Your details stay until you ask me to delete them.\n\nWhat would you like me to remember first?';
// Founder-approved wording, 22 October 2026 (docs/drafts/NUDGE-WORDING-DRAFT.md). Asked once, after her first useful save.
export const TRIAL_NUDGE_QUESTION='One quick thing: when your free trial ends, would you like one message about continuing for ₹99? Reply Yes or No.';
export const PAID_NUDGE_QUESTION='One quick thing: would you like one message before your InTune week ends, with a few ideas for using it? Reply Yes or No.';
export function trialPermissionReply(text:string,yes:boolean){
 const language=v4ReplyLanguage(text);
 if(language==='Hindi')return yes?'हो गया 👍 बस वही एक संदेश भेजूँगी। अपने आप पैसे नहीं कटेंगे।':'कोई बात नहीं, नहीं भेजूँगी। आपकी बातें सेव रहेंगी।';
 if(language?.startsWith('Hinglish'))return yes?'Ho gaya 👍 Bas wahi ek message bhejungi. No automatic charge.':'Koi baat nahi, nahi bhejungi. Aapke notes saved rahenge.';
 return yes?'Done 👍 I’ll send just that one message. No automatic charge.':'No problem, I won’t send it. Your notes stay saved either way.';
}
export function trialUsefulOffer(text:string,source='trial'){
 const language=v4ReplyLanguage(text),trial=source==='trial';
 if(language==='Hindi')return trial?'एक छोटी सी बात: ट्रायल खत्म होने पर ₹99 में जारी रखने के बारे में एक संदेश चाहिए? Yes या No लिखिए।':'एक छोटी सी बात: आपका InTune हफ़्ता खत्म होने से पहले, इस्तेमाल के कुछ आइडिया के साथ एक संदेश चाहिए? Yes या No लिखिए।';
 if(language?.startsWith('Hinglish'))return trial?'Ek chhoti si baat: trial khatam hone par ₹99 mein continue karne ke baare mein ek message chahiye? Yes ya No likhiye.':'Ek chhoti si baat: aapka InTune week khatam hone se pehle, use karne ke kuch ideas ke saath ek message chahiye? Yes ya No likhiye.';
 return trial?TRIAL_NUDGE_QUESTION:PAID_NUDGE_QUESTION;
}
// A plain yes/no counts only as the answer to that one question, sent as InTune's latest message.
const NUDGE_QUESTION_MARK=/Reply Yes or No\.|Yes ya No likhiye\.|Yes या No लिखिए।/;
function contactOpen(u:Doc<'users'>){return !u.dataDeletedAt&&!u.storageWithdrawn&&!u.safetyKind&&u.state!=='paused'&&u.state!=='stopped'&&u.conversationConsent===true&&u.conversationEnabled===true;}
export const join=internalMutation({args:{token:v.string()},returns:v.any(),handler:async(ctx,a)=>{
 if(!pilotEnabled())return null;
 const u=await userFor(ctx,a.token);const preview=(process.env.INTUNE_TRIAL_PREVIEW_PHONES??'').split(',').map(p=>p.trim()).filter(p=>/^\+[1-9]\d{7,14}$/.test(p));const previewUser=!!u.phoneNumber&&preview.includes(u.phoneNumber);if(process.env.INTUNE_TRIAL_ENABLED!=='1'&&!previewUser)return null;if(!u.phoneNumber||u.dataDeletedAt||u.storageWithdrawn||u.safetyKind||['paused','stopped'].includes(u.state??''))return null;
 const prior=await ctx.db.query('pilotEntitlements').withIndex('by_user',q=>q.eq('userId',u._id)).take(101);if(prior.length>100)throw Error('Access history needs review');
 const trial=prior.find(g=>g.source==='trial');if(trial)return {id:trial._id,created:false};
 if(prior.length)return null; // Never add free access to existing paid/coupon/test participants.
 const now=Date.now();const id=await ctx.db.insert('pilotEntitlements',{userId:u._id,source:'trial',grantKey:'trial24:'+u._id,eligibleAt:now,activationDeadline:now+WEEK,welcomeState:'pending',actor:previewUser?'operator_trial_preview':'self_service_trial'});
 await ctx.db.patch(u._id,{conversationEnabled:true,conversationConsent:true,pilotNameAsked:false,memoryVersion:(u.memoryVersion??0)+1});
 await ctx.scheduler.runAfter(0,ref<'action'>('pilotWelcome:send'),{id});return {id,created:true};
}});
// Called in the same transaction as validated writes. No chat/health content is copied.
export async function recordTrialUsefulAction(ctx:MutationCtx,u:Doc<'users'>,actions:any[],changed:string[],safe:boolean,messageText='',canAsk=true){
 if(!safe||!changed.length||!contactOpen(u))return '';
 const access=await accessFor(ctx,u);if(access.state!=='active'||!access.id)return '';
 const g=await ctx.db.get(access.id);if(!g||g.nudgeOfferedAt!==undefined||g.firstUsefulAt!==undefined&&!canAsk)return '';
 let kind:'record_saved'|'grocery_list'|'reminder_scheduled'|null=null;
 for(const id of changed){const item=ctx.db.normalizeId('pilotItems',id),reminder=ctx.db.normalizeId('pilotReminders',id),experience=ctx.db.normalizeId('pilotExperiences',id),occurrence=ctx.db.normalizeId('occurrences',id);
  const r:any=await ctx.db.get((item??reminder??experience??occurrence??id) as any);if(!r||r.userId!==u._id)continue;
  if(reminder&&r.state==='active'&&actions.some(a=>a.type==='reminder'))kind='reminder_scheduled';
  else if(actions.some(a=>a.type==='save')&&(item||experience||occurrence))kind=r.kind==='grocery'?'grocery_list':'record_saved';
  if(kind)break;
 }
 if(!kind)return '';
 // First useful save is counted once; the one nudge question waits if this reply already asks her something.
 await ctx.db.patch(g._id,{...(g.firstUsefulAt===undefined?{firstUsefulAt:Date.now(),firstUsefulKind:kind}:{}),...(canAsk?{nudgeOfferedAt:Date.now()}:{})});return canAsk?trialUsefulOffer(messageText,g.source):'';
}
export const permission=internalMutation({args:{token:v.string(),text:v.string()},returns:v.any(),handler:async(ctx,a)=>{
 const t=a.text.trim(),legacyYes=/^trial reminder (?:yes|haan|ha|please)[.!]?$/i.test(t),legacyNo=/^trial reminder (?:no|nahi|nahin)[.!]?$/i.test(t);
 const plainYes=/^(?:yes|yes please|yeah|yep|sure|haan|haan ji|ji haan|ha|हाँ|हां)[.!]?$/i.test(t),plainNo=/^(?:no|no thanks|no thank you|not now|nahi|nahin|na|नहीं)[.!]?$/i.test(t);
 if(!legacyYes&&!legacyNo&&!plainYes&&!plainNo)return null;
 const u=await userFor(ctx,a.token);const all=await ctx.db.query('pilotEntitlements').withIndex('by_user',q=>q.eq('userId',u._id)).take(101);if(all.length>100)throw Error('Access history needs review');
 let g:Doc<'pilotEntitlements'>|undefined,question:string|undefined;
 if(legacyYes||legacyNo){g=all.find(x=>x.source==='trial');if(!g||!g.startedAt||!g.endsAt||g.endsAt<=Date.now()||!contactOpen(u))return {outcome:'help',controlOnly:true,message:'No trial-end message scheduled. Your saved records remain available.'};}
 else{
  // Plain yes/no only answers the nudge question when it is still open and was InTune's latest message to her.
  g=all.find(x=>x.nudgeOfferedAt!==undefined&&x.nudgePermissionAt===undefined&&x.nudgeDeclinedAt===undefined&&x.revokedAt===undefined&&x.endsAt!==undefined&&x.endsAt>Date.now());
  if(!g||!contactOpen(u))return null;
  const last=(await ctx.db.query('conversationLog').withIndex('by_user_epoch',q=>q.eq('userId',u._id).eq('epoch',u.debugEpoch??0)).order('desc').take(10)).find(l=>l.direction==='outgoing'&&!l.suppressed);
  if(!last?.text||!NUDGE_QUESTION_MARK.test(last.text)||last.receivedAt<(g.nudgeOfferedAt??Infinity))return null;
  question=last.text.slice(0,600);
 }
 const yes=legacyYes||plainYes;
 await ctx.db.patch(g._id,{nudgePermissionAt:yes?Date.now():undefined,nudgeDeclinedAt:yes?undefined:Date.now(),...(yes?{nudgePermissionQuestion:question??'Trial reminder yes (earlier wording)'}:{})});
 // Paid/coupon weeks: one message 24 hours before the end (founder decision 22 Oct); later Yes sends soon, under an hour left sends nothing.
 if(yes&&g.source!=='trial'&&g.endsAt!==undefined){const at=Math.max(g.endsAt-DAY,Date.now()+10*60000);if(at<g.endsAt-3600000)await ctx.scheduler.runAt(at,ref<'action'>('pilotTrial:sendWeekEndNudge'),{id:g._id});else await ctx.db.patch(g._id,{nudgeStatus:'too_late'});}return {outcome:'help',controlOnly:true,message:trialPermissionReply(a.text,yes)};
}});
export const claimNudge=internalMutation({args:{id:v.id('pilotEntitlements')},returns:v.any(),handler:async(ctx,a)=>{
 const g=await ctx.db.get(a.id);if(!g||g.source!=='trial'||g.revokedAt!==undefined||g.startedAt===undefined||g.endsAt===undefined||Date.now()<g.endsAt||g.nudgeHandledAt!==undefined)return null;
 const u=await ctx.db.get(g.userId);const access=u?await accessFor(ctx,u):null;
 const allowed=!!u&&contactOpen(u)&&g.nudgePermissionAt!==undefined&&g.nudgeDeclinedAt===undefined&&access?.state==='expired';
 const inside=!!u?.lastInboundAt&&Date.now()-u.lastInboundAt<DAY-60000;
 // Outside WhatsApp's 24-hour window only the Meta-approved template may reach her; it stays off until approval is configured.
 const template=!inside&&trialEndTemplateReady();
 await ctx.db.patch(g._id,{nudgeHandledAt:Date.now(),nudgeStatus:!allowed?'suppressed':!inside&&!template?'blocked_template':'queued'});
 if(!allowed||!inside&&!template||!u)return null;
 if(template)return {token:u.token,template:true};
 const message='Your 24-hour free trial has ended. You can continue for ₹99 once for seven days, with no automatic charge or renewal. Your saved notes remain available.\n\nSend Pay for your secure ₹99 checkout.';
 return {token:u.token,message};
}});
export const finishNudge=internalMutation({args:{id:v.id('pilotEntitlements'),url:v.union(v.string(),v.null())},returns:v.any(),handler:async(ctx,a)=>{const g=await ctx.db.get(a.id);if(!g||g.nudgeStatus!=='queued'||g.nudgePermissionAt===undefined)return null;const u=await ctx.db.get(g.userId);const inside=!!u?.lastInboundAt&&Date.now()-u.lastInboundAt<DAY-60000;if(!u||!contactOpen(u)||(await accessFor(ctx,u)).state!=='expired'||!inside&&!trialEndTemplateReady()){await ctx.db.patch(g._id,{nudgeStatus:'suppressed'});return null;}const {trialCheckoutMessage}=await import('./checkoutPresentation');const message=!inside?TRIAL_END_TEMPLATE_TEXT:a.url?trialCheckoutMessage(a.url):'Your free trial has ended. Continuing is optional at ₹99 once for seven days, with no automatic charge or renewal. Send Pay for secure checkout. Your saved notes remain available.';const replyId=await saveReply(ctx,u,'pilot-trial-end:'+g._id,{outcome:'trial_offer',readOnly:true,message},true);await ctx.db.patch(g._id,{nudgeStatus:'enqueued'});return replyId;}});
export const sendNudge=internalAction({args:{id:v.id('pilotEntitlements')},returns:v.null(),handler:async(ctx,a)=>{const r:any=await ctx.runMutation(ref<'mutation'>('pilotTrial:claimNudge'),a);if(!r)return null;let url:null|string=null;if(!r.template)try{const checkout:any=await ctx.runAction(ref<'action'>('pilotPayments:createCheckout'),{token:r.token});url=checkout.url;}catch{/* Payment is optional; never retry a possibly created order here. */}const id=await ctx.runMutation(ref<'mutation'>('pilotTrial:finishNudge'),{id:a.id,url});if(id)await ctx.runAction(ref<'action'>('whatsappDelivery:deliver'),{id});return null;}});
export const claimWeekEndNudge=internalMutation({args:{id:v.id('pilotEntitlements')},returns:v.any(),handler:async(ctx,a)=>{
 const g=await ctx.db.get(a.id);if(!g||g.source==='trial'||g.revokedAt!==undefined||g.startedAt===undefined||g.endsAt===undefined||g.nudgeHandledAt!==undefined)return null;
 const u=await ctx.db.get(g.userId);const access=u?await accessFor(ctx,u):null;
 const allowed=!!u&&contactOpen(u)&&g.nudgePermissionAt!==undefined&&g.nudgeDeclinedAt===undefined&&access?.state==='active'&&access.id===g._id&&Date.now()<g.endsAt-3600000;
 const inside=!!u?.lastInboundAt&&Date.now()-u.lastInboundAt<DAY-60000,template=process.env.INTUNE_EXPIRY_TEMPLATE_APPROVED==='1';
 await ctx.db.patch(g._id,{nudgeHandledAt:Date.now(),nudgeStatus:!allowed?'suppressed':!inside&&!template?'blocked_template':'enqueued'});
 if(!allowed||!inside&&!template||!u)return null;
 const end=new Date(g.endsAt),date=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kolkata',day:'numeric',month:'long',year:'numeric'}).format(end),time=new Intl.DateTimeFormat('en-IN',{timeZone:'Asia/Kolkata',hour:'numeric',minute:'2-digit',hour12:true}).format(end).replace(/\s?([ap])\.?m\.?/i,(_m,x)=>' '+x.toLowerCase()+'m');
 return saveReply(ctx,u,'pilot-week-end:'+g._id,{outcome:'week_end_nudge',readOnly:true,message:weekEndNudgeText(date,time)},true);
}});
export const sendWeekEndNudge=internalAction({args:{id:v.id('pilotEntitlements')},returns:v.null(),handler:async(ctx,a)=>{const id=await ctx.runMutation(ref<'mutation'>('pilotTrial:claimWeekEndNudge'),a);if(id)await ctx.runAction(ref<'action'>('whatsappDelivery:deliver'),{id});return null;}});
export const report=internalQuery({args:{},returns:v.any(),handler:async(ctx)=>{
 const grants=await ctx.db.query('pilotEntitlements').withIndex('by_source',q=>q.eq('source','trial')).take(10001);if(grants.length>10000)throw Error('Trial report needs pagination');
 const excluded=new Set((process.env.INTUNE_TEST_RESET_PHONES??'').split(',').map(s=>s.trim()));let trialStarted=0,usefulActionCompleted=0,paid=0,pending=0,blockedNudges=0;const days=new Map<string,{trialStarted:number,usefulActionCompleted:number,paid:number}>();
 const bump=(at:number,k:'trialStarted'|'usefulActionCompleted'|'paid')=>{const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(at);const row=days.get(day)??{trialStarted:0,usefulActionCompleted:0,paid:0};row[k]++;days.set(day,row);};
 for(const g of grants){const u=await ctx.db.get(g.userId);if(g.actor==='operator_trial_preview'||!u||u.dataDeletedAt||u.storageWithdrawn||!u.phoneNumber||excluded.has(u.phoneNumber)||u.testNow!==undefined||/^\+1202555/.test(u.phoneNumber)||/^(lab-|archive:)/.test(u.token)||/fictional|synthetic|test account/i.test(u.label))continue;
 const own=await ctx.db.query('pilotEntitlements').withIndex('by_user',q=>q.eq('userId',u._id)).take(101);if(own.length>100)throw Error('Access history needs review');if(own.some(x=>['operator_test','razorpay_test'].includes(x.source)))continue;
 if(g.startedAt===undefined){pending++;continue;}trialStarted++;bump(g.startedAt,'trialStarted');if(g.firstUsefulAt!==undefined){usefulActionCompleted++;bump(g.firstUsefulAt,'usefulActionCompleted');}if(g.nudgeStatus==='blocked_template')blockedNudges++;
 const orders=await ctx.db.query('pilotOrders').withIndex('by_user',q=>q.eq('userId',u._id)).take(101);if(orders.length>100)throw Error('Order history needs review');const captures=orders.filter(o=>o.state==='paid'&&o.paymentMode==='razorpay_live'&&o.verifiedAt!==undefined&&o.verifiedAt>=g.startedAt!&&o.paymentId&&o.resetAt===undefined).sort((a,b)=>a.verifiedAt!-b.verifiedAt!);if(captures.length){paid++;bump(captures[0].verifiedAt!,'paid');}
 }
 return {at:Date.now(),rollout:process.env.INTUNE_TRIAL_ENABLED==='1'?'live':'preview_only',trialStarted,usefulActionCompleted,paid,pending,blockedNudges,days:[...days].sort(([a],[b])=>a.localeCompare(b)).map(([date,counts])=>({date,...counts})),definitions:{trialStarted:'Unique participant with authenticated welcome delivery; not Join/read alone without verified start.',usefulActionCompleted:'First validated owned record/grocery/reminder write during active trial; greetings, profile names and generic replies excluded.',paid:'Unique trial participant with server-verified captured live INR99 order after trial start; tests/coupons/grants excluded.'},badge:'Anonymous activity evidence only; badge eligibility and awards unconfirmed.'};
}});
