'use node';
import {v} from 'convex/values';
import {makeFunctionReference} from 'convex/server';
import {internalAction} from './_generated/server';
// Hold actual model results in action memory only, solely in a synthetic deployment.
export const wait=internalAction({args:{token:v.string(),messageId:v.string()},returns:v.null(),handler:async(ctx,a)=>{if(process.env.INTUNE_SYNTHETIC_TRANSPORT!=='1')return null;const id=await ctx.runMutation(makeFunctionReference<'mutation'>('verificationTransport:checkpoint'),a);if(!id)return null;for(let n=0;n<150;n++){if(!await ctx.runQuery(makeFunctionReference<'query'>('verificationTransport:waiting'),{id}))return null;await new Promise(r=>setTimeout(r,200));}throw new Error('Synthetic barrier timed out');}});
