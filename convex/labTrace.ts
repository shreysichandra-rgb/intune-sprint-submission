import {makeFunctionReference as ref} from 'convex/server';
import {labEnabled} from './labAuth';
export function instrumentLabAgent<T extends {generateObject:any}>(agent:T,ctx:any,args:{token:string;messageId:string},stage:string,instructions:string):T{
 if(!labEnabled()||!args.token.startsWith('lab-'))return agent;
 return new Proxy(agent,{get(target,key){if(key!=='generateObject')return Reflect.get(target,key);return async(...a:any[])=>{const input=a[2]?.prompt??'',started=Date.now(),id=await ctx.runMutation(ref('labStore:reserveCall'),{token:args.token,messageId:args.messageId,stage,input,instructions});try{const result=await target.generateObject(...a);await ctx.runMutation(ref('labStore:finishCall'),{id,output:result.object,usage:result.usage??null,ms:Date.now()-started});return result;}catch(error){await ctx.runMutation(ref('labStore:finishCall'),{id,error:'Model request failed; see the action outcome.',ms:Date.now()-started});throw error;}};}});
}
