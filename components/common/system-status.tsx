'use client';

import { StatusBadge } from '@/components/common/status-badge';
import type { UseHealthResult } from '@/hooks/use-health';

function toTone(status: string) {
  switch (status) {
    case 'healthy':
      return 'success' as const;
    case 'degraded':
      return 'warning' as const;
    case 'unhealthy':
      return 'danger' as const;
    default:
      return 'neutral' as const;
  }
}

export function SystemStatus({ health }: { health: UseHealthResult }) {
  const label = health.data?.label ?? (health.isLoading ? 'Checking' : 'Health unavailable');
  const tone = health.isError ? 'danger' : toTone(health.data?.status ?? 'neutral');
  const body = health.isError
    ? health.error instanceof Error && health.error.message
      ? health.error.message
      : 'Unable to load system health.'
    : health.isLoading
      ? 'Checking the /api/health endpoint for the latest system status.'
      : 'The health endpoint responded without per-service details.';

  return (
    <section className="rounded-[1.75rem] border border-[color:var(--border-soft)] bg-[color:var(--panel-elevated)] p-5 shadow-[var(--shadow-panel)]">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-[color:var(--text-strong)]">System Status</h3>
          <p className="mt-1 text-sm text-[color:var(--text-muted)]">Infrastructure telemetry and service health snapshots.</p>
        </div>
        <StatusBadge label={label} tone={tone} />
      </div>
      {health.data?.lastCheckedAt ? (
        <p className="mt-3 text-xs text-[color:var(--text-dim)]">
          Last checked{' '}
          <time dateTime={health.data.lastCheckedAt}>{health.data.lastCheckedAt}</time>
        </p>
      ) : null}
      <div className="mt-4 space-y-3">
        {health.data?.services?.length ? (
          health.data.services.map((service) => (
            <div
              key={service.name}
              className="rounded-2xl border border-[color:var(--border-soft)] bg-[color:var(--panel-subtle)] px-4 py-3"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-medium text-[color:var(--text-strong)]">{service.name}</span>
                <StatusBadge label={service.status} tone={toTone(service.status)} />
              </div>
              {service.detail ? <p className="mt-2 text-xs text-[color:var(--text-dim)]">{service.detail}</p> : null}
            </div>
          ))
        ) : (
          <div
            role={health.isError ? 'alert' : undefined}
            className="rounded-2xl border border-dashed border-[color:var(--border-strong)] bg-[color:var(--panel-subtle)] p-4 text-sm text-[color:var(--text-muted)]"
          >
            {body}
          </div>
        )}
      </div>
    </section>
  );
}
