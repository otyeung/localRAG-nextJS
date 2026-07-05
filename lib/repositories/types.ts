import type { Prisma, PrismaClient } from '@prisma/client';

export type DbClient = PrismaClient | Prisma.TransactionClient;

export type CreateUploadDocumentInput = {
  userId: string;
  uploadId: string;
  title: string;
  originalFilename: string;
  mimeType: string;
  fileSizeBytes: number;
  fileHash: string;
  storagePath: string;
  extractedText?: string;
  searchText?: string;
  metadata?: Prisma.InputJsonValue;
};

export type CreateWorkflowExecutionInput = {
  userId: string;
  workflowKey: string;
  documentId?: string;
  uploadId?: string;
  externalExecutionId?: string;
  requestPayload?: Prisma.InputJsonValue;
  responsePayload?: Prisma.InputJsonValue;
  metadata?: Prisma.InputJsonValue;
  errorMessage?: string;
  startedAt?: Date;
  completedAt?: Date;
};

export type CreateAuditLogInput = {
  userId: string;
  action: string;
  entityType: string;
  entityId?: string;
  requestId?: string;
  metadata?: Prisma.InputJsonValue;
  ipAddress?: string;
  userAgent?: string;
};
