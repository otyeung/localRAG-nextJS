import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { UploadValidationService } from '@/lib/services/upload-validation-service';

describe('UploadValidationService', () => {
  const service = new UploadValidationService({ maxBytes: 10_000_000 });

  it('accepts PDF files within size limits', async () => {
    const result = await service.validate({
      fileName: '1706.03762v7.pdf',
      mimeType: 'application/pdf',
      size: 1024,
    });

    expect(result.normalizedExtension).toBe('pdf');
    expect(result.normalizedMimeType).toBe('application/pdf');
  });

  it('rejects unsupported file types', async () => {
    await expect(
      service.validate({ fileName: 'malware.exe', mimeType: 'application/x-msdownload', size: 1024 }),
    ).rejects.toThrow('Unsupported file type');
  });

  it('rejects files that exceed the configured size limit', async () => {
    await expect(
      service.validate({
        fileName: 'large.pdf',
        mimeType: 'application/pdf',
        size: 10_000_001,
      }),
    ).rejects.toThrow('File exceeds the maximum upload size');
  });

  it('rejects mismatched file extensions and MIME types', async () => {
    await expect(
      service.validate({
        fileName: 'notes.md',
        mimeType: 'text/plain',
        size: 512,
      }),
    ).rejects.toThrow('File extension does not match MIME type');
  });
});
