import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
let currentStartedAt;

export function processStartedAt(pid) {
  if(pid===process.pid&&currentStartedAt!==undefined)return currentStartedAt;
  if(process.platform==='win32') {
    const script=`(Get-Process -Id ${pid} -ErrorAction Stop).StartTime.ToUniversalTime().ToString('o')`;
    const output=execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],
      {windowsHide:true,encoding:'utf8',timeout:5000,stdio:['ignore','pipe','ignore']});
    const time=Date.parse(output.trim());
    if(pid===process.pid&&Number.isFinite(time))currentStartedAt=time;
    return Number.isFinite(time)?time:null;
  }
  // lstart has one-second precision; uncertainty remains locked, never guessed.
  const output=execFileSync('ps',['-p',String(pid),'-o','lstart='],{encoding:'utf8',timeout:3000,stdio:['ignore','pipe','ignore']});
  const time=Date.parse(output.trim());
  if(pid===process.pid&&Number.isFinite(time))currentStartedAt=time;
  return Number.isFinite(time)?time:null;
}

// A surviving PID alone is not ownership: Windows reuses PIDs after exit.
// If its current process was born after this claim, it cannot own the claim.
export function processOwnsLock(pid,file,{alive=p=>process.kill(p,0),startedAt=processStartedAt,mtime=()=>fs.statSync(file).mtimeMs}={}) {
  if(!Number.isSafeInteger(pid)||pid<=0)throw Error('Invalid process lock; inspect before recovery');
  try{alive(pid);}catch(e){if(e.code==='ESRCH')return false;throw e;}
  try{const start=startedAt(pid);return !Number.isFinite(start)||start<=mtime();}
  catch{return true;} // Permission/query failure is not proof the owner exited.
}
