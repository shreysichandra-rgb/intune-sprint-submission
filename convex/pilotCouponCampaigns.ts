import {v} from 'convex/values';
import {internalMutation,internalQuery} from './_generated/server';
import type {QueryCtx} from './_generated/server';
export const GURGAON_CODE='gurgaon5';
// Operator-only setup. Re-running never replenishes the five lifetime slots.
export const configureGurgaon=internalMutation({args:{},returns:v.object({code:v.string(),limit:v.number(),redemptions:v.number(),remaining:v.number(),enabled:v.boolean()}),handler:async(ctx)=>{
 let row=await ctx.db.query('pilotCouponCampaigns').withIndex('by_code',q=>q.eq('code',GURGAON_CODE)).unique();
 if(!row){const id=await ctx.db.insert('pilotCouponCampaigns',{code:GURGAON_CODE,limit:5,redemptions:0,enabled:true});row=(await ctx.db.get(id))!;}
 if(row.mergedInto==='palmmeadows15'){const beta=await ctx.db.query('pilotCouponCampaigns').withIndex('by_code',q=>q.eq('code','palmmeadows15')).unique();if(!beta||beta.limit!==15)throw Error('Shared beta campaign requires operator review');return {code:GURGAON_CODE,limit:15,redemptions:beta.redemptions,remaining:Math.max(0,15-beta.redemptions),enabled:beta.enabled};}
 if(row.limit!==5)throw Error('Gurgaon limit requires operator review');
 return {code:row.code,limit:row.limit,redemptions:row.redemptions,remaining:Math.max(0,row.limit-row.redemptions),enabled:row.enabled};
}});
// Aggregate-only reporting. Coupon grants are never represented as paid signups.
// The anonymous lifetime counter survives deletion of an owner's records.
export const gurgaonReport=internalQuery({args:{},returns:v.object({code:v.string(),configured:v.boolean(),enabled:v.boolean(),limit:v.number(),redemptions:v.number(),remaining:v.number(),freeMemberships:v.number(),activatedMemberships:v.number(),pendingMemberships:v.number()}),handler:async(ctx)=>{
 const row=await ctx.db.query('pilotCouponCampaigns').withIndex('by_code',q=>q.eq('code',GURGAON_CODE)).unique();
 if(row?.mergedInto==='palmmeadows15')return {...await sharedBetaReport(ctx),code:GURGAON_CODE};
 const grants=await ctx.db.query('pilotEntitlements').withIndex('by_coupon_campaign',q=>q.eq('couponCampaign',GURGAON_CODE)).take(6);
 if(grants.length>5)throw Error('Community coupon count requires operator review');
 return {code:GURGAON_CODE,configured:!!row,enabled:row?.enabled??false,limit:row?.limit??5,redemptions:row?.redemptions??0,remaining:row?Math.max(0,row.limit-row.redemptions):0,freeMemberships:grants.length,activatedMemberships:grants.filter(g=>g.startedAt!==undefined).length,pendingMemberships:grants.filter(g=>g.startedAt===undefined&&g.revokedAt===undefined&&g.activationDeadline>Date.now()).length};
}});

export const PALM_MEADOWS_CODE='palmmeadows15';
// Operator-only setup. Re-running never replenishes the fifteen lifetime slots.
export const configurePalmMeadows=internalMutation({args:{},returns:v.object({code:v.string(),limit:v.number(),redemptions:v.number(),remaining:v.number(),enabled:v.boolean()}),handler:async(ctx)=>{
 let row=await ctx.db.query('pilotCouponCampaigns').withIndex('by_code',q=>q.eq('code',PALM_MEADOWS_CODE)).unique();
 if(!row){const id=await ctx.db.insert('pilotCouponCampaigns',{code:PALM_MEADOWS_CODE,limit:15,redemptions:0,enabled:true});row=(await ctx.db.get(id))!;}
 if(row.limit!==15)throw Error('Palm Meadows limit requires operator review');
 return {code:row.code,limit:row.limit,redemptions:row.redemptions,remaining:Math.max(0,row.limit-row.redemptions),enabled:row.enabled};
}});
// Aggregate-only reporting. Coupon grants are never represented as paid signups.
// The anonymous lifetime counter survives deletion of an owner's records.
export const palmMeadowsReport=internalQuery({args:{},returns:v.object({code:v.string(),configured:v.boolean(),enabled:v.boolean(),limit:v.number(),redemptions:v.number(),remaining:v.number(),freeMemberships:v.number(),activatedMemberships:v.number(),pendingMemberships:v.number()}),handler:async(ctx)=>sharedBetaReport(ctx)});

async function sharedBetaReport(ctx:QueryCtx){
 const row=await ctx.db.query('pilotCouponCampaigns').withIndex('by_code',q=>q.eq('code',PALM_MEADOWS_CODE)).unique();
 const legacy=await ctx.db.query('pilotCouponCampaigns').withIndex('by_code',q=>q.eq('code',GURGAON_CODE)).unique();
 const grants=await ctx.db.query('pilotEntitlements').withIndex('by_coupon_campaign',q=>q.eq('couponCampaign',PALM_MEADOWS_CODE)).take(16);
 if(legacy?.mergedInto===PALM_MEADOWS_CODE)grants.push(...await ctx.db.query('pilotEntitlements').withIndex('by_coupon_campaign',q=>q.eq('couponCampaign',GURGAON_CODE)).take(16));
 if(grants.length>15)throw Error('Shared beta count requires operator review');
 return {code:PALM_MEADOWS_CODE,configured:!!row,enabled:row?.enabled??false,limit:row?.limit??15,redemptions:row?.redemptions??0,remaining:row?Math.max(0,row.limit-row.redemptions):0,freeMemberships:grants.length,activatedMemberships:grants.filter(g=>g.startedAt!==undefined).length,pendingMemberships:grants.filter(g=>g.startedAt===undefined&&g.revokedAt===undefined&&g.activationDeadline>Date.now()).length};
}
// One atomic operator-approved merge: retain historical claims and never replenish slots.
export const mergeGurgaonIntoBeta=internalMutation({args:{},returns:v.object({limit:v.number(),redemptions:v.number(),remaining:v.number(),merged:v.boolean()}),handler:async(ctx)=>{
 const beta=await ctx.db.query('pilotCouponCampaigns').withIndex('by_code',q=>q.eq('code',PALM_MEADOWS_CODE)).unique();
 const old=await ctx.db.query('pilotCouponCampaigns').withIndex('by_code',q=>q.eq('code',GURGAON_CODE)).unique();
 if(!beta||beta.limit!==15)throw Error('Configure the shared fifteen-place beta first');
 if(old?.mergedInto&&old.mergedInto!==PALM_MEADOWS_CODE)throw Error('Unexpected campaign merge');
 const used=beta.redemptions+(old?.mergedInto===PALM_MEADOWS_CODE?0:old?.redemptions??0);
 if(used>15)throw Error('Existing claims exceed the shared limit; no changes made');
 if(old?.mergedInto!==PALM_MEADOWS_CODE){await ctx.db.patch(beta._id,{redemptions:used});if(old)await ctx.db.patch(old._id,{enabled:false,mergedInto:PALM_MEADOWS_CODE});else await ctx.db.insert('pilotCouponCampaigns',{code:GURGAON_CODE,limit:5,redemptions:0,enabled:false,mergedInto:PALM_MEADOWS_CODE});}
 return {limit:15,redemptions:used,remaining:15-used,merged:true};
}});
