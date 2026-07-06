import 'server-only';

import { setDefaultOpenAIKey, setOpenAIAPI } from '@openai/agents';

import { env } from '@/lib/config/env';
import {
  isHostedOpenAiApiUrl,
  normalizeOpenAiChatCompletionsBaseUrl,
} from '@/lib/openai/api-url';

const chatCompletionsBaseUrl = normalizeOpenAiChatCompletionsBaseUrl(
  env.openai.apiUrl,
  {
    docker: process.env.LOCALRAG_DOCKER === 'true',
  },
);

setDefaultOpenAIKey(env.openai.apiKey);

if (!isHostedOpenAiApiUrl(env.openai.apiUrl)) {
  process.env.OPENAI_BASE_URL = chatCompletionsBaseUrl;
  setOpenAIAPI('chat_completions');
}

export const openAiRuntime = {
  chatCompletionsBaseUrl,
  usesHostedOpenAi: isHostedOpenAiApiUrl(env.openai.apiUrl),
};
