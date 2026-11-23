import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {verifyManifest,updateOrigin} from '../desktop/updater.mjs';
const [version,installer,keyFile,notesFile,output]=process.argv.slice(2);
if(!output)throw Error('Usage: node tools/sign-desktop-release.mjs VERSION INSTALLER PRIVATE_KEY NOTES_FILE OUTPUT');
if(path.basename(installer)!==`Mydex-${version}-Setup.exe`)throw Error('Installer filename must match version');
const release={version,url:`${updateOrigin}/downloads/Mydex-${version}-Setup.exe`,size:fs.statSync(installer).size,sha256:crypto.createHash('sha256').update(fs.readFileSync(installer)).digest('hex'),notes:fs.readFileSync(notesFile,'utf8')};
const raw=Buffer.from(JSON.stringify(release));
const envelope={payload:raw.toString('base64'),signature:crypto.sign(null,raw,fs.readFileSync(keyFile)).toString('base64')};
verifyManifest(envelope); // Refuse publication with a different signing key.
fs.writeFileSync(output,JSON.stringify(envelope,null,2));
console.log(JSON.stringify({version,size:release.size,sha256:release.sha256}));
