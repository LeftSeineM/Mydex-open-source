import fs from 'node:fs';
import https from 'node:https';
import {coordinatorToken} from '../../gateway/router/access.mjs';

// Credentials remain in the existing private gateway config, never in MCP
// arguments, responses or a second service profile.
export function routerRequest(configFile,operation,args={},requestId){
  const c=JSON.parse(fs.readFileSync(configFile,'utf8'));
  if(!c.router?.enabled||!c.tls?.cert)throw Error('Private Router is not enabled on this background owner');
  const read=['snapshot','catalog','events'].includes(operation);
  const query=new URLSearchParams({operation});for(const field of ['jobId','after'])if(args[field]!==undefined)query.set(field,String(args[field]));
  const payload=read?null:JSON.stringify({operation,args});
  return new Promise((resolve,reject)=>{
    const req=https.request({hostname:'127.0.0.1',port:c.port,path:'/api/router'+(read?'?'+query:''),method:read?'GET':'POST',ca:fs.readFileSync(c.tls.cert),headers:{Authorization:'Bearer '+coordinatorToken(c.token),...payload?{'Content-Type':'application/json','Idempotency-Key':requestId}:{} }},res=>{
      let size=0,parts=[];res.on('data',part=>{size+=part.length;if(size>4*1024*1024)return req.destroy(Error('Router response too large'));parts.push(part);});
      res.on('end',()=>{try{const value=JSON.parse(Buffer.concat(parts));if(res.statusCode!==200)return reject(Error('Router operation rejected ('+res.statusCode+'); inspect before retrying'));resolve(value);}catch{reject(Error('Invalid Router response'));}});res.on('error',()=>reject(Error('Router response interrupted; inspect before retrying')));
    });
    req.setTimeout(40000,()=>req.destroy(Error('Router outcome unknown; inspect before retrying')));req.on('error',()=>reject(Error('Router unavailable or outcome unknown; inspect before retrying')));req.end(payload);
  });
}
