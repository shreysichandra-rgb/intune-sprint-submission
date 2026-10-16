import fs from 'node:fs';
import assert from 'node:assert/strict';
import { ConvexHttpClient } from 'convex/browser';
import { api } from '../convex/_generated/api';
const env = fs.readFileSync('.env.local','utf8');
const url = env.match(/^VITE_CONVEX_URL=(.+)$/m)?.[1] || env.match(/^CONVEX_URL=(.+)$/m)?.[1];
if (!url) throw new Error('Missing public Convex URL.');
const client = new ConvexHttpClient(url);
const pair = await client.mutation(api.tracking.createTestPair,{});
const output: any[] = [];
async function send(user:'A'|'B', input:string, targetId?:any, messageId=crypto.randomUUID()) {
  return client.action(api.messages.send,{token:pair[user],text:input,messageId,...(targetId?{targetId}:{})});
}
async function capture(name:string,user:'A'|'B',input:string,response:any) {
  const view = await client.query(api.tracking.getSummary,{token:pair[user]});
  const raw={case:name,user,input,storedRecord:view.records,sevenDayCount:view.sevenDayCount,totalStored:view.totalStored,rawResponse:response};
  output.push(raw); console.log(JSON.stringify(raw,null,2));
  fs.writeFileSync('output/slice-1-raw-output.json',JSON.stringify(output,null,2)+'\n');
  if(response.outcome==='error') throw new Error(response.message);
  return view;
}
const normalInput='Brain fog today around 9am.';
const normalId=crypto.randomUUID();
const normal=await send('A',normalInput,undefined,normalId);
let view=await capture('1. Normal message','A',normalInput,normal); assert.equal(view.sevenDayCount,1);
const twiceInput='Brain fog twice yesterday.';
const twice=await send('A',twiceInput);
view=await capture('2. Twice yesterday','A',twiceInput,twice); assert.equal(view.sevenDayCount,3);
const repeat=await send('A',normalInput);
view=await capture('3. Same text sent again with a new message ID','A',normalInput,repeat);assert.equal(repeat.outcome,'possible_duplicate');assert.equal(view.sevenDayCount,3);
const providerRepeat=await send('A',normalInput,undefined,normalId);
view=await capture('3b. Same provider message ID delivered twice','A',normalInput,providerRepeat);assert.equal(providerRepeat.outcome,'provider_duplicate');assert.equal(view.sevenDayCount,3);
const correctionInput='Actually one of those was 8 days ago.';
const correction=await send('A',correctionInput,twice.changedIds[0]);
view=await capture('4. Correction moves one occurrence outside window','A',correctionInput,correction);assert.equal(view.totalStored,3);assert.equal(view.sevenDayCount,2);
const futureInput='Brain fog at 4pm.';
const future=await send('A',futureInput);
view=await capture('5. Time-only message received at 10am, before 4pm','A',futureInput,future);assert.equal(future.outcome,'clarification');assert.equal(view.sevenDayCount,2);
const summaryInput='What have I told you this week?';
const b=await send('B',summaryInput);
view=await capture('6. User B requests summary while A has records','B',summaryInput,b);assert.equal(view.totalStored,0);assert.equal(view.sevenDayCount,0);assert.deepEqual(view.records,[]);
const referenceInput='Same episode I mentioned earlier.';
const reference=await send('A',referenceInput,normal.changedIds[0]);
view=await capture('7. Explicit reference to selected earlier occurrence','A',referenceInput,reference);assert.equal(view.totalStored,3);assert.equal(view.sevenDayCount,2);
const unresolved=await send('A',referenceInput);
view=await capture('8. Ambiguous reference remains unresolved','A',referenceInput,unresolved);assert.equal(unresolved.outcome,'clarification');assert.equal(view.sevenDayCount,2);
// Forget is a code operation, never a model instruction or a soft-deletion flag.
const forgotten=await client.mutation(api.tracking.forget,{token:pair.A,occurrenceId:normal.changedIds[0]});
view=await capture('9. Forget this erases an occurrence and linked copied text','A','Forget this (selected normal occurrence)',forgotten);assert.equal(view.totalStored,2);assert.equal(view.sevenDayCount,1);assert(!view.records.some((r:any)=>r._id===normal.changedIds[0]));
console.log('All requested live AI cases passed. Full raw output: output/slice-1-raw-output.json');
