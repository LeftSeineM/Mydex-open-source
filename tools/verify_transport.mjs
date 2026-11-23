// Read-only production check; never prints task titles, messages or credentials.
import fs from 'node:fs';
import https from 'node:https';
const [file,base]=process.argv.slice(2),config=JSON.parse(fs.readFileSync(file,'utf8'));
async function get(path){return new Promise((resolve,reject)=>{https.get(base+path,{ca:fs.readFileSync(config.tls.cert),headers:{Authorization:'Bearer '+config.token}},r=>{let chunks=[];r.on('data',b=>chunks.push(b));r.on('end',()=>{try{if(r.statusCode!==200)throw Error('HTTP '+r.statusCode+' '+JSON.parse(Buffer.concat(chunks)).error);const b=Buffer.concat(chunks);resolve({bytes:b.length,value:JSON.parse(b)});}catch(e){reject(e);}});}).on('error',reject);});}
const list=await get('/api/tasks');if(list.value.tasks.some(t=>t.messages))throw Error('List leaked conversation bodies');
const results=[];for(const t of list.value.tasks.filter(t=>t.toolId==='codex').slice(0,3)){
 const page=await get('/api/tasks/'+encodeURIComponent(t.id));if(page.value.messages.length>60)throw Error('Unbounded message window');results.push({bytes:page.bytes,messages:page.value.messages.length,hasMore:page.value.hasMore});
}
console.log(JSON.stringify({listBytes:list.bytes,tasks:list.value.tasks.length,summaryOnly:true,details:results}));
