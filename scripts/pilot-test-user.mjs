import {spawnSync} from 'node:child_process';import {randomUUID} from 'node:crypto';
const [operation,value,...rest]=process.argv.slice(2);const deployment=rest[0];
if(!['grant','revoke','status'].includes(operation)||!value){console.error('Usage: npm run pilot:test-user -- grant|status +countrycodeNUMBER [deployment], or revoke GRANT_ID [deployment]');process.exit(1);}
const args=operation==='grant'?{phoneNumber:value,grantKey:'test-'+randomUUID()}:operation==='status'?{phoneNumber:value}:{id:value};
const result=spawnSync('npx',['convex','run','pilotOperator:'+operation,JSON.stringify(args),'--typecheck','disable','--codegen','disable',...(deployment?['--deployment',deployment]:[])],{stdio:'inherit'});process.exit(result.status??1);
