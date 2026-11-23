import test from 'node:test';
import assert from 'node:assert/strict';
import {WindowsDesktopNavigation} from '../windows-desktop-navigation.mjs';
import {Adapter} from '../adapter.mjs';
const id='11111111-2222-3333-4444-555555555555';

test('Windows opens an existing thread once and requires the exact original identity',async()=>{
 let opened=0,reads=0;
 const nav=new WindowsDesktopNavigation({snapshot:async raw=>{
  assert.equal(raw,id);if(++reads===1)throw Error('unloaded');return {id};
 }},{open:async url=>{opened++;assert.equal(url,'codex://threads/'+id);},sleep:async()=>{}});
 assert.deepEqual(await Promise.all([nav.ensure(id),nav.ensure(id)]),[{id},{id}]);
 assert.equal(opened,1);
 await assert.rejects(nav.ensure("x'; Start-Process calc; '"),/无效/);
});

test('mismatched identity stays unavailable and repeated polling does not reopen the desktop',async()=>{
 let time=0,opened=0;
 const nav=new WindowsDesktopNavigation({snapshot:async()=>({id:'wrong'})},{open:async()=>opened++,sleep:async()=>{time+=11000;},now:()=>time});
 await assert.rejects(nav.ensure(id),/无法确认/);
 await assert.rejects(nav.ensure(id),/尚未载入/);
 assert.equal(opened,1);
});

test('stopping a desktop child uses its own owner and exact active turn, without CLI writes',async()=>{
 const a=Object.create(Adapter.prototype);let sent;
 a.native={snapshot:async raw=>{assert.equal(raw,id);return {id};},control:async(...args)=>{sent=args;return {ok:true,interruptedTurnId:'active-turn'};}};
 a.fromNative=()=>({status:'Running',turnId:'active-turn'});
 assert.equal((await a.interrupt('desktop:'+id)).accepted,true);
 assert.deepEqual(sent,[id,'thread-follower-interrupt-turn',{mode:'user-stop',expectedTurnId:'active-turn'},4]);
 await assert.rejects(a.interrupt('desktop:'+id,'stale-turn'),/轮次已变化/);
 a.fromNative=()=>({status:'Completed',turnId:'old'});
 await assert.rejects(a.interrupt('desktop:'+id),/没有可停止/);
 a.fromNative=()=>({status:'Running',turnId:'new'});a.native.control=async()=>({});
 await assert.rejects(a.interrupt('desktop:'+id),/尚未确认/);
 a.native.control=async()=>({ok:true,interruptedTurnId:null});
 await assert.rejects(a.interrupt('desktop:'+id),/尚未确认/);
});
