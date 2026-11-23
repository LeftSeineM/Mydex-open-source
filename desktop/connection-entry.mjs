import fs from 'node:fs';import path from 'node:path';import readline from 'node:readline';
import {fileURLToPath} from 'node:url';
import {SharedDesktopClient} from './headless/desktop-client.mjs';

const appRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const data=path.resolve(process.env.MYDEX_DATA_DIR||path.join(appRoot,'data'));
const control=path.join(data,'agent-control');
// A registered shared profile must not silently become a standalone gateway
// when its owner is restarting. Stale/missing descriptors are shown as errors.
if(!fs.existsSync(control)){
 await import('./gui-bridge.mjs');
}else{
 const profileFile=path.join(data,'desktop-profile.json');
 const profile=fs.existsSync(profileFile)?JSON.parse(fs.readFileSync(profileFile,'utf8')):{root:data};
 const client=new SharedDesktopClient({directory:control,configPath:path.join(profile.root,'gateway/private/config.json')});
 let updater;
 async function updateController(){
  if(!updater){
   const {DesktopServiceUpdate}=await import('./headless/desktop-update.mjs');
   const {lifecycle,operation}=await import('./headless/lifecycle.mjs');
   updater=new DesktopServiceUpdate({root:process.env.MYDEX_INSTALL_ROOT,dataRoot:data,launch:lifecycle,receipt:operation});
  }
  return updater;
 }
 async function execute(message){
  const args=message.args??{};
  if(message.action==='inspectServiceUpdate')return (await updateController()).inspect(args.directory);
  if(message.action==='installServiceUpdate')return (await updateController()).install();
  if(message.action==='serviceUpdateOperation')return (await updateController()).status(args.id);
  if(message.action==='checkUpdate')return {phase:'private',message:'共享后台使用签名私测包更新；点击“安装私测后台更新”。'};
  const result=await client.call(message.action,args);
  if(message.action==='status')result.update={current:result.agentVersion,phase:'private',message:'共享后台使用签名私测包更新；现有配置与配对保留。'};
  return result;
 }
 let queue=Promise.resolve();
 readline.createInterface({input:process.stdin}).on('line',line=>{
  queue=queue.then(async()=>{
   let message;
   try{
    if(Buffer.byteLength(line)>65536)throw Error('窗口请求过大');
    message=JSON.parse(line);
    const result=await execute(message);
    process.stdout.write(JSON.stringify({id:message.id,result})+'\n');
   }catch(error){process.stdout.write(JSON.stringify({id:message?.id,error:error.message})+'\n');}
  });
 }).on('close',()=>{void queue.finally(()=>client.close());});
}
