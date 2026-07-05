import { Document, DocumentStatus } from '@prisma/client';

import type { CreateUploadDocumentInput, DbClient } from '@/lib/repositories/types';

export class DocumentRepository {
  constructor(private readonly db: DbClient) {}

  async createUploadDocument(input: CreateUploadDocumentInput): Promise<Document> {
    return this.db.document.create({
      data: {
        userId: input.userId,
        uploadId: input.uploadId,
        title: input.title,
        originalFilename: input.originalFilename,
        mimeType: input.mimeType,
        fileSizeBytes: input.fileSizeBytes,
        fileHash: input.fileHash,
        storagePath: input.storagePath,
        status: DocumentStatus.PENDING,
        metadata: input.metadata,
        ...(input.extractedText ? { extractedText: input.extractedText } : {}),
        ...(input.searchText ? { searchText: input.searchText } : {}),
      },
    });
  }
}
