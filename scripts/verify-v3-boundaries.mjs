import {ConvexHttpClient} from 'convex/browser';import {makeFunctionReference as ref} from 'convex/server';
// No administrator credentials. Verify local HTTP and private-operator boundaries.
const client=new ConvexHttpClient('http://127.0.0.1:3320');
let rejected=false;try{await client.mutation(ref('pilotOperator:grant'),{phoneNumber:'+12025550198',grantKey:'unauthorised-smoke'});}catch{rejected=true;}if(!rejected)throw Error('Operator grant was public');
for(const [path,body,headers] of [['/payments/razorpay/webhook','{}',{'x-razorpay-signature':'0'.repeat(64),'x-razorpay-event-id':'synthetic-invalid'}],['/payments/checkout',JSON.stringify({link:'0'.repeat(64)}),{}]]){const r=await fetch('http://127.0.0.1:3321'+path,{method:'POST',headers:{'Content-Type':'application/json',...headers},body});if(r.status!==400)throw Error('Invalid payment input was accepted');}
console.log('PASS: public operator grant rejected, invalid payment signature and guessed checkout link rejected by actual local backend');
