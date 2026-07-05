import 'server-only';

import { z } from 'zod';

import { env } from '@/lib/config/env';
import { logger } from '@/lib/logger/logger';
import { createN8nHeaders } from '@/lib/n8n/auth';
import { N8nError, toN8nError } from '@/lib/n8n/errors';

const transientStatusCodes = new Set([408, 429]);

type FetchFn = typeof fetch;

export type N8nClientOptions = {
  baseUrl: string;
  apiKey: string;
  bearerToken?: string;
  timeoutMs: number;
  retryCount: number;
  retryDelayMs: number;
  fetchFn?: FetchFn;
};

export type N8nRequest<T> = {
  method: 'GET' | 'POST';
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  headers?: Record<string, string>;
  requestId?: string;
  schema?: z.ZodType<T>;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isRetryableStatus(status: number): boolean {
  return transientStatusCodes.has(status) || status >= 500;
}

function isRetryableError(error: unknown): boolean {
  if (!(error instanceof N8nError) || typeof error.details !== 'object' || error.details === null) {
    return false;
  }

  const details = error.details as {
    status?: number;
    retryable?: boolean;
    kind?: string;
  };

  if (details.retryable) {
    return true;
  }

  if (details.kind === 'transport' || details.kind === 'timeout') {
    return true;
  }

  return typeof details.status === 'number' ? isRetryableStatus(details.status) : false;
}

export class N8nClient {
  private readonly fetchFn: FetchFn;
  private readonly requestLogger = logger.child({ service: 'n8n-client' });
  private consecutiveFailures = 0;
  private circuitOpenUntil = 0;

  constructor(private readonly options: N8nClientOptions) {
    this.fetchFn = options.fetchFn ?? fetch;
  }

  async get<T>(path: string, input: Omit<N8nRequest<T>, 'method' | 'path'> = {}): Promise<T> {
    return this.request({ ...input, method: 'GET', path });
  }

  async post<T>(path: string, input: Omit<N8nRequest<T>, 'method' | 'path'> = {}): Promise<T> {
    return this.request({ ...input, method: 'POST', path });
  }

  async request<T>(input: N8nRequest<T>): Promise<T> {
    if (Date.now() < this.circuitOpenUntil) {
      throw new N8nError('n8n circuit breaker is open.', {
        retryAt: new Date(this.circuitOpenUntil).toISOString(),
      });
    }

    let lastError: unknown;

    for (let attempt = 0; attempt <= this.options.retryCount; attempt += 1) {
      try {
        const result = await this.performRequest(input);
        this.consecutiveFailures = 0;
        this.circuitOpenUntil = 0;
        return result;
      } catch (error) {
        lastError = error;
        const retryable = isRetryableError(error);

        if (!retryable || attempt === this.options.retryCount) {
          this.recordFailure(error, input);
          throw error;
        }

        const delayMs = this.options.retryDelayMs * 2 ** attempt;
        this.requestLogger.warn(
          {
            attempt: attempt + 1,
            delayMs,
            path: input.path,
            requestId: input.requestId,
          },
          'Retrying n8n request after transient failure.',
        );
        await sleep(delayMs);
      }
    }

    this.recordFailure(lastError, input);
    throw toN8nError(lastError, 'n8n request failed.');
  }

  private recordFailure(error: unknown, input: Pick<N8nRequest<unknown>, 'path' | 'requestId'>): void {
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= Math.max(2, this.options.retryCount + 1)) {
      this.circuitOpenUntil = Date.now() + Math.max(1_000, this.options.retryDelayMs * 4);
    }

    this.requestLogger.error(
      {
        path: input.path,
        requestId: input.requestId,
        consecutiveFailures: this.consecutiveFailures,
        error,
      },
      'n8n request failed.',
    );
  }

  private async performRequest<T>(input: N8nRequest<T>): Promise<T> {
    const url = new URL(input.path, `${this.options.baseUrl}/`);

    for (const [key, value] of Object.entries(input.query ?? {})) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }

    const headers = createN8nHeaders({
      apiKey: this.options.apiKey,
      bearerToken: this.options.bearerToken,
      requestId: input.requestId,
      headers: input.headers,
      withJsonContentType: input.body !== undefined,
    });

    let response: Response;

    try {
      response = await this.fetchFn(url.toString(), {
        method: input.method,
        headers,
        body: input.body === undefined ? undefined : JSON.stringify(input.body),
        signal: AbortSignal.timeout(this.options.timeoutMs),
      });
    } catch (error) {
      throw this.toTransportError(error, input);
    }

    const payload = await this.readResponseBody(response);

    if (!response.ok) {
      throw new N8nError('n8n request failed.', {
        status: response.status,
        body: payload,
        path: input.path,
        requestId: input.requestId,
      });
    }

    if (!input.schema) {
      return payload as T;
    }

    try {
      return input.schema.parse(payload);
    } catch (error) {
      throw toN8nError(error, 'n8n returned an invalid response payload.');
    }
  }

  private toTransportError(error: unknown, input: Pick<N8nRequest<unknown>, 'path' | 'requestId'>): N8nError {
    const isAbortError =
      (error instanceof Error && error.name === 'AbortError') ||
      (error instanceof DOMException && error.name === 'AbortError');

    return new N8nError(
      isAbortError ? 'n8n request timed out.' : 'n8n request could not be completed.',
      {
        kind: isAbortError ? 'timeout' : 'transport',
        cause: error instanceof Error ? error.message : error,
        path: input.path,
        requestId: input.requestId,
        retryable: true,
      },
    );
  }

  private async readResponseBody(response: Response): Promise<unknown> {
    const contentType = response.headers.get('content-type') ?? '';

    if (contentType.includes('application/json')) {
      try {
        return await response.json();
      } catch (error) {
        throw new N8nError('n8n returned invalid JSON.', {
          status: response.status,
          cause: error instanceof Error ? error.message : error,
        });
      }
    }

    const text = await response.text();
    return text.length > 0 ? text : null;
  }
}

export function createN8nClient(options: Partial<N8nClientOptions> = {}): N8nClient {
  return new N8nClient({
    baseUrl: options.baseUrl ?? env.n8n.baseUrl,
    apiKey: options.apiKey ?? env.n8n.apiKey,
    bearerToken: options.bearerToken,
    timeoutMs: options.timeoutMs ?? env.n8n.timeoutMs,
    retryCount: options.retryCount ?? env.n8n.retryCount,
    retryDelayMs: options.retryDelayMs ?? env.n8n.retryDelayMs,
    fetchFn: options.fetchFn,
  });
}
