import {getFunctionName,makeFunctionReference as ref} from 'convex/server';
import {v} from 'convex/values';
import {internalMutation} from './_generated/server';
import {userFor} from './tracking';
import {timingSnapshot} from './timingSchema';
export function stageTimer(){
 const started=Date.now(),rows=new Map<string,any>();let duplicate=false;
 return {markDuplicate(){duplicate=true;},isDuplicate(){return duplicate;},async run<T>(stage:string,work:()=>Promise<T>,counts:{inputChars?:number,contextChars?:number,aiCalls?:number}={}):Promise<T>{const start=Date.now();let failed=0;try{const result=await work();if((result as any)?.outcome==='provider_duplicate'||stage==='runMutation:v4Store:claim'&&result==='duplicate'||stage==='runMutation:tracking:reserveDeterministic'&&result===false)duplicate=true;return result;}catch(e){failed=1;throw e;}finally{const row=rows.get(stage)??{stage,ms:0,runs:0,failed:0};row.ms+=Math.max(0,Date.now()-start);row.runs++;row.failed+=failed;for(const [key,n] of Object.entries(counts))row[key]=(row[key]??0)+n;rows.set(stage,row);}},snapshot(scope:string){return {scope,totalMs:Math.max(0,Date.now()-started),stages:[...rows.values()].slice(0,60)};}};
}
export function measuredContext<T extends {runQuery:any,runMutation:any,runAction:any}>(ctx:T,timer:ReturnType<typeof stageTimer>):T{
 const wrap=(kind:'runQuery'|'runMutation'|'runAction')=>(name:any,args:any)=>timer.run(kind+':'+getFunctionName(name),()=>ctx[kind](name,args));return {...ctx,runQuery:wrap('runQuery'),runMutation:wrap('runMutation'),runAction:wrap('runAction')};
}
export async function recordTiming(ctx:any,token:string,messageId:string,snapshot:ReturnType<ReturnType<typeof stageTimer>['snapshot']>,duplicate=false){if(duplicate)return;try{await ctx.runMutation(ref('conversationTiming:record'),{token,messageId,snapshot});}catch{/* Measurement must never replace a reply or change a save. */}}
export const record=internalMutation({args:{token:v.string(),messageId:v.string(),snapshot:timingSnapshot},returns:v.null(),handler:async(ctx,a)=>{
 if(process.env.INTUNE_DEBUG_LOGGING!=='1')return null;const u=await userFor(ctx,a.token);if(u.dataDeletedAt||u.storageWithdrawn)return null;
 const row=await ctx.db.query('conversationLog').withIndex('by_user_message',q=>q.eq('userId',u._id).eq('messageId',a.messageId).eq('direction','incoming')).unique();if(!row||row.suppressed||row.epoch!==(u.debugEpoch??0))return null;
 await ctx.db.patch(row._id,{timings:[...(row.timings??[]).filter(t=>t.scope!==a.snapshot.scope),a.snapshot].slice(-6)});return null;
}});

export const delivery=internalMutation({args:{id:v.id('whatsappReplies'),snapshot:timingSnapshot},returns:v.null(),handler:async(ctx,a)=>{const reply=await ctx.db.get(a.id);if(!reply)return null;const u=await ctx.db.get(reply.userId);if(!u||u.dataDeletedAt||u.storageWithdrawn)return null;const row=await ctx.db.query('conversationLog').withIndex('by_user_message',q=>q.eq('userId',u._id).eq('messageId',reply.messageId).eq('direction','outgoing')).unique();if(row&&row.epoch===(u.debugEpoch??0))await ctx.db.patch(row._id,{timings:[...(row.timings??[]).filter(t=>t.scope!==a.snapshot.scope),a.snapshot].slice(-6)});return null;}});
