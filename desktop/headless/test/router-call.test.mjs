import test from 'node:test';import assert from 'node:assert/strict';
import {normalizeRouterCall} from '../router-call.mjs';
test('result reads and reconciliation work without a model-supplied write key',()=>{
 for(const operation of ['catalog','snapshot','events','read_session','reconcile']){const r=normalizeRouterCall({operation,args:{taskId:'existing'}});assert.equal(r.operation,operation);assert.match(r.requestId,/^[a-f0-9-]{36}$/);}
});
test('native side effects still require the caller stable key and preserve it exactly',()=>{
 for(const operation of ['assign','revise_task','dispatch','create_session','wake','cancel','answer','accept','create_job','pause','resume']){
  assert.throws(()=>normalizeRouterCall({operation,args:{}}),/stable requestId/);
  assert.equal(normalizeRouterCall({operation,requestId:'stable-native-request-123',args:{}}).requestId,'stable-native-request-123');
 }
 assert.throws(()=>normalizeRouterCall({operation:'exec',requestId:'stable-native-request-123'}),/Unsupported/);
 assert.throws(()=>normalizeRouterCall({operation:'set_execution',requestId:'stable-native-request-123'}),/Unsupported/);
});
