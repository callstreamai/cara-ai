import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seal, unseal, cookieValue, challenge } from './slack-auth.js';
const secret = '0123456789abcdef0123456789abcdef';
test('sessions are confidential, authenticated, expire, and reject tampering', () => {
  const payload = { user: 'user-a', token: 'example-secret', exp: Date.now() + 60000 };
  const cookie = seal(payload, secret);
  assert.equal(cookie.includes(payload.token), false);
  assert.deepEqual(unseal(cookie, secret), payload);
  assert.equal(unseal(cookie.slice(0, -2) + 'aa', secret), null);
  assert.equal(unseal(cookie, 'different-secret-that-is-long-enough'), null);
  assert.equal(unseal(seal({exp: Date.now()-1}, secret), secret), null);
});
test('cookie parsing and PKCE S256 match known vector', () => {
  assert.equal(cookieValue('a=1; cara=abc; b=2', 'cara'), 'abc');
  assert.equal(challenge('secretpassword'), 'ldMBaaWcQYtSATMV_IG8mf3wp7A6EW80arYoSW80ntU');
});
