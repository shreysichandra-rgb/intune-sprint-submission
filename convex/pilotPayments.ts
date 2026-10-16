"use node";
import {currentPaymentMode,assertOrderMode} from './pilotPaymentMode';
import {createHmac,timingSafeEqual,randomBytes,createHash} from 'node:crypto';
import {v} from 'convex/values';
import {makeFunctionReference as ref} from 'convex/server';
import {internalAction} from './_generated/server';
export function authentic(raw:string,supplied:string,secret:string){return /^[a-fA-F0-9]{64}$/.test(supplied)&&timingSafeEqual(Buffer.from(createHmac('sha256',secret).update(raw).digest('hex'),'hex'),Buffer.from(supplied,'hex'));}
function webRoot(){const root=process.env.INTUNE_PILOT_WEB_URL??process.env.CONVEX_SITE_URL;if(!root)throw new Error('Checkout page unavailable');const url=new URL(root);if(!(url.protocol==='https:'&&url.hostname.endsWith('.convex.site')||url.protocol==='http:'&&['127.0.0.1','localhost'].includes(url.hostname)))throw new Error('Unsupported checkout host');return url.origin;}
function whatsappChatUrl(){const url=process.env.INTUNE_PILOT_WHATSAPP_URL??'';return /^https:\/\/wa\.me\/[1-9]\d{7,14}$/.test(url)?url:null;}
const hash=(link:string)=>createHash('sha256').update(link).digest('hex');
function config(){const mode=currentPaymentMode();const prefix=mode==='razorpay_live'?'rzp_live_':'rzp_test_';if(process.env.INTUNE_PILOT_MODE!=='v3'||process.env.PAYMENT_MODE!==mode||!new RegExp('^'+prefix+'[a-zA-Z0-9]+$').test(process.env.RAZORPAY_KEY_ID??'')||!process.env.RAZORPAY_KEY_SECRET||!process.env.RAZORPAY_WEBHOOK_SECRET)throw new Error(mode==='razorpay_live'?'Razorpay Live Mode unavailable':'Razorpay Test Mode unavailable');return {mode,keyId:process.env.RAZORPAY_KEY_ID!,secret:process.env.RAZORPAY_KEY_SECRET!,webhookSecret:process.env.RAZORPAY_WEBHOOK_SECRET!};}
async function provider(path:string,body?:any){const c=config();const r=await fetch('https://api.razorpay.com/v1/'+path,{method:body?'POST':'GET',headers:{Authorization:'Basic '+Buffer.from(c.keyId+':'+c.secret).toString('base64'),'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15000)});if(!r.ok)throw new Error('Payment provider unavailable');return r.json();}
export const createCheckout=internalAction({args:{token:v.string()},returns:v.any(),handler:async(ctx,a)=>{
 config();const link=randomBytes(32).toString('hex');const reservation:any=await ctx.runMutation(ref<'mutation'>('pilotPaymentsStore:reserveOrder'),{token:a.token,linkHash:hash(link),checkoutToken:link});
 if(reservation.reuse)return {url:webRoot()+'/pilot/checkout.html#'+reservation.checkoutToken};
 if(reservation.recover){const receipt=String(reservation.id).slice(-40),list:any=await provider('orders?receipt='+encodeURIComponent(receipt)+'&count=100');const matches=list.items?.filter((o:any)=>o.receipt===receipt&&o.amount===9900&&o.currency==='INR'&&/^order_[a-zA-Z0-9]+$/.test(o.id));if(matches?.length!==1)throw new Error('Order requires operator recovery; no additional order was created');await ctx.runMutation(ref<'mutation'>('pilotPaymentsStore:finishOrder'),{id:reservation.id,orderId:matches[0].id});return {url:webRoot()+'/pilot/checkout.html#'+reservation.checkoutToken};}
 try{const o:any=await provider('orders',{amount:9900,currency:'INR',receipt:String(reservation.id).slice(-40),partial_payment:false});if(o.amount!==9900||o.currency!=='INR'||!/^order_[a-zA-Z0-9]+$/.test(o.id))throw new Error('Invalid order');await ctx.runMutation(ref<'mutation'>('pilotPaymentsStore:finishOrder'),{id:reservation.id,orderId:o.id});return {url:webRoot()+'/pilot/checkout.html#'+link};}catch{await ctx.runMutation(ref<'mutation'>('pilotPaymentsStore:finishOrder'),{id:reservation.id});throw new Error('Order needs operator recovery; no duplicate order created');}
}});
export const checkout=internalAction({args:{link:v.string()},returns:v.any(),handler:async(ctx,a)=>{const c=config();if(!/^[a-f0-9]{64}$/.test(a.link))throw new Error('Checkout unavailable');const o:any=await ctx.runQuery(ref<'query'>('pilotPaymentsStore:orderForLink'),{hash:hash(a.link)});assertOrderMode(o);if(!o.orderId||!['ready','paid'].includes(o.state))throw new Error('Checkout unavailable');return {mode:c.mode,keyId:c.keyId,orderId:o.orderId,amount:9900,currency:'INR',paid:o.state==='paid',whatsappUrl:whatsappChatUrl()};}});
export const checkoutConfirm=internalAction({args:{link:v.string(),paymentId:v.string(),orderId:v.string(),signature:v.string()},returns:v.any(),handler:async(ctx,a)=>{
 const c=config();if(!/^[a-f0-9]{64}$/.test(a.link)||!/^pay_[a-zA-Z0-9]+$/.test(a.paymentId))throw new Error('Payment rejected');const o:any=await ctx.runQuery(ref<'query'>('pilotPaymentsStore:orderForLink'),{hash:hash(a.link)});
 assertOrderMode(o);if(a.orderId!==o.orderId||!authentic(o.orderId+'|'+a.paymentId,a.signature,c.secret))throw new Error('Payment rejected');const p=await provider('payments/'+encodeURIComponent(a.paymentId));return ctx.runMutation(ref<'mutation'>('pilotPaymentsStore:confirm'),{id:o._id,payment:p});
}});
export const webhook=internalAction({args:{raw:v.string(),signature:v.string(),eventId:v.string()},returns:v.null(),handler:async(ctx,a)=>{
 const c=config();if(!authentic(a.raw,a.signature,c.webhookSecret)||!a.eventId||a.eventId.length>200)throw new Error('Webhook rejected');const e=JSON.parse(a.raw);if(!['payment.captured','order.paid','payment.failed'].includes(e.event))return null;
 const entity=e.payload?.payment?.entity;if(!entity||!/^pay_[a-zA-Z0-9]+$/.test(entity.id??''))throw new Error('Payment rejected');const o:any=await ctx.runQuery(ref<'query'>('pilotPaymentsStore:orderByProvider'),{orderId:entity.order_id});if(!o)throw new Error('Unknown order');assertOrderMode(o);
 if(e.event==='payment.failed')return null; // A failed event never grants access, even if the payment later changes state.
 const p=await provider('payments/'+encodeURIComponent(entity.id));await ctx.runMutation(ref<'mutation'>('pilotPaymentsStore:confirm'),{id:o._id,payment:p,eventId:a.eventId});return null;
}});

export const recoverPayment=internalAction({args:{token:v.string()},returns:v.boolean(),handler:async(ctx,a)=>{
 config();const o:any=await ctx.runQuery(ref<'query'>('pilotPaymentsStore:latestOrder'),a);if(!o?.orderId)return false;assertOrderMode(o);
 if(o.state==='paid')return true;
 const list:any=await provider('orders/'+encodeURIComponent(o.orderId)+'/payments');
 const p=list.items?.find((p:any)=>p.order_id===o.orderId&&p.amount===9900&&p.currency==='INR'&&p.status==='captured'&&p.captured===true);
 if(!p)return false;await ctx.runMutation(ref<'mutation'>('pilotPaymentsStore:confirm'),{id:o._id,payment:p});return true;
}});
