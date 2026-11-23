import crypto from 'node:crypto';
const fields=['id','toolId','title','projectId','status','updatedAt','source','cwd','readOnly','canApprove','canInterrupt','syncMode','turnId','error'];
export function summary(t){return Object.fromEntries(fields.filter(k=>t[k]!==undefined).map(k=>[k,typeof t[k]==='string'?t[k].slice(0,k==='title'?500:2000):t[k]]));}
// Cursors are task-bound and authenticated. History remains on the original computer.
export class TaskTransport {
 constructor(read,secret){this.read=read;this.secret=secret;}
 encode(value){const b=Buffer.from(JSON.stringify(value)).toString('base64url');return 'page.'+b+'.'+crypto.createHmac('sha256',this.secret).update(b).digest('base64url');}
 decode(token,task){try{const [p,b,s]=token.split('.');const expected=crypto.createHmac('sha256',this.secret).update(b).digest('base64url');if(p!=='page'||s!==expected)throw Error();const v=JSON.parse(Buffer.from(b,'base64url'));if(v.task!==task)throw Error();return v;}catch{throw Object.assign(Error('历史位置无效，请重新打开会话'),{status:400});}}
 async detail(task,cursor){const c=cursor?.startsWith('page.')?this.decode(cursor,task):{source:cursor||null};const raw=await this.read(task,c.source);return this.page(raw,task,c);}
 page(raw,task,c={source:null}){
  const all=raw.messages||[];let end=all.length;
  if(c.before!==undefined){end=all.findIndex((m,i)=>(m.id??String(i))===c.before);if(end<0)throw Object.assign(Error('历史位置已变化，请重新打开会话'),{status:409});}
  const start=Math.max(0,end-60);
  const messages=all.slice(start,end).map((m,n)=>{
   const out={};for(const k of ['id','role','type','status','turnId','durationMs','imagePath','url'])if(m[k]!==undefined)out[k]=typeof m[k]==='string'?m[k].slice(0,2000):m[k];
   out.title=String(m.title||'').slice(0,300);const text=String(m.text||'');const limit=m.type==='step'?1000:8000;out.text=text.slice(0,limit);
   if(m.type==='subagent'){
    out.operation=String(m.operation||'').slice(0,80);out.prompt=String(m.prompt||'').slice(0,4000);
    out.model=String(m.model||'').slice(0,200);out.effort=String(m.effort||'').slice(0,80);
    out.agents=(Array.isArray(m.agents)?m.agents:[]).slice(0,30).map(a=>({id:String(a.id||'').slice(0,200),name:String(a.name||'').slice(0,200),status:String(a.status||'').slice(0,80),message:String(a.message||'').slice(0,2000)}));
   }
   if(text.length>limit){out.contentPath='/api/tasks/'+encodeURIComponent(task)+'/content?ref='+encodeURIComponent(this.encode({task,source:c.source||null,message:m.id??String(start+n),revision:crypto.createHash('sha256').update(text).digest('hex')}));out.textLength=text.length;}
   return out;
  });
  const next=start>0?this.encode({task,source:c.source||null,before:all[start].id??String(start)}):raw.nextCursor||null;
  return {...summary(raw),permissions:raw.permissions||null,approvals:raw.approvals||[],messages,hasMore:!!next,nextCursor:next,windowed:true};
 }
 async content(task,ref,offset){const c=this.decode(ref,task);if(!Number.isSafeInteger(offset)||offset<0)throw Object.assign(Error('内容位置无效'),{status:400});const raw=await this.read(task,c.source);const m=(raw.messages||[]).find((m,i)=>(m.id??String(i))===c.message);if(!m)throw Object.assign(Error('原消息已变化，请重新打开会话'),{status:409});const text=String(m.text||'');if(crypto.createHash('sha256').update(text).digest('hex')!==c.revision)throw Object.assign(Error('消息正在更新，请重新打开查看'),{status:409});return {text:text.slice(offset,offset+16000),nextOffset:offset+16000<text.length?offset+16000:null,total:text.length};}
}
