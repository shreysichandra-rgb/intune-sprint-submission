import {paymentWebhook,checkout,confirm} from './pilotHttp';
import * as copy from './copy';
import {httpRouter} from 'convex/server';
import {httpAction} from './_generated/server';
import {registerStaticRoutes} from '@convex-dev/static-hosting';
import {sink} from './verificationTransport';
import {verify,receive} from './whatsapp';
import {components} from './_generated/api';
import {api,internal} from './_generated/api';
const router=httpRouter();
function json(value:unknown,status=200){return new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});}
async function secretMatches(received:string,expected:string){
 const encode=new TextEncoder();
 const [a,b]=await Promise.all([crypto.subtle.digest('SHA-256',encode.encode(received)),crypto.subtle.digest('SHA-256',encode.encode(expected))]);
 const left=new Uint8Array(a),right=new Uint8Array(b);let mismatch=0;
 for(let i=0;i<left.length;i++)mismatch|=left[i]^right[i];
 return mismatch===0;
}
router.route({path:'/api/messages',method:'POST',handler:httpAction(async(ctx,request)=>{
 const secret=process.env.MESSAGE_HTTP_SECRET;
 if(!secret)return json({error:copy.http_Message_endpoint_is_not_configured},503);
 const header=request.headers.get('Authorization')??'';
 if(!header.startsWith('Bearer ')||header.length>4096||!await secretMatches(header.slice(7),secret))return json({error:copy.http_Unauthorised_request},401);
 if(request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase()!=='application/json')return json({error:copy.http_Send_application_json},400);
 // Bound the body before parsing, including callers using chunked transfer.
 const reader=request.body?.getReader();if(!reader)return json({error:copy.http_Invalid_JSON_message},400);
 const chunks:Uint8Array[]=[];let size=0;
 while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>16384){await reader.cancel();return json({error:copy.http_Message_body_is_too_large},413);}chunks.push(value);}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
 let body:any;
 try{body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{return json({error:copy.http_Invalid_JSON_message_2},400);}
 if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!['phoneNumber','text','messageId'].includes(k))||typeof body.phoneNumber!=='string'||!/^\+[1-9]\d{7,14}$/.test(body.phoneNumber)||typeof body.text!=='string'||!body.text.trim()||body.text.length>2000||(body.messageId!==undefined&&(typeof body.messageId!=='string'||!body.messageId||body.messageId.length>100)))return json({error:copy.http_Use_phoneNumber_in_international_digits_format_text},400);
 try{
  const token=await ctx.runMutation(internal.phoneUsers.getOrCreate,{phoneNumber:body.phoneNumber});
  const result=await ctx.runAction(api.messages.send,{token,text:body.text,messageId:body.messageId??crypto.randomUUID()});
  return json({reply:result.message},result.outcome==='error'?503:200);
 }catch{
  // Never log or return request bodies, tokens, secrets or exception details.
  return json({reply:copy.http_I_couldn_t_safely_process_that_right},503);
 }
})});
router.route({path:'/verification/whatsapp',method:'POST',handler:sink});
router.route({path:'/whatsapp/webhook',method:'GET',handler:verify});
router.route({path:'/whatsapp/webhook',method:'POST',handler:receive});
router.route({path:'/payments/razorpay/webhook',method:'POST',handler:paymentWebhook});
router.route({path:'/payments/checkout',method:'POST',handler:checkout});
router.route({path:'/payments/confirm',method:'POST',handler:confirm});
registerStaticRoutes(router,components.staticHosting);
export default router;
