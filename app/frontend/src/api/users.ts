import { apiRequest } from './client';
import type { UserRole } from './session';

export type AppUser = {
  id: string;
  email: string;
  name: string | null;
  role: UserRole;
  business_unit_ids: string[];
  is_active: boolean;
  last_seen_at: string | null;
  created_at: string;
};

export function listUsers(signal?: AbortSignal): Promise<{ users: AppUser[] }> {
  return apiRequest<{ users: AppUser[] }>('/users', { signal });
}

export function createUser(body: {
  email: string;
  name?: string;
  role: UserRole;
  business_unit_ids?: string[];
}): Promise<{ user: AppUser }> {
  return apiRequest<{ user: AppUser }>('/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function updateUser(
  id: string,
  body: {
    name?: string | null;
    role?: UserRole;
    business_unit_ids?: string[];
    is_active?: boolean;
  },
): Promise<{ user: AppUser }> {
  return apiRequest<{ user: AppUser }>(`/users/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}
