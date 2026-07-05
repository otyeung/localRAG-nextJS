import {
  ANONYMOUS_COOKIE_NAME,
  createAnonymousCookieValue,
} from '@/lib/auth/anonymous-provider';

export const SEED_CORPUS_USER_FINGERPRINT = 'seed-corpus-local-user-000000000';

export function createSeedCorpusAnonymousCookieValue(): string {
  return createAnonymousCookieValue(SEED_CORPUS_USER_FINGERPRINT);
}

export function getSeedCorpusAnonymousCookie(): { name: string; value: string } {
  return {
    name: ANONYMOUS_COOKIE_NAME,
    value: createSeedCorpusAnonymousCookieValue(),
  };
}
