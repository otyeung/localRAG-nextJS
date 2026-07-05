import { createHash } from 'node:crypto';

import { nanoid } from 'nanoid';

export const ANONYMOUS_COOKIE_NAME = 'localrag_anonymous_id';
const ANONYMOUS_FINGERPRINT_LENGTH = 32;
const ANONYMOUS_FINGERPRINT_PATTERN = /^[A-Za-z0-9_-]{32}$/;

export async function createAnonymousFingerprintHash(fingerprint: string): Promise<string> {
  return createHash('sha256').update(`localrag-nextjs:${fingerprint}`).digest('hex');
}

export function createAnonymousFingerprint(): string {
  return nanoid(ANONYMOUS_FINGERPRINT_LENGTH);
}

export function isAnonymousFingerprint(value: string | undefined): value is string {
  return value !== undefined && ANONYMOUS_FINGERPRINT_PATTERN.test(value);
}

export function getCookieValue(request: Request, name: string): string | undefined {
  const cookieHeader = request.headers.get('cookie');

  if (!cookieHeader) {
    return undefined;
  }

  for (const part of cookieHeader.split(';')) {
    const [key, ...valueParts] = part.trim().split('=');

    if (key === name) {
      return valueParts.join('=');
    }
  }

  return undefined;
}

export function getAnonymousCookieValue(request: Request): string | undefined {
  return getCookieValue(request, ANONYMOUS_COOKIE_NAME);
}
