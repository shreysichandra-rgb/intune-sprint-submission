import {metaReferralAdId} from './acquisitionRules';
import {loggingEnabled} from './conversationLog';
import {operatorPhonePermitted} from './operatorPhoneGate';
import {makeFunctionReference} from 'convex/server';
import * as copy from './copy';
import {httpAction} from './_generated/server';
import {api,internal} from './_generated/api';
const response=(status:number,body:string)=>new Response(body,{status,headers:{'Content-Type':'text/plain','Cache-Control':'no-store'}});
export const verify=httpAction(async(_ctx,request)=>{
 const token=process.env.WHATSAPP_VERIFY_TOKEN;
 if(!token)return response(503,copy.whatsapp_WhatsApp_is_not_configured);
 const q=new URL(request.url).searchParams;
 if(q.get('hub.mode')!=='subscribe'||q.get('hub.verify_token')!==token||!q.has('hub.challenge'))return response(403,copy.whatsapp_Verification_rejected);
 return response(200,q.get('hub.challenge')!);
});
export const receive=httpAction(async(ctx,request)=>{
 const secret=process.env.WHATSAPP_APP_SECRET;
 if(!secret)return response(503,copy.whatsapp_WhatsApp_is_not_configured_2);
 const signature=request.headers.get('X-Hub-Signature-256')??'';
 if(!/^sha256=[a-fA-F0-9]{64}$/.test(signature))return response(401,copy.whatsapp_Unauthorised_request);
 const reader=request.body?.getReader();if(!reader)return response(400,copy.whatsapp_Invalid_payload);
 const chunks:Uint8Array[]=[];let size=0;
 while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>262144){await reader.cancel();return response(413,copy.whatsapp_Payload_too_large);}chunks.push(value);}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['verify']);
 const digest=Uint8Array.from(signature.slice(7).match(/../g)!,h=>parseInt(h,16));
 if(!await crypto.subtle.verify('HMAC',key,digest,bytes))return response(401,copy.whatsapp_Unauthorised_request_2);
 let body:any;try{body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{return response(400,copy.whatsapp_Invalid_payload_2);}
 if(body?.object!=='whatsapp_business_account'||!Array.isArray(body.entry))return response(400,copy.whatsapp_Invalid_payload_3);
 const messages:{from:string,id:string,text?:string,quotedMessageId?:string,providerSentAt?:number,referralAdId?:string,unsupported?:boolean,type?:string,media?:{id?:string,filename?:string,mimeType?:string}}[]=[];
 const mediaTypes=new Set(['image','document','audio','video','sticker']);
 for(const entry of body.entry){if(!Array.isArray(entry?.changes))continue;for(const change of entry.changes){
  if(change?.field!=='messages')continue;
  const value=change.value;
  if(process.env.INTUNE_PILOT_MODE==='v3'&&Array.isArray(value?.statuses)){
   if(value.metadata?.phone_number_id!==process.env.WHATSAPP_PHONE_NUMBER_ID)return response(400,copy.whatsapp_Wrong_receiving_phone);
   for(const status of value.statuses){if(loggingEnabled()&&typeof status.id==='string'&&typeof status.recipient_id==='string'&&['sent','delivered','read','failed'].includes(status.status))await ctx.runMutation(makeFunctionReference<'mutation'>('conversationLog:status'),{providerMessageId:status.id,recipient:status.recipient_id,status:status.status==='sent'?'accepted':status.status});if(['delivered','read'].includes(status.status)&&typeof status.id==='string'&&typeof status.recipient_id==='string'&&/^\d+$/.test(String(status.timestamp)))await ctx.runMutation(makeFunctionReference<'mutation'>('pilotAccess:welcomeDelivered'),{providerMessageId:status.id,recipient:status.recipient_id,deliveredAt:Number(status.timestamp)*1000,confirmation:status.status});}
  }
  if(!Array.isArray(value?.messages))continue;
  for(const m of value.messages){
   const referralAdId=metaReferralAdId(m?.referral);
   if(process.env.INTUNE_PILOT_MODE==='v3'&&(mediaTypes.has(m?.type)||loggingEnabled()&&m?.type!=='text')){
    if(typeof m.from!=='string'||! /^[1-9]\d{7,14}$/.test(m.from)||typeof m.id!=='string'||!m.id||m.id.length>100)return response(400,copy.whatsapp_Invalid_text_message);
    const media=m[m.type];
    const {referral:_discardedReferral,...messageWithoutReferral}=m;
    messages.push({from:m.from,id:m.id,...(referralAdId?{referralAdId}:{}),unsupported:true,type:String(m.type??'unknown'),...(typeof media?.caption==='string'?{text:media.caption}:!mediaTypes.has(m.type)?{text:JSON.stringify(media??messageWithoutReferral).slice(0,10000)}:{}),...(mediaTypes.has(m.type)?{media:{...(typeof media?.id==='string'?{id:media.id}:{}),...(typeof media?.filename==='string'?{filename:media.filename}:{}),...(typeof media?.mime_type==='string'?{mimeType:media.mime_type}:{})}}:{}),...(typeof m.context?.id==='string'?{quotedMessageId:m.context.id}:{}),...(/^\d+$/.test(String(m.timestamp))?{providerSentAt:Number(m.timestamp)*1000}:{})});continue;
   }
   if(m?.type!=='text')continue;
   if(typeof m.from!=='string'||! /^[1-9]\d{7,14}$/.test(m.from)||typeof m.id!=='string'||!m.id||m.id.length>100||typeof m.text?.body!=='string'||!m.text.body.trim()||m.text.body.length>2000)return response(400,copy.whatsapp_Invalid_text_message);
   if(m.context?.id!==undefined&&(typeof m.context.id!=='string'||!m.context.id||m.context.id.length>100))return response(400,copy.whatsapp_Invalid_text_message);
   const providerSentAt=/^\d+$/.test(String(m.timestamp))?Number(m.timestamp)*1000:undefined;
   if(providerSentAt!==undefined&&(!Number.isFinite(providerSentAt)||providerSentAt>Date.now()+30000))return response(400,copy.whatsapp_Invalid_text_message);
   messages.push({from:m.from,id:m.id,...(referralAdId?{referralAdId}:{}),text:m.text.body,...(m.context?.id?{quotedMessageId:m.context.id}:{}),...(providerSentAt!==undefined?{providerSentAt}:{})});
  }
 }}
 if(!messages.length)return response(200,copy.whatsapp_EVENT_RECEIVED);
 const accessToken=process.env.WHATSAPP_ACCESS_TOKEN,phoneId=process.env.WHATSAPP_PHONE_NUMBER_ID;
 if(!accessToken||!phoneId||!/^\d+$/.test(phoneId))return response(503,copy.whatsapp_WhatsApp_is_not_configured_3);
 // Reject events for a different business phone before any writes.
 for(const entry of body.entry)for(const change of entry.changes??[])if(change?.value?.messages?.some((m:any)=>(m.type==='text'||process.env.INTUNE_PILOT_MODE==='v3'&&(mediaTypes.has(m.type)||loggingEnabled()&&m.type!=='text')))&&change.value.metadata?.phone_number_id!==phoneId)return response(400,copy.whatsapp_Wrong_receiving_phone);
 if(messages.some(m=>!operatorPhonePermitted('+'+m.from)))return response(403,'Test recipient unavailable');
 try{
  for(const m of messages){
   const token=await ctx.runMutation(internal.phoneUsers.getOrCreate,{phoneNumber:'+'+m.from});
   let replyId=await ctx.runQuery(makeFunctionReference<'query'>('whatsappDelivery:lookup'),{token,messageId:m.id});
   if(!replyId){await ctx.runMutation(makeFunctionReference<'mutation'>('whatsappDelivery:request'),{token,messageId:m.id,showTyping:!m.unsupported,...(m.referralAdId?{referralAdId:m.referralAdId}:{}),...(m.quotedMessageId?{quotedMessageId:m.quotedMessageId}:{}),...(m.providerSentAt!==undefined?{providerSentAt:m.providerSentAt}:{})});// Typed V3 messages are logged by messages.send, including provider timestamps from the owned request.
    const logId=(m.unsupported||process.env.INTUNE_PILOT_MODE!=='v3')?await ctx.runMutation(makeFunctionReference<'mutation'>('conversationLog:begin'),{token,messageId:m.id,type:m.type??'text',...(m.text?{text:m.text}:{}),...(m.media?{media:m.media}:{}),...(m.quotedMessageId?{quotedMessageId:m.quotedMessageId}:{}),...(m.providerSentAt!==undefined?{providerSentAt:m.providerSentAt}:{})}):null;
    const retained=m.unsupported&&logId&&m.media?await ctx.runAction(makeFunctionReference<'action'>('conversationMedia:retain'),{logId}):false;
    const messageRetained=!!m.unsupported&&!!logId&&await ctx.runQuery(makeFunctionReference<'query'>('conversationLog:retained'),{id:logId});
    const uploadMessage=!loggingEnabled()?copy.whatsapp_Text_only_upload_reply:retained?'I can use typed messages for your health plans right now. I’ve kept this upload for reviewing issues with InTune. Please type or paste the details if you want me to track them.':m.media?'I can use typed messages for your health plans right now. I couldn’t keep this upload for reviewing issues. Please type or paste the details if you want me to track them.':messageRetained?'I can use typed messages for your health plans right now. This message was kept for reviewing issues with InTune; it wasn’t added to your health record.':'I can use typed messages for your health plans right now. This message was not kept. Please type or paste the details if you want me to track them.';
    const result=m.unsupported?{outcome:'unsupported_media',controlOnly:true,message:uploadMessage}:await ctx.runAction(api.messages.send,{token,text:m.text!,messageId:m.id,...(m.quotedMessageId?{quotedMessageId:m.quotedMessageId}:{})});
    if(logId)await ctx.runMutation(makeFunctionReference<'mutation'>('conversationLog:finish'),{id:logId,result});replyId=await ctx.runMutation(makeFunctionReference<'mutation'>('whatsappDelivery:enqueue'),{token,messageId:m.id,result});}
   if(replyId&&!await ctx.runAction(makeFunctionReference<'action'>('whatsappDelivery:deliver'),{id:replyId}))return response(502,copy.whatsapp_WhatsApp_reply_delivery_failed);
  }
  return response(200,copy.whatsapp_EVENT_RECEIVED_2);
 }catch{
  // No payloads, health text, provider error bodies or credentials in logs.
  return response(503,copy.whatsapp_WhatsApp_message_processing_failed);
 }
});
