import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {newer,verifyManifest,updateOrigin,legacyUpdateOrigin,releaseFetch} from '../../desktop/updater.mjs';
const keys=crypto.generateKeyPairSync('ed25519');
function envelope(m){const raw=Buffer.from(JSON.stringify(m));return {payload:raw.toString('base64'),signature:crypto.sign(null,raw,keys.privateKey).toString('base64')};}
const valid={version:'0.4.9',url:updateOrigin+'/downloads/Mydex-0.4.9-Setup.exe',size:10000,sha256:'a'.repeat(64),notes:'更新说明'};
test('desktop updates compare numeric versions without accepting downgrades',()=>{
 assert(newer('0.4.10','0.4.9'));assert(!newer('0.4.8','0.4.8'));assert(!newer('0.4.7','0.4.8'));assert(!newer('malformed','0.4.8'));
});
test('GitHub fallback follows only HTTPS GitHub asset redirects',async()=>{
 let count=0;
 const result=await releaseFetch('https://github.com/LeftSeineM/Mydex-mobile/releases/download/desktop-v0.4.9/Mydex-0.4.9-Setup.exe',{},async()=>++count===1?new Response(null,{status:302,headers:{location:'https://release-assets.githubusercontent.com/example?signature=demo'}}):new Response('verified later by SHA'));
 assert.equal(await result.text(),'verified later by SHA');assert.equal(count,2);
 for(const location of ['http://release-assets.githubusercontent.com/test','https://evil.example/test','https://user:pass@release-assets.githubusercontent.com/test'])await assert.rejects(()=>releaseFetch('https://github.com/test',{},async()=>new Response(null,{status:302,headers:{location}})));
 await assert.rejects(()=>releaseFetch(updateOrigin+'/downloads/test',{},async()=>new Response(null,{status:302,headers:{location:'https://release-assets.githubusercontent.com/test'}})));
});
test('desktop releases require the pinned signer and exact HTTPS package location',()=>{
 assert.equal(verifyManifest(envelope(valid),keys.publicKey).version,'0.4.9');
 const altered=envelope(valid);altered.payload=Buffer.from(JSON.stringify({...valid,size:11000})).toString('base64');assert.throws(()=>verifyManifest(altered,keys.publicKey));
 assert.throws(()=>verifyManifest(envelope(valid))); // Test key is not the real release key.
 for(const changes of [{url:'https://evil.example/installer.exe'},{url:updateOrigin+'/downloads/Mydex-0.4.9-Setup.exe?redirect=x'},{url:updateOrigin+'/downloads/Mydex-0.4.8-Setup.exe'},{sha256:'bad'},{size:300*1024*1024},{version:'../../bad'}])assert.throws(()=>verifyManifest(envelope({...valid,...changes}),keys.publicKey));
});

test('migration accepts signed legacy origin and rejects unrelated domains',()=>{assert.equal(verifyManifest(envelope({...valid,url:valid.url.replace(updateOrigin,legacyUpdateOrigin)}),keys.publicKey).version,valid.version);});
