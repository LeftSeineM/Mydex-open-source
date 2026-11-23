import test from 'node:test';
import assert from 'node:assert/strict';
import {PairingInvitations} from '../pairing.mjs';

test('pairing invitations expire, rotate and can only be consumed once',()=>{
  let now=1000; const store=new PairingInvitations(()=>now);
  const first=store.create(); assert.match(first.code,/^[A-Za-z0-9_-]{43}$/);
  assert.equal(first.expiresAt,121000);
  assert.equal(store.redeem('wrong'),false);
  const second=store.create(); assert.notEqual(second.code,first.code);
  assert.equal(store.redeem(first.code),false);
  assert.equal(store.redeem(second.code),true);
  assert.equal(store.redeem(second.code),false);
  const third=store.create(); now=third.expiresAt;
  assert.equal(store.redeem(third.code),false);
});
