import path from 'node:path';import crypto from 'node:crypto';
const xml=s=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const unitQuote=s=>'"'+s.replaceAll('\\','\\\\').replaceAll('"','\\"').replaceAll('%','%%').replaceAll('$','$$')+'"';
const unitPath=s=>s.replaceAll('\\','\\x5c').replaceAll(' ','\\x20').replaceAll('\t','\\x09').replaceAll('%','%%');
export function serviceDefinition({root,home,platform,uid}){
 for(const value of [root,home])if(typeof value!=='string'||!path.isAbsolute(value)||/[\r\n\0]/.test(value))throw Error('Invalid service path');
 const suffix=crypto.createHash('sha256').update(root).digest('hex').slice(0,12);
 const label='dev.mydex.agent.'+suffix,launcher=path.join(root,'mydex-agent');
 if(platform==='linux'){
  const name='mydex-agent-'+suffix+'.service';
  return {kind:'systemd',label:name,file:path.join(home,'.config/systemd/user',name),
   content:`# Mydex-owned: ${root}\n[Unit]\nDescription=Mydex independent Agent\nAfter=network.target\n[Service]\nType=exec\nExecStart=${unitQuote(launcher)} service\nWorkingDirectory=${unitPath(root)}\nRestart=on-failure\nRestartSec=5\nKillMode=control-group\nTimeoutStopSec=15\n[Install]\nWantedBy=default.target\n`,
   reload:['systemctl',['--user','daemon-reload']],start:['systemctl',['--user','enable','--now',name]],stop:['systemctl',['--user','stop',name]],remove:['systemctl',['--user','disable',name]]};
 }
 if(platform==='darwin'){
  if(!Number.isSafeInteger(uid)||uid<0)throw Error('Invalid user identity');
  const file=path.join(home,'Library/LaunchAgents',label+'.plist');
  return {kind:'launchd',label,file,content:`<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>Label</key><string>${label}</string><key>ProgramArguments</key><array><string>${xml(launcher)}</string><string>service</string></array><key>WorkingDirectory</key><string>${xml(root)}</string><key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>10</integer><key>ProcessType</key><string>Background</string><key>StandardOutPath</key><string>${xml(path.join(root,'data/service.log'))}</string><key>StandardErrorPath</key><string>${xml(path.join(root,'data/service-error.log'))}</string></dict></plist>\n`,
   start:['launchctl',['bootstrap','gui/'+uid,file]],stop:['launchctl',['bootout','gui/'+uid,file]],remove:null,reload:null};
 }
 throw Error('Unsupported service platform');
}
