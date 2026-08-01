import assert from 'node:assert/strict';
import test, { before } from 'node:test';

/**
 * Shared by the Sally import and the SSO header provider: both may receive a bare Knox ID where an
 * email address is needed. Guessing a domain would mis-route mail or mis-identify a user, so an
 * unresolvable ID must produce nothing and let the caller report it.
 *
 * The domain is cleared before the module graph loads rather than assumed absent. config/env.ts
 * pulls in dotenv, so these once passed only because the developer's .env happened to leave
 * KNOX_EMAIL_DOMAIN blank — and started failing the moment a real domain was configured. dotenv
 * does not overwrite a key already present in process.env, so setting it empty here wins.
 * node:test gives each file its own process, so this affects nothing else.
 */

let knoxIdToEmail: typeof import('./knoxId.js').knoxIdToEmail;

before(async () => {
  process.env.KNOX_EMAIL_DOMAIN = '';
  ({ knoxIdToEmail } = await import('./knoxId.js'));
});

test('a value that is already an address is taken as-is', () => {
  assert.equal(knoxIdToEmail('gildong.hong@samsung.com'), 'gildong.hong@samsung.com');
  assert.equal(knoxIdToEmail('  gildong.hong@samsung.com  '), 'gildong.hong@samsung.com');
});

test('a bare Knox ID yields nothing when no domain is configured', () => {
  assert.equal(knoxIdToEmail('gildong.hong'), '');
  assert.equal(knoxIdToEmail(''), '');
  assert.equal(knoxIdToEmail('   '), '');
});
