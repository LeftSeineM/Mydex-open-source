import test from 'node:test';
import assert from 'node:assert/strict';
import {WebAccess} from '../web-access.mjs';

test('web sockets require a whitelisted origin and a single-use ticket', () => {
  const access = new WebAccess(['https://mydex.example']);
  assert.equal(access.issue('https://evil.example'), null);
  const ticket = access.issue('https://mydex.example');
  assert.equal(access.redeem(ticket, 'https://evil.example'), false);
  assert.equal(access.redeem(ticket, 'https://mydex.example'), true);
  assert.equal(access.redeem(ticket, 'https://mydex.example'), false);
});
test('expired tickets fail and wildcard / HTTP configurations fail closed', () => {
  const access = new WebAccess(['https://mydex.example']);
  const ticket = access.issue('https://mydex.example');
  access.tickets.get(ticket).expires = Date.now() - 1;
  assert.equal(access.redeem(ticket, 'https://mydex.example'), false);
  assert.throws(() => new WebAccess(['*']));
  assert.throws(() => new WebAccess(['http://mydex.example']));
});
test('native access is unchanged, browser origins are explicit', () => {
  const access = new WebAccess(['https://mydex.example']);
  const headers = {};
  const res = {setHeader: (key, value) => headers[key] = value};
  assert.equal(access.cors({headers: {}}, res), true);
  assert.equal(access.cors({headers: {origin: 'null'}}, res), false);
  assert.equal(access.cors({headers: {origin: 'https://mydex.example'}}, res), true);
  assert.equal(headers['Access-Control-Allow-Origin'], 'https://mydex.example');
});
