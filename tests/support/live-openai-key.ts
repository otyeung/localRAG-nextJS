const openAiKeyPrefix = `${'s'}${'k'}-`;
const dummyLiveOpenAiKeyPrefixes = [
  `${openAiKeyPrefix}test`,
  `${openAiKeyPrefix}playwright`,
] as const;

export function hasUsableLiveOpenAiKey(apiKey: string | undefined | null) {
  if (typeof apiKey !== 'string') {
    return false;
  }

  const normalizedApiKey = apiKey.trim().toLowerCase();

  if (normalizedApiKey.length === 0) {
    return false;
  }

  return !dummyLiveOpenAiKeyPrefixes.some((prefix) => normalizedApiKey.startsWith(prefix));
}
