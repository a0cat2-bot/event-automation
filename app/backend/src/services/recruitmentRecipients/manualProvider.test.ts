import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeRecipientEmails } from './manualProvider.js';

test('manual recipient email validation rejects malformed addresses', () => {
  for (const email of ['', 'not-an-email', 'missing-domain@', '@missing-local.example.com']) {
    assert.throws(() => normalizeRecipientEmails([email]), email);
  }
});

test('manual recipient duplicates collapse case-insensitively and keep the first address', () => {
  assert.deepEqual(
    normalizeRecipientEmails([
      ' First.Person@Example.com ',
      'first.person@example.com',
      'SECOND.PERSON@example.com',
      'second.person@EXAMPLE.COM',
    ]),
    ['First.Person@Example.com', 'SECOND.PERSON@example.com'],
  );
});
