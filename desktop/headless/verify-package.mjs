import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import {pathToFileURL} from 'node:url';
export const publicKey=`-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAhbTNjX6AGrlT5tlbCNaLVK7eD/RJzi8PxZGZeYxv/FA=
-----END PUBLIC KEY-----`;
export function verifyPackage(root,key=publicKey,{platform=process.platform,arch=process.arch}={}){
 root=fs.realpathSync(root);const e=JSON.parse(fs.readFileSync(path.join(root,'agent-package.json'),'utf8'));
 if(typeof e.payload!=='string'||e.payload.length>8000000||typeof e.signature!=='string')throw Error('Invalid package envelope');
 const raw=Buffer.from(e.payload,'base64');if(!crypto.verify(null,raw,key,Buffer.from(e.signature,'base64')))throw Error('Invalid package signature');
 const m=JSON.parse(raw);const product=platform==='win32'?'mydex-agent-windows':'mydex-agent-'+platform;
 if(m.product!==product||m.platform&&m.platform!==platform||m.arch&&m.arch!==arch||platform!=='win32'&&!m.arch||!/^\d+\.\d+\.\d+$/.test(m.version)||!Array.isArray(m.files)||m.files.length>30000)throw Error('Invalid package manifest or incompatible platform');
 const seen=new Set();for(const f of m.files){
  if(typeof f.path!=='string'||f.path.includes('\\')||f.path.includes(':')||f.path.startsWith('/')||f.path.split('/').some(p=>!p||p==='.'||p==='..')||seen.has(f.path.toLowerCase()))throw Error('Unsafe package path');
  seen.add(f.path.toLowerCase());const file=path.join(root,...f.path.split('/'));const real=fs.realpathSync(file);
  if(!real.startsWith(root+path.sep)||fs.lstatSync(file).isSymbolicLink())throw Error('Linked package file rejected');
  const bytes=fs.readFileSync(file);if(bytes.length!==f.size||crypto.createHash('sha256').update(bytes).digest('hex')!==f.sha256)throw Error('Package checksum mismatch');
 }
 for(const required of [platform==='win32'?'runtime/node.exe':'runtime/bin/node','desktop/gui-bridge.mjs','desktop/headless/service.mjs',platform==='win32'?'desktop/headless/manage.ps1':'desktop/headless/manage-posix.mjs','desktop/headless/mcp.mjs'])if(!seen.has(required))throw Error('Incomplete package');
 return m;
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){try{const m=verifyPackage(process.argv[2]);console.log(JSON.stringify({verified:true,version:m.version,files:m.files.length}));}catch{console.error('Package signature or contents invalid');process.exitCode=1;}}
