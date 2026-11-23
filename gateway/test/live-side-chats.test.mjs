import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {LiveSideChats,sideCandidates} from '../live-side-chats.mjs';
const parent='11111111-2222-3333-4444-555555555555',child='aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',other='22222222-2222-3333-4444-555555555555';

test('log scanning reads bounded tails and extracts only thread identity fields',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'mydex-side-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const now=Date.UTC(2026,10,2),dir=path.join(root,'2026','11','02');fs.mkdirSync(dir,{recursive:true});
 fs.writeFileSync(path.join(dir,'codex-desktop-test.log'),`conversationId=${other}\n${'x'.repeat(1000)}\nthreadId=${parent}\n{"threadId":"${child}","turnId":"${other}"}\n`);
 assert.deepEqual(sideCandidates([root],parent,{now,maxBytes:200}),[child]);
});

test('log candidates must be confirmed as actual side conversations of this exact parent',async()=>{
 let closed=0;
 const live=new LiveSideChats({candidates:()=>[child,other],follower:()=>({snapshot:async id=>id===child?{id,sideConversation:true,forkedFromId:parent,ephemeral:true,title:'侧聊',threadRuntimeStatus:'idle'}:{id,sideConversation:false,forkedFromId:parent},close:()=>closed++})});
 assert.deepEqual(await live.list(parent),[{id:child,parentId:parent,title:'侧聊',status:'idle',ephemeral:true}]);
 assert.equal(closed,1);
});

test('wrong-parent, mismatched-ID and expired candidates cannot enter a side list',async()=>{
 for(const state of [{id:child,sideConversation:true,forkedFromId:other},{id:other,sideConversation:true,forkedFromId:parent},null]){
  let closed=0;const live=new LiveSideChats({candidates:()=>[child],follower:()=>({snapshot:async()=>{if(!state)throw Error('closed');return state;},close:()=>closed++})});
  assert.deepEqual(await live.list(parent),[]);assert.equal(closed,1);
 }
});

test('discovery coalesces repeated requests and never takes task ownership',async()=>{
 let scans=0,closed=0;const live=new LiveSideChats({candidates:()=>{scans++;return [child];},follower:()=>({snapshot:async id=>({id,sideConversation:true,forkedFromId:parent}),close:()=>closed++})});
 const [a,b]=await Promise.all([live.list(parent),live.list(parent)]);
 assert.equal(a[0].id,child);assert.deepEqual(a,b);assert.equal(scans,1);assert.equal(closed,1);
 await live.list(parent);assert.equal(scans,1);
 assert.deepEqual(await live.list('../bad'),[]);
});
