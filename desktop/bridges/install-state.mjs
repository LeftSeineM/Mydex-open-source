import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const cache=new Map();
export function inspectInstallation(recordPath,{manifestName='staged/manifest.json',exeName='claude.exe'}={}){
 if(!fs.existsSync(recordPath))return {state:'absent',installed:false,recovery:false,message:'尚未安装兼容桥'};
 try{
  const rec=JSON.parse(fs.readFileSync(recordPath,'utf8')),manifestPath=path.join(rec.bridgeRoot,manifestName),m=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
  const files=[path.join(m.appDirectory,exeName),path.join(m.appDirectory,'resources/app.asar')];
  const signature=JSON.stringify([rec.bridgeRoot,rec.phase,rec.error,rec.mode,...files.map(p=>{const s=fs.statSync(p);return [s.size,s.mtimeMs,s.ctimeMs];}),fs.statSync(manifestPath).mtimeMs]);
  const hit=cache.get(recordPath);if(hit?.signature===signature)return {...hit.result};
  const hashes=files.map(p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'));
  const installed=hashes[0]===m.modified.exe&&hashes[1]===m.modified.asar;
  const original=hashes[0]===m.original.exe&&hashes[1]===m.original.asar;
  const result={state:installed?'installed':original?'notApplied':'changed',installed,recovery:true,mode:rec.mode||'inPlace',app:m.appDirectory,copyRoot:rec.compatibilityRoot||'',sourceApp:rec.sourceApp||'',version:m.version,lastError:rec.phase==='failed'?String(rec.error||'').slice(0,600):'',message:installed?(rec.mode==='storeCopy'?'兼容副本已安装；请使用“打开 Claude 兼容版”启动，再检查接口':'桥接文件已写入；需启动原应用并验证接口'):original?'安装未生效，程序仍为原版；备份已保留，可重新安装':'程序文件已变化或安装不完整，请检查恢复记录'};
  if(cache.size>32)cache.clear();cache.set(recordPath,{signature,result});return {...result};
 }catch{return {state:'unreadable',installed:false,recovery:true,message:'安装记录或程序文件无法读取，请检查恢复记录'};}
}
