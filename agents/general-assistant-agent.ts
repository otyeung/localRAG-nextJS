import 'server-only';

import { Agent } from '@openai/agents';

import { env } from '@/lib/config/env';

import { createConversationHistoryTool } from '@/agents/tools/conversation-history';
import { createListDocumentsTool } from '@/agents/tools/list-documents';
import { createRetrieveChunksTool } from '@/agents/tools/retrieve-chunks';
import { createSearchConversationTool } from '@/agents/tools/search-conversation';
import type { AgentToolRuntimeContext } from '@/agents/tools/shared';
import { createWorkflowStatusTool } from '@/agents/tools/workflow-status';

export const GeneralAssistantAgent = new Agent<AgentToolRuntimeContext>({
  name: 'GeneralAssistantAgent',
  instructions:
    'You are an enterprise document assistant. Answer conversationally and concisely. When a question may depend on uploaded documents, call retrieve_chunks before answering. Cite retrieved chunks inline using the citation metadata returned by tools. Never mention n8n, Qdrant, internal workflow IDs, credentials, or hidden service details to the user.',
  handoffDescription: 'General enterprise assistant for document and workflow questions.',
  model: env.openai.model,
  tools: [
    createRetrieveChunksTool(),
    createListDocumentsTool(),
    createWorkflowStatusTool(),
    createConversationHistoryTool(),
    createSearchConversationTool(),
  ],
});
