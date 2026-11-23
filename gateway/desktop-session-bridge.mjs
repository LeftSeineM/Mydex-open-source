import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {KimiDesktop} from './kimi-desktop.mjs';
import {DeepSeekDesktop} from './deepseek-desktop.mjs';

// A bridge descriptor is issued by an already-running desktop application.
// This client never launches an agent or resumes a transcript in a new process.
export class DesktopSessionBridge {
  constructor({homeDir=os.homedir(),bridgeDirectory,...config}={}) {
    this.kimi=new KimiDesktop({...config,homeDir});
    this.deepseek=new DeepSeekDesktop({...config,homeDir,bridgeDirectory});
    this.directory=bridgeDirectory||path.join(homeDir,'.mydex','desktop-bridges');
  }
  descriptor(toolId) {
    if(!['claude-desktop','zcode','gemini'].includes(toolId))throw new Error('不支持的桌面工具');
    const d=JSON.parse(fs.readFileSync(path.join(this.directory,toolId+'.json'),'utf8'));
    if(d.protocol!==1||d.toolId!==toolId||!Number.isInteger(d.port)||d.port<1||d.port>65535||!/^[a-f0-9]{64}$/.test(d.token||'')||typeof d.instance!=='string')throw new Error('桌面桥接信息无效');
    return d;
  }
  async request(toolId,route,body,descriptor) {
    const d=descriptor||this.descriptor(toolId);
    const response=await fetch(`http://127.0.0.1:${d.port}/v1/${route}`,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+d.token,...body?{'Content-Type':'application/json'}:{}},body:body?JSON.stringify(body):undefined,redirect:'error',signal:AbortSignal.timeout(body?20000:4000)});
    const value=await response.json();
    if(!response.ok)throw new Error(value.error||'桌面会话接口未完成请求');
    return value;
  }
  async sessions(toolId) {
    if(toolId==='kimi')return this.kimi.sessions();
    if(toolId==='deepseek')return this.deepseek.sessions();
    const d=this.descriptor(toolId),health=await this.request(toolId,'health',undefined,d);
    if(health.protocol!==1||health.instance!==d.instance||health.toolId!==toolId||health.sessionOwner!=='desktop')throw new Error('无法确认原桌面会话所有权');
    return (await this.request(toolId,'sessions',undefined,d)).sessions;
  }
  detail(toolId,sessionId){if(toolId==='kimi')return this.kimi.detail(sessionId);if(toolId==='deepseek')return this.deepseek.detail(sessionId);return this.request(toolId,'detail',{sessionId});}
  async send(toolId,sessionId,instruction){if(toolId==='kimi')return this.kimi.send(sessionId,instruction);if(toolId==='deepseek')return this.deepseek.send(sessionId,instruction);if(toolId==='zcode')await this.detail(toolId,sessionId);return this.request(toolId,'send',{sessionId,instruction,requestId:crypto.randomUUID()});}
}
