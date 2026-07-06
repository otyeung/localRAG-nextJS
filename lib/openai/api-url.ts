export const DEFAULT_OPENAI_API_URL = 'https://api.openai.com/v1';
const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1']);

export function isHostedOpenAiApiUrl(apiUrl: string): boolean {
  return new URL(apiUrl).hostname === 'api.openai.com';
}

export function normalizeOpenAiChatCompletionsBaseUrl(
  apiUrl: string,
  options: {
    docker?: boolean;
  } = {},
): string {
  const url = new URL(apiUrl);

  if (options.docker && LOCAL_HOSTNAMES.has(url.hostname)) {
    url.hostname = 'host.docker.internal';
  }

  const normalized = url.toString().replace(/\/$/, '');
  if (normalized.endsWith('/v1')) {
    return normalized;
  }

  return `${normalized}/v1`;
}
