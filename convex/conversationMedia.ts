"use node";
import {redactTextAttachment} from './logRedaction';
import {v} from 'convex/values';
import {makeFunctionReference as ref} from 'convex/server';
import {internalAction} from './_generated/server';
const MAX_BYTES=100*1024*1024; // WhatsApp document ceiling; never enlarge health-input limits.
export const retain=internalAction({args:{logId:v.id('conversationLog')},returns:v.boolean(),handler:async(ctx,a)=>{
 const file:any=await ctx.runMutation(ref<'mutation'>('conversationLog:claimAttachment'),a);if(!file)return false;if(file.done)return file.state==='stored';
 let storageId;let phase='configuration';
 try{
  if(!file.mediaId||!process.env.WHATSAPP_ACCESS_TOKEN||!process.env.WHATSAPP_PHONE_NUMBER_ID||!/^[A-Za-z0-9_.-]{1,200}$/.test(file.mediaId))throw Error('media_configuration');
  const headers={Authorization:'Bearer '+process.env.WHATSAPP_ACCESS_TOKEN};
  phase='metadata';const metadata=await fetch('https://graph.facebook.com/v23.0/'+encodeURIComponent(file.mediaId)+'?phone_number_id='+encodeURIComponent(process.env.WHATSAPP_PHONE_NUMBER_ID),{headers,signal:AbortSignal.timeout(15000),redirect:'error'});
  if(!metadata.ok)throw Error('media_unavailable');const info:any=await metadata.json();
  const url=new URL(info.url);if(url.protocol!=='https:'||url.username||url.password||!(url.hostname==='lookaside.fbsbx.com'||url.hostname==='graph.facebook.com'||url.hostname.endsWith('.fbcdn.net')))throw Error('media_host');
  if(info.file_size>MAX_BYTES)throw Error('media_size');
  phase='download';const response=await fetch(url.toString(),{headers,signal:AbortSignal.timeout(30000),redirect:'error'});if(!response.ok||!response.body)throw Error('media_download');
  const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX_BYTES){await reader.cancel();throw Error('media_size');}chunks.push(value);}
  if(!size)throw Error('media_empty');const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  const mimeType=info.mime_type??file.mimeType??'application/octet-stream';phase='storage';const retainedBytes=redactTextAttachment(bytes,mimeType,file.filename);storageId=await ctx.storage.store(new Blob([Uint8Array.from(retainedBytes)],{type:mimeType}));
  return await ctx.runMutation(ref<'mutation'>('conversationLog:storeAttachment'),{id:file._id,leaseUntil:file.leaseUntil,storageId,size,mimeType});
 }catch{
  if(storageId)await ctx.storage.delete(storageId);
  await ctx.runMutation(ref<'mutation'>('conversationLog:storeAttachment'),{id:file._id,leaseUntil:file.leaseUntil,failure:'media_'+phase+'_failed'});return false;
 }
}});
// Administrator-only bytes, never a public storage URL. Bound chunks to Convex response limits.
export const read=internalAction({args:{phoneNumber:v.string(),id:v.id('conversationAttachments'),offset:v.number()},returns:v.any(),handler:async(ctx,a)=>{
 if(!Number.isInteger(a.offset)||a.offset<0)throw Error('Invalid offset');const file:any=await ctx.runQuery(ref<'query'>('conversationLog:attachment'),{phoneNumber:a.phoneNumber,id:a.id});if(!file?.storageId)return null;
 const blob=await ctx.storage.get(file.storageId);if(!blob)return null;
 const size=blob.size,data=Buffer.from(await blob.slice(a.offset,a.offset+1024*1024).arrayBuffer()).toString('base64');
 // Recheck deletion after reading bytes, before returning private content.
 if(!await ctx.runQuery(ref<'query'>('conversationLog:attachment'),{phoneNumber:a.phoneNumber,id:a.id}))return null;
 return {data,size,nextOffset:Math.min(a.offset+1024*1024,size),done:a.offset+1024*1024>=size,mimeType:file.mimeType};
}});
