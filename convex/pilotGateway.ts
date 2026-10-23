import {notNowReply} from './copy';
import {V4_FIRST_ACTION} from './v4Reply';
import {checkoutMessage} from './checkoutPresentation';
import {joinAdSource} from './acquisitionRules';
import {couponAttempt} from './pilotCoupon';
import {directRecordRequest,directLegacyHistoryRequest,directWeeklyRequest} from './conversationPerformance';
import {stageTimer,measuredContext,recordTiming} from './conversationTiming';
import {impliedSavingEnabled} from './conversationPolicy';
import {retentionDisclosure} from './conversationCopy';
import {currentPaymentMode} from './pilotPaymentMode';
import {v} from 'convex/values';
import {makeFunctionReference as ref} from 'convex/server';
import {internalAction} from './_generated/server';
import {internal} from './_generated/api';
import {matchCommand,matchRetrieval} from './commandRoute';
import {conversationRefs} from './conversationStore';
import * as copy from './copy';
import {matchGreeting} from './commandRoute';
import {matchSafetyCategory} from './safety';
export const send=internalAction({args:{token:v.string(),messageId:v.string(),text:v.string(),quotedMessageId:v.optional(v.string()),targetId:v.optional(v.id('occurrences')),completionTargetId:v.optional(v.id('planCompletions'))},returns:v.any(),handler:async(rawCtx,a):Promise<any>=>{
 if(joinAdSource(a.text))a={...a,text:'Join'};
 const timer=stageTimer(),ctx=measuredContext(rawCtx,timer);try{
 if(!a.text.trim()||a.text.length>2000)return {outcome:'error',message:'Please send a text message of 1 to 2000 characters.'};
 const command=matchCommand(a.text)??(process.env.INTUNE_V4_ENABLED==='1'&&/^delete[.!]?$/i.test(a.text.trim())?'delete':null);const access:any=await ctx.runQuery(ref<'query'>('pilotAccess:status'),{token:a.token});
 await ctx.runMutation(internal.tracking.receive,{token:a.token,messageId:a.messageId,...(command==='stop'||command==='delete'?{cancelPending:true}:{})});
 if(!/^go ahead[.!]?$/i.test(a.text.trim()))await ctx.runMutation(ref<'mutation'>('pilotSummary:dismiss'),{token:a.token});
 if(command&&command!=='summary'&&command!=='start')return await ctx.runMutation(internal.commands.execute,{token:a.token,command,messageId:a.messageId});
 const risk=matchSafetyCategory(a.text);if(risk&&process.env.INTUNE_V4_ENABLED!=='1'){const s=await ctx.runMutation(internal.tracking.safetyGuard,{token:a.token,messageId:a.messageId,text:a.text});if(s)return s;}
 if(/\b(?:send|give)\b.*\b(?:summary|recap)\b.*\b(?:when|at)\b.*\b(?:pilot|seven days|7 days)\b.*\b(?:ends?|over|finish)/i.test(a.text))return await ctx.runMutation(ref<'mutation'>('pilotReminders:scheduleSummary'),{token:a.token,text:a.text});
 if(command==='start')return await ctx.runMutation(internal.commands.execute,{token:a.token,command,messageId:a.messageId});
 const permission=await ctx.runMutation(ref<'mutation'>('pilotTrial:permission'),{token:a.token,text:a.text});if(permission)return permission;
 if(/^join$/i.test(a.text.trim())&&access.state==='unpaid'){const trial:any=await ctx.runMutation(ref<'mutation'>('pilotTrial:join'),{token:a.token});if(trial)return {outcome:'greeting',controlOnly:true,message:'Sending your welcome now 👋 Your free 24-hour trial starts when it arrives.'};}
 const coupon=couponAttempt(a.text);if(coupon!==null){const result=await ctx.runMutation(ref<'mutation'>('pilotCoupon:redeem'),{token:a.token,code:coupon});if(result.outcome!=='coupon_exhausted')return result;
  try{const checkout:any=await ctx.runAction(ref<'action'>('pilotPayments:createCheckout'),{token:a.token});return {outcome:'unpaid',controlOnly:true,message:checkoutMessage(checkout.url,currentPaymentMode()==='razorpay_test')};}catch{return {outcome:'unpaid',controlOnly:true,message:result.message+' Send Join for your secure checkout. No payment has been taken.'};}
 }
 if(/^(?:I\s+(?:have\s+)?paid|paid|payment\s+done)[.!]?$/i.test(a.text.trim())){try{const recovered=await ctx.runAction(ref<'action'>('pilotPayments:recoverPayment'),{token:a.token});return {outcome:'unpaid',controlOnly:true,message:recovered?(access.state==='active'?'Your payment is already verified. Your existing pilot end time stays the same.':access.state==='expired'?'Your earlier payment is verified, but that pilot has ended. It does not begin another paid week. Your saved records remain available.':access.state==='resolution'?'Your payment is verified, but welcome delivery needs operator review. No second payment is needed.':'Your payment is verified. Your WhatsApp welcome starts your seven days when delivered.'):'I haven’t found a matching completed payment yet. You can reopen your checkout with Join. No extra payment order was created.'};}catch{return {outcome:'unpaid',controlOnly:true,message:'I couldn’t verify payment right now. Please send I paid again in a few minutes. No access was granted from the message alone.'};}}
 if(/when.*(?:pilot|expire|end)|pilot.*(?:end|status|expir)|how long.*(?:pilot|left)/i.test(a.text)){const context:any=await ctx.runQuery(conversationRefs.context,{token:a.token,messageId:a.messageId});const end=access.endsAt?new Intl.DateTimeFormat('en-IN',{timeZone:context.timezone,dateStyle:'medium',timeStyle:'short'}).format(access.endsAt):null;return {outcome:'summary',controlOnly:true,message:end?`Your pilot ${access.state==='active'?'ends':'ended'} at ${end} (${context.timezone}). Your saved records stay until you ask me to forget or delete them. After expiry you can still read or correct them; new updates and reminders stop.`:access.state==='eligible'?'Your seven days begin when the welcome message is delivered on WhatsApp.':'No active paid pilot is recorded. Your old saved information is still available.'};}
 if(/^go ahead[.!]?$/i.test(a.text.trim())){const approved=await ctx.runMutation(ref<'mutation'>('pilotSummary:approve'),{token:a.token,messageId:a.messageId});if(approved)return approved;}
 const weekly=command==='summary'||/^summary[.!?]?$/i.test(a.text.trim())||matchRetrieval(a.text)==='week'||directWeeklyRequest(a.text);
 const retrieval=weekly||matchRetrieval(a.text)||directLegacyHistoryRequest(a.text);
 if(retrieval||process.env.INTUNE_DIRECT_RECORD_READ!=='0'&&directRecordRequest(a.text)){const h:any=await ctx.runQuery(weekly?conversationRefs.recordReply:conversationRefs.history,weekly?{token:a.token,scope:'week'}:{token:a.token});const offered=weekly&&await ctx.runMutation(ref<'mutation'>('pilotSummary:offer'),{token:a.token,messageId:a.messageId,version:h.version});return {outcome:'summary',message:h.message+(offered?'\nYou can correct an existing record, or say “go ahead” to approve this summary as accurate.':''),version:h.version};}
 if(access.source==='trial'&&/^(?:join|hi|hello|hey)[.!]?$/i.test(a.text.trim())){if(access.state==='eligible')return {outcome:'greeting',controlOnly:true,message:'Your welcome is on its way 👋 Your free 24-hour trial starts when it arrives.'};if(access.state==='active')return {outcome:'greeting',controlOnly:true,message:'Hi 👋 Your free trial is on. You can send me a body change, a plan from your doctor or dietitian, a food plan for a grocery list, a question for your doctor, or ask for a reminder. What would you like to start with?'};}
 if(access.state==='expired'&&/^not now[.!]?$/i.test(a.text.trim()))return {outcome:'help',controlOnly:true,message:notNowReply};
 if(access.state==='expired'&&/^(?:pay|join|checkout)$/i.test(a.text.trim())){try{const checkout:any=await ctx.runAction(ref<'action'>('pilotPayments:createCheckout'),{token:a.token});return {outcome:'unpaid',controlOnly:true,message:checkoutMessage(checkout.url,currentPaymentMode()==='razorpay_test')};}catch{return {outcome:'unpaid',controlOnly:true,message:'Secure checkout abhi available nahi hai. No payment taken. Tumhare saved records available hain.'};}}
 if(access.state==='eligible'&&matchGreeting(a.text)){const welcome=await ctx.runQuery(ref<'query'>('pilotWelcome:greeting'),{token:a.token});if(welcome)return welcome;}
 // Join is an entry request, not a new payment or a health update.
 if(/^join$/i.test(a.text.trim())&&access.state==='eligible')return {outcome:'unpaid',controlOnly:true,message:'Your access is confirmed. I’m waiting for confirmation that your welcome reached WhatsApp. Your seven days haven’t started yet. No need to pay again.'};
 if(/^join$/i.test(a.text.trim())&&access.state==='active'){const end=new Intl.DateTimeFormat('en-IN',{timeZone:'Asia/Kolkata',dateStyle:'medium',timeStyle:'short'}).format(access.endsAt);return {outcome:'greeting',controlOnly:true,message:`Your seven days with InTune are already active, until ${end} (India time). No need to pay again.\n\n${V4_FIRST_ACTION}`};}
 if(process.env.INTUNE_V4_ENABLED==='1'&&(['active','expired'].includes(access.state)||(!matchGreeting(a.text)&&!/^(?:pay|join|start pilot|buy pilot|checkout)$/i.test(a.text.trim()))))return await ctx.runAction(ref<'action'>('v4Action:send'),{token:a.token,messageId:a.messageId,text:a.text,...(a.quotedMessageId?{quotedMessageId:a.quotedMessageId}:{})});
 if(access.state!=='active'){
  // Reuse V2 semantic safety without allowing health writes; apply rechecks access after safety.
  if(!matchGreeting(a.text)&&! /^(?:pay|join|start pilot|buy pilot|checkout)$/i.test(a.text.trim())){const attempted:any=await ctx.runAction(conversationRefs.send,{token:a.token,messageId:a.messageId,text:a.text});if(attempted.readOnly||attempted.correctionOnly||attempted.controlOnly||['safety','safety_paused','safety_resumed','summary','provider_duplicate'].includes(attempted.outcome))return attempted;if(attempted.message==='Thank you. I’ve saved your feedback about InTune.')return {...attempted,controlOnly:true};if(attempted.message?.includes(copy.medicalQuestionReply))return {outcome:'out_of_scope_medical',controlOnly:true,message:copy.medicalQuestionReply};}
  if(/^(?:pay|join|start pilot|buy pilot|checkout)$/i.test(a.text.trim())){try{const checkout:any=await ctx.runAction(ref<'action'>('pilotPayments:createCheckout'),{token:a.token});return {outcome:'unpaid',controlOnly:true,message:checkoutMessage(checkout.url,currentPaymentMode()==='razorpay_test')};}catch{return {outcome:'unpaid',controlOnly:true,message:'Checkout is unavailable or already in progress. Your saved information remains accessible. No new information was saved.'};}}
  return {outcome:'unpaid',controlOnly:true,message:access.state==='eligible'?'Your onboarding welcome is ready. Your seven days begin when it is delivered on WhatsApp.':access.state==='expired'?"Your seven-day pilot has ended. Your saved information is still available, but I haven’t saved new information or scheduled tracking reminders. If you’d like, tell me whether InTune was useful.":(matchGreeting(a.text)?"Hi, I’m InTune 👋 I help you remember your existing health plans and updates during perimenopause. Text messages only for now. The pilot is ₹99 once for seven days, with no automatic renewal. Send Join for your private checkout."+(impliedSavingEnabled()?'\n\n'+retentionDisclosure:''):"Your saved information is still available. New information and tracking reminders need active paid access. No new health information from this message was saved. Send Join for the ₹99 pilot checkout.")};
 }
 const social=await ctx.runMutation(ref<'mutation'>('pilotSocial:reply'),{token:a.token,messageId:a.messageId,text:a.text});if(social)return social;
 return await ctx.runAction(conversationRefs.send,{token:a.token,messageId:a.messageId,text:a.text});
 }finally{await recordTiming(rawCtx,a.token,a.messageId,timer.snapshot("gateway"),timer.isDuplicate());}
}});
