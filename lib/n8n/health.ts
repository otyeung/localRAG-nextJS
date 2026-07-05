import 'server-only';

import { createN8nClient, N8nClient } from '@/lib/n8n/client';
import { N8nWorkflowService } from '@/lib/n8n/workflow';
import { n8nHealthResponseSchema, type N8nHealthResponse } from '@/lib/n8n/types';

export type N8nHealthStatus = {
  healthy: boolean;
  api: N8nHealthResponse | null;
  workflowCount: number;
};

export class N8nHealthService {
  private readonly workflowService: N8nWorkflowService;

  constructor(private readonly client: N8nClient = createN8nClient()) {
    this.workflowService = new N8nWorkflowService(client);
  }

  async getStatus(requestId?: string): Promise<N8nHealthStatus> {
    try {
      const [api, workflows] = await Promise.all([
        this.client.get('/healthz', {
          requestId,
          schema: n8nHealthResponseSchema,
        }),
        this.workflowService.listActiveWorkflows(requestId),
      ]);

      return {
        healthy: api.status.toLowerCase() === 'ok',
        api,
        workflowCount: workflows.length,
      };
    } catch {
      return {
        healthy: false,
        api: null,
        workflowCount: 0,
      };
    }
  }
}
