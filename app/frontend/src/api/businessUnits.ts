import { apiRequest } from './client';

export type BusinessUnit = {
  id: string;
  name: string;
  is_active: boolean;
  created_at: string;
};

type BusinessUnitResponse = { business_unit: BusinessUnit };
type BusinessUnitsResponse = { business_units: BusinessUnit[] };

export function listBusinessUnits(
  options?: { activeOnly?: boolean },
  signal?: AbortSignal,
): Promise<BusinessUnitsResponse> {
  const query = options?.activeOnly ? '?active=true' : '';
  return apiRequest<BusinessUnitsResponse>(`/business-units${query}`, { signal });
}

export function createBusinessUnit(name: string): Promise<BusinessUnitResponse> {
  return apiRequest<BusinessUnitResponse>('/business-units', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
}

export function updateBusinessUnit(
  id: string,
  input: { name?: string; is_active?: boolean },
): Promise<BusinessUnitResponse> {
  return apiRequest<BusinessUnitResponse>(`/business-units/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}
