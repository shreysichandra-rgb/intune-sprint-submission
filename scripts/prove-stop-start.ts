import fs from 'node:fs';
import assert from 'node:assert/strict';
import {ConvexHttpClient} from 'convex/browser';
import {api} from '../convex/_generated/api';
const url=fs.readFileSync('.env.local','utf8').match(/^VITE_CONVEX_URL=(.+)$/m)![1];
const client=new ConvexHttpClient(url);
const pair=await client.mutation(api.tracking.createTestPair,{});
const rows:any[]=[];
for(const input of ['Brain fog today','Stop','Brain fog today','Start','Brain fog today']){
 const before=await client.query(api.tracking.getSummary,{token:pair.A});
 const response=await client.action(api.messages.send,{token:pair.A,messageId:crypto.randomUUID(),text:input});
 const after=await client.query(api.tracking.getSummary,{token:pair.A});
 rows.push({input,replyText:response.message,receivedTime:response.messageReceivedAt,before:{state:before.user.state,jobId:before.user.jobId,records:before.records,sevenDayCount:before.sevenDayCount},after:{state:after.user.state,jobId:after.user.jobId,records:after.records,sevenDayCount:after.sevenDayCount,totalStored:after.totalStored},serverResponse:response});
 assert.notEqual(response.outcome,'error');
}
assert.equal(rows[2].after.sevenDayCount,1);assert.deepEqual(rows[2].after.records,rows[1].after.records);
assert.notEqual(rows[3].after.jobId,rows[2].after.jobId);assert.equal(rows[4].after.sevenDayCount,1);assert.equal(rows[4].after.totalStored,2);assert.equal(rows[4].serverResponse.outcome,'stored');
fs.writeFileSync('output/stop-start-live-raw.json',JSON.stringify(rows,null,2)+'\n');
// Only synthetic capability tokens; keep outside the repository for the browser check.
fs.writeFileSync('/tmp/keeper-stop-start-pair.json',JSON.stringify(pair));
console.log(JSON.stringify(rows,null,2));
