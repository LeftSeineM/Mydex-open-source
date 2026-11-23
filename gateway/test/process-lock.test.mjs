import test from 'node:test';import assert from 'node:assert/strict';
import {processOwnsLock} from '../router/process-lock.mjs';
const pid=process.pid+100000;
test('PID reused by a younger process cannot own a previous lock',()=>{
 assert.equal(processOwnsLock(pid,'fixture',{alive:()=>{},startedAt:()=>2000,mtime:()=>1000}),false);
});
test('reused PID equal to the new process itself is not mistaken for ownership',()=>{
 assert.equal(processOwnsLock(process.pid,'fixture',{alive:()=>{},startedAt:()=>2000,mtime:()=>1000}),false);
 assert.equal(processOwnsLock(process.pid,'fixture',{alive:()=>{},startedAt:()=>900,mtime:()=>1000}),true);
});
test('live original owner and uncertain creation time remain locked',()=>{
 for(const startedAt of [()=>900,()=>null,()=>{throw Error('access denied');}])
  assert.equal(processOwnsLock(pid,'fixture',{alive:()=>{},startedAt,mtime:()=>1000}),true);
});
test('dead owner recovers; permission failure and invalid PID do not',()=>{
 assert.equal(processOwnsLock(pid,'fixture',{alive:()=>{throw Object.assign(Error(),{code:'ESRCH'});}}),false);
 assert.throws(()=>processOwnsLock(pid,'fixture',{alive:()=>{throw Object.assign(Error(),{code:'EPERM'});}}));
 assert.throws(()=>processOwnsLock(0,'fixture'),/Invalid/);
});
