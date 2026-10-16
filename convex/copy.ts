// Presentation only: no writes, counting, date resolution, AI calls or permissions.
export const stoppedReply="Of course. I’ve stopped tracking this. Your earlier records are still there. Send Start to begin a new seven-day period.";
export function clockLabel(time:string){
 const [hour,minute]=time.split(':').map(Number);
 return `${hour%12||12}${minute?':'+String(minute).padStart(2,'0'):''}${hour<12?'am':'pm'}`;
}
export function dateLabel(date:string,timezone:string,now=Date.now(),relative=true){
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
 const value=(type:string)=>parts.find(p=>p.type===type)!.value;
 const today=`${value('year')}-${value('month')}-${value('day')}`;
 if(relative&&date===today)return 'today';
 const yesterday=new Date(Date.parse(today+'T12:00:00Z')-86400000).toISOString().slice(0,10);
 if(relative&&date===yesterday)return 'yesterday';
 return new Intl.DateTimeFormat('en-GB',{timeZone:'UTC',day:'numeric',month:'long',...(date.slice(0,4)!==today.slice(0,4)?{year:'numeric'}:{})}).format(new Date(date+'T12:00:00Z'));
}
export function eventLabel(item:string,date:string,time:string|null,precision:string,count=1,timezone='Asia/Kolkata'){
 const label=dateLabel(date,timezone);
 return `${item}${count===2?' twice':count>2?` ${count} times`:''} ${['today','yesterday'].includes(label)?'':'on '}${label}${time?` ${precision==='approximate'?'around':'at'} ${clockLabel(time)}`:''}`;
}
export function acknowledgement(item:string,date:string,time:string|null,precision:string,count:number,timezone='Asia/Kolkata'){
 return `${item==='poor sleep'?'Ugh, that’s rough 😕 ':''}Got it, ${eventLabel(item,date,time,precision,count,timezone)}.`;
}

export function summaryText(view: ReturnType<typeof import('./rules').summary>,timezone='Asia/Kolkata') {
  const heading = summaryHeading({startDate:dateLabel(view.windowStart,timezone,Date.now(),false),endDate:dateLabel(view.windowEnd,timezone,Date.now(),false)});
  if (!view.inWindowRecords.length) return heading + '\n' + summaryEmpty;
  const items=Object.keys(view.byItem).map(item=>{
    const records=view.inWindowRecords.filter(r=>r.trackedItem===item);
    const dates=records.map(r=>`${dateLabel(r.occurrenceDate,timezone)}${r.occurrenceTime?` ${r.timePrecision==='approximate'?'around':'at'} ${clockLabel(r.occurrenceTime)}`:''}`);
    return summaryItem({item,count:records.length,dates:dates.join('; ')});
  });
  return heading + '\n' + items.join('\n');
}

export function planReply(view:Awaited<ReturnType<typeof import('./plans').planView>>){
 if(!view.plan)return noConfirmedPlan;
 return `${view.plan.activity}, ${view.plan.targetNumber} times this week. You’re at ${view.progress}.${view.skipped?` ${view.skipped} reported skipped.`:''} Completed dates: ${view.dates.length?view.dates.map(d=>dateLabel(d,view.timezone)).join(', '):'none'}.${view.plan.state==='closed'?closedPlanSuffix:''}`;
}

export const commands_I_already_received_this_Start_message_I="I already received this Start message. I haven’t started another seven-day period.";

export const commands_Your_health_records_were_deleted_Starting_again="Your health records were deleted. Starting again isn’t available for this number; contact shreysi@spunky.media for help.";

export const commands_This_job_is_already_open_I_m="We’re already tracking this. I’m still keeping up with it.";

export const commands_Started_a_fresh_seven_day_job_for="You’re all set 👍 We’re starting fresh for the next 7 days. Your earlier records are still there.";

export const commands_Your_health_records_have_been_deleted_Your="Your health records have been deleted. Your phone number and service records remain. All proactive messages are stopped.";

export const commands_Paused_I_ll_stay_quiet_including_messages="Of course. I’ll stay quiet for now, but I’ll still keep track when you message me.";

export const commands_Resumed_Future_messages_you_ve_agreed_to="We’re back 👍 The reminders and messages you asked for can come through again. I won’t send the ones you missed while paused.";

export const http_Message_endpoint_is_not_configured="Message endpoint is not configured.";

export const http_Unauthorised_request="Unauthorised request.";

export const http_Send_application_json="Send application/json.";

export const http_Invalid_JSON_message="Invalid JSON message.";

export const http_Message_body_is_too_large="Message body is too large.";

export const http_Invalid_JSON_message_2="Invalid JSON message.";

export const http_Use_phoneNumber_in_international_digits_format_text="Use phoneNumber in international +digits format, text of 1–2,000 characters, and an optional messageId of 1–100 characters.";

export const http_I_couldn_t_safely_process_that_right="I couldn’t safely process that right now. Please try again in a few minutes.";

export const messages_Please_send_a_text_message_of_1="Please send a text message of 1 to 2,000 characters. No health record was saved from this message.";

export const messages_I_already_received_this_message_I_haven='I already received this message. I haven’t counted it again.';

export const messages_AI_is_not_configured_Add_OPENAI_API="I couldn’t read that update just now. Nothing was saved. Please try again in a few minutes.";

export const messages_I_couldn_t_safely_process_that_right="I couldn’t safely process that right now. No health record was saved from this message. Please try again in a few minutes.";

export const messages_I_ve_reached_my_hourly_limit_for="I’ve reached my hourly limit for reading updates. No health record was saved from this message. Please try again after an hour.";

export const phoneUsers_Invalid_phone_number="Invalid phone number.";

export const plans_Resolve_an_existing_plan_question_before_adding="Resolve an existing plan question before adding another.";

export const plans_I_m_keeping_your_confirmed_plan_for="You’ve already got a plan for this week. I’ll keep tracking that one.";


export const plans_What_s_the_plan_you_want_me="What existing plan or commitment do you want me to help you stay on top of, and how many times this week?";


export const plans_This_plan_is_closed_Send_Start_to="This plan is closed. Send Start to begin a new seven-day period.";


export const plans_Does_this_update_refer_to_your_confirmed="Is this about the plan we’re already tracking? I haven’t counted anything yet.";


export const plans_Which_day_did_this_happen_Nothing_was="Which day was that? You can say today, yesterday or 2 days ago. I haven’t counted it yet.";


export const plans_Which_completed_session_should_I_correct_I="Which completed session should I correct? I haven’t changed it yet.";


export const plans_What_should_I_change_about_that_session="What should I change about that session?";


export const plans_Corrected=({activity,date,skipped,progress}:{activity:string;date:string;skipped:boolean;progress:string|null})=>`Got it, corrected 👍 ${activity} for ${date}${skipped?' marked as skipped':''}. You’re at ${progress} this week.`;


export const plans_What_happened_with_your_plan_I_haven="What happened with your plan? I haven’t counted anything yet.";


export const plans_What_changed_about_your_plan_I_haven="What changed with your plan? I haven’t updated anything yet.";



export const plans_Is_that_the_same_session_you_told="Was that the same session as earlier or a new one? I haven’t counted it again yet.";

export const plans_The_test_completion_record_limit_was_reached="I can’t save another completed session right now. Nothing was counted.";

export const plans_Nice=({activity,date,progress}:{activity:any;date:any;progress:any})=>`Nice 💪 I’ve got that for ${date}. You’re at ${progress} this week.`;

export const plans_That_plan_question_is_not_available_to="That plan question is not available to this user.";

export const plans_Okay_I_ve_discarded_that_draft_No="Okay, I’ve discarded that draft. No plan was saved.";

export const plans_This_plan_message_belongs_to_a_stopped="This plan message belongs to a stopped seven-day period. Nothing was saved.";

export const plans_Your_record_changed_while_this_question_was="Your record changed while this question was open. I haven’t saved the older update. Please send it again.";

export const plans_Which_day_did_this_happen_I_haven="Which day was that? You can say today, yesterday or 2 days ago. I haven’t counted it yet.";

export const plans_Please_confirm_or_discard_the_proposed_plan="Please confirm or discard the proposed plan.";

export const plans_This_job_already_has_one_confirmed_plan="You already have a confirmed plan for this seven-day period.";

export const plans_Invalid_plan_proposal="Invalid plan proposal.";

export const plans_Got_it=({activity,targetNumber,targetNumber2}:{activity:any;targetNumber:any;targetNumber2:any})=>`Got it 👍 Your plan is ${activity}, ${targetNumber} times this week. You’re starting at 0/${targetNumber2}.`;

export const plans_Got_it_the_same_session=({value}:{value:any})=>`Got it. Same session. ${value}`;

export const plans_Please_give_the_day_this_happened_Nothing="Which day was that? You can say today, yesterday or 2 days ago. I haven’t updated anything yet.";

export const plans_Please_choose_the_same_session_or_a="Same session or a new one? I haven’t counted it again yet.";

export const rules_What_time_did_this_happen_Please_use="What time was that? Something like 4pm is fine.";

export const rules_Which_day_did_this_happen_at=({timePhrase}:{timePhrase:any})=>`That time hasn’t happened yet today. Which day was it? You can say yesterday or 2 days ago. I haven’t counted it yet.`;

export const rules_Which_day_did_this_happen_I_haven="Which day was that? You can say today, yesterday or 2 days ago. I haven’t counted it yet.";

export const rules_Which_day_did_this_happen_at_2=({timePhrase}:{timePhrase:any})=>`That time is still ahead today. Which day did you mean? You can say yesterday or 2 days ago. I haven’t counted it yet.`;

export const rules_Which_day_did_this_happen_The_date="That date is still ahead. Which day did you mean?";

export const tracking_This_test_session_is_not_authorised_Create="This session isn’t available. Please start again.";

export const tracking_This_test_session_is_not_authorised="This session isn’t available.";

export const tracking_Test_record_limit_reached="I can’t load more saved records right now.";

export const tracking_Invalid_message_ID="Invalid message ID.";

export const tracking_Invalid_message_ID_2="Invalid message ID.";

export const tracking_AI_hourly_call_limit_reached_Please_try="I can’t read another update right now. Nothing was saved. Please try again in about an hour.";

export const tracking_That_occurrence_is_not_available_to_this="That occurrence is not available to this user.";

export const tracking_Resolve_an_existing_clarification_before_adding_more="Please answer the earlier question before adding another update.";

export const tracking_What_would_you_like_me_to_remember="What would you like me to keep track of this week?";

export const tracking_Which_earlier_episode_do_you_mean_I="Which earlier episode do you mean? I haven’t added another.";

export const tracking_Test_record_limit_reached_2="I can’t save another reference right now.";

export const tracking_Got_it_the_same=({value}:{value:any})=>`Got it, the same ${value}. I haven’t counted it again.`;

export const tracking_Which_earlier_episode_should_I_correct="Which earlier episode should I correct?";

export const tracking_I_haven_t_added_any_episodes_from="I haven’t added any episodes from that correction. What happened in the additional episode?";

export const tracking_Corrected=({trackedItem,count}:{trackedItem:string;count:number})=>`Got it, corrected 👍 ${trackedItem}: ${count} time${count===1?'':'s'} in that report.`;

export const tracking_Ah_yes=({value,outsideWindow}:{value:string;outsideWindow:boolean})=>`Ah yes, ${value}. Corrected 👍${outsideWindow?' It’s outside this seven-day period.':''}`;

export const tracking_Which_of_your_chosen_changes_would_you=({items}:{items:string[]})=>`Which one should I keep track of${items.length?`: ${items.join(' or ')}`:''}?`;

export const tracking_Is_that_the_same_episode_you_already="Was that the same episode as earlier or a new one? I haven’t counted it again yet.";

export const tracking_The_fictional_test_session_has_reached_its="I can’t save another update right now.";

export const tracking_Message_is_not_reserved_for_processing="Message is not reserved for processing.";

export const tracking_Your_record_or_tracking_state_changed_while="Your record or tracking state changed while I was reading this. I haven’t saved the older update.";

export const tracking_That_occurrence_is_not_available_to_this_2="That occurrence is not available to this user.";

export const tracking_Forgotten_that_episode_and_its_linked_notes="Done 👍 That episode is gone. I won’t count it or include it in your summary.";

export const tracking_That_clarification_is_not_available_to_this="That clarification is not available to this user.";

export const tracking_That_update_belongs_to_a_stopped_job="That update belongs to a stopped seven-day period, so I haven’t counted it. Send Start before reporting a new episode.";

export const tracking_This_is_not_a_duplicate_clarification="This is not a duplicate clarification.";

export const tracking_That_change_is_not_tracked_by_this="That change is not tracked by this user.";

export const tracking_This_is_not_a_duplicate_clarification_2="This is not a duplicate clarification.";

export const tracking_Got_it_the_same_episode_I_haven="Got it, the same episode. I haven’t counted it again.";

export const tracking_That_unresolved_message_is_removed_Nothing_was="That unresolved message is removed. Nothing was counted.";

export const tracking_Which_completed_session_do_you_mean_Please="Which completed session do you mean? Tell me the date, or say latest.";

export const tracking_Which_earlier_episode_do_you_mean_Please="Which earlier episode do you mean? Tell me the date or tracked change, or say latest.";

export const tracking_Which_pending_question_are_you_answering_Please="Which update do you mean?";

export const tracking_Which_update_is_this_date_for_I="Which update is this date for? I haven’t counted it yet.";

export const whatsapp_WhatsApp_is_not_configured="WhatsApp is not configured.";

export const whatsapp_Verification_rejected="Verification rejected.";

export const whatsapp_WhatsApp_is_not_configured_2="WhatsApp is not configured.";

export const whatsapp_Unauthorised_request="Unauthorised request.";

export const whatsapp_Invalid_payload="Invalid payload.";

export const whatsapp_Payload_too_large="Payload too large.";

export const whatsapp_Unauthorised_request_2="Unauthorised request.";

export const whatsapp_Invalid_payload_2="Invalid payload.";

export const whatsapp_Invalid_payload_3="Invalid payload.";

export const whatsapp_Invalid_text_message="Invalid text message.";

export const whatsapp_EVENT_RECEIVED="EVENT_RECEIVED";

export const whatsapp_WhatsApp_is_not_configured_3="WhatsApp is not configured.";

export const whatsapp_Wrong_receiving_phone="Wrong receiving phone.";

export const whatsapp_WhatsApp_reply_delivery_failed="WhatsApp reply delivery failed.";

export const whatsapp_EVENT_RECEIVED_2="EVENT_RECEIVED";

export const whatsapp_WhatsApp_message_processing_failed="WhatsApp message processing failed.";

export const planConfirmation=({activity,target}:{activity:string;target:number})=>`${activity}, ${target} times this week. Have I got that right? Say yes to save it, or no to leave it unsaved.`;

export const clarifiedSymptomCount=({count}:{count:number})=>` You’ve recorded ${count} in this seven-day window.`;

export const webConnectionFailure="I couldn’t reach InTune just now. Check your saved record before sending that update again.";

export const fictionalSessionReady="Ready — two separate fictional users. I’ll remember brain fog and poor sleep for this test. You can correct, forget, stop or delete your health records.";

export const noConfirmedPlan="We haven’t saved a plan yet.";

export const summaryHeading=({startDate,endDate}:{startDate:string;endDate:string})=>`Here’s what you told me over the last 7 days (${startDate} to ${endDate}):`;

export const summaryEmpty="No body changes recorded in this window.";

export const summaryItem=({item,count,dates}:{item:string;count:number;dates:string})=>`${item}: ${count} time${count===1?'':'s'}: ${dates}.`;

export const closedPlanSuffix=" This plan is closed; your completed sessions are still saved.";

export const webPlanClosed="This plan is closed. Your completed sessions are still saved.";

export const webPlanCounting="One completed session counts as one.";

export const webPlanNotConfirmed="There’s no confirmed plan yet. Type your existing plan and weekly target, then check my repeat-back.";

export const greetingReply='Hi 👋\n\nPerimenopause has enough surprises. I’m InTune. Tell me what showed up and what you got done. I’ll keep track.\n\nSymptoms, workouts, whatever you’re keeping track of this week. Tell me as it happens. I’ll remember it and keep count.\n\nText me like you’d text a friend. I save what you tell me, and you can delete it anytime.\n\nWhat should we keep track of this week?';
export const returningGreetingReply='Hey 👋 What’s going on?';

export const helpReply='I can keep track of what’s changing in your body and keep count for one plan you already follow. Tell me what you’d like a hand with this week.';
export const planNeedsTarget='Yep, I can keep track of that. How many times this week are you aiming for?';
export const clarifyWithExample='Tell me what you’d like me to keep track of. ‘Brain fog today’ or ‘strength training 3 times this week’ is enough.';
export const farewellReply='Okay, bye for now 👋';

export const uncertaintyReply="Sure. We can start with what’s changing in your body, or one plan you want help staying on top of this week. Which feels more useful right now?";
export const doingWellReply='Good to hear 🙂 What would you like me to keep track of this week?';

export const clarificationChoiceReply=({choices}:{choices:string[]})=>`Which update do you mean?\n${choices.map((choice,index)=>`${index+1}. ${choice}`).join("\n")}\nReply with the number and your answer, like “1 same” or “2 today”.`;

export const medicalSafetyReply="I want to pause the usual tracking here because what you’ve described may need medical attention.\nPlease seek urgent medical care now or contact your local emergency service.";
export const mentalSafetyReply="I’m concerned about what you’ve just told me. Please contact emergency services or a local crisis service\nI’m not able to provide emergency or crisis care.";
export const safetyReturnQuestion="Are you okay to continue with normal tracking now?";

export const chooseTrackedItemsReply='Which 1–2 body changes would you like me to keep track of this week?';
export const trackedItemsSavedReply=({items}:{items:string[]})=>`Got it. I’ll keep track of ${items.join(' and ')} this week.`;

// DRAFT — natural tracking recovery; no clinical advice.
export const trackerLimitReply=({items}:{items:string[]})=>`I can keep track of two body changes this week. I’m already tracking ${items.join(' and ')}.`;
export const setupUpdatesConfirmation=({items,updates}:{items:string[];updates:{trackedItem:string|null;count:number|null;datePhrase:string|null;timePhrase:string|null}[]})=>{
 const details=updates.map(update=>{
  const item=update.trackedItem??'';
  const noun=item==='hot flashes'?'hot flash':item==='night sweats'?'night sweat':null;
  const label=update.count===null?item:noun?`${update.count===1?'one':update.count} ${update.count===1?noun:item}`:update.count===1?item:`${item} ${update.count} times`;
  return [label,update.datePhrase,update.timePhrase].filter(Boolean).join(' ');
 }).join(' and ');
 return `I’ll keep track of ${items.join(' and ')}. You said ${details}. Should I count those too?`;
};
export const symptomDateQuestion=({item}:{item:string})=>`Which day did ${item} happen? You can say today, yesterday or 2 days ago. I haven’t counted that yet.`;
export const symptomCountQuestion=({item}:{item:string})=>`How many times did ${item} happen? I haven’t counted that yet.`;

export const naturalTrackingReplies=({replies}:{replies:string[]})=>replies.join('\n\n');
export const symptomDetailsQuestion=({item}:{item:string})=>`What would you like me to note about ${item}? I haven’t counted anything from that message yet.`;

// Operator-approved medical boundary wording; no clinical interpretation.
export const medicalQuestionReply='That’s something to discuss with your doctor. I can’t tell you what’s causing these changes or whether HRT is right for you. I can keep tracking what you’ve noticed, so you have a clearer picture for that conversation.';

export const whatsapp_Text_only_upload_reply="I can only read text messages right now. I can’t read PDFs, photos or voice notes yet. Please paste or type the details here. Nothing from this upload was saved.";
