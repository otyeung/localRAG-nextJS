import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

import { nanoid } from 'nanoid';

import { env } from '@/lib/config/env';

export const ANONYMOUS_COOKIE_NAME = 'localrag_anonymous_id';
const ANONYMOUS_FINGERPRINT_LENGTH = 32;
const ANONYMOUS_FINGERPRINT_PATTERN = /^[A-Za-z0-9_-]{32}$/;
const ANONYMOUS_SIGNATURE_PATTERN = /^[a-f0-9]{64}$/;

export async function createAnonymousFingerprintHash(fingerprint: string): Promise<string> {
  return createHash('sha256').update(`localrag-nextjs:${fingerprint}`).digest('hex');
}

export function createAnonymousFingerprint(): string {
  return nanoid(ANONYMOUS_FINGERPRINT_LENGTH);
}

export function isAnonymousFingerprint(value: string | undefined): value is string {
  return value !== undefined && ANONYMOUS_FINGERPRINT_PATTERN.test(value);
}

function createAnonymousCookieSignature(fingerprint: string): string {
  return createHmac('sha256', env.auth.anonymousCookieSecret).update(fingerprint).digest('hex');
}

export function createAnonymousCookieValue(fingerprint: string): string {
  return `${fingerprint}.${createAnonymousCookieSignature(fingerprint)}`;
}

export function verifyAnonymousCookieValue(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const [fingerprint, signature, ...rest] = value.split('.');
  if (rest.length > 0 || !isAnonymousFingerprint(fingerprint) || !signature || !ANONYMOUS_SIGNATURE_PATTERN.test(signature)) {
    return undefined;
  }

  const expectedSignature = createAnonymousCookieSignature(fingerprint);
  const providedSignature = Buffer.from(signature, 'utf8');
  const expectedSignatureBuffer = Buffer.from(expectedSignature, 'utf8');

  if (providedSignature.length !== expectedSignatureBuffer.length) {
    return undefined;
  }

  return timingSafeEqual(providedSignature, expectedSignatureBuffer) ? fingerprint : undefined;
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

export function getVerifiedAnonymousFingerprint(request: Request): string | undefined {
  return verifyAnonymousCookieValue(getAnonymousCookieValue(request));
}
