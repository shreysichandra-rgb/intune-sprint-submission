import {v} from 'convex/values';
import {internalQuery,internalMutation} from './_generated/server';
import type {MutationCtx} from './_generated/server';
import type {Doc} from './_generated/dataModel';
import {joinAdSource,privateAdSource} from './acquisitionRules';
// No phone, name or health content. First touch is immutable across retries and resets.
export async function captureAcquisition(ctx:MutationCtx,u:Doc<'users'>,a:{messageId:string;text?:string;referralAdId?:string},receivedAt:number){
 if(!u.phoneNumber||u.dataDeletedAt||u.storageWithdrawn)return;
 const existing=await ctx.db.query('pilotAcquisitions').withIndex('by_user',q=>q.eq('userId',u._id)).unique();
 if(existing){
  // The first received message may finish logging after a later upload. Only
  // that original message can resolve its as-yet-unknown entry label.
  if(existing.isNew&&existing.source===null&&existing.firstMessageId===a.messageId){const source=privateAdSource(a.referralAdId)??joinAdSource(a.text??'');if(source)await ctx.db.patch(existing._id,{source});}
  return;
 }
 const prior=await ctx.db.query('conversationLog').withIndex('by_user',q=>q.eq('userId',u._id)).first();
 const first=await ctx.db.query('whatsappRequests').withIndex('by_user',q=>q.eq('userId',u._id)).first();
 const isNew=!prior,firstMessageId=first?.messageId??a.messageId;
 await ctx.db.insert('pilotAcquisitions',{userId:u._id,firstMessageId,firstAt:first?.receivedAt??receivedAt,isNew,source:isNew&&firstMessageId===a.messageId?(privateAdSource(a.referralAdId)??joinAdSource(a.text??'')):null});
}
// Operator-only, idempotent repair for the specific proven ordering failure.
// No chat, access, payment or health record is changed.
export const repairOutOfOrder=internalMutation({args:{userId:v.id('users')},returns:v.object({repaired:v.boolean(),reason:v.string()}),handler:async(ctx,{userId})=>{
 const u=await ctx.db.get(userId),a=await ctx.db.query('pilotAcquisitions').withIndex('by_user',q=>q.eq('userId',userId)).unique();
 if(!u||!u.phoneNumber||u.dataDeletedAt||u.storageWithdrawn||(u.debugEpoch??0)!==0||u.pilotOnboardingResetKey||!a||a.isNew||a.source!==null)return {repaired:false,reason:'Not an eligible unclassified first contact'};
 const first=await ctx.db.query('whatsappRequests').withIndex('by_user',q=>q.eq('userId',userId)).first();
 if(!first||first.messageId!==a.firstMessageId||first.receivedAt!==a.firstAt||first.receivedAt<u._creationTime-1000||first.receivedAt-u._creationTime>60000)return {repaired:false,reason:'Fresh account and first receipt are not proven'};
 const logs=await ctx.db.query('conversationLog').withIndex('by_user',q=>q.eq('userId',userId)).take(101);
 if(logs.length>100)return {repaired:false,reason:'History needs a separate paginated review'};
 const earliest=logs[0],entry=logs.find(l=>l.direction==='incoming'&&l.messageId===first.messageId);
 if(!earliest||!entry||earliest.messageId===first.messageId||earliest.direction!=='incoming'||earliest.receivedAt<=first.receivedAt||earliest._creationTime>=entry._creationTime||logs.some(l=>l.receivedAt<first.receivedAt||l.epoch!==0||l.suppressed))return {repaired:false,reason:'Out-of-order first-message evidence is incomplete'};
 await ctx.db.patch(a._id,{isNew:true,source:joinAdSource(entry.text??'')});
 return {repaired:true,reason:'First receipt preceded the later message that was logged first'};
}});
export async function purgeAcquisition(ctx:MutationCtx,userId:Doc<'users'>['_id']){
 const row=await ctx.db.query('pilotAcquisitions').withIndex('by_user',q=>q.eq('userId',userId)).unique();if(row)await ctx.db.delete(row._id);
}
const bucket=v.object({source:v.string(),newChats:v.number(),paidUsers:v.number(),capturedPayments:v.number(),grossInr:v.number()});
// Internal only: the existing authenticated local operator proxy exposes aggregates.
export const report=internalQuery({args:{from:v.optional(v.number()),to:v.optional(v.number())},returns:v.object({rows:v.array(bucket),at:v.number(),method:v.string()}),handler:async(ctx,a)=>{
 if(a.from!==undefined&&!Number.isFinite(a.from)||a.to!==undefined&&!Number.isFinite(a.to)||a.from!==undefined&&a.to!==undefined&&a.from>=a.to)throw Error('Invalid contact period.');
 const contacts=await ctx.db.query('pilotAcquisitions').take(1001);if(contacts.length>1000)throw Error('Report needs pagination above 1000 contacts; no incomplete totals shown.');
 const groups=new Map<string,{source:string;newChats:number;paidUsers:number;capturedPayments:number;grossInr:number}>();
 for(const c of contacts){if(!c.isNew||a.from!==undefined&&c.firstAt<a.from||a.to!==undefined&&c.firstAt>=a.to)continue;
 const u=await ctx.db.get(c.userId);if(!u||u.dataDeletedAt||u.storageWithdrawn)continue;
 const source=c.source??'unknown',b=groups.get(source)??{source,newChats:0,paidUsers:0,capturedPayments:0,grossInr:0};b.newChats++;
 const orders=await ctx.db.query('pilotOrders').withIndex('by_user',q=>q.eq('userId',c.userId)).take(101);if(orders.length>100)throw Error('Payment history needs pagination; no incomplete totals shown.');
 const ids=new Set(orders.filter(o=>o.state==='paid'&&o.paymentMode==='razorpay_live'&&o.paymentId&&o.verifiedAt!==undefined&&o.verifiedAt>=c.firstAt).map(o=>o.paymentId!));
 if(ids.size)b.paidUsers++;b.capturedPayments+=ids.size;b.grossInr+=ids.size*99;groups.set(source,b);
 }
 return {rows:[...groups.values()].sort((x,y)=>x.source.localeCompare(y.source)),at:Date.now(),method:'First received WhatsApp Meta ad referral ID, or entry tag when no referral is supplied. Unknown includes removed or missing tags. Existing contacts are excluded; deleted/withdrawn contacts are removed. Spend and clicks come separately from Meta. Payments are verified live captures after first contact; refunds are not deducted.'};
}});
