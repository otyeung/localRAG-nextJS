import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { SystemStatus } from '@/components/common/system-status';
import type { UseHealthResult } from '@/hooks/use-health';

describe('SystemStatus', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders real system health details from /api/health data', () => {
    const health = {
      data: {
        supported: true,
        status: 'degraded',
        label: 'Degraded',
        lastCheckedAt: '2026-01-01T00:00:00.000Z',
        services: [
          {
            name: 'Database',
            status: 'healthy',
            detail: 'Database connection verified.',
          },
          {
            name: 'n8n',
            status: 'degraded',
            detail: 'n8n API unavailable or workflows could not be listed.',
          },
        ],
      },
      isLoading: false,
      isError: false,
      error: null,
    } satisfies UseHealthResult;

    render(<SystemStatus health={health} />);

    expect(screen.getByText('System Status')).toBeInTheDocument();
    expect(screen.getByText('Degraded')).toBeInTheDocument();
    expect(screen.getByText('2026-01-01T00:00:00.000Z')).toBeInTheDocument();
    expect(screen.getByText('Database')).toBeInTheDocument();
    expect(screen.getByText('n8n API unavailable or workflows could not be listed.')).toBeInTheDocument();
  });

  it('renders an alert state when the health request fails', () => {
    const health = {
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error('Unable to load system health.'),
    } satisfies UseHealthResult;

    render(<SystemStatus health={health} />);

    expect(screen.getByRole('alert')).toHaveTextContent('Unable to load system health.');
  });

  it('shows health unavailable when the route is missing', () => {
    const health = {
      data: undefined,
      isLoading: false,
      isError: false,
      error: null,
    } satisfies UseHealthResult;

    render(<SystemStatus health={health} />);

    expect(screen.getByText('Health unavailable')).toBeInTheDocument();
  });
});
