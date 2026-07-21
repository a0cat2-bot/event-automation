import assert from 'node:assert/strict';
import test from 'node:test';

import type { Request, Response } from 'express';

import { requireRole, type AuthenticatedPrincipal } from './auth.js';

function makeResponse() {
  const response = {
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) {
      response.statusCode = code;
      return response;
    },
    json(payload: unknown) {
      response.body = payload;
      return response;
    },
  };
  return response as unknown as Response & { statusCode: number; body: unknown };
}

function makeRequest(user?: AuthenticatedPrincipal) {
  return { user } as unknown as Request;
}

test('requireRole rejects unauthenticated requests with 401', () => {
  const response = makeResponse();
  let nextCalled = false;

  requireRole('admin')(makeRequest(undefined), response, () => {
    nextCalled = true;
  });

  assert.equal(response.statusCode, 401);
  assert.equal(nextCalled, false);
});

test('requireRole rejects a role outside the allowed list with 403', () => {
  const response = makeResponse();
  let nextCalled = false;
  const viewer: AuthenticatedPrincipal = {
    user_id: 'u1',
    email: 'viewer@ehs.local',
    role: 'viewer',
    business_units: [],
  };

  requireRole('admin', 'coordinator')(makeRequest(viewer), response, () => {
    nextCalled = true;
  });

  assert.equal(response.statusCode, 403);
  assert.equal(nextCalled, false);
});

test('requireRole calls next() for an allowed role', () => {
  const response = makeResponse();
  let nextCalled = false;
  const admin: AuthenticatedPrincipal = {
    user_id: 'u2',
    email: 'admin@ehs.local',
    role: 'admin',
    business_units: ['Engineering'],
  };

  requireRole('admin')(makeRequest(admin), response, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.equal(response.statusCode, 0);
});
