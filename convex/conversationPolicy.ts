import {v} from 'convex/values';
import {internalMutation} from './_generated/server';
import {userFor,memoryChanged} from './tracking';
import {storageDeclined} from './directTracking';
export function impliedSavingEnabled(){return process.env.INTUNE_PILOT_MODE==='v3'&&process.env.INTUNE_IMPLIED_SAVING==='1';}
export const prepare=internalMutation({args:{token:v.string(),text:v.string()},returns:v.null(),handler:async(ctx,a)=>{
 if(!impliedSavingEnabled())return null;const u=await userFor(ctx,a.token);
 if(u.dataDeletedAt||storageDeclined(a.text)||u.storageWithdrawn)return null;
 if(!u.conversationConsent||u.pilotFreshConsentPending){await ctx.db.patch(u._id,{conversationConsent:true,pilotFreshConsentPending:undefined,conversationConsentAsked:undefined});await memoryChanged(ctx,u._id);}return null;
}});
