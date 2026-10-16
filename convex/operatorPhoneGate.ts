// Test deployment only; production routing is unchanged. A missing/expired lease
// rejects both incoming messages and outbound sends before touching another user.
// An explicitly enabled private cohort admits at most five exact phones.
// It grants no paid access: consent, activation, expiry and controls stay independent.
export function operatorPhonePermitted(phone:string,env:Record<string,string|undefined>=process.env,now=Date.now()):boolean {
 const test=env.CONVEX_CLOUD_URL==='https://disciplined-mammoth-312.convex.cloud'||env.CONVEX_SITE_URL==='https://disciplined-mammoth-312.convex.site';
 if(!test||env.INTUNE_SYNTHETIC_TRANSPORT==='1')return true;
 if(env.INTUNE_CONVERSATION_GATE==='candidate'&&env.INTUNE_PILOT_COHORT_ENABLED==='1'){
  try{const phones:unknown=JSON.parse(env.INTUNE_PILOT_COHORT_PHONES??'null');
   if(Array.isArray(phones)&&phones.length>0&&phones.length<=5&&new Set(phones).size===phones.length&&phones.every(p=>typeof p==='string'&&/^\+[1-9]\d{7,14}$/.test(p))&&phones.includes(phone))return true;
  }catch{/* Invalid configuration never admits an additional recipient. */}
 }
 const expires=Number(env.INTUNE_OPERATOR_PHONE_EXPIRES);
 return env.INTUNE_CONVERSATION_GATE==='candidate'&&/^\+[1-9]\d{7,14}$/.test(env.INTUNE_OPERATOR_PHONE??'')&&phone===env.INTUNE_OPERATOR_PHONE&&Number.isFinite(expires)&&now<expires&&expires-now<=3600000;
}
