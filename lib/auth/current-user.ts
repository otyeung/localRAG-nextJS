import 'server-only';

import { cookies } from 'next/headers';

import { prisma } from '@/lib/db/prisma';
import {
  ANONYMOUS_COOKIE_NAME,
  createAnonymousCookieValue,
  createAnonymousFingerprint,
  createAnonymousFingerprintHash,
  getVerifiedAnonymousFingerprint,
} from '@/lib/auth/anonymous-provider';
import type { AuthUser } from '@/lib/auth/types';
import { UserRepository } from '@/lib/repositories/user-repository';

export async function getCurrentUser(request: Request): Promise<AuthUser> {
  const cookieStore = await cookies();
  const existingFingerprint = getVerifiedAnonymousFingerprint(request);
  const fingerprint = existingFingerprint ?? createAnonymousFingerprint();

  if (!existingFingerprint) {
    cookieStore.set(ANONYMOUS_COOKIE_NAME, createAnonymousCookieValue(fingerprint), {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
    });
  }

  const fingerprintHash = await createAnonymousFingerprintHash(fingerprint);
  const user = await new UserRepository(prisma).findOrCreateAnonymousUser(fingerprintHash);

  return {
    id: user.id,
    displayName: user.displayName,
    provider: 'anonymous',
  };
}
