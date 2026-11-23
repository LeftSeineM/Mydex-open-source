// Offline administrator command. Stop the relay before running to avoid
// overwriting its in-memory database. Credentials must stay outside public sites.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {promisify} from 'node:util';
const scrypt=promisify(crypto.scrypt);
const [configPath,outputPath,prefix='mydex-test',countArg='5']=process.argv.slice(2);
const count=Number(countArg);
if(!configPath||!outputPath||!/^[a-z0-9_-]{3,50}$/.test(prefix)||!Number.isInteger(count)||count<1||count>20)throw Error('Usage: node provision-web-test-users.mjs PRIVATE_CONFIG PRIVATE_OUTPUT [PREFIX] [COUNT:1..20]');
if(fs.existsSync(outputPath))throw Error('Refusing to overwrite existing credential delivery');
const config=JSON.parse(fs.readFileSync(configPath,'utf8'));
const db=fs.existsSync(config.dataFile)?JSON.parse(fs.readFileSync(config.dataFile,'utf8')):{users:[],devices:[]};
const names=Array.from({length:count},(_,i)=>`${prefix}-${String(i+1).padStart(2,'0')}`);
if(names.some(name=>db.users.some(u=>u.name===name)))throw Error('Test account name already exists; existing passwords are never reset');
const created=[];
for(const name of names){
 const password=crypto.randomBytes(18).toString('base64url'),salt=crypto.randomBytes(32).toString('base64url');
 const digest=(await scrypt(password,salt,64)).toString('hex');
 db.users.push({id:crypto.randomBytes(32).toString('base64url'),name,salt,digest,provisioned:true});
 created.push({username:name,password});
}
fs.mkdirSync(path.dirname(outputPath),{recursive:true});
// Write delivery first: if the DB write fails, the administrator retains a
// recoverable record, rather than enabling accounts with lost passwords.
fs.writeFileSync(outputPath,JSON.stringify({url:config.origin+'/connect/',createdAt:new Date().toISOString(),accounts:created},null,2),{mode:0o600,flag:'wx'});
fs.mkdirSync(path.dirname(config.dataFile),{recursive:true});
fs.writeFileSync(config.dataFile+'.tmp',JSON.stringify(db),{mode:0o600});
fs.renameSync(config.dataFile+'.tmp',config.dataFile);
console.log(JSON.stringify({created:created.length,usernames:names}));
