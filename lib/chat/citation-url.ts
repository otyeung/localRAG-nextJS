const SAFE_PROTOCOLS = new Set(['http:', 'https:']);

function isSafeRelativeUrl(url: string) {
  return (
    (url.startsWith('/') && !url.startsWith('//')) ||
    url.startsWith('./') ||
    url.startsWith('../') ||
    url.startsWith('?') ||
    url.startsWith('#')
  );
}

export function getSafeCitationUrl(url: string): string | null {
  const trimmedUrl = url.trim();

  if (!trimmedUrl) {
    return null;
  }

  if (isSafeRelativeUrl(trimmedUrl)) {
    return trimmedUrl;
  }

  try {
    const parsedUrl = new URL(trimmedUrl);
    return SAFE_PROTOCOLS.has(parsedUrl.protocol) ? parsedUrl.toString() : null;
  } catch {
    return null;
  }
}
