import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { N8nExecutionService } from '@/lib/n8n/executions';

describe('N8nExecutionService', () => {
  it('fetches execution details with includeData and normalizes status', async () => {
    const client = {
      get: vi.fn().mockResolvedValue({
        id: 'exec_123',
        workflowId: 'workflow_123',
        status: 'FAILED',
        startedAt: '2026-07-05T12:00:00.000Z',
        stoppedAt: '2026-07-05T12:01:00.000Z',
        finished: true,
        data: {
          resultData: {
            runData: {},
          },
        },
      }),
    };

    const service = new N8nExecutionService(client as never);

    await expect(service.getExecution('exec_123')).resolves.toMatchObject({
      id: 'exec_123',
      status: 'error',
      finished: true,
    });
    expect(client.get).toHaveBeenCalledWith('/api/v1/executions/exec_123', {
      query: { includeData: 'true' },
    });
  });

  it('polls executions until a terminal status is reached', async () => {
    const client = {
      get: vi
        .fn()
        .mockResolvedValueOnce({
          id: 'exec_123',
          status: 'running',
          finished: false,
        })
        .mockResolvedValueOnce({
          id: 'exec_123',
          status: 'success',
          finished: true,
        }),
    };

    const service = new N8nExecutionService(client as never, {
      pollIntervalMs: 1,
      maxPollAttempts: 3,
    });

    await expect(service.pollExecution('exec_123')).resolves.toMatchObject({
      id: 'exec_123',
      status: 'success',
      finished: true,
    });
    expect(client.get).toHaveBeenCalledTimes(2);
  });
});
