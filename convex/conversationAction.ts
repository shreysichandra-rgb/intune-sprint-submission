'use node';
import {instrumentLabAgent} from './labTrace';
import {normalizationProfileContext} from './conversationPerformance';
import {stageTimer,measuredContext,recordTiming} from './conversationTiming';
import {usageLimitFailure,usageLimitReply} from './usageLimits';
import {ordinalSelection,completionShorthand} from './conversationFocus';
import {GROCERY_MEANING_INSTRUCTIONS} from './groceryMeaning';
import {cycleSetupAnswer} from './cycleReminderSetup';
import {makeFunctionReference} from 'convex/server';
import {NORMALIZATION_INSTRUCTIONS,VERIFICATION_INSTRUCTIONS,normalizationInput,normalizedSources,normalizationGroups} from './semanticBridge';
import {v} from 'convex/values';
import {verificationFailureKind,verificationFailureMetadata} from './verificationDiagnostics';
import {internalAction} from './_generated/server';
import {internal,components} from './_generated/api';
import {Agent} from '@convex-dev/agent';
import {createOpenAI} from '@ai-sdk/openai';
import {conversationRefs} from './conversationStore';
import {PILOT_NORMALIZATION_INSTRUCTIONS} from './semanticBridge';
import {PILOT_INSTRUCTIONS,REMINDER_INSTRUCTIONS,FEEDBACK_INSTRUCTIONS,GROCERY_REQUEST_CLARIFICATION,GROCERY_FOLLOW_THROUGH} from './conversationProtocol';
import {pilotEnabled} from './pilotAccess';
import {setupAnswer,setupRequest} from './scheduleReminderSetup';
import {preferredNameAnswer,explicitPreferredNameRequest} from './pilotName';
import {CONVERSATION_INSTRUCTIONS} from './conversationProtocol';
import {extractionInput,decodeSources} from './conversationInput';
import {SAFETY_INSTRUCTIONS} from './interpretation';
import {matchSafetyCategory,safetyReturnAffirmative} from './safety';
import {matchCommand,matchGreeting,matchRetrieval} from './commandRoute';
import * as copy from './copy';

// Internal extractor; the public route uses a server-owned allowlist and kill switch.
export const send=internalAction({args:{token:v.string(),messageId:v.string(),text:v.string()},returns:v.any(),handler:async(rawCtx,args):Promise<any>=>{
 const timer=stageTimer(),ctx=measuredContext(rawCtx,timer);
 const route=await ctx.runQuery(conversationRefs.route,{token:args.token});
 if(process.env.INTUNE_CONVERSATION_PROTOTYPE!=='local'&&route==='v1')return {outcome:'disabled',message:'The conversational prototype is disabled.'};
 let reserved=false,committed=false,phase='receive';
 try{
  if(!args.text.trim()||args.text.length>2000)return {outcome:'error',message:copy.messages_Please_send_a_text_message_of_1};
  const command=matchCommand(args.text);
  await ctx.runMutation(internal.tracking.receive,{token:args.token,messageId:args.messageId,...(command==='stop'||command==='delete'?{cancelPending:true}:{})});
  const retrieve=async(scope:'week'|'plan')=>{
   const result=await ctx.runQuery(conversationRefs.recordReply,{token:args.token,scope});
   await ctx.runMutation(internal.tracking.completeCommand,{token:args.token,messageId:args.messageId});
   const permitted=await ctx.runQuery(conversationRefs.delivery,{token:args.token,version:result.version,readOnly:true});
   return permitted?{outcome:'summary',message:result.message,version:result.version}:{outcome:'dropped',message:'Your record changed before I could reply. Ask me for your current record.'};
  };
  if(command==='summary')return await retrieve('week');
  if(command){
   const result=await ctx.runMutation(internal.commands.execute,{token:args.token,command,messageId:args.messageId});
   await ctx.runMutation(internal.tracking.completeCommand,{token:args.token,messageId:args.messageId});return result;
  }
  const safety=process.env.INTUNE_SEMANTIC_BRIDGE==='legacy'||matchSafetyCategory(args.text)?await ctx.runMutation(internal.tracking.safetyGuard,{token:args.token,messageId:args.messageId,text:args.text}):null;
  if(safety)return safety;
  const retrieval=matchRetrieval(args.text);if(retrieval)return await retrieve(retrieval);
  if(matchGreeting(args.text)){
   const greeting=await ctx.runMutation(internal.tracking.greet,{token:args.token,messageId:args.messageId});
   if(greeting.outcome==='provider_duplicate'||route==='hold')return greeting;
   const consent=await ctx.runMutation(conversationRefs.consentGate,{...args,askOnly:true});
   return consent?{outcome:'greeting',message:'Hi 👋 I’m InTune.\n\n'+consent.message}:greeting;
  }
  if(route==='hold'&&process.env.INTUNE_CONVERSATION_PROTOTYPE!=='local'){await ctx.runMutation(internal.tracking.completeCommand,{token:args.token,messageId:args.messageId});return {outcome:'disabled',message:copy.messages_I_couldn_t_safely_process_that_right};}
  const consent=await ctx.runMutation(conversationRefs.consentGate,args);
  if(consent&&consent.outcome!=='consent_pending')return consent;
  const context=await ctx.runQuery(conversationRefs.context,{token:args.token,messageId:args.messageId});
  // Reuse the existing server-owned safety-return question and approved answers.
  // Mixed messages still undergo semantic safety verification before any resumption.
  if(context.safetyPaused&&safetyReturnAffirmative(args.text)){
   const result=await ctx.runMutation(internal.tracking.safetyGuard,{token:args.token,messageId:args.messageId,text:args.text});
   if(result)return result;
  }
  if(context.state==='stopped')return {outcome:'stopped',message:copy.stoppedReply};
  // A short answer to the pending name question is not a health occurrence.
  // Reuse validated profile writes, duplicate checks and separate storage consent.
  const name=pilotEnabled()&&process.env.INTUNE_SEMANTIC_BRIDGE!=='legacy'&&(context.nameAsked||explicitPreferredNameRequest(args.text))&&!context.safetyPaused?preferredNameAnswer(args.text):null;
  if(name){
   if(!await ctx.runMutation(makeFunctionReference<'mutation'>('tracking:reserveDeterministic'),{token:args.token,messageId:args.messageId}))return {outcome:'provider_duplicate',message:copy.messages_I_already_received_this_message_I_haven};
   const applied=await ctx.runMutation(conversationRefs.apply,{...args,version:context.version,envelope:{v:2,ops:[{k:'profile',q:args.text,name}]}});
   if(applied.outcome==='conversation'&&!applied.controlOnly&&!await ctx.runQuery(conversationRefs.delivery,{token:args.token,version:applied.version}))return {outcome:'dropped',message:copy.tracking_Your_record_or_tracking_state_changed_while};
   return applied;
  }
  if(pilotEnabled()&&setupRequest(args.text)){
   if(!await ctx.runMutation(makeFunctionReference<'mutation'>('tracking:reserveDeterministic'),{token:args.token,messageId:args.messageId}))return {outcome:'provider_duplicate',message:copy.messages_I_already_received_this_message_I_haven};
   return await ctx.runMutation(makeFunctionReference<'mutation'>('scheduleReminderSetup:begin'),{...args,version:context.version});
  }
  if(context.cycleReminderSetup&&cycleSetupAnswer(args.text)){
   if(!await ctx.runMutation(makeFunctionReference<'mutation'>('tracking:reserveDeterministic'),{token:args.token,messageId:args.messageId}))return {outcome:'provider_duplicate',message:copy.messages_I_already_received_this_message_I_haven};
   const result=await ctx.runMutation(makeFunctionReference<'mutation'>('cycleReminderSetup:answer'),{...args,version:context.version});
   if(result.outcome==='conversation'&&!await ctx.runQuery(conversationRefs.delivery,{token:args.token,version:result.version}))return {outcome:'dropped',message:copy.tracking_Your_record_or_tracking_state_changed_while};
   return result;
  }
  if(context.reminderSetup&&setupAnswer(args.text)){
   if(!await ctx.runMutation(makeFunctionReference<'mutation'>('tracking:reserveDeterministic'),{token:args.token,messageId:args.messageId}))return {outcome:'provider_duplicate',message:copy.messages_I_already_received_this_message_I_haven};
   const result=await ctx.runMutation(makeFunctionReference<'mutation'>('scheduleReminderSetup:answer'),{...args,version:context.version});
   if(result.outcome==='conversation'&&!await ctx.runQuery(conversationRefs.delivery,{token:args.token,version:result.version}))return {outcome:'dropped',message:copy.tracking_Your_record_or_tracking_state_changed_while};
   return result;
  }
  const shortCompletion=pilotEnabled()&&process.env.INTUNE_SEMANTIC_BRIDGE!=='legacy'&&!context.askedPendingId&&context.consent&&!context.safetyPaused&&(context.responsibilities??[]).some((i:any)=>i.kind==='plan'&&!['stopped','paused'].includes(i.state))?completionShorthand(args.text):null;
  if(shortCompletion){
   if(!await ctx.runMutation(makeFunctionReference<'mutation'>('tracking:reserveDeterministic'),{token:args.token,messageId:args.messageId}))return {outcome:'provider_duplicate',message:copy.messages_I_already_received_this_message_I_haven};
   const applied=await ctx.runMutation(conversationRefs.apply,{...args,version:context.version,envelope:{v:2,ops:[{k:'item_complete',q:args.text,target:null,d:shortCompletion.day,status:'completed',x:false}]}});
   if(applied.outcome==='conversation'&&!await ctx.runQuery(conversationRefs.delivery,{token:args.token,version:applied.version,readOnly:applied.readOnly===true||applied.correctionOnly===true}))return {outcome:'dropped',message:copy.tracking_Your_record_or_tracking_state_changed_while};return applied;
  }
  const selection=pilotEnabled()?ordinalSelection(args.text):null;
  const selectionQuestion=context.pending?.find((p:any)=>p.id===context.askedPendingId&&p.proposal?.mode==='target'&&p.proposal?.choices?.length);
  if(selection&&selectionQuestion&&!context.safetyPaused&&context.consent){
   if(!await ctx.runMutation(makeFunctionReference<'mutation'>('tracking:reserveDeterministic'),{token:args.token,messageId:args.messageId}))return {outcome:'provider_duplicate',message:copy.messages_I_already_received_this_message_I_haven};
   const applied=await ctx.runMutation(conversationRefs.apply,{...args,version:context.version,envelope:{v:2,ops:[{k:'answer',q:args.text,target:selectionQuestion.id,choice:'detail',d:null,t:null,n:null}]}});
   if(applied.outcome==='conversation'&&!await ctx.runQuery(conversationRefs.delivery,{token:args.token,version:applied.version,readOnly:applied.readOnly===true||applied.correctionOnly===true}))return {outcome:'dropped',message:copy.tracking_Your_record_or_tracking_state_changed_while};return applied;
  }
  // Exact confirmation vocabulary is already defined by the approved deterministic flow.
  // No model call is needed for yes/no to the server-owned question just asked.
  if(process.env.INTUNE_SEMANTIC_BRIDGE!=='legacy'&&context.consent&&!context.safetyPaused&&context.askedPendingId&&/^(yes|yes please|no)[.!]?$/i.test(args.text.trim())){
   if(!await ctx.runMutation(makeFunctionReference<'mutation'>('tracking:reserveDeterministic'),{token:args.token,messageId:args.messageId}))return {outcome:'provider_duplicate',message:copy.messages_I_already_received_this_message_I_haven};
   const applied=await ctx.runMutation(conversationRefs.apply,{...args,version:context.version,envelope:{v:2,ops:[{k:'answer',q:args.text,target:context.askedPendingId,choice:args.text.trim().toLowerCase().startsWith('no')?'discard':'confirm',d:null,t:null,n:null}]}});
   if(applied.outcome==='conversation'&&!applied.controlOnly&&!await ctx.runQuery(conversationRefs.delivery,{token:args.token,version:applied.version,readOnly:applied.readOnly===true||applied.correctionOnly===true}))return {outcome:'dropped',message:copy.tracking_Your_record_or_tracking_state_changed_while};return applied;
  }
  const reservation=await ctx.runMutation(internal.tracking.reserve,{token:args.token,messageId:args.messageId});
  if(!reservation.proceed)return {outcome:'provider_duplicate',message:copy.messages_I_already_received_this_message_I_haven};
  reserved=true;
  const key=process.env.OPENAI_API_KEY;
  if(!key)throw new Error('Provider unavailable');
  // Match the governing model declaration. Reasoning is disabled to keep structured output inside the unchanged 350-token cap.
  const extractor=instrumentLabAgent(new Agent(components.agent,{name:'conversation-meaning-only',languageModel:createOpenAI({apiKey:key}).chat(process.env.INTUNE_CONVERSATION_MODEL??'gpt-6-luna'),instructions:CONVERSATION_INSTRUCTIONS+(pilotEnabled()?'\n'+PILOT_INSTRUCTIONS+'\n'+REMINDER_INSTRUCTIONS+'\n'+FEEDBACK_INSTRUCTIONS+'\n'+GROCERY_REQUEST_CLARIFICATION+'\n'+GROCERY_FOLLOW_THROUGH:'')+'\n'+SAFETY_INSTRUCTIONS.replace('Return intent clarify for a safety candidate and no symptom/plan fields.', 'Use a safety operation with q copied from the CURRENT message and the matching category. Do not use V1 intent/safetyEvidence fields.'),storageOptions:{saveMessages:'none'}}),ctx,args,'verify',CONVERSATION_INSTRUCTIONS+(pilotEnabled()?'\n'+PILOT_INSTRUCTIONS+'\n'+REMINDER_INSTRUCTIONS+'\n'+FEEDBACK_INSTRUCTIONS+'\n'+GROCERY_REQUEST_CLARIFICATION+'\n'+GROCERY_FOLLOW_THROUGH:'')+'\n'+SAFETY_INSTRUCTIONS.replace('Return intent clarify for a safety candidate and no symptom/plan fields.', 'Use a safety operation with q copied from the CURRENT message and the matching category. Do not use V1 intent/safetyEvidence fields.'));
  let semantic:ReturnType<typeof normalizedSources>|undefined;
  if(process.env.INTUNE_SEMANTIC_BRIDGE!=='legacy'){
   const normalizer=instrumentLabAgent(new Agent(components.agent,{name:'source-language-normalizer',languageModel:createOpenAI({apiKey:key}).chat(process.env.INTUNE_CONVERSATION_MODEL??'gpt-6-luna'),instructions:NORMALIZATION_INSTRUCTIONS+(pilotEnabled()?"\n"+PILOT_NORMALIZATION_INSTRUCTIONS+"\n"+GROCERY_MEANING_INSTRUCTIONS:""),storageOptions:{saveMessages:'none'}}),ctx,args,'normalize',NORMALIZATION_INSTRUCTIONS+(pilotEnabled()?"\n"+PILOT_NORMALIZATION_INSTRUCTIONS+"\n"+GROCERY_MEANING_INSTRUCTIONS:""));
   const groceryQuestion=context.pending?.find((p:any)=>p.id===context.askedPendingId&&p.proposal?.mode==='grocery_state');
   const askedGrocery=(context.responsibilities??[]).find((i:any)=>i.id===groceryQuestion?.proposal?.target&&i.kind==='grocery');
   const source=normalizationInput(args.text,pilotEnabled(),(context.responsibilities??[]).filter((i:any)=>i.kind==='grocery'),askedGrocery?{item:askedGrocery.title,question:groceryQuestion.question}:undefined,undefined,context.conversation,normalizationProfileContext(context));
   phase='normalize';
   const groups=normalizationGroups(source.sources),normalized:Record<string,unknown>={};
   for(let i=0;i<groups.length;i++){
    if(i>0&&!await ctx.runMutation(makeFunctionReference<'mutation'>('tracking:reserveFollowup'),{token:args.token,messageId:args.messageId,allowSafety:context.safetyPaused===true}))return {outcome:'dropped',message:copy.tracking_Your_record_or_tracking_state_changed_while};
    const part=groups.length===1?source:normalizationInput(args.text,pilotEnabled(),(context.responsibilities??[]).filter((item:any)=>item.kind==='grocery'),askedGrocery?{item:askedGrocery.title,question:groceryQuestion.question}:undefined,groups[i],context.conversation,normalizationProfileContext(context));
    const result=await timer.run('ai:normalize',()=>normalizer.generateObject(ctx,{userId:context.userId},{prompt:part.prompt,schema:part.schema,providerOptions:{openai:{reasoningEffort:'none'}},maxOutputTokens:350,maxRetries:0,abortSignal:AbortSignal.timeout(20000)},{storageOptions:{saveMessages:'none'}}),{aiCalls:1,inputChars:part.prompt.length,contextChars:JSON.stringify(JSON.parse(part.prompt).conversationContext??null).length});
    Object.assign(normalized,result.object);
   }
   if(!await ctx.runMutation(makeFunctionReference<'mutation'>('tracking:reserveFollowup'),{token:args.token,messageId:args.messageId,allowSafety:context.safetyPaused===true}))return {outcome:'dropped',message:copy.tracking_Your_record_or_tracking_state_changed_while};
   semantic=normalizedSources(normalized,source.sources);
  }
  const input=await timer.run('prompt:verification',async()=>extractionInput(args.text,context,semantic));
  phase='verify';
  const groups=semantic&&semantic.length>3?Array.from({length:Math.ceil(semantic.length/2)},(_,i)=>semantic.slice(i*2,i*2+2)):[semantic];
  let result:any={object:{v:2,meanings:{},verified:{}}};
  for(let i=0;i<groups.length;i++){
   // Each additional call consumes the existing hourly budget. Nothing is
   // applied until every source passes verification and whole-message validation.
   if(i>0&&!await ctx.runMutation(makeFunctionReference<'mutation'>('tracking:reserveFollowup'),{token:args.token,messageId:args.messageId,allowSafety:context.safetyPaused===true}))return {outcome:'dropped',message:copy.tracking_Your_record_or_tracking_state_changed_while};
   const part=groups.length===1?input:extractionInput(args.text,context,groups[i]);
   const prior=groups.length>1?'\n'+JSON.stringify({earlierMeaningsPendingValidation:result.object.meanings,allSourceUnits:semantic})+'\nReturn only the required source keys in this schema. Any report r is the GLOBAL zero-based operation index across earlier meanings followed by this group, not a local index. Do not borrow dates from unrelated clauses.':'';
   const generated=await timer.run('ai:verify',()=>extractor.generateObject(ctx,{userId:context.userId},{prompt:part.prompt+prior+(semantic?'\n'+VERIFICATION_INSTRUCTIONS+(pilotEnabled()?'\n'+PILOT_NORMALIZATION_INSTRUCTIONS+'\n'+GROCERY_MEANING_INSTRUCTIONS:'' ):''),schema:part.providerSchema,providerOptions:{openai:{reasoningEffort:'none'}},maxOutputTokens:350,maxRetries:0,abortSignal:AbortSignal.timeout(20000)},{storageOptions:{saveMessages:'none'}}),{aiCalls:1,inputChars:(part.prompt+prior).length,contextChars:JSON.stringify(JSON.parse(part.prompt).context).length});
   if(groups.length===1)result=generated;
   else{Object.assign(result.object.meanings,(generated.object as any).meanings);Object.assign(result.object.verified,(generated.object as any).verified);}
  }
  if(process.env.INTUNE_SYNTHETIC_TRANSPORT==='1')await ctx.runAction(makeFunctionReference<'action'>('verificationBarrier:wait'),{token:args.token,messageId:args.messageId});
  phase='decode';
  const envelope=await timer.run('decode:validation',async()=>decodeSources(result.object,input.sources,context.receivedAt,context.timezone,args.text,semantic,context));
  if(!context.consent&&semantic&&semantic.every(s=>(result.object as any).verified?.[s.id]===true)&&semantic.length===1&&/^(yes|yes please|confirm|haan)[.!]?$/i.test(semantic[0].english.trim())){
   const consentAnswer=await ctx.runMutation(conversationRefs.consentGate,{...args,text:semantic[0].english.trim()});if(consentAnswer&&consentAnswer.outcome!=='consent_pending')return consentAnswer;
  }
  phase='apply';
  const applied=await ctx.runMutation(conversationRefs.apply,{...args,version:context.version,envelope});
  committed=applied.outcome==='conversation';
  if(committed){
   const permitted=await ctx.runQuery(conversationRefs.delivery,{token:args.token,version:applied.version,readOnly:applied.readOnly===true||applied.correctionOnly===true});
   // A control reply contains no health record content and must still confirm Stop/Delete.
   if(!permitted&&!applied.controlOnly)return {outcome:'dropped',message:'Your record changed before I could reply. Ask me for your current record.'};
  }
  return applied;
 }catch(error){
  const limit=usageLimitFailure(error);
  if(limit&&!committed){if(reserved)await ctx.runMutation(internal.tracking.fail,{token:args.token,messageId:args.messageId});return {outcome:'error',message:usageLimitReply(limit),failure:limit};}
  const known=['Incomplete commitment meanings','Conflicting stock-only purpose','Unexpected stock-only meaning','Conflicting grocery meaning','Incomplete grocery meanings','Unattested grocery meaning','Unavailable grocery meaning','Ungrounded plan','Ungrounded existing plan/item','Unavailable private reference','Reminder permission not grounded','Ungrounded item state','Negated or uncertain completion','Conflicting source purpose','Ungrounded English span','Unverified translation','Ungrounded date','Ungrounded time','Ungrounded body label','Ungrounded count','Ungrounded inherited count','Conflicting explicit count','Invalid inherited label','Ungrounded new event','Incomplete message coverage','AI hourly call limit reached. Please try again later.'];const reason=error instanceof Error&&error.message.includes(copy.tracking_AI_hourly_call_limit_reached_Please_try)?'AI hourly call limit reached. Please try again later.':error instanceof Error&&known.some(tag=>error.message.includes(tag))?(known.find(tag=>error.message.includes(tag))??'rejected'):'rejected';
  const metadata=verificationFailureMetadata(error,phase,reason);
  console.info('InTune interpretation failure',JSON.stringify(metadata));
  await ctx.runMutation(makeFunctionReference<'mutation'>('conversationLog:failure'),{token:args.token,messageId:args.messageId,kind:metadata.kind,phase:metadata.phase,...(metadata.validationRule?{rule:metadata.validationRule}:{})});
  if(process.env.INTUNE_SYNTHETIC_TRANSPORT==='1'){
   const diagnostic=verificationFailureKind(error,reason);
   await ctx.runMutation(makeFunctionReference<'mutation'>('verificationFixtures:failure'),{token:args.token,messageId:args.messageId,phase,reason:diagnostic});
  }
  if(reserved&&!committed)await ctx.runMutation(internal.tracking.fail,{token:args.token,messageId:args.messageId});
  return {outcome:'error',message:committed?copy.webConnectionFailure:copy.messages_I_couldn_t_safely_process_that_right,...(process.env.INTUNE_SYNTHETIC_TRANSPORT==='1'?{failure:{phase,reason}}:{})};
 }finally{await recordTiming(rawCtx,args.token,args.messageId,timer.snapshot("interpretation"),timer.isDuplicate());}
}});
