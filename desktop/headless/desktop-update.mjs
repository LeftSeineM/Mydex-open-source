import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
import {verifyPackage} from './verify-package.mjs';

// UI calls this locally, never through the Agent /rpc token. The existing
// signed-package supervisor remains responsible for installation and rollback.
export class DesktopServiceUpdate {
 constructor({root,dataRoot,verify=verifyPackage,launch,receipt}){
  this.root=root;this.dataRoot=dataRoot;this.verify=verify;this.launch=launch;this.receipt=receipt;
  this.candidate=null;this.pending=null;
 }
 validate(){
  if(!this.root||!this.dataRoot)throw Error('未绑定共享服务安装位置，不能更新。');
  const root=fs.realpathSync(this.root),data=fs.realpathSync(this.dataRoot);
  if(data!==fs.realpathSync(path.join(root,'data'))||!fs.existsSync(path.join(root,'mydex-agent-install.json')))throw Error('更新目标与当前共享配置不一致。');
  return JSON.parse(fs.readFileSync(path.join(root,'current.json'),'utf8'));
 }
 inspect(directory){
  const current=this.validate();
  const target=fs.realpathSync(directory),manifest=this.verify(target);
  this.candidate={directory:target,version:manifest.version,hash:this.hash(target)};
  return {current:current.version,version:manifest.version,verified:true};
 }
 hash(directory){return crypto.createHash('sha256').update(fs.readFileSync(path.join(directory,'agent-package.json'))).digest('hex');}
 async install(){
  this.validate();
  if(this.pending)return this.pending;
  if(!this.candidate)throw Error('请先选择并验证私测更新包。');
  const c=this.candidate;this.verify(c.directory);
  if(this.hash(c.directory)!==c.hash)throw Error('更新包已变化，请重新核对版本。');
  // Retain the promise, including a failed launch: uncertain outcomes require
  // inspection rather than a second install from another click.
  this.pending=this.launch('update',c.directory);
  return this.pending;
 }
 status(id){this.validate();return this.receipt(id);}
}
