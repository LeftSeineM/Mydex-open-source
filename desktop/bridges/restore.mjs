import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {assertClaudeClosed} from './install-claude.mjs';
import {removeStoreCopy} from './claude-store.mjs';
import {inspectInstallation} from './install-state.mjs';

const record=()=>path.join(os.homedir(),'.mydex','desktop-bridges','claude-install.json');
export function claudeInstallationState(){const pending=path.join(path.dirname(record()),'claude-store-pending.json');if(fs.existsSync(pending)){try{const r=JSON.parse(fs.readFileSync(pending,'utf8'));return {state:'copyIncomplete',installed:false,recovery:true,mode:'storeCopy',app:path.join(r.compatibilityRoot,'app'),copyRoot:r.compatibilityRoot,lastError:r.error||'',message:'副本安装未完成，可一键回退清理；原程序与历史数据保留'};}catch{}}return inspectInstallation(record());}
export function claudeCompatibilityInstalled(){return claudeInstallationState().installed;}
export async function restoreClaude({ensureClosed=assertClaudeClosed,recordPath=record()}={}){
 const pending=path.join(path.dirname(recordPath),'claude-store-pending.json');if(fs.existsSync(pending)){const result=await removeStoreCopy({recordPath:pending,ensureClosed});if(fs.existsSync(recordPath)){const prior=JSON.parse(fs.readFileSync(recordPath));if(prior.mode==='storeCopy'&&!fs.existsSync(prior.compatibilityRoot))fs.renameSync(recordPath,recordPath+'.removed-'+Date.now());}return result;}
 if(!fs.existsSync(recordPath))throw new Error('本机没有可还原的 Claude 兼容补丁');
 const install=JSON.parse(fs.readFileSync(recordPath,'utf8'));
 if(install.mode==='storeCopy')return removeStoreCopy({recordPath,ensureClosed});
 const manifest=JSON.parse(fs.readFileSync(path.join(install.bridgeRoot,'staged','manifest.json'),'utf8'));
 const app=path.resolve(manifest.appDirectory),backup=path.join(install.bridgeRoot,'original');
 await ensureClosed(app);
 const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
 for(const [name,key,destination] of [['claude.exe','exe',path.join(app,'claude.exe')],['app.asar','asar',path.join(app,'resources','app.asar')]]){
  if(hash(path.join(backup,name))!==manifest.original[key])throw new Error('原版备份校验失败，未还原');
  if(![manifest.original[key],manifest.modified[key]].includes(hash(destination)))throw new Error('Claude 文件已被其他更新修改，请勿覆盖');
 }
 fs.copyFileSync(path.join(backup,'app.asar'),path.join(app,'resources','app.asar'));
 fs.copyFileSync(path.join(backup,'claude.exe'),path.join(app,'claude.exe'));
 // Do not alter Claude's update settings.
 fs.renameSync(recordPath,recordPath+'.restored-'+Date.now());
 return {ok:true};
}
