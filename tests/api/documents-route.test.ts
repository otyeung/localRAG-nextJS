import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const routeMocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  rateLimit: vi.fn(),
  listDocuments: vi.fn(),
  getDocument: vi.fn(),
  softDeleteDocument: vi.fn(),
}));

vi.mock('@/lib/auth/current-user', () => ({
  getCurrentUser: routeMocks.getCurrentUser,
}));

vi.mock('@/lib/security/rate-limit', () => ({
  rateLimit: routeMocks.rateLimit,
}));

vi.mock('@/lib/services/document-service', () => ({
  DocumentService: class {
    listDocuments = routeMocks.listDocuments;
    getDocument = routeMocks.getDocument;
    softDeleteDocument = routeMocks.softDeleteDocument;
  },
}));

import { GET as listDocumentsRoute } from '@/app/api/documents/route';
import { DELETE as deleteDocumentRoute, GET as getDocumentRoute } from '@/app/api/documents/[id]/route';

describe('documents routes', () => {
  beforeEach(() => {
    routeMocks.getCurrentUser.mockReset();
    routeMocks.rateLimit.mockReset();
    routeMocks.listDocuments.mockReset();
    routeMocks.getDocument.mockReset();
    routeMocks.softDeleteDocument.mockReset();
    routeMocks.getCurrentUser.mockResolvedValue({
      id: 'user_1',
      displayName: 'Local User',
      provider: 'anonymous',
    });
    routeMocks.rateLimit.mockResolvedValue({
      allowed: true,
      remaining: 9,
      resetAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    routeMocks.listDocuments.mockResolvedValue({
      items: [
        {
          id: 'document_1',
          status: 'READY',
          title: 'Quarterly Report',
          originalFilename: 'quarterly-report.pdf',
          mimeType: 'application/pdf',
          fileSizeBytes: 1024,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-02T00:00:00.000Z',
        },
      ],
      total: 1,
      page: 1,
      pageSize: 10,
    });
    routeMocks.getDocument.mockResolvedValue({
      id: 'document_1',
      status: 'READY',
      title: 'Quarterly Report',
      originalFilename: 'quarterly-report.pdf',
      mimeType: 'application/pdf',
      fileSizeBytes: 1024,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    });
    routeMocks.softDeleteDocument.mockResolvedValue({
      id: 'document_1',
      status: 'DELETED',
      title: 'Quarterly Report',
      originalFilename: 'quarterly-report.pdf',
      mimeType: 'application/pdf',
      fileSizeBytes: 1024,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-03T00:00:00.000Z',
      deletedAt: '2026-01-03T00:00:00.000Z',
    });
  });

  it('lists searchable document metadata for the current user', async () => {
    const request = new Request(
      'https://app.example.com/api/documents?query=Quarterly&status=READY&sort=updatedAt&order=desc&page=1&pageSize=10',
      {
        headers: {
          'x-request-id': 'req_documents',
        },
      },
    );

    const response = await listDocumentsRoute(request);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: {
        items: [
          {
            id: 'document_1',
            status: 'READY',
            title: 'Quarterly Report',
            originalFilename: 'quarterly-report.pdf',
            mimeType: 'application/pdf',
            fileSizeBytes: 1024,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-02T00:00:00.000Z',
          },
        ],
        total: 1,
        page: 1,
        pageSize: 10,
      },
    });
    expect(routeMocks.listDocuments).toHaveBeenCalledWith('user_1', {
      search: 'Quarterly',
      status: 'READY',
      sort: 'updatedAt',
      order: 'desc',
      page: 1,
      pageSize: 10,
    });
  });

  it('returns structured validation errors for invalid list params', async () => {
    const request = new Request(
      'https://app.example.com/api/documents?status=NOPE&sort=bogus&order=sideways&page=0&pageSize=999',
      {
        headers: {
          'x-request-id': 'req_documents_invalid',
        },
      },
    );

    const response = await listDocumentsRoute(request);

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid document query parameters.',
        requestId: 'req_documents_invalid',
        details: {
          formErrors: [],
          fieldErrors: {
            status: expect.any(Array),
            sort: expect.any(Array),
            order: expect.any(Array),
            page: expect.any(Array),
            pageSize: expect.any(Array),
          },
        },
      },
    });
    expect(routeMocks.listDocuments).not.toHaveBeenCalled();
  });

  it('returns one document by id', async () => {
    const request = new Request('https://app.example.com/api/documents/document_1', {
      headers: {
        'x-request-id': 'req_document',
      },
    });

    const response = await getDocumentRoute(request, {
      params: Promise.resolve({ id: 'document_1' }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: {
        id: 'document_1',
        status: 'READY',
        title: 'Quarterly Report',
        originalFilename: 'quarterly-report.pdf',
        mimeType: 'application/pdf',
        fileSizeBytes: 1024,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
      },
    });
  });

  it('returns structured validation errors for invalid document ids', async () => {
    const request = new Request('https://app.example.com/api/documents/%20%20', {
      headers: {
        'x-request-id': 'req_document_invalid',
      },
    });

    const response = await getDocumentRoute(request, {
      params: Promise.resolve({ id: '   ' }),
    });

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid document route parameters.',
        requestId: 'req_document_invalid',
        details: {
          formErrors: [],
          fieldErrors: {
            id: expect.any(Array),
          },
        },
      },
    });
    expect(routeMocks.getDocument).not.toHaveBeenCalled();
  });

  it('soft deletes documents for the current user', async () => {
    const request = new Request('https://app.example.com/api/documents/document_1', {
      method: 'DELETE',
      headers: {
        host: 'app.example.com',
        origin: 'https://app.example.com',
        'x-request-id': 'req_document_delete',
        'user-agent': 'vitest',
      },
    });

    const response = await deleteDocumentRoute(request, {
      params: Promise.resolve({ id: 'document_1' }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: {
        id: 'document_1',
        status: 'DELETED',
        title: 'Quarterly Report',
        originalFilename: 'quarterly-report.pdf',
        mimeType: 'application/pdf',
        fileSizeBytes: 1024,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-03T00:00:00.000Z',
        deletedAt: '2026-01-03T00:00:00.000Z',
      },
    });
    expect(routeMocks.softDeleteDocument).toHaveBeenCalledWith('user_1', 'document_1', {
      requestId: 'req_document_delete',
      ipAddress: 'unknown',
      userAgent: 'vitest',
    });
  });
});
