export type N8nAuthHeadersInput = {
  apiKey?: string | null;
  bearerToken?: string;
  webhookSecret?: string;
  requestId?: string;
  headers?: Record<string, string>;
  withJsonContentType?: boolean;
};

export const N8N_WEBHOOK_SECRET_HEADER = 'x-n8n-webhook-secret';

export function createN8nHeaders(input: N8nAuthHeadersInput): Record<string, string> {
  const headers: Record<string, string> = {
    ...input.headers,
  };

  if (input.apiKey) {
    headers['X-N8N-API-KEY'] = input.apiKey;
  }

  if (input.webhookSecret) {
    headers[N8N_WEBHOOK_SECRET_HEADER] = input.webhookSecret;
  }

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
