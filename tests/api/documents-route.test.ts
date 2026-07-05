import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const routeMocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  enforcePreProvisionRouteRateLimit: vi.fn(),
  rateLimit: vi.fn(),
  listDocuments: vi.fn(),
  getDocument: vi.fn(),
  softDeleteDocument: vi.fn(),
  requestReindex: vi.fn(),
  listPublicWorkflows: vi.fn(),
  getPublicWorkflowStatus: vi.fn(),
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

vi.mock('@/lib/services/document-service', () => ({
  DocumentService: class {
    listDocuments = routeMocks.listDocuments;
    getDocument = routeMocks.getDocument;
    softDeleteDocument = routeMocks.softDeleteDocument;
    requestReindex = routeMocks.requestReindex;
  },
}));

vi.mock('@/lib/services/workflow-service', () => ({
  WorkflowService: class {
    listPublicWorkflows = routeMocks.listPublicWorkflows;
    getPublicWorkflowStatus = routeMocks.getPublicWorkflowStatus;
  },
}));

import { GET as listDocumentsRoute } from '@/app/api/documents/route';
import { DELETE as deleteDocumentRoute, GET as getDocumentRoute, PATCH as reindexDocumentRoute } from '@/app/api/documents/[id]/route';
import { GET as listWorkflowsRoute } from '@/app/api/workflows/route';
import { GET as getWorkflowRoute } from '@/app/api/workflows/[id]/route';

describe('documents routes', () => {
  beforeEach(() => {
    routeMocks.getCurrentUser.mockReset();
    routeMocks.enforcePreProvisionRouteRateLimit.mockReset();
    routeMocks.rateLimit.mockReset();
    routeMocks.listDocuments.mockReset();
    routeMocks.getDocument.mockReset();
    routeMocks.softDeleteDocument.mockReset();
    routeMocks.requestReindex.mockReset();
    routeMocks.listPublicWorkflows.mockReset();
    routeMocks.getPublicWorkflowStatus.mockReset();
    routeMocks.getCurrentUser.mockResolvedValue({
      id: 'user_1',
      displayName: 'Local User',
      provider: 'anonymous',
    });
    routeMocks.enforcePreProvisionRouteRateLimit.mockResolvedValue(undefined);
    routeMocks.rateLimit.mockResolvedValue({
      allowed: true,
      remaining: 9,
      resetAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    routeMocks.listDocuments.mockResolvedValue({
      items: [
        {
          id: 'document_1',
          uploadId: 'upload_1',
          status: 'READY',
          title: 'Quarterly Report',
          originalFilename: 'quarterly-report.pdf',
          mimeType: 'application/pdf',
          fileSizeBytes: 1024,
          fileHash: 'hash_1',
          storagePath: '/uploads/quarterly-report.pdf',
          metadata: { source: 'upload' },
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-02T00:00:00.000Z',
          deletedAt: null,
        },
      ],
      total: 1,
      page: 1,
      pageSize: 10,
    });
    routeMocks.getDocument.mockResolvedValue({
      id: 'document_1',
      uploadId: 'upload_1',
      status: 'READY',
      title: 'Quarterly Report',
      originalFilename: 'quarterly-report.pdf',
      mimeType: 'application/pdf',
      fileSizeBytes: 1024,
      fileHash: 'hash_1',
      storagePath: '/uploads/quarterly-report.pdf',
      metadata: { source: 'upload' },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
      deletedAt: null,
    });
    routeMocks.listPublicWorkflows.mockResolvedValue({
      items: [
        {
          id: 'workflow_1',
          workflowKey: 'ingestion',
          status: 'RUNNING',
          errorMessage: null,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:01:00.000Z',
          startedAt: '2026-01-01T00:00:00.000Z',
          completedAt: null,
          uploadId: 'upload_1',
          documentId: 'document_1',
          reconciliationRequired: false,
        },
      ],
      total: 1,
    });
    routeMocks.getPublicWorkflowStatus.mockResolvedValue({
      id: 'workflow_1',
      workflowKey: 'ingestion',
      status: 'RUNNING',
      errorMessage: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:01:00.000Z',
      startedAt: '2026-01-01T00:00:00.000Z',
      completedAt: null,
      uploadId: 'upload_1',
      documentId: 'document_1',
      reconciliationRequired: false,
    });
    routeMocks.softDeleteDocument.mockResolvedValue({
      id: 'document_1',
      uploadId: 'upload_1',
      status: 'DELETED',
      title: 'Quarterly Report',
      originalFilename: 'quarterly-report.pdf',
      mimeType: 'application/pdf',
      fileSizeBytes: 1024,
      fileHash: 'hash_1',
      storagePath: '/uploads/quarterly-report.pdf',
      metadata: { source: 'upload' },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-03T00:00:00.000Z',
      deletedAt: '2026-01-03T00:00:00.000Z',
    });
    routeMocks.requestReindex.mockResolvedValue({
      workflowExecutionId: 'workflow_2',
      externalExecutionId: 'n8n_2',
      status: 'RUNNING',
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
            uploadId: 'upload_1',
            status: 'READY',
            title: 'Quarterly Report',
            originalFilename: 'quarterly-report.pdf',
            mimeType: 'application/pdf',
            fileSizeBytes: 1024,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-02T00:00:00.000Z',
            deletedAt: null,
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

  it('omits internal document storage fields from public list responses', async () => {
    const request = new Request('https://app.example.com/api/documents', {
      headers: {
        'x-request-id': 'req_documents_public',
      },
    });

    const response = await listDocumentsRoute(request);
    const body = await response.json();
    const [first] = body.data.items;

    expect(first).not.toHaveProperty('fileHash');
    expect(first).not.toHaveProperty('storagePath');
    expect(first).not.toHaveProperty('metadata');
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
        uploadId: 'upload_1',
        status: 'READY',
        title: 'Quarterly Report',
        originalFilename: 'quarterly-report.pdf',
        mimeType: 'application/pdf',
        fileSizeBytes: 1024,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
        deletedAt: null,
      },
    });
  });

  it('omits internal document storage fields from public detail responses', async () => {
    const request = new Request('https://app.example.com/api/documents/document_1', {
      headers: {
        'x-request-id': 'req_document_public',
      },
    });

    const response = await getDocumentRoute(request, {
      params: Promise.resolve({ id: 'document_1' }),
    });
    const body = await response.json();

    expect(body.data).not.toHaveProperty('fileHash');
    expect(body.data).not.toHaveProperty('storagePath');
    expect(body.data).not.toHaveProperty('metadata');
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
        uploadId: 'upload_1',
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

  it('queues document re-indexing for the current user', async () => {
    const request = new Request('https://app.example.com/api/documents/document_1', {
      method: 'PATCH',
      headers: {
        host: 'app.example.com',
        origin: 'https://app.example.com',
        'x-request-id': 'req_document_reindex',
      },
    });

    const response = await reindexDocumentRoute(request, {
      params: Promise.resolve({ id: 'document_1' }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: {
        workflowExecutionId: 'workflow_2',
        externalExecutionId: 'n8n_2',
        status: 'RUNNING',
      },
    });
    expect(routeMocks.requestReindex).toHaveBeenCalledWith('user_1', 'document_1', 'req_document_reindex');
  });

  it('omits internal document storage fields from delete responses', async () => {
    const request = new Request('https://app.example.com/api/documents/document_1', {
      method: 'DELETE',
      headers: {
        host: 'app.example.com',
        origin: 'https://app.example.com',
        'x-request-id': 'req_document_delete_public',
      },
    });

    const response = await deleteDocumentRoute(request, {
      params: Promise.resolve({ id: 'document_1' }),
    });
    const body = await response.json();

    expect(body.data).not.toHaveProperty('fileHash');
    expect(body.data).not.toHaveProperty('storagePath');
    expect(body.data).not.toHaveProperty('metadata');
  });


  it('applies the pre-provision guard before resolving document list users', async () => {
    const request = new Request('https://app.example.com/api/documents', {
      headers: {
        'x-request-id': 'req_documents_pre_provision',
      },
    });

    await listDocumentsRoute(request);

    expect(routeMocks.enforcePreProvisionRouteRateLimit).toHaveBeenCalledWith(request, expect.any(Object), {
      action: 'get',
      errorMessage: 'Too many document requests.',
      namespace: 'documents-api',
    });
    expect(routeMocks.enforcePreProvisionRouteRateLimit.mock.invocationCallOrder[0]).toBeLessThan(
      routeMocks.getCurrentUser.mock.invocationCallOrder[0],
    );
  });

  it('applies the pre-provision guard before resolving document detail users', async () => {
    const request = new Request('https://app.example.com/api/documents/document_1', {
      headers: {
        'x-request-id': 'req_document_pre_provision',
      },
    });

    await getDocumentRoute(request, {
      params: Promise.resolve({ id: 'document_1' }),
    });

    expect(routeMocks.enforcePreProvisionRouteRateLimit).toHaveBeenCalledWith(request, expect.any(Object), {
      action: 'get',
      errorMessage: 'Too many document requests.',
      namespace: 'documents-api',
    });
  });

  it('applies the pre-provision guard before resolving workflow list users', async () => {
    const request = new Request('https://app.example.com/api/workflows', {
      headers: {
        'x-request-id': 'req_workflows_pre_provision',
      },
    });

    const response = await listWorkflowsRoute(request);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: {
        items: [
          {
            id: 'workflow_1',
            workflowKey: 'ingestion',
            status: 'RUNNING',
            errorMessage: null,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:01:00.000Z',
            startedAt: '2026-01-01T00:00:00.000Z',
            completedAt: null,
            uploadId: 'upload_1',
            documentId: 'document_1',
            reconciliationRequired: false,
          },
        ],
        total: 1,
      },
    });
    expect(routeMocks.enforcePreProvisionRouteRateLimit).toHaveBeenCalledWith(request, expect.any(Object), {
      action: 'get',
      errorMessage: 'Too many workflow requests.',
      namespace: 'workflows-api',
    });
    expect(routeMocks.listPublicWorkflows).toHaveBeenCalledWith('user_1');
  });

  it('applies the pre-provision guard before resolving workflow detail users', async () => {
    const request = new Request('https://app.example.com/api/workflows/workflow_1', {
      headers: {
        'x-request-id': 'req_workflow_pre_provision',
      },
    });

    const response = await getWorkflowRoute(request, {
      params: Promise.resolve({ id: 'workflow_1' }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: {
        id: 'workflow_1',
        workflowKey: 'ingestion',
        status: 'RUNNING',
        errorMessage: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:01:00.000Z',
        startedAt: '2026-01-01T00:00:00.000Z',
        completedAt: null,
        uploadId: 'upload_1',
        documentId: 'document_1',
        reconciliationRequired: false,
      },
    });
    expect(routeMocks.enforcePreProvisionRouteRateLimit).toHaveBeenCalledWith(request, expect.any(Object), {
      action: 'get',
      errorMessage: 'Too many workflow requests.',
      namespace: 'workflows-api',
    });
    expect(routeMocks.getPublicWorkflowStatus).toHaveBeenCalledWith('user_1', 'workflow_1');
  });
});
