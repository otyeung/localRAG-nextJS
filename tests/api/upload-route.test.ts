import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const routeMocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  rateLimit: vi.fn(),
  createUpload: vi.fn(),
}));

vi.mock('@/lib/auth/current-user', () => ({
  getCurrentUser: routeMocks.getCurrentUser,
}));

vi.mock('@/lib/security/rate-limit', () => ({
  rateLimit: routeMocks.rateLimit,
}));

vi.mock('@/lib/services/upload-service', () => ({
  UploadService: class {
    createUpload = routeMocks.createUpload;
    listUploads = vi.fn();
  },
}));

import { POST } from '@/app/api/upload/route';

describe('upload route', () => {
  beforeEach(() => {
    routeMocks.getCurrentUser.mockReset();
    routeMocks.rateLimit.mockReset();
    routeMocks.createUpload.mockReset();
    routeMocks.getCurrentUser.mockResolvedValue({
      id: 'user_1',
      displayName: 'Local User',
      provider: 'anonymous',
    });
    routeMocks.rateLimit.mockResolvedValue({
      allowed: true,
      remaining: 4,
      resetAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    routeMocks.createUpload.mockResolvedValue({
      uploadId: 'upload_1',
      documentId: 'document_1',
      workflowExecutionId: 'workflow_1',
      externalExecutionId: 'exec_123',
      status: 'RUNNING',
      storagePath: '/uploads/report.pdf',
    });
  });

  it('accepts same-origin multipart uploads and returns typed upload metadata', async () => {
    const formData = new FormData();
    formData.set(
      'file',
      new File([Buffer.from('report bytes')], 'report.pdf', {
        type: 'application/pdf',
      }),
    );

    const request = new Request('https://app.example.com/api/upload', {
      method: 'POST',
      headers: {
        host: 'app.example.com',
        origin: 'https://app.example.com',
        'x-request-id': 'req_upload',
        'user-agent': 'vitest',
      },
    });
    vi.spyOn(request, 'formData').mockResolvedValue(formData);

    const response = await POST(request);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: {
        uploadId: 'upload_1',
        documentId: 'document_1',
        workflowExecutionId: 'workflow_1',
        externalExecutionId: 'exec_123',
        status: 'RUNNING',
        storagePath: '/uploads/report.pdf',
      },
    });
    expect(routeMocks.rateLimit).toHaveBeenCalledWith(
      'upload:post:user_1:unknown',
      expect.objectContaining({
        namespace: 'upload-api',
      }),
    );
    expect(routeMocks.createUpload).toHaveBeenCalledWith({
      userId: 'user_1',
      fileName: 'report.pdf',
      mimeType: 'application/pdf',
      bytes: expect.any(Uint8Array),
      requestId: 'req_upload',
      ipAddress: 'unknown',
      userAgent: 'vitest',
    });
  });

  it('rejects missing file payloads', async () => {
    const request = new Request('https://app.example.com/api/upload', {
      method: 'POST',
      headers: {
        host: 'app.example.com',
        origin: 'https://app.example.com',
        'x-request-id': 'req_missing_file',
      },
    });
    vi.spyOn(request, 'formData').mockResolvedValue(new FormData());

    const response = await POST(request);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: 'BAD_REQUEST',
        message: 'A file upload is required.',
        requestId: 'req_missing_file',
      },
    });
  });

  it('returns structured validation errors for invalid multipart metadata', async () => {
    const formData = new FormData();
    formData.set(
      'file',
      new File([Buffer.from('report bytes')], '   ', {
        type: '',
      }),
    );

    const request = new Request('https://app.example.com/api/upload', {
      method: 'POST',
      headers: {
        host: 'app.example.com',
        origin: 'https://app.example.com',
        'x-request-id': 'req_invalid_metadata',
      },
    });
    vi.spyOn(request, 'formData').mockResolvedValue(formData);

    const response = await POST(request);

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid upload metadata.',
        requestId: 'req_invalid_metadata',
        details: {
          formErrors: [],
          fieldErrors: {
            fileName: expect.any(Array),
            mimeType: expect.any(Array),
          },
        },
      },
    });
    expect(routeMocks.createUpload).not.toHaveBeenCalled();
  });
});
