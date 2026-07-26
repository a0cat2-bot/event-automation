export interface BackendRequestOptions {
  method?: 'GET' | 'POST' | 'PUT';
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
}

export class BackendApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {
    super(backendErrorMessage(status, body));
    this.name = 'BackendApiError';
  }
}

function backendErrorMessage(status: number, body: unknown): string {
  if (isRecord(body) && typeof body.error === 'string') return body.error;
  return `Backend API returned HTTP ${status}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function buildUrl(
  backendApiUrl: string,
  path: string,
  query?: BackendRequestOptions['query'],
): URL {
  const base = backendApiUrl.endsWith('/') ? backendApiUrl : `${backendApiUrl}/`;
  const url = new URL(path.replace(/^\//, ''), base);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  return url;
}

async function parseResponseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

export async function backendRequest<T>(
  backendApiUrl: string,
  path: string,
  options: BackendRequestOptions = {},
): Promise<T> {
  const headers = new Headers();
  let body: string | undefined;
  if (options.body !== undefined) {
    headers.set('Content-Type', 'application/json');
    body = JSON.stringify(options.body);
  }

  const response = await fetch(buildUrl(backendApiUrl, path, options.query), {
    method: options.method ?? 'GET',
    headers,
    body,
  });
  const responseBody = await parseResponseBody(response);
  if (!response.ok) throw new BackendApiError(response.status, responseBody);
  return responseBody as T;
}

export async function backendMultipartRequest<T>(
  backendApiUrl: string,
  path: string,
  csvContent: string,
  filename: string,
): Promise<T> {
  const form = new FormData();
  form.append('csv_file', new Blob([csvContent], { type: 'text/csv;charset=utf-8' }), filename);
  const response = await fetch(buildUrl(backendApiUrl, path), {
    method: 'POST',
    body: form,
  });
  const responseBody = await parseResponseBody(response);
  if (!response.ok) throw new BackendApiError(response.status, responseBody);
  return responseBody as T;
}

function backendErrorDetails(body: unknown): string | null {
  if (!isRecord(body)) return typeof body === 'string' ? body : null;
  const details: Record<string, unknown> = { ...body };
  delete details.error;
  return Object.keys(details).length > 0 ? JSON.stringify(details, null, 2) : null;
}

export async function toolRequest<T>(operation: string, request: () => Promise<T>) {
  try {
    const result = await request();
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    };
  } catch (error) {
    let message: string;
    if (error instanceof BackendApiError) {
      const details = backendErrorDetails(error.body);
      message = `${operation} failed (HTTP ${error.status}): ${error.message}${details ? `\nDetails: ${details}` : ''}`;
    } else if (error instanceof Error) {
      const causeMessage =
        error.cause instanceof Error
          ? error.cause.message ||
            (isRecord(error.cause) && typeof error.cause.code === 'string'
              ? error.cause.code
              : '')
          : '';
      const cause = causeMessage ? ` (${causeMessage})` : '';
      message = `${operation} failed: ${error.message}${cause}`;
    } else {
      message = `${operation} failed: Unknown network error`;
    }
    return {
      content: [{ type: 'text' as const, text: message }],
      isError: true,
    };
  }
}
