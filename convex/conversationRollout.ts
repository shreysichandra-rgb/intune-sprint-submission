// Explicit all-user rollout. Changes enrollment only, never consent or health state.
import {v} from 'convex/values';
import {paginationOptsValidator} from 'convex/server';
import {internalMutation} from './_generated/server';
import {memoryChanged} from './tracking';
export function allUsersEnabled(env:Record<string,string|undefined>=process.env){return env.INTUNE_CONVERSATION_GATE==='candidate'&&env.INTUNE_CONVERSATION_ROLLOUT==='all';}
export const enrollPage=internalMutation({args:{paginationOpts:paginationOptsValidator},returns:v.object({continueCursor:v.string(),isDone:v.boolean(),enrolled:v.number(),deletedSkipped:v.number()}),handler:async(ctx,args)=>{
 if(!allUsersEnabled())throw new Error('All-user rollout disabled');
 const page=await ctx.db.query('users').paginate({...args.paginationOpts,numItems:Math.min(args.paginationOpts.numItems,100)});
 let enrolled=0,deletedSkipped=0;
 for(const user of page.page){
  if(user.dataDeletedAt){deletedSkipped++;continue;}
  if(user.conversationEnabled!==true){await ctx.db.patch(user._id,{conversationEnabled:true});await memoryChanged(ctx,user._id);enrolled++;}
 }
 return {continueCursor:page.continueCursor,isDone:page.isDone,enrolled,deletedSkipped};
}});

// Operator-only, explicitly gated restart. Keeps owned records, consent, safety,
// contact controls, payment history and paid clocks. Run only after private export.
export const restartOnboardingPage=internalMutation({args:{epoch:v.string(),paginationOpts:paginationOptsValidator},returns:v.object({continueCursor:v.string(),isDone:v.boolean(),restarted:v.number(),deletedSkipped:v.number()}),handler:async(ctx,a)=>{
 if(!allUsersEnabled()||process.env.INTUNE_PILOT_MODE!=='v3'||a.epoch!==process.env.INTUNE_PILOT_ONBOARDING_EPOCH||!a.epoch)throw new Error('Onboarding restart disabled');
 const page=await ctx.db.query('users').paginate({...a.paginationOpts,numItems:Math.min(a.paginationOpts.numItems,50)});
 let restarted=0,deletedSkipped=0;
 for(const u of page.page){
  if(u.dataDeletedAt){deletedSkipped++;continue;}
  if(u.v3OnboardingEpoch===a.epoch)continue;
  const pending=await ctx.db.query('pending').withIndex('by_user',q=>q.eq('userId',u._id)).take(51);
  if(pending.length>50)throw new Error('Pending history requires review');
  for(const p of pending)if(!p.jobId)await ctx.db.patch(p._id,{jobId:u.jobId});
  // Existing paid periods retain their job and clock. Unpaid V2 jobs become history.
  await ctx.db.patch(u._id,{conversationEnabled:true,v3OnboardingEpoch:a.epoch,pilotFreshConsentPending:true,pilotNameAsked:true,preferredName:undefined,greetingSeenAt:undefined,conversationConsentAsked:undefined,conversationQuestionId:undefined,clarificationChoices:undefined,...(u.pilotStartedAt===undefined?{jobId:crypto.randomUUID(),trackedItems:[]}:{}),memoryVersion:(u.memoryVersion??0)+1});
  restarted++;
 }
 return {continueCursor:page.continueCursor,isDone:page.isDone,restarted,deletedSkipped};
}});
