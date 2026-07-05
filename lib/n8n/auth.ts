export type N8nAuthHeadersInput = {
  apiKey: string;
  bearerToken?: string;
  requestId?: string;
  headers?: Record<string, string>;
  withJsonContentType?: boolean;
};

export function createN8nHeaders(input: N8nAuthHeadersInput): Record<string, string> {
  const headers: Record<string, string> = {
    ...input.headers,
    'X-N8N-API-KEY': input.apiKey,
  };

  if (input.bearerToken) {
    headers.Authorization = `Bearer ${input.bearerToken}`;
  }

  if (input.requestId) {
    headers['x-request-id'] = input.requestId;
  }

  if (input.withJsonContentType) {
    headers['content-type'] = 'application/json';
  }

  return headers;
}
