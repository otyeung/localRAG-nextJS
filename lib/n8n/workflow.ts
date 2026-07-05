import 'server-only';

import { z } from 'zod';

import { createN8nClient, N8nClient } from '@/lib/n8n/client';
import { N8nError, toN8nError } from '@/lib/n8n/errors';
import {
  n8nWorkflowListSchema,
  n8nWorkflowStartResultSchema,
  type N8nWorkflow,
  type N8nWorkflowStartResult,
} from '@/lib/n8n/types';

export const N8N_DOCUMENT_INGESTION_WORKFLOW_KEY = 'ingestion';
export const N8N_RETRIEVAL_WORKFLOW_KEY = 'retrieval';

export type StartWorkflowInput = {
  workflowKey: string;
  entrypointPath?: string;
  payload: Record<string, unknown>;
  requestId?: string;
};

const workflowStartResponseSchema = z.union([
  n8nWorkflowStartResultSchema,
  z
    .object({
      data: n8nWorkflowStartResultSchema,
    })
    .transform((result) => result.data),
]);

export class N8nWorkflowService {
  constructor(private readonly client: N8nClient = createN8nClient()) {}

  async listActiveWorkflows(requestId?: string): Promise<N8nWorkflow[]> {
    const workflows: N8nWorkflow[] = [];
    let cursor: string | undefined;

    do {
      const page = await this.client.get('/api/v1/workflows', {
        query: {
          active: 'true',
          cursor,
        },
        requestId,
        schema: n8nWorkflowListSchema,
      });

      workflows.push(...page.data);
      cursor = page.nextCursor ?? undefined;
    } while (cursor);

    return workflows;
  }

  async startWorkflow(input: StartWorkflowInput): Promise<N8nWorkflowStartResult> {
    const entrypointPath = input.entrypointPath ?? input.workflowKey;

    try {
      return await this.client.post(`/webhook/${entrypointPath}`, {
        body: input.payload,
        requestId: input.requestId,
        schema: workflowStartResponseSchema,
      });
    } catch (error) {
      if (error instanceof N8nError) {
        throw error;
      }

      throw toN8nError(error, `Unable to start n8n workflow "${input.workflowKey}".`);
    }
  }
}
