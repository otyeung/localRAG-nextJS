'use client';

import { useQuery, type UseQueryResult } from '@tanstack/react-query';

type HealthService = {
  name: string;
  status: 'healthy' | 'degraded' | 'unhealthy';
  detail?: string;
};

type HealthSnapshot = {
  supported: boolean;
  status: 'healthy' | 'degraded' | 'unhealthy' | 'pending';
  label: string;
  lastCheckedAt?: string;
  version?: string;
  uptimeSeconds?: number;
  services: HealthService[];
};

type ApiResponse<T> = { data: T };

type HealthResponseBody = ApiResponse<Record<string, unknown>>;

type HealthCheck = {
  name: string;
  status: 'healthy' | 'degraded' | 'unhealthy';
  message?: string;
  latencyMs?: number;
};

const serviceLabel: Record<string, string> = {
  app: 'Application',
  database: 'Database',
  n8n: 'n8n',
  qdrant: 'Qdrant',
  openai: 'OpenAI',
};

function normalizeServices(value: unknown): HealthService[] {
  if (Array.isArray(value)) {
    return value
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
      .map((item, index) => {
        const check = item as Partial<HealthCheck> & { detail?: string };
        const status = check.status === 'healthy' || check.status === 'degraded' || check.status === 'unhealthy' ? check.status : 'degraded';
        const detail = typeof check.message === 'string' ? check.message : typeof check.detail === 'string' ? check.detail : undefined;
        const latencyMs = typeof check.latencyMs === 'number' ? check.latencyMs : undefined;

        return {
          name: typeof check.name === 'string' ? (serviceLabel[check.name] ?? check.name) : `Service ${index + 1}`,
          status,
          detail: detail ? (latencyMs !== undefined ? `${detail} (${latencyMs}ms)` : detail) : latencyMs !== undefined ? `${latencyMs}ms` : undefined,
        };
      });
  }

  return [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isHealthResponseBody(body: unknown): body is HealthResponseBody {
  return isRecord(body) && isRecord(body.data);
}

function normalizeHealthSnapshot(body: HealthResponseBody): HealthSnapshot {
  const data = body.data;
  const status =
    data.status === 'healthy' || data.status === 'degraded' || data.status === 'unhealthy' || data.status === 'pending'
      ? data.status
      : null;

  if (!status) {
    throw new Error('Health response was malformed.');
  }

  return {
    supported: true,
    status,
    label: status === 'healthy' ? 'Healthy' : status === 'degraded' ? 'Degraded' : status === 'unhealthy' ? 'Unhealthy' : 'Available',
    lastCheckedAt: typeof data.checkedAt === 'string' ? data.checkedAt : undefined,
    version: typeof data.version === 'string' ? data.version : undefined,
    uptimeSeconds: typeof data.uptimeSeconds === 'number' ? data.uptimeSeconds : undefined,
    services: normalizeServices(data.checks ?? data.services),
  };
}

function normalizeErrorMessage(body: unknown) {
  if (isRecord(body) && isRecord(body.error) && typeof body.error.message === 'string' && body.error.message) {
    return body.error.message;
  }

  return 'Unable to load system health.';
}

async function requestHealth(): Promise<HealthSnapshot> {
  const response = await fetch('/api/health');

  if (response.status === 404) {
    return {
      supported: false,
      status: 'pending',
      label: 'Pending Task 9',
      services: [],
    };
  }

  const body = (await response.json().catch(() => null)) as unknown;

  if (response.status === 503) {
    if (isHealthResponseBody(body)) {
      return normalizeHealthSnapshot(body);
    }

    throw new Error('Health response was malformed.');
  }

  if (!response.ok) {
    throw new Error(normalizeErrorMessage(body));
  }

  if (!isHealthResponseBody(body)) {
    throw new Error('Health response was malformed.');
  }

  return normalizeHealthSnapshot(body);
}

export type { HealthService, HealthSnapshot };
export type UseHealthResult = Pick<UseQueryResult<HealthSnapshot, Error>, 'data' | 'isLoading' | 'isError' | 'error'>;

export function useHealth(): UseQueryResult<HealthSnapshot, Error> {
  return useQuery({
    queryKey: ['health'],
    queryFn: requestHealth,
    refetchInterval: 30_000,
  });
}
