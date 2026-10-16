// Run bounded fictional conversations against local V4; never production.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {ConvexHttpClient} from 'convex/browser';
import {makeFunctionReference as ref} from 'convex/server';
const cfg=JSON.parse(fs.readFileSync(path.join(os.tmpdir(),'intune-conversation-lab/operator.json'),'utf8'));
if(cfg.backend!=='http://127.0.0.1:3330')throw Error('Only the private local conversation backend is allowed.');
const client=new ConvexHttpClient(cfg.backend), auth={operatorToken:cfg.operatorToken};
const args=process.argv.slice(2), resume=args.find(x=>x.startsWith('--resume='))?.slice(9);
const scenarioIds=args.filter(x=>!x.startsWith('--'));
const action=(name,body)=>client.action(ref('qaAction:'+name),{...auth,...body});
const query=(name,body={})=>client.query(ref('qaStore:'+name),{...auth,...body});
const ready=await query('list');
if(args.includes('--list')){console.log(JSON.stringify({scenarios:ready.scenarios,runs:ready.runs},null,2));process.exit(0);}
if(resume)await client.mutation(ref('qaStore:resume'),{...auth,runId:resume});
const {runId}=resume?{runId:resume}:await action('start',scenarioIds.length?{scenarioIds}:{});
console.log(JSON.stringify({runId,state:'started',evidence:'Fictional users, actual InTune AI, simulated transport/payment'}));
let final;
for(let i=0;i<24;i++){
 const result=await action('step',{runId});console.log(JSON.stringify(result));
 if(!['queued','running'].includes(result.status)){final=await query('view',{runId});break;}
}
if(!final)throw Error('Bounded runner stopped after 24 steps. Inspect the run before continuing.');
const output=path.join(os.tmpdir(),`intune-qa-${runId}.json`);
fs.writeFileSync(output,JSON.stringify(final,null,2),{mode:0o600});
console.log(JSON.stringify({runId,status:final.run.status,conversations:final.conversations.length,issues:final.issues.map(i=>({description:i.description,severity:i.severity,status:i.status})),evidenceFile:output}));
