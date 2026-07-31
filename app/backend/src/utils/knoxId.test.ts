import assert from 'node:assert/strict';
import test from 'node:test';

import { knoxIdToEmail } from './knoxId.js';

/**
 * Shared by the Sally import and the SSO header provider: both may receive a bare Knox ID where an
 * email address is needed. Guessing a domain would mis-route mail or mis-identify a user, so an
 * unresolvable ID must produce nothing and let the caller report it.
 */

test('a value that is already an address is taken as-is', () => {
  assert.equal(knoxIdToEmail('gildong.hong@samsung.com'), 'gildong.hong@samsung.com');
  assert.equal(knoxIdToEmail('  gildong.hong@samsung.com  '), 'gildong.hong@samsung.com');
});

test('a bare Knox ID yields nothing when no domain is configured', () => {
  // KNOX_EMAIL_DOMAIN is unset in the test environment.
  assert.equal(knoxIdToEmail('gildong.hong'), '');
  assert.equal(knoxIdToEmail(''), '');
  assert.equal(knoxIdToEmail('   '), '');
});
