import {impliedSavingEnabled} from './conversationPolicy';
export const retentionDisclosure='I keep our messages and uploads until you ask me to forget or delete them. Health plans use typed messages only.';
// Prototype wording only. Clinical/control copy stays in the approved V1 catalogue.
export {medicalQuestionReply as medicalBoundary} from './copy';
export const capabilities='Tell me about body changes, your cycle, or what you got done for one plan you already follow. I’ll keep the record straight.';
export const consentAccepted='I’ll keep your record, including updates that need clarification, until you ask me to forget or delete it. Reminders stay off unless you agree to them. What would you like me to remember?';
export const consentQuestion='I can keep the body changes, cycle events and existing plan you ask me to remember, including updates that need clarification. They stay until you ask me to forget or delete them; authorised pilot operators may access them to run or troubleshoot the pilot. Shall I keep this record for you?';
export const confirmQuestion='Have I got that right? I’ll count these when you confirm.';
export const unclearQuestion='What would you like me to remember from that?';
export const discardReply='Okay, I haven’t counted that.';
export const privacyReply='Meta/WhatsApp delivers your messages and replies, Convex stores your InTune records, and OpenAI interprets messages that need AI processing. Your InTune health records do not expire automatically. You can request deletion by sending “Delete my pilot data”. Your phone number and some service records remain.';
export function compose(statements:string[],question?:string){return [...new Set(statements.filter(Boolean)),...(question?[question]:[])].join('\n\n');}

export function currentCapabilities(){return process.env.INTUNE_PILOT_MODE==='v3'?"Send me your existing food or workout plan, or health changes you want to track. I can keep them organised, make a grocery list from the food items you name, and bring your saved details back when you ask. "+(process.env.INTUNE_REMINDER_TEMPLATE_APPROVED==='1'?"Reminders need your agreement and a confirmed time.":"Automatic reminders aren’t available yet."):capabilities;}
export function currentConsentQuestion(){if(impliedSavingEnabled())return 'What would you like a hand keeping track of?';if(process.env.INTUNE_PILOT_MODE==='v3'&&process.env.INTUNE_DIRECT_TRACKING==='1')return 'What would you like me to keep track of? I’ll keep the details you ask me to remember until you ask me to forget or delete them.';return process.env.INTUNE_PILOT_MODE==='v3'?"May I save the plans and updates you share so you can ask for them later? You can ask me to forget or delete them.":consentQuestion;}
export function currentConsentAccepted(){return process.env.INTUNE_PILOT_MODE==='v3'?"What would you like a hand remembering first: your food plan, workouts, or health changes you’ve noticed?":consentAccepted;}
export function currentPrivacyReply(){return process.env.INTUNE_PILOT_MODE==='v3'?privacyReply+' '+retentionDisclosure+' Authorised pilot operators may access your records to run or troubleshoot InTune. Records stay until you ask me to forget or delete them. After expiry, you can still read and correct existing records; new additions and reminders need active access.':privacyReply;}

export function currentUnclearQuestion(){return process.env.INTUNE_PILOT_MODE==='v3'?'You could start with a body change, an existing workout plan, or a question for your doctor. Which one would you like me to keep?':unclearQuestion;}

// No health draft is retained before storage permission. This metadata-only
// reply makes the necessary resend explicit instead of restarting onboarding.
export const consentDetailsAccepted='Thank you. I can save what you share now. Your earlier details weren’t saved before you gave permission. Please resend them once so I can organise them.';
