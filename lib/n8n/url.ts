export function resolveN8nUrl(baseUrl: string, path: string): URL {
  const normalizedBaseUrl = baseUrl.replace(/\/$/, '');
  const normalizedPath = path.startsWith('/') ? path.slice(1) : path;

  return new URL(normalizedPath, `${normalizedBaseUrl}/`);
}
