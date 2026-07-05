import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const routeMocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  enforcePreProvisionRouteRateLimit: vi.fn(),
  rateLimit: vi.fn(),
  createUpload: vi.fn(),
  listUploads: vi.fn(),
}));

vi.mock('@/lib/auth/current-user', () => ({
  getCurrentUser: routeMocks.getCurrentUser,
}));

vi.mock('@/lib/security/rate-limit', () => ({
  rateLimit: routeMocks.rateLimit,
}));

vi.mock('@/lib/security/pre-provision-rate-limit', () => ({
  enforcePreProvisionRouteRateLimit: routeMocks.enforcePreProvisionRouteRateLimit,
}));

vi.mock('@/lib/services/upload-service', () => ({
  UploadService: class {
    createUpload = routeMocks.createUpload;
    listUploads = routeMocks.listUploads;
  },
}));

import { POST } from '@/app/api/upload/route';
import { GET as listUploadsRoute } from '@/app/api/uploads/route';

describe('upload route', () => {
  beforeEach(() => {
    routeMocks.getCurrentUser.mockReset();
    routeMocks.enforcePreProvisionRouteRateLimit.mockReset();
    routeMocks.rateLimit.mockReset();
    routeMocks.createUpload.mockReset();
    routeMocks.listUploads.mockReset();
    routeMocks.getCurrentUser.mockResolvedValue({
      id: 'user_1',
      displayName: 'Local User',
      provider: 'anonymous',
    });
    routeMocks.enforcePreProvisionRouteRateLimit.mockResolvedValue(undefined);
    routeMocks.rateLimit.mockResolvedValue({
      allowed: true,
      remaining: 4,
      resetAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    routeMocks.listUploads.mockResolvedValue([
      {
        id: 'upload_1',
        status: 'COMPLETED',
        originalFilename: 'report.pdf',
        mimeType: 'application/pdf',
        fileSizeBytes: 1024,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:01:00.000Z',
        errorMessage: null,
      },
    ]);
    routeMocks.createUpload.mockResolvedValue({
      uploadId: 'upload_1',
      documentId: 'document_1',
      workflowExecutionId: 'workflow_1',
      externalExecutionId: 'exec_123',
      status: 'RUNNING',
      storagePath: '/uploads/report.pdf',
      reconciliationRequired: false,
    });
  });

  it('accepts same-origin multipart uploads and returns sanitized public upload metadata', async () => {
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
        status: 'RUNNING',
        reconciliationRequired: false,
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

  it('rejects rate-limited uploads before parsing multipart form data', async () => {
    routeMocks.enforcePreProvisionRouteRateLimit.mockResolvedValue(undefined);
    routeMocks.rateLimit.mockResolvedValue({
      allowed: false,
      remaining: 0,
      resetAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    const request = new Request('https://app.example.com/api/upload', {
      method: 'POST',
      headers: {
        host: 'app.example.com',
        origin: 'https://app.example.com',
        'x-request-id': 'req_rate_limited',
      },
    });
    const formDataSpy = vi.spyOn(request, 'formData').mockResolvedValue(new FormData());

    const response = await POST(request);

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'RATE_LIMITED',
        message: 'Too many upload requests.',
        requestId: 'req_rate_limited',
        details: {
          resetAt: '2026-01-01T00:00:00.000Z',
        },
      },
    });
    expect(formDataSpy).not.toHaveBeenCalled();
    expect(routeMocks.createUpload).not.toHaveBeenCalled();
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

  it('rejects oversize uploads before reading file bytes', async () => {
    const file = new File([Buffer.from('report bytes')], 'report.pdf', {
      type: 'application/pdf',
    });
    Object.defineProperty(file, 'size', {
      configurable: true,
      value: 52_428_801,
    });
    const arrayBufferSpy = vi.spyOn(file, 'arrayBuffer').mockRejectedValue(new Error('should not be called'));
    const formData = new FormData();
    formData.set('file', file);

    const request = new Request('https://app.example.com/api/upload', {
      method: 'POST',
      headers: {
        host: 'app.example.com',
        origin: 'https://app.example.com',
        'x-request-id': 'req_oversize',
      },
    });
    vi.spyOn(request, 'formData').mockResolvedValue(formData);

    const response = await POST(request);

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'File exceeds the maximum upload size.',
        requestId: 'req_oversize',
        details: {
          maxBytes: 52_428_800,
        },
      },
    });
    expect(arrayBufferSpy).not.toHaveBeenCalled();
    expect(routeMocks.createUpload).not.toHaveBeenCalled();
  });


  it('applies the pre-provision guard before resolving the upload user', async () => {
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
        'x-request-id': 'req_upload_pre_provision',
      },
    });
    vi.spyOn(request, 'formData').mockResolvedValue(formData);

    await POST(request);

    expect(routeMocks.enforcePreProvisionRouteRateLimit).toHaveBeenCalledWith(request, expect.any(Object), {
      action: 'post',
      errorMessage: 'Too many upload requests.',
      namespace: 'upload-api',
    });
    expect(routeMocks.enforcePreProvisionRouteRateLimit.mock.invocationCallOrder[0]).toBeLessThan(
      routeMocks.getCurrentUser.mock.invocationCallOrder[0],
    );
  });

  it('blocks upload requests before resolving a user when the pre-provision guard rejects them', async () => {
    routeMocks.enforcePreProvisionRouteRateLimit.mockRejectedValueOnce(new Error('pre-provision limited'));
    const request = new Request('https://app.example.com/api/upload', {
      method: 'POST',
      headers: {
        host: 'app.example.com',
        origin: 'https://app.example.com',
        'x-request-id': 'req_upload_pre_provision_limited',
      },
    });
    const formDataSpy = vi.spyOn(request, 'formData').mockResolvedValue(new FormData());

    const response = await POST(request);

    expect(response.status).toBe(500);
    expect(routeMocks.getCurrentUser).not.toHaveBeenCalled();
    expect(formDataSpy).not.toHaveBeenCalled();
  });

  it('applies the pre-provision guard before resolving upload history users', async () => {
    const request = new Request('https://app.example.com/api/uploads', {
      headers: {
        'x-request-id': 'req_uploads_pre_provision',
      },
    });

    const response = await listUploadsRoute(request);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: [
        {
          id: 'upload_1',
          status: 'COMPLETED',
          originalFilename: 'report.pdf',
          mimeType: 'application/pdf',
          fileSizeBytes: 1024,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:01:00.000Z',
          errorMessage: null,
        },
      ],
    });
    expect(routeMocks.enforcePreProvisionRouteRateLimit).toHaveBeenCalledWith(request, expect.any(Object), {
      action: 'get',
      errorMessage: 'Too many upload history requests.',
      namespace: 'uploads-api',
    });
    expect(routeMocks.enforcePreProvisionRouteRateLimit.mock.invocationCallOrder.at(-1)!).toBeLessThan(
      routeMocks.getCurrentUser.mock.invocationCallOrder.at(-1)!,
    );
    expect(routeMocks.listUploads).toHaveBeenCalledWith('user_1');
  });
});
