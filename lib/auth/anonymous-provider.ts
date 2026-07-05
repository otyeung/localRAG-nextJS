import { createHash } from 'node:crypto';

export async function createAnonymousFingerprintHash(fingerprint: string): Promise<string> {
  return createHash('sha256').update(`localrag-nextjs:${fingerprint}`).digest('hex');
}
