import {v} from 'convex/values';
import {internalMutation} from './_generated/server';
import {userFor,memoryChanged} from './tracking';
import {accessFor} from './pilotAccess';
import {matchHelp} from './commandRoute';
import {V4_FIRST_ACTION} from './v4Reply';
import {WELCOME} from './pilotWelcome';
import {currentCapabilities,currentConsentQuestion} from './conversationCopy';
import {saveReply} from './deliveryState';
// Whole-message social turns only. Mixed facts, commands and task answers keep normal verification.
export function socialIntent(text:string):'greeting'|'help'|'begin'|'smalltalk'|'ack'|null{
 const s=text.toLowerCase().replace(/’/g,"'").replace(/[?!.,;:]/g,' ').replace(/[👋🙂😊]/gu,' ').trim().replace(/\s+/g,' ');
 if(/^(?:hi|hello|hey)(?: (?:what's up|what is up|how are you))?$/.test(s))return 'greeting';
 if(matchHelp(s.replace(/^but /,'')))return 'help';
 if(/^(?:(?:yes|ok|okay|so) (?:but )?)?(?:let's start|lets start|let us start|shall we start|should we start|can we start|let's begin|lets begin|i'm ready|i am ready)$/.test(s))return 'begin';
 if(["nothing much you tell me","nothing much","you tell me","what about you"].includes(s))return 'smalltalk';
 if(['ok','okay','got it','understood'].includes(s))return 'ack';
 return null;
}
export const reply=internalMutation({args:{token:v.string(),messageId:v.string(),text:v.string()},returns:v.any(),handler:async(ctx,a)=>{
 if(process.env.INTUNE_PILOT_MODE!=='v3'||process.env.INTUNE_CONVERSATION_GATE!=='candidate')return null;
 const intent=socialIntent(a.text);if(!intent)return null;
 const u=await userFor(ctx,a.token);
 if(u.dataDeletedAt||u.state==='stopped'||u.state==='paused'||u.safetyKind||(await accessFor(ctx,u)).state!=='active')return null;
 if(intent==='ack'&&u.conversationQuestionId)return null; // Never swallow a real pending answer.
 const receipt=await ctx.db.query('receipts').withIndex('by_user_message',q=>q.eq('userId',u._id).eq('messageId',a.messageId)).unique();
 if(!receipt)return null;
 if(receipt.state==='complete')return {outcome:'provider_duplicate',message:'I already received this message.'};
 const last=await ctx.db.query('receipts').withIndex('by_user_state',q=>q.eq('userId',u._id).eq('state','complete')).order('desc').first();
 if(intent==='ack'&&u.conversationConsentAsked&&['conversation_consent_question','conversation_consent_details_question','conversation_tracking_invite'].includes(last?.replyEntry??''))return null;
 const nameQuestion=u.pilotNameAsked&&intent==='greeting';
 const plainAck=intent==='ack'&&!u.pilotNameAsked&&!['pilot_social_help','pilot_social_begin','pilot_social_smalltalk','pilot_social_tracking_invite'].includes(last?.replyEntry??'');
 const invite=(!u.conversationConsent||u.pilotFreshConsentPending)&&!u.conversationConsentAsked?currentConsentQuestion():'What would you like me to keep track of first?';
 let message=nameQuestion?WELCOME+'\n\n'+V4_FIRST_ACTION:plainAck?'Okay.':intent==='help'?currentCapabilities()+'\n\n'+invite:intent==='smalltalk'?"I’m here to take a few things off your mind.\n\n"+invite:intent==='greeting'?`Hi${u.preferredName?' '+u.preferredName:''} 👋\n\n`+invite:intent==='ack'&&u.pilotNameAsked?V4_FIRST_ACTION:invite;
 // Social interaction changes displayed-question metadata only, never storage permission or health records.
 if(!plainAck){await ctx.db.patch(u._id,{conversationQuestionId:undefined,clarificationChoices:undefined,...(!nameQuestion&&!(intent==='ack'&&u.pilotNameAsked)?{pilotNameAsked:false,conversationConsentAsked:!u.conversationConsent||u.pilotFreshConsentPending?true:undefined}:{})});await memoryChanged(ctx,u._id);}
 const fresh=(await ctx.db.get(u._id))!;
 const tag=message.includes(invite)&&(!u.conversationConsent||u.pilotFreshConsentPending)?'pilot_social_tracking_invite':'pilot_social_'+intent;
 await ctx.db.patch(receipt._id,{state:'complete',replyEntry:tag,repliedAt:Date.now()});
 const result={outcome:intent==='greeting'?'greeting':'help',controlOnly:true,message,version:fresh.memoryVersion??0};
 await saveReply(ctx,fresh,a.messageId,result);return result;
}});
