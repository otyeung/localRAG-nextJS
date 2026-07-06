import 'server-only';

import { createN8nClient, N8nClient } from '@/lib/n8n/client';
import { N8nError } from '@/lib/n8n/errors';
import {
  documentIngestionInputSchema,
  type DocumentIngestionInput,
} from '@/lib/n8n/documents';
import { type N8nWorkflowStartResult } from '@/lib/n8n/types';
import {
  N8N_DOCUMENT_INGESTION_WEBHOOK_PATH,
  N8N_DOCUMENT_INGESTION_WORKFLOW_KEY,
  N8nWorkflowService,
} from '@/lib/n8n/workflow';

export class N8nIngestionService {
  private readonly workflowService: N8nWorkflowService;

  constructor(client: N8nClient = createN8nClient()) {
    this.workflowService = new N8nWorkflowService(client);
  }

  async startDocumentIngestion(
    input: DocumentIngestionInput,
  ): Promise<N8nWorkflowStartResult> {
    let payload: DocumentIngestionInput;

    try {
      payload = documentIngestionInputSchema.parse(input);
    } catch (error) {
      throw new N8nError('Invalid n8n document ingestion input.', {
        cause: error instanceof Error ? error.message : error,
      });
    }

    try {
      return await this.workflowService.startWorkflow({
        workflowKey: N8N_DOCUMENT_INGESTION_WORKFLOW_KEY,
        entrypointPath: N8N_DOCUMENT_INGESTION_WEBHOOK_PATH,
        payload,
        requestId: payload.requestId,
      });
    } catch (error) {
      if (isAcceptedEmptyWebhookResponse(error)) {
        return {
          executionId: `accepted-${N8N_DOCUMENT_INGESTION_WORKFLOW_KEY}-${payload.requestId ?? Date.now()}`,
          workflowId: null,
          status: 'running',
        };
      }

      throw error;
    }
  }
}

function isAcceptedEmptyWebhookResponse(error: unknown): boolean {
  if (
    !(error instanceof N8nError) ||
    error.message !== 'n8n returned invalid JSON.'
  ) {
    return false;
  }

  const details = error.details as
    { status?: number; cause?: unknown } | undefined;
  return (
    details?.status === 200 &&
    String(details.cause ?? '').includes('Unexpected end of JSON input')
  );
}
