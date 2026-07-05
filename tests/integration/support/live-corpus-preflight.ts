export type LiveCorpusDependencyReadiness = {
  n8nReady: boolean;
  qdrantReady: boolean;
  databaseReady: boolean;
  openAiReady: boolean;
};

export function summarizeLiveCorpusPreflight({
  liveCorpusEnabled,
  dependencyReadiness,
}: {
  liveCorpusEnabled: boolean;
  dependencyReadiness?: LiveCorpusDependencyReadiness;
}) {
  if (!liveCorpusEnabled) {
    return {
      shouldRun: false,
      skipReason: 'Set LOCALRAG_LIVE_CORPUS_TESTS=1 to run live corpus retrieval validation.',
    };
  }

  const unavailableDependencies = [
    ['n8n', dependencyReadiness?.n8nReady ?? false],
    ['qdrant', dependencyReadiness?.qdrantReady ?? false],
    ['database', dependencyReadiness?.databaseReady ?? false],
    ['openai', dependencyReadiness?.openAiReady ?? false],
  ]
    .filter(([, isReady]) => !isReady)
    .map(([name]) => name);

  if (unavailableDependencies.length > 0) {
    return {
      shouldRun: false,
      skipReason: `Required live dependencies are unavailable: ${unavailableDependencies.join(', ')}.`,
    };
  }

  return {
    shouldRun: true,
    skipReason: null,
  };
}
