import { API_BASE_URL } from '../config/api';
import { apiRequest } from './client';

export type AuditLogEntry = {
  id: string;
  user_id: string | null;
  actor_name: string | null;
  action: string | null;
  entity_type: string | null;
  entity_id: string | null;
  program_id: string | null;
  details: unknown;
  ip_address: string | null;
  timestamp: string;
};

type AuditLogsResponse = { entries: AuditLogEntry[] };

function auditLogQuery(programId?: string): string {
  return programId ? `?program_id=${encodeURIComponent(programId)}` : '';
}

export function listAuditLogs(
  programId?: string,
  signal?: AbortSignal,
): Promise<AuditLogsResponse> {
  return apiRequest<AuditLogsResponse>(`/audit-logs${auditLogQuery(programId)}`, { signal });
}

export function auditLogExportUrl(programId?: string): string {
  return `${API_BASE_URL.replace(/\/$/, '')}/audit-logs/export${auditLogQuery(programId)}`;
}
