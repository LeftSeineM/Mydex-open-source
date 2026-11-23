import crypto from 'node:crypto';import {publicKey} from './verify-package.mjs';
export async function latestRelease(){
 const response=await fetch('https://app.leftseinem.com/agent/latest.json',{signal:AbortSignal.timeout(20000)});
 if(!response.ok)throw Error('Release index unavailable');const e=await response.json();
 if(typeof e.payload!=='string'||e.payload.length>100000||typeof e.signature!=='string')throw Error('Invalid release index');
 const raw=Buffer.from(e.payload,'base64');if(!crypto.verify(null,raw,publicKey,Buffer.from(e.signature,'base64')))throw Error('Invalid release signature');
 const m=JSON.parse(raw),asset=m.assets?.[process.platform+'-'+process.arch];
 if(!asset||!asset.url.startsWith('https://app.leftseinem.com/downloads/')||!/^\d+\.\d+\.\d+$/.test(m.version)||!/^[a-f0-9]{64}$/.test(asset.sha256))throw Error('No compatible release');
 return {version:m.version,platform:process.platform,arch:process.arch,...asset,verificationRequired:true};
}
