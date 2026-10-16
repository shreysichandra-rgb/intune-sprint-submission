import * as copy from './copy';
// Identify authored replies without including any substituted user values in logs.
export function replyEntryName(result:{message?:string;outcome?:string;planView?:unknown}){
 if(typeof result.message!=='string')return null;
 for(const [name,value] of Object.entries(copy))if(typeof value==='string'&&result.message===value)return name;
 switch(result.outcome){
  case 'natural_updates':return 'naturalTrackingReplies';
  case 'tracking_limit':return 'trackerLimitReply';
  case 'tracking_setup':return 'trackedItemsSavedReply';
  case 'clarification':return result.message.startsWith('What would you like me to note about ')?'symptomDetailsQuestion':result.message.startsWith('I’ll keep track of ')?'setupUpdatesConfirmation':result.message.startsWith('Which day did ')?'symptomDateQuestion':result.message.startsWith('How many times did ')?'symptomCountQuestion':result.message.startsWith('Which update do you mean?\n')?'clarificationChoiceReply':null;
  case 'summary':return 'summaryText';
  case 'plan_summary':return 'planReply';
  case 'stored':return 'acknowledgement';
  case 'plan_completed':return 'plans_Nice';
  case 'plan_confirmed':return 'plans_Got_it';
  case 'plan_confirmation':return 'planConfirmation';
  case 'plan_corrected':return 'plans_Corrected';
  case 'corrected':return result.message.includes(' in that report.')?'tracking_Corrected':'tracking_Ah_yes';
  case 'reference':return result.planView?'plans_Got_it_the_same_session':'tracking_Got_it_the_same';
 }
 // Dynamic chosen-change wording is the only remaining substituted clarification.
 if(result.message.startsWith(copy.tracking_Which_of_your_chosen_changes_would_you({items:[]}).slice(0,-1)))return 'tracking_Which_of_your_chosen_changes_would_you';
 return null;
}
