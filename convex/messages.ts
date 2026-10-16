'use node';
import {stageTimer,measuredContext,recordTiming} from './conversationTiming';
import {usageLimitFailure,usageLimitReply} from './usageLimits';
import {makeFunctionReference} from 'convex/server';
import {pilotEnabled} from './pilotAccess';
import {conversationRefs} from './conversationStore';
import {supportedSafetyEvidence} from './safety';
import * as copy from './copy';
import { v } from 'convex/values';
import { action } from './_generated/server';
import { api, internal, components } from './_generated/api';
import { Agent } from '@convex-dev/agent';
import { APICallError } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { INSTRUCTIONS, SAFETY_INSTRUCTIONS, extractionSchema } from './interpretation';
import { matchCommand,matchRetrieval,matchGreeting,matchHelp,matchFarewell,matchPlanWithoutTarget,matchConversationReply } from './commandRoute';
import {planReply} from './plans';
import {STOPPED_REPLY} from './replyCopy';
import { summaryText } from './rules';
import {replyEntryName} from './diagnostics';
export const send = action({ args: { token: v.string(), messageId: v.string(), text: v.string(), quotedMessageId:v.optional(v.string()),completionTargetId:v.optional(v.id('planCompletions')), targetId: v.optional(v.id('occurrences')) }, returns: v.any(), handler: async (rawCtx, args): Promise<any> => {
  const timer=stageTimer(),ctx=measuredContext(rawCtx,timer);
  if(pilotEnabled()){
    const logId=await ctx.runMutation(makeFunctionReference<'mutation'>('conversationLog:begin'),{token:args.token,messageId:args.messageId,type:'text',text:args.text,...(args.quotedMessageId?{quotedMessageId:args.quotedMessageId}:{})});
    try{
    const privacy=await ctx.runMutation(makeFunctionReference<'mutation'>('conversationLog:privacy'),{token:args.token,text:args.text,messageId:args.messageId});
    if(privacy)return privacy;
    await ctx.runMutation(makeFunctionReference<'mutation'>('conversationPolicy:prepare'),{token:args.token,text:args.text});
    const {quotedMessageId}=args; const messageArgs=args;
    await ctx.runMutation(makeFunctionReference<'mutation'>('conversationContext:begin'),{token:args.token,messageId:args.messageId,text:args.text,...(quotedMessageId?{quotedMessageId}:{})});
    const result=await ctx.runAction(makeFunctionReference<'action'>('pilotGateway:send'),messageArgs);
    if(process.env.INTUNE_DEBUG_LOGGING==='1'&&typeof result.message==='string')result.message=result.message.replace('Nothing new from this message was saved.','No new health information from this message was saved.');
    await ctx.runMutation(makeFunctionReference<'mutation'>('conversationContext:finish'),{token:args.token,messageId:args.messageId,text:args.text,...(quotedMessageId?{quotedMessageId}:{}),result});
    if(logId)await ctx.runMutation(makeFunctionReference<'mutation'>('conversationLog:finish'),{id:logId,result});
    await ctx.runMutation(makeFunctionReference<'mutation'>('conversationLog:outgoing'),{token:args.token,messageId:args.messageId,result});return result;
    }catch(error){if(logId)await ctx.runMutation(makeFunctionReference<'mutation'>('conversationLog:finish'),{id:logId,result:{outcome:'error'}});throw error;}finally{await recordTiming(rawCtx,args.token,args.messageId,timer.snapshot('message'),timer.isDuplicate());}
  }
  let reserved = false;
  let messageReceivedAt: number | null = null;
  let aiIntent:string|null=null,route='receive',replyEntry:string|null=null;
  const finish=async(result:any)=>{
    replyEntry=result.outcome==='safety_resumed'?'safety_resumed':replyEntryName(result);
    if(replyEntry){try{await ctx.runMutation(internal.tracking.noteReply,{token:args.token,messageId:args.messageId,replyEntry});}catch{/* Diagnostics must not replace the user's reply. */}}
    const version=result.version??result.view?.version??result.planView?.version;return {...result,...(typeof version==='number'?{version}:{})};
  };
  try {
  if(await ctx.runQuery(conversationRefs.route,{token:args.token})!=='v1'){
    if(args.targetId||args.completionTargetId)return {outcome:'error',message:copy.messages_I_couldn_t_safely_process_that_right};
    return await ctx.runAction(conversationRefs.send,{token:args.token,messageId:args.messageId,text:args.text});
  }
    const command = matchCommand(args.text);
    messageReceivedAt = await ctx.runMutation(internal.tracking.receive, {token: args.token, messageId: args.messageId, ...(command === 'stop' || command === 'delete' ? {cancelPending: true} : {})});
    if (!args.text.trim() || args.text.length > 2000) {route='validation';return await finish({outcome:'error', messageReceivedAt, message:copy.messages_Please_send_a_text_message_of_1});}
    if (command) {
      route=command;
      const result = command === 'summary'
        ? {outcome: 'summary'}
        : await ctx.runMutation(internal.commands.execute, {token: args.token, command, messageId: args.messageId});
      const view = await ctx.runQuery(api.tracking.getSummary, {token: args.token});
      await ctx.runMutation(internal.tracking.completeCommand, {token: args.token, messageId: args.messageId});
      return await finish({...result, ...(command === 'summary' ? {message: summaryText(view,view.user.timezone)} : {}), messageReceivedAt, view});
    }
    const safetyResult=await ctx.runMutation(internal.tracking.safetyGuard,{token:args.token,messageId:args.messageId,text:args.text,neutral:matchFarewell(args.text)});
    if(safetyResult){route=safetyResult.outcome;return await finish({...safetyResult,messageReceivedAt});}
    if(matchGreeting(args.text)){
      route='greeting';
      const result=await ctx.runMutation(internal.tracking.greet,{token:args.token,messageId:args.messageId});
      return await finish({...result,messageReceivedAt});
    }
    const conversationReply=matchConversationReply(args.text);
    if(matchHelp(args.text)||conversationReply){
      route='help';await ctx.runMutation(internal.tracking.completeCommand,{token:args.token,messageId:args.messageId});
      return await finish({outcome:'help',message:conversationReply==='uncertainty'?copy.uncertaintyReply:conversationReply==='doingWell'?copy.doingWellReply:copy.helpReply,messageReceivedAt});
    }
    if(matchFarewell(args.text)){
      route='farewell';await ctx.runMutation(internal.tracking.completeCommand,{token:args.token,messageId:args.messageId});
      return await finish({outcome:'farewell',message:copy.farewellReply,messageReceivedAt});
    }
    const retrieval=matchRetrieval(args.text);
    if(retrieval==='week'){
      route='week_retrieval';
      const view=await ctx.runQuery(api.tracking.getSummary,{token:args.token});
      await ctx.runMutation(internal.tracking.completeCommand,{token:args.token,messageId:args.messageId});
      return await finish({outcome:'summary',message:summaryText(view,view.user.timezone),messageReceivedAt,view});
    }
    if (retrieval==='plan') {
      route='plan_retrieval';
      const planView=await ctx.runQuery(api.plans.getPlan,{token:args.token});
      await ctx.runMutation(internal.tracking.completeCommand,{token:args.token,messageId:args.messageId});
      return await finish({outcome:planView.plan?'plan_summary':'no_plan',message:planReply(planView),messageReceivedAt,planView});
    }
    const context = await ctx.runQuery(internal.tracking.context, {token: args.token});
    if (context.user.state === 'stopped') {
      route='stopped';
      await ctx.runMutation(internal.tracking.completeCommand, {token: args.token, messageId: args.messageId});
      return await finish({outcome:'stopped', message:STOPPED_REPLY, messageReceivedAt, view:context});
    }
    const dateAnswer=await ctx.runMutation(internal.tracking.resolveTypedDate,{token:args.token,messageId:args.messageId,text:args.text});
    if(dateAnswer){route='pending_answer';return await finish(dateAnswer);}
    const typedPlanReply=await ctx.runMutation(internal.plans.resolveTyped,{token:args.token,messageId:args.messageId,text:args.text});
    if(typedPlanReply){route='plan_confirmation';return await finish(typedPlanReply);}
    const activity=matchPlanWithoutTarget(args.text);
    if(activity){route='plan_request';return await finish(await ctx.runMutation(internal.plans.requestTarget,{token:args.token,messageId:args.messageId,text:args.text,activity}));}
    const selected=await ctx.runMutation(internal.tracking.selectTrackedItems,{token:args.token,messageId:args.messageId,text:args.text});
    if(selected){route=selected.outcome;return await finish({...selected,messageReceivedAt});}
    route='interpretation';
    const planContext=await ctx.runQuery(internal.plans.context,{token:args.token});
    const reservation = await ctx.runMutation(internal.tracking.reserve, {token: args.token, messageId: args.messageId});
    if (!reservation.proceed) return await finish({outcome:'provider_duplicate', message:copy.messages_I_already_received_this_message_I_haven, messageReceivedAt, view: context});
    reserved = true;
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error(copy.messages_AI_is_not_configured_Add_OPENAI_API);
    const extractor = new Agent(components.agent, {
      name: 'meaning-only',
      languageModel: createOpenAI({apiKey}).chat('gpt-4.1-mini'),
      instructions: INSTRUCTIONS+"\n"+SAFETY_INSTRUCTIONS,
      storageOptions: { saveMessages: 'none' },
    });
    // No thread or chat memory: health text is persisted only in owned occurrence/pending tables.
    const result = await extractor.generateObject(ctx, {userId: context.userId}, {
      prompt: JSON.stringify({allowedTrackedItems: context.user.trackedItems, message: args.text, plan:planContext.plan, pendingQuestion:planContext.pending?.length===1?planContext.pending[0]:context.pending.filter((p:any)=>p.proposal?.intent==='clarify').length===1?context.pending.filter((p:any)=>p.proposal?.intent==='clarify').map((p:any)=>({question:p.reason,proposal:p.proposal,rawText:p.rawText}))[0]:null, recentRecordKinds:[...context.records.slice(-5).map((r:any)=>({kind:'occurrence',messageReceivedAt:r.messageReceivedAt})),...planContext.recentCompletions.map((r:any)=>({kind:'plan_completion',messageReceivedAt:r.messageReceivedAt}))].sort((a:any,b:any)=>a.messageReceivedAt-b.messageReceivedAt).slice(-5), targetKind:args.completionTargetId?'plan_completion':args.targetId?'occurrence':null}),
      schema: extractionSchema,
      maxOutputTokens: 350,
      maxRetries: 0,
      abortSignal: AbortSignal.timeout(20000),
    }, {storageOptions: {saveMessages: 'none'}});
    const intent=extractionSchema.shape.intent.safeParse(result.object.intent);
    aiIntent=intent.success?intent.data:null;
    if(result.object.safetyCategory){
      const evidence=result.object.safetyEvidence;
      if(typeof evidence!=='string'||!evidence.trim()||!args.text.toLowerCase().includes(evidence.toLowerCase()))throw new Error('Invalid interpretation evidence');
      if(!supportedSafetyEvidence(result.object.safetyCategory,args.text,evidence)){result.object.safetyCategory=null;result.object.safetyEvidence=null;}
      const safety=result.object.safetyCategory?await ctx.runMutation(internal.tracking.safetyGuard,{token:args.token,messageId:args.messageId,text:args.text,category:result.object.safetyCategory}):null;
      if(safety){route=safety.outcome;return await finish({...safety,messageReceivedAt});}
    }
    const applied=await ctx.runMutation(internal.tracking.apply, {...args, meaning: result.object});
    if(applied.outcome==='out_of_scope_medical')route='out_of_scope_medical';
    return await finish({...applied,messageReceivedAt});
  } catch (error) {
    route='error';
    const limit=usageLimitFailure(error);
    if(limit){if(reserved)await ctx.runMutation(internal.tracking.fail,{token:args.token,messageId:args.messageId});return await finish({outcome:'error',messageReceivedAt,message:usageLimitReply(limit),failure:limit});}
    if (reserved) await ctx.runMutation(internal.tracking.fail, {token: args.token, messageId: args.messageId});
    // Never log provider errors: they can include the input text or credential-bearing headers.
    const message = error instanceof Error ? error.message : '';
    const safe = [copy.tracking_This_test_session_is_not_authorised_Create,copy.tracking_This_test_session_is_not_authorised,copy.tracking_Test_record_limit_reached,copy.tracking_Test_record_limit_reached_2,copy.tracking_The_fictional_test_session_has_reached_its,copy.tracking_That_occurrence_is_not_available_to_this,copy.tracking_AI_hourly_call_limit_reached_Please_try].includes(message);
    const status = APICallError.isInstance(error) ? error.statusCode : null;
    const kind = error instanceof Error ? error.name : 'UnknownError';
    let providerCode: string | null = null;
    if (APICallError.isInstance(error) && error.responseBody) {
      try {
        const code = JSON.parse(error.responseBody)?.error?.code;
        if (['insufficient_quota', 'rate_limit_exceeded', 'invalid_api_key', 'model_not_found'].includes(code)) providerCode = code;
      } catch { /* Do not expose or log provider response bodies. */ }
    }
    return await finish({outcome:'error', messageReceivedAt, message: message===copy.tracking_AI_hourly_call_limit_reached_Please_try ? copy.messages_I_ve_reached_my_hourly_limit_for : safe ? message : copy.messages_I_couldn_t_safely_process_that_right, failure: {kind, status, providerCode}});
  } finally {
    console.info(JSON.stringify({messageId:args.messageId,aiIntent,route,replyEntry}));
  }
}});
