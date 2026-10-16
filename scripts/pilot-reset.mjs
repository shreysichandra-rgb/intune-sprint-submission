import {readFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {ConvexHttpClient} from 'convex/browser';
import {makeFunctionReference} from 'convex/server';
const input=process.argv[2]??'';
const phoneNumber=/^[6-9]\d{9}$/.test(input)?'+91'+input:input;
if(!/^\+[1-9]\d{7,14}$/.test(phoneNumber)){console.error('Usage: npm run pilot:reset -- PHONE_NUMBER');process.exit(1);}
try{
 const target='graceful-ptarmigan-19';
 const login=JSON.parse(readFileSync(homedir()+'/.convex/config.json','utf8')).accessToken;
 if(!login)throw Error('Sign in to Convex with npx convex login first.');
 const response=await fetch('https://api.convex.dev/api/deployment/authorize_within_current_project',{method:'POST',headers:{Authorization:'Bearer '+login,'Content-Type':'application/json'},body:JSON.stringify({selectedDeploymentName:target,projectSelection:{kind:'deploymentName',deploymentName:target,deploymentType:null}})});
 if(!response.ok)throw Error('Your Convex login cannot manage the existing live deployment.');
 const credentials=await response.json();
 if(credentials.url!=='https://'+target+'.convex.cloud')throw Error('Unexpected deployment. Reset stopped.');
 const client=new ConvexHttpClient(credentials.url);client.setAdminAuth(credentials.adminKey);
 await client.mutation(makeFunctionReference(process.argv.includes('--fresh')?'pilotTestArchive:fresh':'pilotOperator:resetTestAccount'),{phoneNumber,resetKey:'test-reset:'+randomUUID()});
 if(process.argv.includes('--fresh'))console.log('Old test memory archived out of the active account. Start a new WhatsApp conversation with Hello.');
 console.log('Payment and onboarding reset on the existing live app. Old records and payment proof retained. No refund or quota reset. In WhatsApp, send Hello, or Start if you previously stopped contact.');
}catch(error){console.error(error instanceof Error?error.message:'Reset failed. No success was confirmed.');process.exit(1);}
