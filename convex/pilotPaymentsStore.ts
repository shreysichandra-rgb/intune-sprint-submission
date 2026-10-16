import type {MutationCtx,QueryCtx} from './_generated/server';
import type {Id} from './_generated/dataModel';
import {currentPaymentMode,assertOrderMode} from './pilotPaymentMode';
import {makeFunctionReference as ref} from 'convex/server';
import {v} from 'convex/values';
import {internalMutation,internalQuery} from './_generated/server';
import {pilotUser,WEEK,accessFor} from './pilotAccess';
async function latestModeOrder(ctx:MutationCtx|QueryCtx,userId:Id<'users'>){const mode=currentPaymentMode();const current=await ctx.db.query('pilotOrders').withIndex('by_user_mode',q=>q.eq('userId',userId).eq('paymentMode',mode)).order('desc').first();if(mode==='razorpay_live')return current;const legacy=await ctx.db.query('pilotOrders').withIndex('by_user_mode',q=>q.eq('userId',userId).eq('paymentMode',undefined)).order('desc').first();return !current?legacy:!legacy?current:current._creationTime>=legacy._creationTime?current:legacy;}
export const reserveOrder=internalMutation({args:{token:v.string(),linkHash:v.string(),checkoutToken:v.optional(v.string())},returns:v.any(),handler:async(ctx,a)=>{
 const u=await pilotUser(ctx,a.token);if(u.dataDeletedAt)throw new Error('Account unavailable');
 const access=await accessFor(ctx,u);if(['active','eligible'].includes(access.state))throw new Error('Current entitlement already exists');
 const prior=await latestModeOrder(ctx,u._id);
 if(prior&&prior.resetAt===undefined&&prior.state!=='paid'){
  if(a.checkoutToken&&prior.state==='ready'&&prior.orderId){
   const refresh=!prior.checkoutToken||Date.now()>(prior.linkIssuedAt??prior.createdAt)+WEEK;
   if(refresh)await ctx.db.patch(prior._id,{checkoutToken:a.checkoutToken,linkHash:a.linkHash,linkIssuedAt:Date.now()});
   return {id:prior._id,reuse:true,checkoutToken:refresh?a.checkoutToken:prior.checkoutToken};
  }
  if(a.checkoutToken&&prior.state==='review'){if(!prior.checkoutToken)await ctx.db.patch(prior._id,{checkoutToken:a.checkoutToken,linkHash:a.linkHash});return {id:prior._id,recover:true,checkoutToken:prior.checkoutToken??a.checkoutToken};}
  throw new Error('An order already exists; recover it rather than creating a duplicate');
 }
 const id=await ctx.db.insert('pilotOrders',{userId:u._id,paymentMode:currentPaymentMode(),linkHash:a.linkHash,...(a.checkoutToken?{checkoutToken:a.checkoutToken}:{}),state:'reserved',createdAt:Date.now()});return {id};
}});
export const finishOrder=internalMutation({args:{id:v.id('pilotOrders'),orderId:v.optional(v.string())},returns:v.null(),handler:async(ctx,a)=>{
 const o=await ctx.db.get(a.id);if(!o||o.resetAt!==undefined||!['reserved','review'].includes(o.state))return null;assertOrderMode(o);
 if(a.orderId){if(!/^order_[a-zA-Z0-9]+$/.test(a.orderId))throw new Error('Invalid order');const prior=await ctx.db.query('pilotOrders').withIndex('by_order',q=>q.eq('orderId',a.orderId)).unique();if(prior)throw new Error('Duplicate order');}
 await ctx.db.patch(o._id,{state:a.orderId?'ready':'review',...(a.orderId?{orderId:a.orderId}:{})});return null;
}});
export const orderForLink=internalQuery({args:{hash:v.string()},returns:v.any(),handler:async(ctx,a)=>{
 const o=await ctx.db.query('pilotOrders').withIndex('by_link',q=>q.eq('linkHash',a.hash)).unique();if(!o||o.resetAt!==undefined||(o.entitlementId&&(await ctx.db.get(o.entitlementId))?.revokedAt!==undefined)||Date.now()>(o.linkIssuedAt??o.createdAt)+WEEK)throw new Error('Checkout link unavailable');return o;
}});
export const orderByProvider=internalQuery({args:{orderId:v.string()},returns:v.any(),handler:async(ctx,a)=>ctx.db.query('pilotOrders').withIndex('by_order',q=>q.eq('orderId',a.orderId)).unique()});
export const confirm=internalMutation({args:{id:v.id('pilotOrders'),payment:v.any(),eventId:v.optional(v.string())},returns:v.any(),handler:async(ctx,a)=>{
 const o=await ctx.db.get(a.id),p=a.payment;if(o)assertOrderMode(o);if(!o||!o.orderId||!p||typeof p.id!=='string'||!/^pay_[a-zA-Z0-9]+$/.test(p.id)||p.order_id!==o.orderId||p.amount!==9900||p.currency!=='INR'||p.status!=='captured'||p.captured!==true)throw new Error('Matching captured INR 99 payment required');
 if(a.eventId){const e=await ctx.db.query('pilotPaymentEvents').withIndex('by_event',q=>q.eq('eventId',a.eventId!)).unique();if(e){if(e.orderId!==o._id)throw new Error('Event belongs to another order');return {id:o.entitlementId};}}
 const used=await ctx.db.query('pilotOrders').withIndex('by_payment',q=>q.eq('paymentId',p.id)).unique();if(used&&used._id!==o._id)throw new Error('Payment belongs to another order');
 if(o.paymentId&&o.paymentId!==p.id)throw new Error('Conflicting payment needs review');
 let id=o.entitlementId;const now=Date.now();
 if(!id){const user=await ctx.db.get(o.userId);if(!user||user.dataDeletedAt)throw new Error('Account unavailable');id=await ctx.db.insert('pilotEntitlements',{userId:o.userId,source:currentPaymentMode(),grantKey:'payment:'+p.id,eligibleAt:now,activationDeadline:now+WEEK,welcomeState:'pending',actor:'verified_razorpay',...(o.resetAt!==undefined?{revokedAt:now}:{})});await ctx.db.patch(o._id,{paymentId:p.id,verifiedAt:now,state:'paid',entitlementId:id});if(o.resetAt===undefined){await ctx.db.patch(user._id,{memoryVersion:(user.memoryVersion??0)+1});await ctx.scheduler.runAfter(0,ref<'action'>('pilotWelcome:send'),{id});}}
 if(a.eventId)await ctx.db.insert('pilotPaymentEvents',{eventId:a.eventId,orderId:o._id,processedAt:now});return {id};
}});

export const latestOrder=internalQuery({args:{token:v.string()},returns:v.any(),handler:async(ctx,a)=>{const u=await pilotUser(ctx,a.token);if(u.dataDeletedAt)return null;const o=await latestModeOrder(ctx,u._id);if(o?.resetAt!==undefined)return null;if(o?.entitlementId&&(await ctx.db.get(o.entitlementId))?.revokedAt!==undefined)return null;return o;}});
