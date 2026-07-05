import 'server-only';

import { Agent } from '@openai/agents';

import { env } from '@/lib/config/env';

import { createConversationHistoryTool } from '@/agents/tools/conversation-history';
import { createRetrieveChunksTool } from '@/agents/tools/retrieve-chunks';
import { createSearchConversationTool } from '@/agents/tools/search-conversation';
import type { AgentToolRuntimeContext } from '@/agents/tools/shared';
import { createWorkflowStatusTool } from '@/agents/tools/workflow-status';

export const RetrievalAgent = new Agent<AgentToolRuntimeContext>({
  name: 'RetrievalAgent',
  instructions:
    'You focus on retrieval planning. Decide when to inspect conversation history, search earlier messages, or retrieve document chunks before answering.',
  handoffDescription: 'Focused on retrieval planning and evidence gathering.',
  model: env.openai.model,
  tools: [
    createRetrieveChunksTool(),
    createConversationHistoryTool(),
    createSearchConversationTool(),
    createWorkflowStatusTool(),
  ],
});
