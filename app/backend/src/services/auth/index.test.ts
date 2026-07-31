import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveIdentityProvider, type AuthConfig } from './index.js';
import {
  canAccessBusinessUnit,
  roleAtLeast,
  type AuthenticatedUser,
  type UserRole,
} from './types.js';

function config(authProvider: string): AuthConfig {
  return { authProvider };
}

function user(overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser {
  return {
    id: 'u1',
    email: 'user@example.com',
    name: null,
    role: 'coordinator',
    businessUnitIds: [],
    ...overrides,
  };
}

test('access control is disabled by default, and says so', () => {
  assert.equal(resolveIdentityProvider(config('disabled')), null);
});

test('an unrecognised auth provider fails loudly instead of silently disabling access control', () => {
  assert.throws(() => resolveIdentityProvider(config('ldap')), /Unsupported AUTH_PROVIDER "ldap"/);
});

test('sso_header reads identity from the gateway headers', () => {
  // Names follow the AI Pro guide's gateway contract: X-User-ID with X-User-Email alongside it.
  const provider = resolveIdentityProvider(config('sso_header'));
  assert.ok(provider);

  assert.deepEqual(
    provider.resolveIdentity({
      'x-user-email': 'gildong.hong@example.com',
      'x-user-name': '홍길동',
    }),
    { email: 'gildong.hong@example.com', name: '홍길동' },
  );

  // X-User-ID alone is enough when it already carries a full address.
  assert.deepEqual(provider.resolveIdentity({ 'x-user-id': 'gildong.hong@example.com' }), {
    email: 'gildong.hong@example.com',
    name: undefined,
  });

  assert.equal(provider.resolveIdentity({}), null);
  // A header present but blank must not be treated as an identity.
  assert.equal(provider.resolveIdentity({ 'x-user-email': '   ' }), null);
});

test('a bare Knox ID with no configured domain is not accepted as an identity', () => {
  // Signing someone in as a half-formed address would attribute their actions to the wrong row.
  const provider = resolveIdentityProvider(config('sso_header'));
  assert.ok(provider);

  assert.equal(provider.resolveIdentity({ 'x-user-id': 'gildong.hong' }), null);
});

test('roles are never taken from the gateway', () => {
  // This app's roles and business-unit scoping are application-specific; taking them from the
  // gateway would create a second, disagreeing source of truth for who may run a selection.
  const provider = resolveIdentityProvider(config('sso_header'));
  assert.ok(provider);

  const claim = provider.resolveIdentity({
    'x-user-email': 'gildong.hong@example.com',
    'x-user-roles': 'admin,superuser',
  });

  assert.deepEqual(Object.keys(claim ?? {}).sort(), ['email', 'name']);
});

test('dev_header provider never reads the SSO headers', () => {
  const provider = resolveIdentityProvider(config('dev_header'));
  assert.ok(provider);

  assert.equal(provider.resolveIdentity({ 'x-user-email': 'sso@example.com' }), null);
  assert.deepEqual(provider.resolveIdentity({ 'x-dev-user-email': 'dev@example.com' }), {
    email: 'dev@example.com',
    name: undefined,
  });
});

test('role ranking lets guards express "at least this role"', () => {
  const cases: Array<[UserRole, UserRole, boolean]> = [
    ['viewer', 'viewer', true],
    ['viewer', 'coordinator', false],
    ['viewer', 'admin', false],
    ['coordinator', 'viewer', true],
    ['coordinator', 'coordinator', true],
    ['coordinator', 'admin', false],
    ['admin', 'admin', true],
    ['admin', 'coordinator', true],
  ];

  for (const [role, minimum, expected] of cases) {
    assert.equal(roleAtLeast(role, minimum), expected, `${role} >= ${minimum}`);
  }
});

test('business unit scoping restricts coordinators but not admins', () => {
  const scoped = user({ role: 'coordinator', businessUnitIds: ['bu-1'] });
  assert.equal(canAccessBusinessUnit(scoped, 'bu-1'), true);
  assert.equal(canAccessBusinessUnit(scoped, 'bu-2'), false);

  // An empty list means "all" — the normal state for admins and for unscoped accounts.
  const unscoped = user({ role: 'coordinator', businessUnitIds: [] });
  assert.equal(canAccessBusinessUnit(unscoped, 'bu-2'), true);

  const admin = user({ role: 'admin', businessUnitIds: ['bu-1'] });
  assert.equal(canAccessBusinessUnit(admin, 'bu-2'), true);
});
