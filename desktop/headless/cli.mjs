import fs from 'node:fs';import path from 'node:path';import {spawnSync} from 'node:child_process';
import {rpc,appRoot} from './local-state.mjs';
import {lifecycle,operation} from './lifecycle.mjs';
const argv=process.env.MYDEX_CLI_ARGUMENTS?JSON.parse(Buffer.from(process.env.MYDEX_CLI_ARGUMENTS,'base64').toString('utf8')):process.argv.slice(2);
const [command='status',argument]=argv;
try{
 if(['install','update','uninstall','start-service','stop-service'].includes(command)){
  console.log(JSON.stringify(await lifecycle(command,argument)));
 }else if(command==='operation'){console.log(JSON.stringify(operation(argument)));}else{
  const args=argument?JSON.parse(argument.startsWith('@')?fs.readFileSync(argument.slice(1),'utf8'):argument):{};
  const result=await rpc(command,args);console.log(JSON.stringify(result));
 }
}catch{console.error(JSON.stringify({error:'Mydex operation failed. Verify the service is installed and running; do not automatically retry mutations.'}));process.exitCode=1;}
