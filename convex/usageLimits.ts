import {ConvexError} from 'convex/values';
import type {MutationCtx} from './_generated/server';
import type {Doc} from './_generated/dataModel';
import {accessFor} from './pilotAccess';
export type LimitKind='personal_hourly'|'burst'|'shared_capacity';
export type LimitFailure={kind:'usage_limit';limits:LimitKind[];retryAt:number;checkedAt:number};
// All budgets are read and checked before any write, in the caller's single mutation.
export async function consumeAiQuota(ctx:MutationCtx,user:Doc<'users'>,firstCall:boolean){
 const now=Date.now(),access=await accessFor(ctx,user,now),personal=access.state==='active'?100:20; // trial, paid, coupon and test weeks alike (founder decision 23 Oct)
 const specs:[string,number,number,LimitKind][]=[[`user:${user._id}`,personal,3600000,'personal_hourly'],['global',500,3600000,'shared_capacity']];
 if(firstCall)specs.push([`burst:${user._id}`,10,60000,'burst']);
 const budgets=await Promise.all(specs.map(async([key,cap,window,kind])=>{const row=await ctx.db.query('quotas').withIndex('by_key',q=>q.eq('key',key)).unique();const times=(row?.times??[]).filter(t=>t>now-window).sort((a,b)=>a-b);return {key,cap,window,kind,row,times};}));
 const blocked=budgets.filter(b=>b.times.length>=b.cap);
 if(blocked.length){const failure:LimitFailure={kind:'usage_limit',limits:blocked.map(b=>b.kind),checkedAt:now,retryAt:Math.max(...blocked.map(b=>b.times[b.times.length-b.cap]+b.window))};throw new ConvexError(failure);}
 for(const b of budgets){const times=[...b.times,now];if(b.row)await ctx.db.patch(b.row._id,{times});else await ctx.db.insert('quotas',{key:b.key,times});}
}
// Convex wraps mutation errors in actions. Parse only this bounded, server-owned payload.
function validLimitFailure(f:any):f is LimitFailure{return !!f&&f.kind==='usage_limit'&&Array.isArray(f.limits)&&f.limits.length>0&&f.limits.length<=3&&f.limits.every((k:unknown)=>typeof k==='string'&&['personal_hourly','burst','shared_capacity'].includes(k))&&Number.isFinite(f.retryAt)&&Number.isFinite(f.checkedAt)&&f.retryAt>=f.checkedAt;}
export function usageLimitFailure(error:unknown):LimitFailure|null{
 let e:any=error;for(let depth=0;e&&depth<5;depth++,e=e.cause){
  // ConvexError data survives production error redaction between mutation and action.
  if(validLimitFailure(e.data))return e.data;
  const text=typeof e.message==='string'?e.message:'';const match=text.match(/INTUNE_USAGE_LIMIT:(\{[^\n]*?\})/);if(!match)continue;
  try{const f=JSON.parse(match[1]);if(validLimitFailure(f))return f;}catch{/* Malformed and unrelated errors remain failures. */}
 }
 return null;
}
export function usageLimitReply(f:LimitFailure){
 const labels:Record<LimitKind,string>={personal_hourly:'Your personal hourly AI limit has been reached.',burst:'Your temporary message burst limit has been reached.',shared_capacity:'InTune’s shared app capacity has been reached.'};
 const seconds=Math.max(1,Math.ceil((f.retryAt-f.checkedAt)/1000));const wait=seconds<60?`${seconds} second${seconds===1?'':'s'}`:`${Math.ceil(seconds/60)} minute${Math.ceil(seconds/60)===1?'':'s'}`;
 return f.limits.map(k=>labels[k]).join(' ')+` Try again in ${wait}. Nothing new from this message was saved. Your saved records and unfinished questions are unchanged.`;
}
