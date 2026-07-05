import 'server-only';

import { createN8nClient, N8nClient } from '@/lib/n8n/client';
import { documentIngestionInputSchema, type DocumentIngestionInput } from '@/lib/n8n/documents';
import { type N8nWorkflowStartResult } from '@/lib/n8n/types';
import { N8N_DOCUMENT_INGESTION_WORKFLOW_KEY, N8nWorkflowService } from '@/lib/n8n/workflow';

export class N8nIngestionService {
  private readonly workflowService: N8nWorkflowService;

  constructor(client: N8nClient = createN8nClient()) {
    this.workflowService = new N8nWorkflowService(client);
  }

  async startDocumentIngestion(input: DocumentIngestionInput): Promise<N8nWorkflowStartResult> {
    const payload = documentIngestionInputSchema.parse(input);

    return this.workflowService.startWorkflow({
      workflowKey: N8N_DOCUMENT_INGESTION_WORKFLOW_KEY,
      payload,
      requestId: payload.requestId,
    });
  }
}
