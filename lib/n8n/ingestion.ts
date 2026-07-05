import 'server-only';

import { createN8nClient, N8nClient } from '@/lib/n8n/client';
import { N8nError } from '@/lib/n8n/errors';
import { documentIngestionInputSchema, type DocumentIngestionInput } from '@/lib/n8n/documents';
import { type N8nWorkflowStartResult } from '@/lib/n8n/types';
import { N8N_DOCUMENT_INGESTION_WORKFLOW_KEY, N8nWorkflowService } from '@/lib/n8n/workflow';

export class N8nIngestionService {
  private readonly workflowService: N8nWorkflowService;

  constructor(client: N8nClient = createN8nClient()) {
    this.workflowService = new N8nWorkflowService(client);
  }

  async startDocumentIngestion(input: DocumentIngestionInput): Promise<N8nWorkflowStartResult> {
    let payload: DocumentIngestionInput;

    try {
      payload = documentIngestionInputSchema.parse(input);
    } catch (error) {
      throw new N8nError('Invalid n8n document ingestion input.', {
        cause: error instanceof Error ? error.message : error,
      });
    }

    return this.workflowService.startWorkflow({
      workflowKey: N8N_DOCUMENT_INGESTION_WORKFLOW_KEY,
      payload,
      requestId: payload.requestId,
    });
  }
}
