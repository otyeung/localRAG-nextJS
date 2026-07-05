import 'server-only';

import { Agent } from '@openai/agents';

import { env } from '@/lib/config/env';

import { createConversationHistoryTool } from '@/agents/tools/conversation-history';
import { createListDocumentsTool } from '@/agents/tools/list-documents';
import { createRetrieveChunksTool } from '@/agents/tools/retrieve-chunks';
import type { AgentToolRuntimeContext } from '@/agents/tools/shared';

export const DocumentAgent = new Agent<AgentToolRuntimeContext>({
  name: 'DocumentAgent',
  instructions:
    'You specialize in document-grounded answers. Prefer retrieve_chunks for questions about uploaded content, summarize evidence clearly, and cite chunk documentName and chunkIndex inline.',
  handoffDescription: 'Focused on document-grounded answers over uploaded files.',
  model: env.openai.model,
  tools: [createRetrieveChunksTool(), createListDocumentsTool(), createConversationHistoryTool()],
});
