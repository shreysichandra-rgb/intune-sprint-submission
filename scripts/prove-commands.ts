import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {ConvexHttpClient} from 'convex/browser';
import {api} from '../convex/_generated/api';
import {localDate} from '../convex/rules';
const env=fs.readFileSync('.env.local','utf8');
const url=env.match(/^VITE_CONVEX_URL=(.+)$/m)![1];
const client=new ConvexHttpClient(url);
// CLI output is captured. Never print credentials, raw CLI errors, or command arguments.
function cli(args:string[]){try{return execFileSync('npx',['convex',...args],{encoding:'utf8',stdio:['pipe','pipe','pipe'],maxBuffer:2_000_000});}catch{throw new Error('A Convex test setup operation failed; no credential-bearing diagnostic was printed.');}}
function read(query:string){return JSON.parse(cli(['run','--inline-query',query]));}
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'command-proof-'));
let keyRemoved=false,quotaReplaced=false;
let keyBackup='';let quotaBackup:any[]=[];
const output:any[]=[];
function imported(table:string,rows:any[],replace=false){const file=path.join(temp,`${table}.json`);fs.writeFileSync(file,JSON.stringify(rows),{mode:0o600});cli(['import','--table',table,replace?'--replace':'--append','--yes',file]);}
try{
 keyBackup=cli(['env','get','OPENAI_API_KEY']).trim();
 if(!keyBackup) throw new Error('Expected an existing AI key for the temporary remove-and-restore proof.');
 quotaBackup=read('await ctx.db.query("quotas").take(10000)');
 assert(quotaBackup.length<10000,'Quota backup exceeded its bounded read.');
 const pair=await client.mutation(api.tracking.createTestPair,{});
 const users:any={};
 for(const label of ['A','B']) users[label]=read(`await ctx.db.query("users").withIndex("by_token",q=>q.eq("token",${JSON.stringify(pair[label])})).unique()`);
 imported('occurrences',['A','B'].map(label=>({userId:users[label]._id,jobId:users[label].jobId,trackedItem:label==='A'?'brain fog':'poor sleep',rawText:label==='A'?'Brain fog today around 9am.':'Poor sleep last night.',occurrenceDate:localDate(Date.now(),'Asia/Kolkata'),occurrenceTime:label==='A'?'09:00':null,timePrecision:label==='A'?'approximate':'date-only',messageReceivedAt:Date.now(),source:'user',status:'active',confirmationState:'confirmed',batchId:crypto.randomUUID()})));
 imported('proactiveOutputs',['A','B'].map(label=>({userId:users[label]._id,jobId:users[label].jobId,kind:'summary',status:'queued',body:`Fictional ${label==='A'?'brain fog':'poor sleep'} summary.`})));
 cli(['env','remove','OPENAI_API_KEY']);keyRemoved=true;
 const fullQuota=quotaBackup.filter(q=>q.key!=='global');
 fullQuota.push({key:'global',times:Array(60).fill(Date.now())});
 imported('quotas',fullQuota,true);quotaReplaced=true;
 const setup={aiKeyRemoved:true,configuredGlobalHourlyCap:60,aiCallsRemaining:0,zeroRemainingMethod:'Existing quota exhausted, without changing the interpretation path or configured limit.'};
 const snapshot=async(label:string)=>{
  const view=await client.query(api.tracking.getSummary,{token:pair[label]});
  const queued=read(`await ctx.db.query("proactiveOutputs").withIndex("by_user",q=>q.eq("userId",${JSON.stringify(users[label]._id)})).take(100)`);
  return {state:view.user.state,proactiveAllowed:view.user.proactiveAllowed,records:view.records,sevenDayCount:view.sevenDayCount,queuedOutputs:queued};
 };
 for(const label of ['A','B']){
  for(const input of ['Pause','Resume','Stop','What have I told you this week?','Delete my pilot data']){
   if(input==='Stop') imported('proactiveOutputs',[{userId:users[label]._id,jobId:users[label].jobId,kind:'flag',status:'queued',body:`Fictional ${label} queued flag.`}]);
   const before=await snapshot(label);
   const quotaBefore=read('await ctx.db.query("quotas").withIndex("by_key",q=>q.eq("key","global")).unique()');
   const response=await client.action(api.messages.send,{token:pair[label],messageId:crypto.randomUUID(),text:input});
   const after=await snapshot(label);
   const quotaAfter=read('await ctx.db.query("quotas").withIndex("by_key",q=>q.eq("key","global")).unique()');
   const proof={user:label,input,replyText:response.message,outcome:response.outcome,testConditions:setup,before,after,aiQuotaUnchanged:JSON.stringify(quotaBefore.times)===JSON.stringify(quotaAfter.times)};
   output.push(proof);fs.writeFileSync('output/command-route-raw.json',JSON.stringify(output,null,2)+'\n');
   assert.notEqual(response.outcome,'error');assert(proof.aiQuotaUnchanged);
   if(input==='Pause'||input==='Stop') {assert.equal(after.proactiveAllowed,false);assert(!after.queuedOutputs.some((q:any)=>q.status==='queued'));}
   if(input==='Resume') {assert.equal(after.state,'active');assert(!after.queuedOutputs.some((q:any)=>q.status==='queued'));}
   if(input==='Delete my pilot data'){assert.deepEqual(after.records,[]);assert.deepEqual(after.queuedOutputs,[]);assert.equal(after.sevenDayCount,0);assert.equal(after.state,'stopped');}
   else assert.deepEqual(after.records,before.records);
   if(input==='What have I told you this week?') assert.deepEqual(response.view.records,before.records);
  }
 }
 console.log(JSON.stringify(output,null,2));
}finally{
 // Always restore the existing provider setting and quotas, even if a test fails.
 try{if(quotaReplaced) imported('quotas',quotaBackup,true);}finally{try{if(keyRemoved) cli(['env','set','OPENAI_API_KEY',keyBackup]);}finally{keyBackup='';fs.rmSync(temp,{recursive:true,force:true});}}
}
