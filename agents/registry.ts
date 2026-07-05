import 'server-only';

import type { Agent } from '@openai/agents';

import { DocumentAgent } from '@/agents/document-agent';
import { GeneralAssistantAgent } from '@/agents/general-assistant-agent';
import { RetrievalAgent } from '@/agents/retrieval-agent';
import type { AgentToolRuntimeContext } from '@/agents/tools/shared';

export const agentRegistry = new Map<string, Agent<AgentToolRuntimeContext>>([
  [GeneralAssistantAgent.name, GeneralAssistantAgent],
  [DocumentAgent.name, DocumentAgent],
  [RetrievalAgent.name, RetrievalAgent],
]);

export const defaultAgentName = GeneralAssistantAgent.name;
