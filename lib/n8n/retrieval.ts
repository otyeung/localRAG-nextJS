import 'server-only';

import { z } from 'zod';

import { createN8nClient, N8nClient } from '@/lib/n8n/client';
import { retrievalInputSchema, type RetrievalInput } from '@/lib/n8n/documents';
import { retrievedChunkSchema, type RetrievedChunk } from '@/lib/n8n/types';
import { N8N_RETRIEVAL_WORKFLOW_KEY } from '@/lib/n8n/workflow';

const retrievalResponseSchema = z.union([
  z.array(retrievedChunkSchema),
  z
    .object({
      chunks: z.array(retrievedChunkSchema),
    })
    .transform((result) => result.chunks),
]);

export class N8nRetrievalService {
  constructor(private readonly client: Pick<N8nClient, 'post'> = createN8nClient()) {}

  async retrieve(input: RetrievalInput): Promise<RetrievedChunk[]> {
    const payload = retrievalInputSchema.parse(input);

    return this.client.post(`/webhook/${N8N_RETRIEVAL_WORKFLOW_KEY}`, {
      body: payload,
      requestId: payload.requestId,
      schema: retrievalResponseSchema,
    });
  }
}
