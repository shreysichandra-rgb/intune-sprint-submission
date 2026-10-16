import {allUsersEnabled} from './conversationRollout';
import {memoryChanged} from './tracking';
import * as copy from './copy';
import {v} from 'convex/values';
import {internalMutation} from './_generated/server';
import {localDate,shiftDate} from './rules';
export const getOrCreate=internalMutation({args:{phoneNumber:v.string()},returns:v.string(),handler:async(ctx,args)=>{
 if(!/^\+[1-9]\d{7,14}$/.test(args.phoneNumber))throw new Error(copy.phoneUsers_Invalid_phone_number);
 const user=await ctx.db.query('users').withIndex('by_phone',q=>q.eq('phoneNumber',args.phoneNumber)).unique();
 if(user){if(allUsersEnabled()&&!user.dataDeletedAt&&user.conversationEnabled!==true){await ctx.db.patch(user._id,{conversationEnabled:true});await memoryChanged(ctx,user._id);}return user.token;}
 // Real phone users start without any assumed body changes; synthetic web fixtures stay separate.
 const token=crypto.randomUUID()+crypto.randomUUID();
 const timezone='Asia/Kolkata';const endDate=localDate(Date.now(),timezone);
 await ctx.db.insert('users',{...(allUsersEnabled()?{conversationEnabled:true}:{}),phoneNumber:args.phoneNumber,token,label:'WhatsApp user',jobId:crypto.randomUUID(),timezone,startDate:shiftDate(endDate,-6),endDate,trackedItems:[]});
 return token;
}});
