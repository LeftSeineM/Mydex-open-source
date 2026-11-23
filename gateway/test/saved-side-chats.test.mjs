import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {savedSideChats} from '../saved-side-chats.mjs';
const a='11111111-2222-3333-4444-555555555555',b='22222222-2222-3333-4444-555555555555',x='aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',y='bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee';
function fixture(t){const home=fs.mkdtempSync(path.join(os.tmpdir(),'mydex-saved-side-'));t.after(()=>fs.rmSync(home,{recursive:true,force:true}));return home;}
test('two chats in the same project have separate side lists; ordinary forks are excluded',t=>{
 const home=fixture(t),file=path.join(home,'state_5.sqlite'),db=new DatabaseSync(file);
 db.exec('CREATE TABLE threads(id TEXT, attached_thread_parent_id TEXT, title TEXT, cwd TEXT, archived INT, updated_at INT)');
 const put=db.prepare('INSERT INTO threads VALUES(?,?,?,?,?,?)');
 for(const r of [[x,a,'A side','same/project',0,1],[y,b,'B side','same/project',0,2],[a,null,'Ordinary fork','same/project',0,3],[b,a,'Archived side','same/project',1,4]])put.run(...r);
 db.close();const before=fs.readFileSync(file);
 assert.deepEqual(savedSideChats(a,{home}).data.map(r=>[r.id,r.parentId]),[[x,a]]);
 assert.deepEqual(savedSideChats(b,{home}).data.map(r=>[r.id,r.parentId]),[[y,b]]);
 assert.deepEqual(savedSideChats(x,{home}),{supported:true,hasMore:false,data:[]});
 assert.deepEqual(fs.readFileSync(file),before);
});
test('missing database, unknown schema and invalid identity fail closed, without creating a database',t=>{
 const home=fixture(t);assert.equal(savedSideChats(a,{home}).supported,false);assert.deepEqual(fs.readdirSync(home),[]);
 const db=new DatabaseSync(path.join(home,'state_9.sqlite'));db.exec('CREATE TABLE threads(id TEXT)');db.close();
 assert.deepEqual(savedSideChats(a,{home}),{supported:false,hasMore:false,data:[]});
 assert.equal(savedSideChats('../parent',{home}).supported,false);
});
test('pagination remains parent-filtered and bounded',t=>{
 const home=fixture(t),db=new DatabaseSync(path.join(home,'state_5.sqlite'));db.exec('CREATE TABLE threads(id TEXT, attached_thread_parent_id TEXT, name TEXT, title TEXT)');
 const put=db.prepare('INSERT INTO threads VALUES(?,?,?,?)');for(let i=0;i<103;i++)put.run(`${i.toString(16).padStart(8,'0')}-bbbb-cccc-dddd-eeeeeeeeeeee`,a,'name','title');db.close();
 const r=savedSideChats(a,{home});assert.equal(r.data.length,100);assert.equal(r.hasMore,true);assert(r.data.every(t=>t.parentId===a&&t.title==='name'));
});
