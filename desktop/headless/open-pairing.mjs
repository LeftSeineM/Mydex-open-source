import {execFile} from 'node:child_process';import {promisify} from 'node:util';
export async function openPairing(file){
 const run=promisify(execFile);
 try{
  if(process.platform==='win32'){
   const ps="Start-Process -FilePath '"+file.replaceAll("'","''")+"'";
   await run('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(ps,'utf16le').toString('base64')],{windowsHide:true,timeout:10000});
  }else await run(process.platform==='darwin'?'open':'xdg-open',[file],{windowsHide:true,timeout:10000});
  return {opened:true};
 }catch{return {opened:false,localFile:file,instruction:'Open this temporary local HTML file in a browser on this computer; do not publish it.'};}
}
