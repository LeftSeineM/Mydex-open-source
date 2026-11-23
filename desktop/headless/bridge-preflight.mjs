import fs from 'node:fs';import path from 'node:path';
import {prepareElectron} from '../bridges/install-electron.mjs';
import {prepareGemini} from '../bridges/install-gemini.mjs';
// Older manual bridge installations may have no current restoration record.
// Inspect structure without modifying original applications before attempting
// installation. Never overwrite an already-patched vendor bundle.
export function preflight(id,app){
 if(id==='claude')return {state:'delegate'};
 try{
  if(id==='gemini')prepareGemini(app);
  else{const exe={deepseek:'DeepSeek Harness.exe',zcode:'ZCode.exe'}[id];if(!exe)throw Error('Unsupported tool');prepareElectron(id,fs.readFileSync(path.join(app,exe)),fs.readFileSync(path.join(app,'resources/app.asar')),app,path.resolve(import.meta.dirname,'../bridges/zcode-session.cjs'),'preflight-only');}
  return {state:'supported'};
 }catch(e){
  if(/已存在兼容桥|已有兼容桥/.test(e.message))return {state:'already-patched',message:'Original application already contains a Mydex bridge. Preserve it; start the original application and verify connectivity. A matching backup is required before restoration.'};
  return {state:'unsupported',message:'Original application structure is not supported by this adapter. No files changed; diagnose and prepare a reversible patch before installing.'};
 }
}
