import { z } from 'zod';

export const documentIngestionInputSchema = z.object({
  documentId: z.string().min(1),
  uploadId: z.string().min(1),
  filePath: z.string().min(1),
  fileName: z.string().min(1),
  mimeType: z.string().min(1),
  requestId: z.string().min(1).optional(),
});
export type DocumentIngestionInput = z.infer<typeof documentIngestionInputSchema>;

export const retrievalInputSchema = z.object({
  query: z.string().min(1),
  conversationId: z.string().min(1).optional(),
  documentIds: z.array(z.string().min(1)).default([]),
  topK: z.number().int().positive().default(5),
  requestId: z.string().min(1).optional(),
});
export type RetrievalInput = z.infer<typeof retrievalInputSchema>;
