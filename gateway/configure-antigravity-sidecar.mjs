import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const executable = process.argv[2];
if (!path.isAbsolute(executable ?? '') || !fs.statSync(executable).isFile()) {
  throw Error('Supply the absolute path to the installed Antigravity language server');
}
const configRoot = path.join(os.homedir(),'.gemini/config');
const sidecar = path.join(configRoot,'sidecars/mydex');
const configFile = path.join(configRoot,'config.json');
const config = fs.existsSync(configFile) ? JSON.parse(fs.readFileSync(configFile,'utf8')) : {};
if (!config || typeof config !== 'object' || Array.isArray(config) || (config.sidecars && (typeof config.sidecars !== 'object' || Array.isArray(config.sidecars)))) throw Error('Unsupported Antigravity configuration');
const definition = path.join(sidecar,'sidecar.json');
const script = fileURLToPath(new URL('./antigravity-sidecar.mjs',import.meta.url));
if (fs.existsSync(definition)) {
  const existing = JSON.parse(fs.readFileSync(definition,'utf8'));
  if (config.sidecars?.mydex?.enabled && existing.command === process.execPath && existing.args?.[0] === script && existing.args?.[1] === executable) {
    console.log('Mydex sidecar already configured');
    process.exit(0);
  }
}
if (fs.existsSync(definition) || config.sidecars?.mydex) throw Error('A different Mydex sidecar is already configured; review it before replacing');
fs.mkdirSync(sidecar,{recursive:true,mode:0o700});
fs.writeFileSync(definition,JSON.stringify({display_name:'Mydex 原会话连接',command:process.execPath,args:[script,executable],restart_policy:'on-failure'},null,2),{flag:'wx',mode:0o600});
const backup = `${configFile}.before-mydex-${Date.now()}`;
if (fs.existsSync(configFile)) fs.copyFileSync(configFile,backup,fs.constants.COPYFILE_EXCL);
config.sidecars = {...(config.sidecars ?? {}),mydex:{enabled:true}};
const temporary = `${configFile}.mydex-${process.pid}`;
fs.writeFileSync(temporary,JSON.stringify(config,null,2),{flag:'wx',mode:0o600});
fs.renameSync(temporary,configFile);
console.log('Mydex sidecar configured');
