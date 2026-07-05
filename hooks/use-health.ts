'use client';

import { useQuery } from '@tanstack/react-query';

type HealthService = {
  name: string;
  status: string;
  detail?: string;
};

type HealthSnapshot = {
  supported: boolean;
  status: string;
  label: string;
  services: HealthService[];
};

type ApiResponse<T> = { data: T };

function normalizeServices(value: unknown): HealthService[] {
  if (Array.isArray(value)) {
    return value
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
      .map((item, index) => ({
        name: typeof item.name === 'string' ? item.name : `Service ${index + 1}`,
        status: typeof item.status === 'string' ? item.status : 'unknown',
        detail: typeof item.detail === 'string' ? item.detail : undefined,
      }));
  }

  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).map(([name, status]) => ({
      name,
      status: typeof status === 'string' ? status : 'unknown',
    }));
  }

  return [];
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

  const body = (await response.json().catch(() => null)) as
    | ApiResponse<Record<string, unknown>>
    | { error?: { message?: string } }
    | null;

  if (!response.ok) {
    throw new Error(body && 'error' in body ? body.error?.message ?? 'Unable to load system health.' : 'Unable to load system health.');
  }

  const data = (body as ApiResponse<Record<string, unknown>>).data;
  const status = typeof data.status === 'string' ? data.status : 'available';

  return {
    supported: true,
    status,
    label: status === 'healthy' ? 'Healthy' : status === 'degraded' ? 'Degraded' : 'Available',
    services: normalizeServices(data.services),
  };
}

export function useHealth() {
  return useQuery({
    queryKey: ['health'],
    queryFn: requestHealth,
    refetchInterval: 30_000,
  });
}
