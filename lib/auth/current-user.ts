import 'server-only';

import { cookies } from 'next/headers';
import { nanoid } from 'nanoid';

import { prisma } from '@/lib/db/prisma';
import { createAnonymousFingerprintHash } from '@/lib/auth/anonymous-provider';
import type { AuthUser } from '@/lib/auth/types';
import { UserRepository } from '@/lib/repositories/user-repository';

const COOKIE_NAME = 'localrag_anonymous_id';

function getCookieValue(request: Request, name: string): string | undefined {
  const cookieHeader = request.headers.get('cookie');

  if (!cookieHeader) {
    return undefined;
  }

  for (const part of cookieHeader.split(';')) {
    const [key, ...valueParts] = part.trim().split('=');

    if (key === name) {
      return decodeURIComponent(valueParts.join('='));
    }
  }

  return undefined;
}

export async function getCurrentUser(request: Request): Promise<AuthUser> {
  const cookieStore = await cookies();
  const existingFingerprint = getCookieValue(request, COOKIE_NAME);
  const fingerprint = existingFingerprint ?? nanoid(32);

  if (!existingFingerprint) {
    cookieStore.set(COOKIE_NAME, fingerprint, {
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
