import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;

// thread/list filters differ between Codex versions. Read the actual attached
// parent index instead; never interpret an unverified global list as side chats.
export function savedSideChats(parent,{home=process.env.CODEX_HOME||path.join(os.homedir(),'.codex')}={}){
 if(!uuid.test(parent))return {supported:false,data:[],hasMore:false};
 let db;
 try{
  const files=fs.readdirSync(home).filter(n=>/^state_\d+\.sqlite$/.test(n)).sort((a,b)=>Number(b.match(/\d+/)[0])-Number(a.match(/\d+/)[0]));
  if(!files.length)return {supported:false,data:[],hasMore:false};
  const {DatabaseSync}=require('node:sqlite');
  db=new DatabaseSync(path.join(home,files[0]),{readOnly:true});
  const cols=new Set(db.prepare('PRAGMA table_info(threads)').all().map(c=>c.name));
  if(!['id','attached_thread_parent_id'].every(c=>cols.has(c)))return {supported:false,data:[],hasMore:false};
  const title=cols.has('name')&&cols.has('title')?'COALESCE(NULLIF(name,\'\'),title)':cols.has('title')?'title':"'侧聊'";
  const rows=db.prepare(`SELECT id, attached_thread_parent_id AS parentId, ${title} AS title FROM threads WHERE attached_thread_parent_id = ? AND id <> ? ${cols.has('archived')?'AND archived = 0':''} ORDER BY ${cols.has('updated_at')?'updated_at DESC,':''} id LIMIT 101`).all(parent,parent);
  return {supported:true,hasMore:rows.length>100,data:rows.slice(0,100).filter(r=>uuid.test(r.id)&&r.parentId===parent).map(r=>({id:r.id,parentId:parent,title:r.title||'侧聊',status:null,ephemeral:false}))};
 }catch{return {supported:false,data:[],hasMore:false};}finally{db?.close();}
}
