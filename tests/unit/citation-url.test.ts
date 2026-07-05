import { describe, expect, it } from 'vitest';

import { getSafeCitationUrl } from '@/lib/chat/citation-url';

describe('getSafeCitationUrl', () => {
  it('rejects protocol-relative URLs', () => {
    expect(getSafeCitationUrl('//attacker.example/path')).toBeNull();
  });

  it('preserves allowed same-origin relative and absolute http(s) URLs', () => {
    expect(getSafeCitationUrl('/api/documents/document_1')).toBe('/api/documents/document_1');
    expect(getSafeCitationUrl('./documents/document_1')).toBe('./documents/document_1');
    expect(getSafeCitationUrl('../documents/document_1')).toBe('../documents/document_1');
    expect(getSafeCitationUrl('https://example.com/documents/document_1')).toBe('https://example.com/documents/document_1');
  });
});
