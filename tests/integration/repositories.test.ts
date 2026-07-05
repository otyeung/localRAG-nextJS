import { describe, expect, it, vi } from 'vitest';

import { AuditRepository } from '@/lib/repositories/audit-repository';
import { ConversationRepository } from '@/lib/repositories/conversation-repository';
import { DocumentRepository } from '@/lib/repositories/document-repository';
import { UserRepository } from '@/lib/repositories/user-repository';
import { WorkflowRepository } from '@/lib/repositories/workflow-repository';

const createDb = () => ({
  user: { upsert: vi.fn() },
  conversation: { create: vi.fn() },
  document: { create: vi.fn() },
  workflowExecution: { create: vi.fn() },
  auditLog: { create: vi.fn() },
});

describe('repository layer', () => {
  it('upserts an anonymous user by fingerprint hash', async () => {
    const db = createDb();
    const expectedUser = { id: 'user_1', displayName: 'Local User' };
    db.user.upsert.mockResolvedValue(expectedUser);

    const repository = new UserRepository(db as never);

    await expect(repository.findOrCreateAnonymousUser('fingerprint-hash')).resolves.toEqual(expectedUser);
    expect(db.user.upsert).toHaveBeenCalledWith({
      where: { fingerprintHash: 'fingerprint-hash' },
      update: {},
      create: {
        fingerprintHash: 'fingerprint-hash',
        displayName: 'Local User',
      },
    });
  });

  it('creates conversations with a default title for the user', async () => {
    const db = createDb();
    const expectedConversation = { id: 'conversation_1', title: 'New Chat' };
    db.conversation.create.mockResolvedValue(expectedConversation);

    const repository = new ConversationRepository(db as never);

    await expect(repository.createForUser('user_1')).resolves.toEqual(expectedConversation);
    expect(db.conversation.create).toHaveBeenCalledWith({
      data: {
        userId: 'user_1',
        title: 'New Chat',
      },
    });
  });

  it('creates upload-backed document records with status and metadata', async () => {
    const db = createDb();
    const expectedDocument = { id: 'document_1', title: 'Quarterly Report' };
    db.document.create.mockResolvedValue(expectedDocument);

    const repository = new DocumentRepository(db as never);

    await expect(
      repository.createUploadDocument({
        userId: 'user_1',
        uploadId: 'upload_1',
        title: 'Quarterly Report',
        originalFilename: 'report.pdf',
        mimeType: 'application/pdf',
        fileSizeBytes: 1024,
        fileHash: 'hash_1',
        storagePath: 'uploads/report.pdf',
        metadata: { source: 'upload' },
      }),
    ).resolves.toEqual(expectedDocument);

    expect(db.document.create).toHaveBeenCalledWith({
      data: {
        userId: 'user_1',
        uploadId: 'upload_1',
        title: 'Quarterly Report',
        originalFilename: 'report.pdf',
        mimeType: 'application/pdf',
        fileSizeBytes: 1024,
        fileHash: 'hash_1',
        storagePath: 'uploads/report.pdf',
        status: 'PENDING',
        metadata: { source: 'upload' },
      },
    });
  });

  it('creates workflow execution records with queue defaults', async () => {
    const db = createDb();
    const expectedWorkflow = { id: 'workflow_1', workflowKey: 'ingestion' };
    db.workflowExecution.create.mockResolvedValue(expectedWorkflow);

    const repository = new WorkflowRepository(db as never);

    await expect(
      repository.createExecution({
        userId: 'user_1',
        uploadId: 'upload_1',
        documentId: 'document_1',
        workflowKey: 'ingestion',
        metadata: { correlationId: 'req_1' },
      }),
    ).resolves.toEqual(expectedWorkflow);

    expect(db.workflowExecution.create).toHaveBeenCalledWith({
      data: {
        userId: 'user_1',
        uploadId: 'upload_1',
        documentId: 'document_1',
        workflowKey: 'ingestion',
        status: 'QUEUED',
        metadata: { correlationId: 'req_1' },
      },
    });
  });

  it('persists audit log records with request metadata', async () => {
    const db = createDb();
    const expectedAuditLog = { id: 'audit_1', action: 'settings.updated' };
    db.auditLog.create.mockResolvedValue(expectedAuditLog);

    const repository = new AuditRepository(db as never);

    await expect(
      repository.create({
        userId: 'user_1',
        action: 'settings.updated',
        entityType: 'settings',
        entityId: 'settings_1',
        requestId: 'req_1',
        metadata: { model: 'gpt-4.1-mini' },
        ipAddress: '127.0.0.1',
        userAgent: 'vitest',
      }),
    ).resolves.toEqual(expectedAuditLog);

    expect(db.auditLog.create).toHaveBeenCalledWith({
      data: {
        userId: 'user_1',
        action: 'settings.updated',
        entityType: 'settings',
        entityId: 'settings_1',
        requestId: 'req_1',
        metadata: { model: 'gpt-4.1-mini' },
        ipAddress: '127.0.0.1',
        userAgent: 'vitest',
      },
    });
  });
});
