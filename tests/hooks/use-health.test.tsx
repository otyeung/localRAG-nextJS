import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useHealth } from '@/hooks/use-health';

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  const Wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
  Wrapper.displayName = 'HealthQueryClientWrapper';

  return Wrapper;
}

describe('useHealth', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns a 503 unhealthy snapshot as usable health data', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            status: 'unhealthy',
            checkedAt: '2026-01-01T00:00:00.000Z',
            version: '0.1.0',
            uptimeSeconds: 42,
            checks: [
              {
                name: 'database',
                status: 'unhealthy',
                message: 'Database query failed.',
                checkedAt: '2026-01-01T00:00:00.000Z',
                latencyMs: 4,
              },
              {
                name: 'n8n',
                status: 'degraded',
                message: 'n8n API unavailable or workflows could not be listed.',
                checkedAt: '2026-01-01T00:00:00.000Z',
                latencyMs: 9,
              },
            ],
          },
        }),
        {
          status: 503,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );

    const { result } = renderHook(() => useHealth(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toMatchObject({
      supported: true,
      status: 'unhealthy',
      label: 'Unhealthy',
      lastCheckedAt: '2026-01-01T00:00:00.000Z',
      version: '0.1.0',
      uptimeSeconds: 42,
      services: [
        {
          name: 'Database',
          status: 'unhealthy',
          detail: 'Database query failed. (4ms)',
        },
        {
          name: 'n8n',
          status: 'degraded',
          detail: 'n8n API unavailable or workflows could not be listed. (9ms)',
        },
      ],
    });
  });

  it('throws when a 503 response does not include a valid health snapshot', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: { message: 'Service unavailable.' } }), {
        status: 503,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const { result } = renderHook(() => useHealth(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe('Health response was malformed.');
  });
});
