import {readFileSync,writeFileSync} from 'node:fs';
import {randomUUID,createHmac} from 'node:crypto';
import {ConvexHttpClient} from 'convex/browser';
import {makeFunctionReference as ref} from 'convex/server';
// Local candidate only. Admin credentials never appear in output or evidence.
const config=JSON.parse(readFileSync('.convex/local/default/config.json','utf8'));
if(config.ports.cloud!==3320||config.ports.site!==3321)throw Error('Expected isolated local candidate');
const client=new ConvexHttpClient('http://127.0.0.1:3320');client.setAdminAuth(config.adminKey);
const q=(name,args)=>client.query(ref(name),args),m=(name,args)=>client.mutation(ref(name),args),a=(name,args)=>client.action(ref(name),args);
const privateEnv=Object.fromEntries(readFileSync('/private/tmp/v3-private.env','utf8').split('\n').filter(Boolean).map(line=>{const n=line.indexOf('=');return [line.slice(0,n),line.slice(n+1)];}));
const phone=process.env.V3_TEST_PHONE??'+12025550175';if(!/^\+120255501\d{2}$/.test(phone))throw Error('Reserved synthetic phone required');const token=await m('phoneUsers:getOrCreate',{phoneNumber:phone});
const prior=await q('pilotMemory:overview',{token});if(prior.items.length||prior.name)throw Error('Choose a fresh synthetic phone; never pass using old records');
const status=await q('pilotAccess:status',{token});if(['active','eligible'].includes(status.state)&&status.source==='operator_test')await m('pilotAccess:revokeTest',{id:status.id});
await m('pilotAccess:grantTest',{token,grantKey:'connected-'+randomUUID()});
let welcome;for(let n=0;n<20;n++){welcome=await q('pilotOperator:status',{phoneNumber:phone});if(welcome.welcomeMessageId)break;await new Promise(r=>setTimeout(r,250));}
if(!welcome?.welcomeMessageId)throw Error('Synthetic welcome not accepted');
const raw=JSON.stringify({object:'whatsapp_business_account',entry:[{changes:[{field:'messages',value:{metadata:{phone_number_id:'123'},statuses:[{id:welcome.welcomeMessageId,status:'delivered',recipient_id:phone.slice(1),timestamp:String(Math.floor(Date.now()/1000))}]}}]}]});
const delivered=await fetch('http://127.0.0.1:3321/whatsapp/webhook',{method:'POST',headers:{'X-Hub-Signature-256':'sha256='+createHmac('sha256',privateEnv.WHATSAPP_APP_SECRET).update(raw).digest('hex')},body:raw});
if(delivered.status!==200||(await q('pilotAccess:status',{token})).state!=='active')throw Error('Signed synthetic welcome delivery did not activate');
const evidence={backend:'actual local Convex',interpretation:'actual OpenAI gpt-6-luna',whatsapp:'synthetic transport, authenticated mock delivery status',razorpay:'order creation checked separately; no payment claimed',steps:[]};
console.log('PASS: signed synthetic welcome delivered and exact access clock active');
async function send(text){const result=await a('messages:send',{token,messageId:'connected-'+randomUUID(),text});evidence.steps.push({text,outcome:result.outcome,message:result.message,failure:result.failure??null});console.log('Interpretation:',result.outcome);if(['error','dropped'].includes(result.outcome))throw Error('Actual-model interpretation failed; inspect synthetic evidence');return result;}
try{
 await send('My name is Maya');if((await q('pilotMemory:overview',{token})).name!=='Maya')throw Error('Preferred name was not correctly saved');await send('yes');
 await send('My existing plan is strength training 3 times this week');await send('yes');
 await send('My existing plan is brainstorming 2 times this week');await send('yes');
 const overview=await q('pilotMemory:overview',{token});if(overview.items.filter(i=>i.kind==='plan').length<2)throw Error('Independent plans not saved');
 await send('My existing food plan: oats with yoghurt. Please make a grocery list');await send('yes');
 const after=await q('pilotMemory:overview',{token});if(!after.items.some(i=>i.kind==='grocery'&&/oats/i.test(i.title)))throw Error('Groceries not saved');
 const retrieval=await send('What all are you keeping track of for me?');if(!retrieval.message.includes('strength training')||!retrieval.message.includes('brainstorming'))throw Error('Complete retrieval missing plans');
 evidence.pass=true;console.log('PASS: actual OpenAI name, consent, two plans, food/grocery and complete retrieval');
}catch(error){evidence.pass=false;evidence.error=error.message;console.log('FAIL:',error.message);process.exitCode=1;}
finally{writeFileSync('handoff/V3-ACTUAL-MODEL.json',JSON.stringify(evidence,null,2)+'\n');}
