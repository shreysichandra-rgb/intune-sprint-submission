import type {MutationCtx,QueryCtx} from './_generated/server';
import type {Doc} from './_generated/dataModel';
import type {Operation} from './conversationProtocol';
import {assertPilotWrite} from './pilotAccess';
import {memoryChanged} from './tracking';
export async function readExperiences(ctx:QueryCtx|MutationCtx,u:Doc<'users'>){const rows=await ctx.db.query('pilotExperiences').withIndex('by_user',q=>q.eq('userId',u._id)).order('desc').take(101);if(rows.length>100)throw Error('Experience history requires review');return rows;}
export async function applyExperience(ctx:MutationCtx,u:Doc<'users'>,op:Operation,receivedAt:number,quotedIds:string[]=[]){
 if(op.k!=='experience'&&op.k!=='experience_correct')return null;
 const rows=await readExperiences(ctx,u);
 if(op.k==='experience_correct'){
  const row=rows.find(r=>r._id===op.target);if(!row)return {message:'Which saved health experience should I correct?',question:'Which saved health experience should I correct?',mode:'target',changedIds:[]};
  await assertPilotWrite(ctx,u,row._id);await ctx.db.patch(row._id,{text:op.replacement,updatedAt:Date.now()});await memoryChanged(ctx,u._id);return {message:`Corrected your saved ${row.label} details.`,changedIds:[row._id]};
 }
 await assertPilotWrite(ctx,u);
 const label=op.l.replace(/^I (?:have been experiencing|have been having|am experiencing|experience|get|have|had)\s+/i,'').trim();
 const key=(l:string)=>l.replace(/^I (?:have been experiencing|have been having|am experiencing|experience|get|have|had)\s+/i,'').trim().toLowerCase();
 const exact=rows.filter(r=>r.kind===op.kind&&key(r.label)===key(label));
 const prefix=rows.filter(r=>r.kind===op.kind&&key(label).startsWith(key(r.label)+' '));
 const explicit=op.target?rows.find(r=>r._id===op.target&&r.kind===op.kind):null;
 if(op.target&&!explicit)throw Error('Unavailable private experience');
 if(explicit&&!quotedIds.includes(explicit._id)&&!(op.e??op.q).toLowerCase().includes(key(explicit.label)))return {message:'I haven’t added that to an unrelated experience.',question:'Which saved health experience is this about?',mode:'target',changedIds:[],choices:rows.filter(r=>r.kind===op.kind).map(r=>({id:r._id,label:r.label}))};
 const selected=rows.filter(r=>r.kind===op.kind&&quotedIds.includes(r._id)&&(key(label)===key(r.label)||key(label).startsWith(key(r.label)+' ')||(op.e??op.q).toLowerCase().includes(key(r.label))));
 if(explicit&&selected.length&& !selected.some(r=>r._id===explicit._id))throw Error('Unavailable private reference');
 const matches=selected.length?selected:exact.length?exact:prefix;
 if(!explicit&&matches.length>1)return {message:'I haven’t guessed which experience to update.',question:'Which saved health experience is this about?',mode:'target',changedIds:[],choices:matches.map(r=>({id:r._id,label:r.label}))};
 const same=explicit??matches[0];
 const savedLabel=same?key(same.label):label;
 if(same&&same.text.split('\n').some(t=>t.toLowerCase()===op.q.toLowerCase())&&same.status===op.status)return {message:`Your ${op.l} details are already saved.`,changedIds:[]};
 if(!same&&rows.length>=100)throw Error('Experience history requires review');
 const id=same? same._id:await ctx.db.insert('pilotExperiences',{userId:u._id,jobId:u.jobId,kind:op.kind,label,text:op.q,status:op.status,reportedAt:receivedAt,updatedAt:Date.now()});
 if(same){const text=same.text+'\n'+op.q;if(text.length>2000)throw Error('Experience detail limit reached');await ctx.db.patch(same._id,{label:savedLabel,text,status:op.status,updatedAt:Date.now()});}
 await memoryChanged(ctx,u._id);return {message:`Kept ${savedLabel} as ${op.status==='historical'?'reported history':'an ongoing experience'}, without counting an episode.`,changedIds:[id]};
}
