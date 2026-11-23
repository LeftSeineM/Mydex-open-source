import test from 'node:test';import assert from 'node:assert/strict';
import {gatewayFailure} from '../../gateway-diagnostics.mjs';
test('startup errors expose actionable fixed messages, never raw diagnostics',()=>{
 const secret='Bearer secret-fixture-do-not-display';
 for(const marker of ['EADDRINUSE','This Router database already has an execution owner','Router identity changed','ERR_MODULE_NOT_FOUND','EPERM']){
  const result=gatewayFailure(marker+' '+secret);assert.equal(typeof result,'string');assert.ok(!result.includes(secret));
 }
 assert.equal(gatewayFailure('arbitrary stderr '+secret),null);
});
