import {v} from 'convex/values';
import {makeFunctionReference as ref} from 'convex/server';
import {internalMutation} from './_generated/server';
import {accessFor,pilotUser,pilotEnabled,WEEK} from './pilotAccess';
// Whole messages only. A plan mentioning a coupon still uses normal interpretation.
export function couponAttempt(text:string):string|null{
 const trimmed=text.trim().replace(/[.!]$/,'').trim();
 const explicit=/^(?:use\s+)?coupon(?:\s+code)?\s*(?::|=|is)?\s+([a-z0-9_-]{1,80})$/i.exec(trimmed);
 if(explicit)return explicit[1];
 if(['gurgaon5','palmmeadows15','intunebeta'].includes(trimmed.toLowerCase()))return trimmed.toLowerCase();
 const configured=(process.env.INTUNE_PILOT_COUPON?.trim()||'intunewithmyself').toLowerCase();
 return trimmed.toLowerCase()===configured?trimmed:null;
}
const reply=(message:string)=>({outcome:'unpaid',controlOnly:true,message});
export const redeem=internalMutation({args:{token:v.string(),code:v.string()},returns:v.any(),handler:async(ctx,a)=>{
 const suppliedCode=a.code.trim().toLowerCase();
 // Both public names resolve to the existing campaign; never create a new pool.
 let code=suppliedCode==='intunebeta'?'palmmeadows15':suppliedCode;
 if(code==='gurgaon5'){const legacy=await ctx.db.query('pilotCouponCampaigns').withIndex('by_code',q=>q.eq('code','gurgaon5')).unique();if(legacy?.mergedInto==='palmmeadows15')code='palmmeadows15';}
 const community=code==='gurgaon5'||code==='palmmeadows15';
 const configured=process.env.INTUNE_PILOT_COUPON?.trim().toLowerCase();
 if(!pilotEnabled()||!configured&&!community)return reply('The free-week coupon is unavailable right now. No access was changed. You can still use Join for the ₹99 checkout.');
 if(!community&&code!==configured)return reply('That coupon code is not valid. No access was changed. Check the code, or send Join for the ₹99 checkout.');
 const u=await pilotUser(ctx,a.token);
 if(!u.phoneNumber)return reply('Use this coupon in the InTune WhatsApp chat. No access was changed.');
 if(u.dataDeletedAt)return reply('This account was deleted. Please contact support before starting again. No access was changed.');
 if(u.storageWithdrawn)return reply('Saving is currently turned off. Use the existing saving permission controls before redeeming the coupon. No access was changed.');
 if(u.safetyKind)return reply('Please complete the current return-to-tracking step before using the coupon. No access was changed.');
 if(u.state==='stopped'||u.state==='paused')return reply(`Send ${u.state==='stopped'?'Start':'Resume'} first if you want to return to InTune. No access was changed.`);
 const access=await accessFor(ctx,u);
 if(access.state==='active')return reply('You already have active pilot access. The coupon has not changed your existing end time.');
 if(access.state==='eligible')return reply('Your welcome is already pending. Your seven days begin when it is delivered. The coupon has not created another week or payment.');
 const tester=(process.env.INTUNE_TEST_RESET_PHONES??'').split(',').map(p=>p.trim()).includes(u.phoneNumber??'');
 const epoch=!community&&tester&&u.pilotOnboardingResetKey?.startsWith('test-reset:')?u.pilotOnboardingResetKey:'first';
 const grantKey='coupon-week:'+u._id+':'+epoch;
 const prior=await ctx.db.query('pilotEntitlements').withIndex('by_key',q=>q.eq('grantKey',grantKey)).unique();
 if(prior)return reply('This account has already used its free-week coupon. It does not renew automatically. Your saved records are still available. Send Join for the ₹99 pilot checkout.');
 const campaign=community?await ctx.db.query('pilotCouponCampaigns').withIndex('by_code',q=>q.eq('code',code)).unique():null;
 if(community&&(!campaign||!campaign.enabled||campaign.redemptions>=campaign.limit))return {outcome:'coupon_exhausted',controlOnly:true,message:code==='palmmeadows15'?'The fifteen complimentary beta memberships have been claimed. You can join for ₹99 once for seven days, with no automatic renewal.':'The five complimentary Gurgaon memberships have been claimed. You can join for ₹99 once for seven days, with no automatic renewal.'};
 // A pending checkout must not continue to charge after coupon redemption.
 // Its captured-payment proof will still be recorded, without granting another week.
 const orders=await ctx.db.query('pilotOrders').withIndex('by_user',q=>q.eq('userId',u._id)).take(101);
 if(orders.length>100)throw new Error('Access history requires operator review');
 const now=Date.now();for(const o of orders)if(o.state!=='paid'&&o.resetAt===undefined)await ctx.db.patch(o._id,{resetAt:now});
 if(campaign)await ctx.db.patch(campaign._id,{redemptions:campaign.redemptions+1});
 const id=await ctx.db.insert('pilotEntitlements',{...(community?{couponCampaign:code}:{}),userId:u._id,source:'coupon',grantKey,eligibleAt:now,activationDeadline:now+WEEK,welcomeState:'pending',actor:'self_service_coupon'});
 await ctx.db.patch(u._id,{memoryVersion:(u.memoryVersion??0)+1});
 await ctx.scheduler.runAfter(0,ref<'action'>('pilotWelcome:send'),{id});
 return reply('Your coupon gives you seven days free, with no payment or automatic renewal. Your week begins when your WhatsApp welcome is delivered.');
}});
