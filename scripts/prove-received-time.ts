import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {ConvexHttpClient} from 'convex/browser';
import {api} from '../convex/_generated/api';
import {localDate,shiftDate} from '../convex/rules';
const url=fs.readFileSync('.env.local','utf8').match(/^VITE_CONVEX_URL=(.+)$/m)![1];
const client=new ConvexHttpClient(url);
function cli(args:string[]){try{return execFileSync('npx',['convex',...args],{encoding:'utf8',stdio:['pipe','pipe','pipe'],maxBuffer:2_000_000});}catch{throw new Error('Convex proof setup failed. Credential-bearing diagnostics were suppressed.');}}
function read(query:string){return JSON.parse(cli(['run','--inline-query',query]));}
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'received-time-proof-'));
function imported(table:string,rows:any[],replace=false){const file=path.join(temporary,`${table}.json`);fs.writeFileSync(file,JSON.stringify(rows),{mode:0o600});cli(['import','--table',table,replace?'--replace':'--append','--yes',file]);}
const output:any[]=[];
function emit(row:any){output.push(row);fs.writeFileSync('output/received-time-raw.json',JSON.stringify(output,null,2)+'\n');}
async function send(pair:any,user:'A'|'B',input:string,targetId?:any){const response=await client.action(api.messages.send,{token:pair[user],messageId:crypto.randomUUID(),text:input,...(targetId?{targetId}:{})});assert.notEqual(response.outcome,'error',response.message);return response;}
function row(name:string,user:string,input:string,response:any){return {case:name,user,input,messageReceivedAt:response.messageReceivedAt,receivedTimeUTC:new Date(response.messageReceivedAt).toISOString(),timezone:response.view.user.timezone,resolvedDates:response.changedIds?.map((id:string)=>response.view.records.find((r:any)=>r._id===id)?.occurrenceDate)??[],replyText:response.message,outcome:response.outcome,userState:response.view.user.state,storedRecords:response.view.records,pending:response.view.pending,sevenDayCount:response.view.sevenDayCount,totalStored:response.view.totalStored};}
let keyBackup='',keyRemoved=false,quotaBackup:any[]=[],quotaReplaced=false;
try{
 // Real received times; only fictional users' timezone is selected for the pre-4pm case.
 const timezone='Atlantic/Cape_Verde';const day=localDate(Date.now(),timezone);
 const localTime=new Intl.DateTimeFormat('en-GB',{timeZone:timezone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(Date.now());
 assert(localTime>='09:00'&&localTime<'16:00','Run this live before-4pm fixture in a timezone currently between 9am and 4pm.');
 const pair:any={A:crypto.randomUUID()+crypto.randomUUID(),B:crypto.randomUUID()+crypto.randomUUID()};
 imported('users',['A','B'].map(label=>({label,token:pair[label],jobId:crypto.randomUUID(),timezone,startDate:shiftDate(day,-6),endDate:day,trackedItems:['brain fog','poor sleep']})));
 let response=await send(pair,'A','Brain fog today around 9am.');emit(row('1. Normal message','A','Brain fog today around 9am.',response));assert.equal(response.view.sevenDayCount,1);
 const twice=await send(pair,'A','Brain fog twice yesterday.');emit(row('2. Twice yesterday','A','Brain fog twice yesterday.',twice));assert.equal(twice.view.sevenDayCount,3);
 response=await send(pair,'A','Brain fog today around 9am.');emit(row('3. Same message sent twice','A','Brain fog today around 9am.',response));assert.equal(response.outcome,'possible_duplicate');assert.equal(response.view.sevenDayCount,3);
 response=await send(pair,'A','Actually one of those was 8 days ago.',twice.changedIds[0]);emit(row('4. Correction outside window','A','Actually one of those was 8 days ago.',response));assert.equal(response.view.sevenDayCount,2);assert.equal(response.view.totalStored,3);
 response=await send(pair,'A','Brain fog at 4pm.');emit(row('5. Time-only before 4pm','A','Brain fog at 4pm.',response));assert.equal(response.outcome,'clarification');assert.equal(response.view.sevenDayCount,2);
 response=await send(pair,'B','What have I told you this week?');emit(row('6. B summary while A has records','B','What have I told you this week?',response));assert.equal(response.view.sevenDayCount,0);assert(!response.message.includes('brain fog'));
 const commandPair=await client.mutation(api.tracking.createTestPair,{});
 for(const user of ['A','B'] as const){const input=user==='A'?'Brain fog yesterday':'Poor sleep last night.';response=await send(commandPair,user,input);emit(row(`Command fixture ${user}`,user,input,response));assert.equal(response.view.totalStored,1);}
 keyBackup=cli(['env','get','OPENAI_API_KEY']).trim();assert(keyBackup);
 quotaBackup=read('await ctx.db.query("quotas").take(10000)');assert(quotaBackup.length<10000);
 cli(['env','remove','OPENAI_API_KEY']);keyRemoved=true;
 imported('quotas',[...quotaBackup.filter(q=>q.key!=='global'),{key:'global',times:Array(60).fill(Date.now())}],true);quotaReplaced=true;
 for(const user of ['A','B'] as const){
  for(const input of ['Pause','Resume','Stop','What have I told you this week?','Delete my pilot data']){
   const before=await client.query(api.tracking.getSummary,{token:commandPair[user]});
   const quotaBefore=read('await ctx.db.query("quotas").withIndex("by_key",q=>q.eq("key","global")).unique()');
   response=await send(commandPair,user,input);
   const quotaAfter=read('await ctx.db.query("quotas").withIndex("by_key",q=>q.eq("key","global")).unique()');
   assert.deepEqual(quotaAfter.times,quotaBefore.times);
   emit({...row(`Command ${input}`,user,input,response),before:{state:before.user.state,records:before.records,sevenDayCount:before.sevenDayCount},aiKeyRemoved:true,aiCallsRemaining:0,aiQuotaUnchanged:true});
   if(input==='Delete my pilot data') assert.deepEqual(response.view.records,[]);
   else assert.deepEqual(response.view.records,before.records);
  }
 }
 imported('quotas',quotaBackup,true);quotaReplaced=false;cli(['env','set','OPENAI_API_KEY',keyBackup]);keyRemoved=false;keyBackup='';
 // Two actual calls at distinct real server times, with separate users to avoid duplicate ambiguity.
 const realPair=await client.mutation(api.tracking.createTestPair,{});
 const a=await send(realPair,'A','Brain fog yesterday');emit(row('Real-time yesterday 1','A','Brain fog yesterday',a));
 const b=await send(realPair,'B','Brain fog yesterday');emit(row('Real-time yesterday 2','B','Brain fog yesterday',b));
 assert(b.messageReceivedAt>a.messageReceivedAt);
 for(const r of [a,b]){const stored=r.view.records[0];assert.equal(stored.messageReceivedAt,r.messageReceivedAt);assert.equal(stored.occurrenceDate,shiftDate(localDate(r.messageReceivedAt,r.view.user.timezone),-1));}
 console.log(JSON.stringify(output,null,2));
}finally{
 try{if(quotaReplaced) imported('quotas',quotaBackup,true);}finally{try{if(keyRemoved) cli(['env','set','OPENAI_API_KEY',keyBackup]);}finally{keyBackup='';fs.rmSync(temporary,{recursive:true,force:true});}}
}
