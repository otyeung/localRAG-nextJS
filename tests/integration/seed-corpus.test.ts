import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    document: {
      findFirst: vi.fn(),
    },
  },
}));

import { seedCorpus } from '@/scripts/seed-corpus';

describe('seedCorpus', () => {
  it('reuses ready documents and ingests missing corpus files through the upload service', async () => {
    const findReadyDocumentByHash = vi
      .fn()
      .mockResolvedValueOnce({ id: 'document_existing' })
      .mockResolvedValueOnce(null);
    const uploadService = {
      createUpload: vi.fn().mockResolvedValue({
        uploadId: 'upload_2',
        documentId: 'document_2',
        workflowExecutionId: 'workflow_2',
        externalExecutionId: 'exec_2',
        status: 'RUNNING',
        storagePath: '/uploads/cymbal-starlight-2024.pdf',
      }),
    };
    const workflowService = {
      getWorkflowStatus: vi.fn().mockResolvedValue({
        id: 'workflow_2',
        status: 'SUCCESS',
        externalExecutionId: 'exec_2',
      }),
    };
    const userRepository = {
      findOrCreateAnonymousUser: vi.fn().mockResolvedValue({ id: 'user_1' }),
    };

    const result = await seedCorpus({
      findReadyDocumentByHash,
      uploadService: uploadService as never,
      workflowService: workflowService as never,
      userRepository: userRepository as never,
      createFingerprintHash: async () => 'fingerprint-hash',
      sleep: async () => undefined,
      pollIntervalMs: 1,
      timeoutMs: 10,
    });

    expect(result.totalFiles).toBe(2);
    expect(result.skipped).toHaveLength(1);
    expect(result.ingested).toHaveLength(1);
    expect(result.failed).toHaveLength(0);
    expect(uploadService.createUpload).toHaveBeenCalledTimes(1);
    expect(workflowService.getWorkflowStatus).toHaveBeenCalledWith('user_1', 'workflow_2');
  });
});
