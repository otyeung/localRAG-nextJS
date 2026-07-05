import 'server-only';

import { z } from 'zod';

import { createN8nClient, N8nClient } from '@/lib/n8n/client';
import { N8nError } from '@/lib/n8n/errors';
import { type N8nExecution, n8nExecutionSchema } from '@/lib/n8n/types';

const executionResponseSchema = z.union([
  n8nExecutionSchema,
  z
    .object({
      data: n8nExecutionSchema,
    })
    .transform((result) => result.data),
]);

export class N8nExecutionService {
  constructor(
    private readonly client: Pick<N8nClient, 'get'> = createN8nClient(),
    private readonly options: {
      pollIntervalMs?: number;
      maxPollAttempts?: number;
    } = {},
  ) {}

  async getExecution(executionId: string): Promise<N8nExecution> {
    const response = await this.client.get<unknown>(`/api/v1/executions/${executionId}`, {
      query: { includeData: 'true' },
    });

    try {
      return executionResponseSchema.parse(response);
    } catch (error) {
      if (error instanceof N8nError) {
        throw error;
      }

      throw new N8nError('n8n returned an invalid execution payload.', {
        executionId,
        cause: error instanceof Error ? error.message : error,
      });
    }
  }

  async pollExecution(executionId: string): Promise<N8nExecution> {
    const maxPollAttempts = this.options.maxPollAttempts ?? 10;
    const pollIntervalMs = this.options.pollIntervalMs ?? 1_000;

    for (let attempt = 0; attempt < maxPollAttempts; attempt += 1) {
      const execution = await this.getExecution(executionId);

      if (execution.finished || isTerminalStatus(execution.status)) {
        return execution;
      }

      if (attempt < maxPollAttempts - 1) {
        await new Promise((resolve) => {
          setTimeout(resolve, pollIntervalMs);
        });
      }
    }

    throw new N8nError('Timed out while polling n8n execution status.', {
      executionId,
      maxPollAttempts,
      pollIntervalMs,
    });
  }
}

function isTerminalStatus(status: N8nExecution['status']): boolean {
  return status === 'success' || status === 'error' || status === 'canceled' || status === 'crashed';
}
