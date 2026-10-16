> Current rules: [CURRENT_RULES.md](CURRENT_RULES.md), founder decision 10 October 2026. It supersedes older save-confirmation, pre-permission, unsupported-upload, usage-limit and routine release-gate instructions below. Historical status statements are evidence at their recorded time, not current readiness.

# Copy authority for the V3 build

Updated 9 October 2026. PRODUCT.md and DESIGN.md govern current scope. The catalogue below records earlier V1 wording and does not certify the verified V2 conversation copy or future V3 availability. Reuse exact reviewed safety/control/medical wording from the verified V2 source, including its conversation copy and consent wording. Record reviewed new V3 copy here before implementing it.

V1 greetings, one-plan/two-change prompts and Start/new-week offers must not override current V3 paid-access rules. V3 candidate copy is implemented for founder review under the authorised build; older public-launch restrictions below are historical; current test-stage iteration authority is in CURRENT_RULES.md. Payment, storage consent, activation and reminder permission must remain distinct. The first paid onboarding welcome starts access on confirmed delivery, not on her answer; later messages do not reset the 168-hour clock. Communicate the actual expiry plainly without claiming API acceptance means delivery. State only confirmed saved information and actually configured reminders; expiry must not imply medication stops or automatic data deletion. Explain that old stored information is still accessible without payment and new information was not saved. Tracking reminders stop; renewal nudges require separate explicit permission and respect all contact controls. Do not promise an unapproved renewal price or schedule. Operator test access must not claim money was received, issue a fake payment receipt or imply Razorpay confirmed it. Existing users without payment/test access follow unpaid rules while retaining old-data retrieval.

---

# InTune reply catalogue

All conversational replies, visible fallbacks and endpoint responses are defined in `convex/copy.ts`. Braces mark substituted values; square brackets mark conditional wording. This catalogue contains the final reviewed wording for the current copy-only implementation task. User text is passed through unchanged. Web controls, labels and static privacy pages are not conversational replies. Provider/library-generated validation errors are not authored reply text.

Entries explicitly marked DRAFT remain drafts, including the repeated-fallback and farewell entries below.

| Entry | Final wording | Exact situation |
| --- | --- | --- |
| `greetingReply` | Hi 👋
Perimenopause has enough surprises. I’m InTune. Tell me what showed up and what you got done. I’ll keep track.
Symptoms, workouts, whatever you’re keeping track of this week. Tell me as it happens. I’ll remember it and keep count.
Text me like you’d text a friend. I save what you tell me, and you can delete it anytime.
What should we keep track of this week?| Entire message is hi, hello or hey, ignoring case and surrounding spaces; first greeting only, with a saved introduction marker and no health record, pending question, plan or tracking-state changes. |
| `returningGreetingReply` | Hey 👋 What’s going on? | Later standalone greeting; preserves health records and pending questions. |
| `stoppedReply` | Of course. I’ve stopped tracking this. Your earlier records are still there. Send Start to begin a new seven-day period. | Stop command, or a new update/plan for a stopped job. |
| `clockLabel` | {hour}{:minutes}{am/pm} | Known stored clock time displayed in a reply; omit :minutes when zero. |
| `dateLabel` | today / yesterday / {day} {month}[ {year}] | Stored date displayed relative to reply time in user timezone; window headings use explicit dates; year appears when different. |
| `eventLabel` | {item}[ twice / {count} times] [on ]{date}[ around / at {time}] | Symptom record/reference/correction description; on for explicit dates, around for approximate time, at for exact; no invented time. |
| `acknowledgement` | [Ugh, that’s rough 😕 ]Got it, {event}. | New symptom occurrence saved; warmth prefix only for poor sleep. |
| `summaryText` | {summaryHeading}\n{summaryEmpty or summaryItem lines} | On-demand week retrieval; compose corrected in-window records only, one item per line. |
| `planReply` | {activity}, {targetNumber} times this week. You’re at {progress}. Completed dates: {dates or none}.{closedPlanSuffix} | Plan/progress retrieval and same-session acknowledgement when a confirmed plan exists; noConfirmedPlan otherwise. |
| `commands_I_already_received_this_Start_message_I` | I already received this Start message. I haven’t started another seven-day period. | Start delivery already processed. |
| `commands_Your_health_records_were_deleted_Starting_again` | Your health records were deleted. Starting again isn’t available for this number; contact shreysi@spunky.media for help. | Start after pilot-data deletion. |
| `commands_This_job_is_already_open_I_m` | We’re already tracking this. I’m still keeping up with it. | Start when the job is already open. |
| `commands_Started_a_fresh_seven_day_job_for` | You’re all set 👍 We’re starting fresh for the next 7 days. Your earlier records are still there. | Start opens a fresh job. |
| `commands_Your_health_records_have_been_deleted_Your` | Your health records have been deleted. Your phone number and service records remain. All proactive messages are stopped. | Delete my pilot data finishes erasing health copies. |
| `commands_Paused_I_ll_stay_quiet_including_messages` | Of course. I’ll stay quiet for now, but I’ll still keep track when you message me. | Pause is processed. |
| `commands_Resumed_Future_messages_you_ve_agreed_to` | We’re back 👍 The reminders and messages you asked for can come through again. I won’t send the ones you missed while paused. | Resume is processed. |
| `http_Message_endpoint_is_not_configured` | Message endpoint is not configured. | /api/messages: shared-secret configuration missing. |
| `http_Unauthorised_request` | Unauthorised request. | /api/messages: missing or incorrect shared secret. |
| `http_Send_application_json` | Send application/json. | /api/messages: content type is not application/json. |
| `http_Invalid_JSON_message` | Invalid JSON message. | /api/messages: request body is missing. |
| `http_Message_body_is_too_large` | Message body is too large. | /api/messages: request body exceeds 16,384 bytes. |
| `http_Invalid_JSON_message_2` | Invalid JSON message. | /api/messages: JSON parsing fails. |
| `http_Use_phoneNumber_in_international_digits_format_text` | Use phoneNumber in international +digits format, text of 1–2,000 characters, and an optional messageId of 1–100 characters. | /api/messages: JSON fields or phone/text/message ID validation fails. |
| `http_I_couldn_t_safely_process_that_right` | I couldn’t safely process that right now. Please try again in a few minutes. | /api/messages: processing throws. |
| `messages_Please_send_a_text_message_of_1` | Please send a text message of 1 to 2,000 characters. No health record was saved from this message. | send: empty text or more than 2,000 characters. |
| `messages_I_already_received_this_message_I_haven` | I already received this message. I haven’t counted it again. | send: message reservation says this delivery was already handled. |
| `messages_AI_is_not_configured_Add_OPENAI_API` | I couldn’t read that update just now. Nothing was saved. Please try again in a few minutes. | send: AI key missing; internal error replaced by safe visible fallback. |
| `messages_I_couldn_t_safely_process_that_right` | I couldn’t safely process that right now. No health record was saved from this message. Please try again in a few minutes. | send: AI/processing exception is not an approved safe error. |
| `messages_I_ve_reached_my_hourly_limit_for` | I’ve reached my hourly limit for reading updates. No health record was saved from this message. Please try again after an hour. | send: hourly AI quota reservation rejected. |
| `phoneUsers_Invalid_phone_number` | Invalid phone number. | Phone-user lookup: international phone format validation fails. |
| `plans_Resolve_an_existing_plan_question_before_adding` | Resolve an existing plan question before adding another. | applyPlanMeaning: twenty plan questions are already pending. |
| `plans_I_m_keeping_your_confirmed_plan_for` | You’ve already got a plan for this week. I’ll keep tracking that one. | applyPlanMeaning: another proposal while a confirmed plan exists. |
| `plans_What_s_the_plan_you_want_me` | What existing plan or commitment do you want me to help you stay on top of, and how many times this week? | applyPlanMeaning: proposal lacks verifiable activity or target. |
| `plans_This_plan_is_closed_Send_Start_to` | This plan is closed. Send Start to begin a new seven-day period. | applyPlanMeaning: plan exists but is closed. |
| `plans_Does_this_update_refer_to_your_confirmed` | Is this about the plan we’re already tracking? I haven’t counted anything yet. | applyPlanMeaning: extracted activity differs from confirmed activity. |
| `plans_Which_day_did_this_happen_Nothing_was` | Which day was that? You can say today, yesterday or 2 days ago. I haven’t counted it yet. | applyPlanMeaning: extracted date/time phrase does not occur in the message. |
| `plans_Which_completed_session_should_I_correct_I` | Which completed session should I correct? I haven’t changed it yet. | applyPlanMeaning: correction has no uniquely identifiable completion. |
| `plans_What_should_I_change_about_that_session` | What should I change about that session? | applyPlanMeaning: correction specifies no date, time or status change. |
| `plans_Corrected` | Got it, corrected 👍 {activity} for {date}{skippedSuffix}. You’re at {progress} this week. (skippedSuffix: “ marked as skipped” or empty) | applyPlanMeaning: existing completion corrected; skipped suffix only if resulting status is skipped. |
| `plans_What_happened_with_your_plan_I_haven` | What happened with your plan? I haven’t counted anything yet. | applyPlanMeaning: completion meaning contains symptom/count/target fields or skipped status. |
| `plans_What_changed_about_your_plan_I_haven` | What changed with your plan? I haven’t updated anything yet. | applyPlanMeaning: extracted plan intent is not a completion after correction/proposal routes. |
| `plans_Is_that_the_same_session_you_told` | Was that the same session as earlier or a new one? I haven’t counted it again yet. | applyPlanMeaning: completion on an already-completed date without explicit another/new. |
| `plans_The_test_completion_record_limit_was_reached` | I can’t save another completed session right now. Nothing was counted. | applyPlanMeaning: maximum completion record limit reached. |
| `plans_Nice` | Nice 💪 I’ve got that for {date}. You’re at {progress} this week. | applyPlanMeaning: one completion successfully saved. |
| `plans_That_plan_question_is_not_available_to` | That plan question is not available to this user. | resolvePlan: pending ID missing or belongs to another user. |
| `plans_Okay_I_ve_discarded_that_draft_No` | Okay, I’ve discarded that draft. No plan was saved. | resolvePlan: pending question discarded. |
| `plans_This_plan_message_belongs_to_a_stopped` | This plan message belongs to a stopped seven-day period. Nothing was saved. | resolvePlan: user stopped/deleted or question belongs to an older job. |
| `plans_Your_record_changed_while_this_question_was` | Your record changed while this question was open. I haven’t saved the older update. Please send it again. | resolvePlan: memory changed since the question was saved. |
| `plans_Which_day_did_this_happen_I_haven` | Which day was that? You can say today, yesterday or 2 days ago. I haven’t counted it yet. | resolvePlan: interpreted date/time is absent from original text plus answer. |
| `plans_Please_confirm_or_discard_the_proposed_plan` | Please confirm or discard the proposed plan. | resolvePlan: confirmation question received a choice other than confirm/discard. |
| `plans_This_job_already_has_one_confirmed_plan` | You already have a confirmed plan for this seven-day period. | resolvePlan: confirmed plan already exists during confirmation. |
| `plans_Invalid_plan_proposal` | Invalid plan proposal. | resolvePlan: stored proposal has invalid intent, activity or target. |
| `plans_Got_it` | Got it 👍 Your plan is {activity}, {targetNumber} times this week. You’re starting at 0/{targetNumber2}. | resolvePlan: plan successfully confirmed. |
| `plans_Got_it_the_same_session` | Got it. Same session. {value} | resolvePlan: duplicate answered same, followed by current plan reply. |
| `plans_Please_give_the_day_this_happened_Nothing` | Which day was that? You can say today, yesterday or 2 days ago. I haven’t updated anything yet. | resolvePlan: date question answered without confirm and a date. |
| `plans_Please_choose_the_same_session_or_a` | Same session or a new one? I haven’t counted it again yet. | resolvePlan: duplicate question answered without same/new. |
| `rules_What_time_did_this_happen_Please_use` | What time was that? Something like 4pm is fine. | resolveWhen: supplied clock phrase cannot be parsed. |
| `rules_Which_day_did_this_happen_at` | That time hasn’t happened yet today. Which day was it? You can say yesterday or 2 days ago. I haven’t counted it yet. | resolveWhen: no explicit date and mentioned clock time is later than received local time. |
| `rules_Which_day_did_this_happen_I_haven` | Which day was that? You can say today, yesterday or 2 days ago. I haven’t counted it yet. | resolveWhen: date is missing or unresolvable. |
| `rules_Which_day_did_this_happen_at_2` | That time is still ahead today. Which day did you mean? You can say yesterday or 2 days ago. I haven’t counted it yet. | resolveWhen: explicit today and clock time is later than received local time. |
| `rules_Which_day_did_this_happen_The_date` | That date is still ahead. Which day did you mean? | resolveWhen: resolved date is in the future. |
| `tracking_This_test_session_is_not_authorised_Create` | This session isn’t available. Please start again. | userFor: no user matches the web access token. |
| `tracking_This_test_session_is_not_authorised` | This session isn’t available. | viewFor: supplied user no longer exists. |
| `tracking_Test_record_limit_reached` | I can’t load more saved records right now. | ownRecords: record read exceeds maximum limit. |
| `tracking_Invalid_message_ID` | Invalid message ID. | receive: message ID empty or longer than 100 characters. |
| `tracking_Invalid_message_ID_2` | Invalid message ID. | reserve: message ID empty or longer than 100 characters. |
| `tracking_AI_hourly_call_limit_reached_Please_try` | I can’t read another update right now. Nothing was saved. Please try again in about an hour. | reserve: per-user or app-wide hourly cap reached. |
| `tracking_That_occurrence_is_not_available_to_this` | That occurrence is not available to this user. | applyMeaning: supplied occurrence target is not owned or unavailable. |
| `tracking_Resolve_an_existing_clarification_before_adding_more` | Please answer the earlier question before adding another update. | applyMeaning: fifty symptom questions already pending. |
| `tracking_What_would_you_like_me_to_remember` | What would you like me to keep track of this week? | applyMeaning: AI intent asks for general recording clarification. |
| `tracking_Which_earlier_episode_do_you_mean_I` | Which earlier episode do you mean? I haven’t added another. | applyMeaning: reference has no uniquely identifiable episode. |
| `tracking_Test_record_limit_reached_2` | I can’t save another reference right now. | applyMeaning: reference-link limit reached. |
| `tracking_Got_it_the_same` | Got it, the same {value}. I haven’t counted it again. | applyMeaning: reference linked to an existing episode. |
| `tracking_Which_earlier_episode_should_I_correct` | Which earlier episode should I correct? | applyMeaning: correction has no uniquely identifiable episode. |
| `tracking_I_haven_t_added_any_episodes_from` | I haven’t added any episodes from that correction. What happened in the additional episode? | applyMeaning: count correction requests more episodes than the original group. |
| `tracking_Corrected` | Got it, corrected 👍 {trackedItem}: {count} time{plural} in that report. (plural: s or empty) | applyMeaning: count correction succeeds without a date/time change. |
| `tracking_Ah_yes` | Ah yes, {event}. Corrected 👍{outsideWindowSuffix} (suffix: “ It’s outside this seven-day period.” or empty) | applyMeaning: date/time correction succeeds; append outside-window note if appropriate. |
| `tracking_Which_of_your_chosen_changes_would_you` | Which one should I keep track of{choices}? (choices: “: {item} or {item}” or empty) | applyMeaning: tracked change is missing/not chosen or count is missing. |
| `tracking_Is_that_the_same_episode_you_already` | Was that the same episode as earlier or a new one? I haven’t counted it again yet. | applyMeaning: matching prior symptom occurrence needs duplicate confirmation. |
| `tracking_The_fictional_test_session_has_reached_its` | I can’t save another update right now. | applyMeaning: new occurrences would exceed the test limit. |
| `tracking_Message_is_not_reserved_for_processing` | Message is not reserved for processing. | apply: AI result has no processing reservation. |
| `tracking_Your_record_or_tracking_state_changed_while` | Your record or tracking state changed while I was reading this. I haven’t saved the older update. | apply: memory/state changed after incoming message snapshot; late result dropped. |
| `tracking_That_occurrence_is_not_available_to_this_2` | That occurrence is not available to this user. | forget: requested occurrence missing or belongs to another user. |
| `tracking_Forgotten_that_episode_and_its_linked_notes` | Done 👍 That episode is gone. I won’t count it or include it in your summary. | forget: occurrence and linked notes successfully removed. |
| `tracking_That_clarification_is_not_available_to_this` | That clarification is not available to this user. | resolveSymptom: pending question missing or belongs to another user. |
| `tracking_That_update_belongs_to_a_stopped_job` | That update belongs to a stopped seven-day period, so I haven’t counted it. Send Start before reporting a new episode. | resolveSymptom: non-discard answer targets stopped/deleted/older job. |
| `tracking_This_is_not_a_duplicate_clarification` | This is not a duplicate clarification. | resolveSymptom: new choice supplied for a non-duplicate question. |
| `tracking_That_change_is_not_tracked_by_this` | That change is not tracked by this user. | resolveSymptom: selected tracked change not in this user’s choices. |
| `tracking_This_is_not_a_duplicate_clarification_2` | This is not a duplicate clarification. | resolveSymptom: same choice supplied for a non-duplicate question. |
| `tracking_Got_it_the_same_episode_I_haven` | Got it, the same episode. I haven’t counted it again. | resolveSymptom: duplicate answered same. |
| `tracking_That_unresolved_message_is_removed_Nothing_was` | That unresolved message is removed. Nothing was counted. | resolveSymptom: pending symptom message discarded. |
| `tracking_Which_completed_session_do_you_mean_Please` | Which completed session do you mean? Tell me the date, or say latest. | resolveTypedDate: typed selection matches multiple completion targets. |
| `tracking_Which_earlier_episode_do_you_mean_Please` | Which earlier episode do you mean? Tell me the date or tracked change, or say latest. | resolveTypedDate: typed selection matches multiple symptom targets. |
| `tracking_Which_pending_question_are_you_answering_Please` | Which update do you mean? | resolveTypedDate: typed answer matches multiple pending questions. |
| `tracking_Which_update_is_this_date_for_I` | Which update is this date for? I haven’t counted it yet. | resolveTypedDate: date answer but more than one pending date question. |
| `whatsapp_WhatsApp_is_not_configured` | WhatsApp is not configured. | WhatsApp GET: verify token configuration absent. |
| `whatsapp_Verification_rejected` | Verification rejected. | WhatsApp GET: token or subscribe mode invalid. |
| `whatsapp_WhatsApp_is_not_configured_2` | WhatsApp is not configured. | WhatsApp POST: app secret configuration absent. |
| `whatsapp_Unauthorised_request` | Unauthorised request. | WhatsApp POST: signature header missing/malformed. |
| `whatsapp_Invalid_payload` | Invalid payload. | WhatsApp POST: request body is missing. |
| `whatsapp_Payload_too_large` | Payload too large. | WhatsApp POST: payload exceeds 262,144 bytes. |
| `whatsapp_Unauthorised_request_2` | Unauthorised request. | WhatsApp POST: signature mismatch. |
| `whatsapp_Invalid_payload_2` | Invalid payload. | WhatsApp POST: JSON parsing fails. |
| `whatsapp_Invalid_payload_3` | Invalid payload. | WhatsApp POST: wrong object type or entries not an array. |
| `whatsapp_Invalid_text_message` | Invalid text message. | WhatsApp POST: text message ID, sender or text validation fails. |
| `whatsapp_EVENT_RECEIVED` | EVENT_RECEIVED | WhatsApp POST: status/non-text events ignored, no text replies needed. |
| `whatsapp_WhatsApp_is_not_configured_3` | WhatsApp is not configured. | WhatsApp POST: send access token or phone-number ID configuration absent. |
| `whatsapp_Wrong_receiving_phone` | Wrong receiving phone. | WhatsApp POST: receiving phone ID does not match configuration. |
| `whatsapp_WhatsApp_reply_delivery_failed` | WhatsApp reply delivery failed. | WhatsApp POST: Cloud API returns non-success status. |
| `whatsapp_EVENT_RECEIVED_2` | EVENT_RECEIVED | WhatsApp POST: all text replies sent successfully. |
| `whatsapp_WhatsApp_message_processing_failed` | WhatsApp message processing failed. | WhatsApp POST: message processing or delivery throws. |
| `planConfirmation` **SUPERSEDED** | Clear plan: acknowledge successful save briefly. Ambiguous plan: ask one specific question about what is unclear. | CURRENT_RULES.md replaces blanket yes-to-save proposals. |
| `clarifiedSymptomCount` |  You’ve recorded {count} in this seven-day window. | resolveTypedDate: successful typed symptom-date clarification, appended to acknowledgement. |
| `webConnectionFailure` | I couldn’t reach InTune just now. Check your saved record before sending that update again. | Web perform: request throws, so show a visible connection error. |
| `fictionalSessionReady` | Ready — two separate fictional users. I’ll remember brain fog and poor sleep for this test. You can correct, forget, stop or delete your health records. | Web createPair: fictional user A/B session successfully created. |
| `noConfirmedPlan` | We haven’t saved a plan yet. | planReply: current job has no confirmed plan. |
| `summaryHeading` | Here’s what you told me over the last 7 days ({startDate} to {endDate}): | summaryText: start of every on-demand symptom summary, formatted from the existing job window. |
| `summaryEmpty` | No body changes recorded in this window. | summaryText: no in-window symptom records. |
| `summaryItem` | {item}: {count} time{plural}: {dates}. | summaryText: one line per tracked change with in-window records; plural is empty for one, s otherwise. |
| `closedPlanSuffix` |  This plan is closed; your completed sessions are still saved. | planReply: suffix when retrieved plan is closed. |
| `webPlanClosed` | This plan is closed. Your completed sessions are still saved. | Web plan panel: closed confirmed plan. |
| `webPlanCounting` | One completed session counts as one. | Web plan panel: active confirmed plan. |
| `webPlanNotConfirmed` | There’s no confirmed plan yet. Type your existing plan and weekly target, then check my repeat-back. | Web plan panel: no confirmed plan. |

| `helpReply` **DRAFT** | I can keep track of what’s changing in your body and keep count for one plan you already follow. Tell me what you’d like a hand with this week. | Standalone help or capabilities question; creates no record or pending question. |
| `planNeedsTarget` **DRAFT** | Yep, I can keep track of that. How many times this week are you aiming for? | Existing activity or plan request has no weekly target; waits for an explicit number before the existing plan confirmation. |
| `clarifyWithExample` **DRAFT** | Tell me what you’d like me to keep track of. ‘Brain fog today’ or ‘strength training 3 times this week’ is enough. | Generic clarification would repeat the immediately preceding generic reply; replaces the earlier generic pending question. |
| `farewellReply` **DRAFT** | Okay, bye for now 👋 | Entire message is Okay bye, with optional final full stop or exclamation mark, ignoring case and surrounding spaces; no AI processing, follow-up question or change to health records, pending questions, plan confirmation, controls or permissions. |

| `uncertaintyReply` **DRAFT** | Sure. We can start with what’s changing in your body, or one plan you want help staying on top of this week. Which feels more useful right now? | Standalone I don’t know, you tell me, you tell me, or what do you suggest; guides within existing jobs without AI or changing pending records. |
| `doingWellReply` **DRAFT** | Good to hear 🙂 What would you like me to keep track of this week? | Standalone Going good, acknowledging before asking; no AI or new pending record. |

## Final implementation notes

- The greeting route is limited to whole-message hi, hello or hey. It does not change health records, pending questions, plans or tracking state.
- Standalone help questions accept ordinary lead-ins, spacing, punctuation, common spelling mistakes and u/ur abbreviations. They return the catalogued `helpReply`, without AI processing or health-state changes. Extra report content and control commands keep their existing routes.
- Ambiguous pending answers use numbered choices and accept the number followed by an answer. Never ask the user for an internal question ID. Legacy ID input remains accepted for compatibility.
- Never render square-bracket notes. In `acknowledgement`, `[Ugh, that’s rough 😕 ]` is an optional contextual prefix, not literal user-visible brackets.
- Keep `planReply` unchanged for now. The repeated-date output such as `today, today` is a formatter issue and should be handled separately.
- Preserve every existing placeholder name exactly, including `{targetNumber2}`, `{value}`, `{choices}`, `{skippedSuffix}`, `{outsideWindowSuffix}` and `{closedPlanSuffix}`.
- Before applying the copy, verify that the current resolvers accept `2 days ago` and `latest`.
- If `2 days ago` is not accepted, leave the affected date-question entries unchanged in `convex/copy.ts`.
- If `latest` is not accepted, leave the affected record-selection entries unchanged in `convex/copy.ts`.
- Do not change routing, resolvers, tracking or commands in order to support wording in this task.
- Update only wording-based test assertions.
- Proposed DESIGN.md principle for the separate design update: “Write like she already understands the conversation. Keep enough context to identify what you mean, and explain what changed or remains unresolved when it affects her record, consent or next action.”

| `clarificationChoiceReply` **DRAFT** | Which update do you mean?\n{numbered user update excerpts}\nReply with the number and your answer, like “1 same” or “2 today”. | More than one open question could match the answer; numbering uses only this user’s current pending questions, and no answer is applied until selection is unambiguous. |

## Clinician-approved pilot safety copy

Source: CLINICIAN_SAFETY.md, review supplied by the operator. Wording preserved exactly, with line breaks represented by \n.

| Entry | Approved wording | Exact situation |
| --- | --- | --- |
| `medicalSafetyReply` | I want to pause the usual tracking here because what you’ve described may need medical attention.\nPlease seek urgent medical care now or contact your local emergency service. | An approved physical category interrupts tracking; no ordinary occurrence/completion is saved. |
| `mentalSafetyReply` | I’m concerned about what you’ve just told me. Please contact emergency services or a local crisis service\nI’m not able to provide emergency or crisis care. | Approved suicidal thoughts, self-harm intent or immediate danger to self; priority when both kinds occur. |
| `safetyReturnQuestion` | Are you okay to continue with normal tracking now? | Option B: ask before resuming; only an explicit affirmative reply to this question clears safety pause. Greeting/help/normal updates do not clear it. |
| `chooseTrackedItemsReply` **DRAFT** | Which 1–2 body changes would you like me to keep track of this week? | Real user has not chosen body changes, or proposes more than two; do not assume any. |
| `trackedItemsSavedReply` **DRAFT** | Got it. I’ll keep track of {items joined with and} this week. | Explicit one/two supported changes selected; no occurrence or plan created. |

## Natural tracking recovery — DRAFT

| Entry | Exact wording | Situation |
| --- | --- | --- |
| `trackerLimitReply` — DRAFT | I can keep track of two body changes this week. I’m already tracking {items joined with and}. | A new body change exceeds the existing two-change limit; no silent addition. |
| `setupUpdatesConfirmation` — APPROVED | I’ll keep track of {items joined with and}. You said {reported details joined with and}. Should I count those too? | Preserve reported episodes when choosing new trackers; count only after yes. |
| `symptomDateQuestion` — DRAFT | Which day did {item} happen? You can say today, yesterday or 2 days ago. I haven’t counted that yet. | Known symptom, missing occurrence date; retain the known details. |
| `symptomCountQuestion` — DRAFT | How many times did {item} happen? I haven’t counted that yet. | Known symptom, unclear count; retain the known details. |
| `naturalTrackingReplies` — DRAFT | {existing reply lines, separated by a blank line} | Compose independent known reports and any specific remaining question; no new counting or clinical rule. |
| `symptomDetailsQuestion` — DRAFT | What would you like me to note about {item}? I haven’t counted anything from that message yet. | The symptom is understood but what to remember is unclear; preserve that context. |

Setup repeat-back wording approved by the operator on 7 October 2026. Repeat only the parsed symptom, known count and quoted date/time phrases; omit unresolved details instead of inventing them. Example: “I’ll keep track of hot flashes and night sweats. You said 3 hot flashes yesterday and one night sweat last night. Should I count those too?” Confirmation and tracking rules are unchanged.

## Bounded medical-question reply — approved

| Entry | Exact wording | Situation |
| --- | --- | --- |
| `medicalQuestionReply` — APPROVED | That’s something to discuss with your doctor. I can’t tell you what’s causing these changes or whether HRT is right for you. I can keep tracking what you’ve noticed, so you have a clearer picture for that conversation. | User asks for medical interpretation or treatment suitability. Safety takes priority when approved criteria apply. This reply creates no occurrence, plan, tracker or pending question, and preserves existing pending state. The tracking offer remains subject to existing choices and limits. |

## V3 candidate implementation copy, 9 October 2026

Review before production: first paid welcome in convex/pilotWelcome.ts; unpaid/checkout messages in convex/pilotGateway.ts; expanded storage/capabilities wording in convex/conversationCopy.ts; per-category acknowledgements in convex/pilotMemory.ts; exact-time permission/configuration/suppression wording in convex/pilotReminders.ts; Test Mode checkout at public/pilot/checkout.html. Existing exact clinician/control/medical responses remain authoritative. No renewal-nudge campaign, pricing or support promise is invented.

## Previous V3 first welcome, superseded by the shorter review below

This replaces the generic V3 first-welcome introduction in the isolated candidate. Its promise is shown before the single preferred-name question; storage permission is implied and reminder permission remains separate.

> Hi, I'm InTune, your personal AI and extra pair of hands on WhatsApp for perimenopause.
>
> You can hand me something that's taking up space in your head, and come back to it without working it all out again.
>
> For example, share your existing food plan as text. I'll help make your grocery list, check what you already have, and send one ordering nudge if you want it. One less list to make. One less thing to keep remembering.
>
> Your seven-day pilot begins when this welcome reaches you.
>
> What name would you like me to use?

## Current V3 short welcome and review wording, 9 October 2026

> Hi, I'm InTune 👋 Your personal AI on WhatsApp. I help you keep track of plans and little details during perimenopause.
>
> Text me naturally, then ask for things back when you need them.
>
> What would you like me to call you?

After delivery, separately: “Your seven days have started. Your pilot ends on [exact end date and time] ([confirmed timezone]).” Explain old-record retrieval/correction/deletion and retention after that. After an optional name: “Nice to meet you, [name]. I keep what you share so you can come back to it, and we can review issues with InTune. You can ask me to forget or delete it.” If she has not already provided something useful to handle: “What would you like a hand remembering first: your food plan, workouts, or health changes you’ve noticed?”

A complete explicit reminder request is confirmed with its real date/time/timezone/recurrence, without a second permission question. Meal reminder: “Your reminder: [user-supplied target]. As you asked.” This does not promise an after-meal check-in. Pause: “Reminders paused. Your saved plans and updates are still here.” Summary approval: “Marked your weekly summary as accurate. This does not renew your pilot or charge you.” These examples must follow CURRENT_RULES.md; real-phone acceptance remains separate from routine test-stage release authority.

## Current copy rules — 10 October 2026

Use implies saving. Do not ask May I save or Shall I add for clear statements. Distinguish a factual save acknowledgement from an ambiguity question. Use the truthful upload-retention wording in CURRENT_RULES.md only after successful retention. Known limit blocks identify personal/burst/shared capacity and actual wait, rather than the historical one-hour/generic replies. Catalogue rows above describe prior implementation unless verified against current policy. Ordinary conversation must not be classified as a name or health event.
