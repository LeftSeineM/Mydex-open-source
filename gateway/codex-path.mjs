import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// The official Windows app replaces versioned CLI folders during upgrades.
// Repair only empty/expired official paths; preserve explicit custom commands.
export function resolveCodexExecutable(configured,{home=os.homedir(),platform=process.platform}={}){
 if(platform!=='win32'||configured&&fs.existsSync(configured))return configured;
 const root=path.join(home,'AppData','Local','OpenAI','Codex','bin');
 if(configured&&(!path.resolve(configured).toLowerCase().startsWith(path.resolve(root).toLowerCase()+path.sep)||path.basename(configured).toLowerCase()!=='codex.exe'))return configured;
 try{return fs.readdirSync(root).map(n=>path.join(root,n,'codex.exe')).filter(p=>{try{return fs.statSync(p).isFile();}catch{return false;}}).sort((a,b)=>fs.statSync(b).mtimeMs-fs.statSync(a).mtimeMs)[0]||configured;}catch{return configured;}
}
