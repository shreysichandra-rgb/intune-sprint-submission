import {v} from 'convex/values';
import {makeFunctionReference as ref} from 'convex/server';
import {internalMutation,internalAction,internalQuery} from './_generated/server';
import type {MutationCtx} from './_generated/server';
import type {Doc} from './_generated/dataModel';
import {userFor} from './tracking';
import {accessFor,pilotEnabled,WEEK} from './pilotAccess';
import {saveReply} from './deliveryState';
export const DAY=86400000;
export const TRIAL_WELCOME='Hi 👋 Main InTune hoon—taaki sab kuch tumhe yaad na rakhna pade.\n\nYeh welcome deliver hone se tumhara 24-hour free trial shuru hoga. No coupon, card or payment needed.\n\nUske baad continue karna chaho toh ₹99 once for seven days. Payment optional hai—no automatic charge or renewal.\n\nAbhi sirf text. Your details stay until you ask me to delete them.\n\nApna existing food plan yahan type ya paste karo—main usmein listed foods ki grocery list bana dungi.';
const OFFER='Trial end par ₹99 wale seven-day option ka ek message chahiye toh “Trial reminder yes” bhejo. Nahi chahiye toh koi baat nahi.';
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
export async function recordTrialUsefulAction(ctx:MutationCtx,u:Doc<'users'>,actions:any[],changed:string[],safe:boolean){
 if(!safe||!changed.length||!contactOpen(u))return '';
 const access=await accessFor(ctx,u);if(access.state!=='active'||access.source!=='trial'||!access.id)return '';
 const g=await ctx.db.get(access.id);if(!g||g.firstUsefulAt!==undefined)return '';
 let kind:'record_saved'|'grocery_list'|'reminder_scheduled'|null=null;
 for(const id of changed){const item=ctx.db.normalizeId('pilotItems',id),reminder=ctx.db.normalizeId('pilotReminders',id),experience=ctx.db.normalizeId('pilotExperiences',id),occurrence=ctx.db.normalizeId('occurrences',id);
  const r:any=await ctx.db.get((item??reminder??experience??occurrence??id) as any);if(!r||r.userId!==u._id)continue;
  if(reminder&&r.state==='active'&&actions.some(a=>a.type==='reminder'))kind='reminder_scheduled';
  else if(actions.some(a=>a.type==='save')&&(item||experience||occurrence))kind=r.kind==='grocery'?'grocery_list':'record_saved';
  if(kind)break;
 }
 if(!kind)return '';await ctx.db.patch(g._id,{firstUsefulAt:Date.now(),firstUsefulKind:kind,nudgeOfferedAt:Date.now()});return OFFER;
}
export const permission=internalMutation({args:{token:v.string(),text:v.string()},returns:v.any(),handler:async(ctx,a)=>{
 const yes=/^trial reminder (?:yes|haan|ha|please)[.!]?$/i.test(a.text.trim()),no=/^trial reminder (?:no|nahi|nahin)[.!]?$/i.test(a.text.trim());if(!yes&&!no)return null;
 const u=await userFor(ctx,a.token);const all=await ctx.db.query('pilotEntitlements').withIndex('by_user',q=>q.eq('userId',u._id)).take(101);if(all.length>100)throw Error('Access history needs review');const g=all.find(g=>g.source==='trial');
 if(!g||!g.startedAt||!g.endsAt||g.endsAt<=Date.now()||!contactOpen(u))return {outcome:'help',controlOnly:true,message:'No trial-end message scheduled. Your saved records remain available.'};
 await ctx.db.patch(g._id,{nudgePermissionAt:yes?Date.now():undefined,nudgeDeclinedAt:no?Date.now():undefined});return {outcome:'help',controlOnly:true,message:yes?'Theek hai—trial khatam hone par ₹99 option ka sirf ek message bhejungi. No automatic charge.':'Theek hai—trial-end payment nudge nahi bhejungi.'};
}});
export const claimNudge=internalMutation({args:{id:v.id('pilotEntitlements')},returns:v.any(),handler:async(ctx,a)=>{
 const g=await ctx.db.get(a.id);if(!g||g.source!=='trial'||g.revokedAt!==undefined||g.startedAt===undefined||g.endsAt===undefined||Date.now()<g.endsAt||g.nudgeHandledAt!==undefined)return null;
 const u=await ctx.db.get(g.userId);const access=u?await accessFor(ctx,u):null;
 const allowed=!!u&&contactOpen(u)&&g.nudgePermissionAt!==undefined&&g.nudgeDeclinedAt===undefined&&access?.state==='expired';
 const inside=!!u?.lastInboundAt&&Date.now()-u.lastInboundAt<DAY-60000;
 await ctx.db.patch(g._id,{nudgeHandledAt:Date.now(),nudgeStatus:!allowed?'suppressed':!inside?'blocked_template':'queued'});
 if(!allowed||!inside||!u)return null;
 const message='Tumhara 24-hour free trial khatam ho gaya hai. Continue karna chaho toh ₹99 once for seven days—no automatic charge or renewal. Tumhare saved notes ab bhi available hain.\n\nSend Pay for your secure ₹99 checkout.';
 return {token:u.token,message};
}});
export const finishNudge=internalMutation({args:{id:v.id('pilotEntitlements'),url:v.union(v.string(),v.null())},returns:v.any(),handler:async(ctx,a)=>{const g=await ctx.db.get(a.id);if(!g||g.nudgeStatus!=='queued'||g.nudgePermissionAt===undefined)return null;const u=await ctx.db.get(g.userId);if(!u||!contactOpen(u)||(await accessFor(ctx,u)).state!=='expired'||!u.lastInboundAt||Date.now()-u.lastInboundAt>=DAY-60000){await ctx.db.patch(g._id,{nudgeStatus:'suppressed'});return null;}const {trialCheckoutMessage}=await import('./checkoutPresentation');const message=a.url?trialCheckoutMessage(a.url):'Tumhara free trial khatam ho gaya hai. Continue karna chaho toh ₹99 once for seven days, no automatic charge or renewal. Send Pay for secure checkout. Saved notes ab bhi available hain.';const replyId=await saveReply(ctx,u,'pilot-trial-end:'+g._id,{outcome:'trial_offer',readOnly:true,message},true);await ctx.db.patch(g._id,{nudgeStatus:'enqueued'});return replyId;}});
export const sendNudge=internalAction({args:{id:v.id('pilotEntitlements')},returns:v.null(),handler:async(ctx,a)=>{const r:any=await ctx.runMutation(ref<'mutation'>('pilotTrial:claimNudge'),a);if(!r)return null;let url:null|string=null;try{const checkout:any=await ctx.runAction(ref<'action'>('pilotPayments:createCheckout'),{token:r.token});url=checkout.url;}catch{/* Payment is optional; never retry a possibly created order here. */}const id=await ctx.runMutation(ref<'mutation'>('pilotTrial:finishNudge'),{id:a.id,url});if(id)await ctx.runAction(ref<'action'>('whatsappDelivery:deliver'),{id});return null;}});
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
