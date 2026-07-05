import { z } from 'zod';

export const n8nExecutionStatusSchema = z.enum([
  'new',
  'running',
  'success',
  'error',
  'canceled',
  'crashed',
  'waiting',
  'unknown',
]);
export type N8nExecutionStatus = z.infer<typeof n8nExecutionStatusSchema>;

export const retrievedChunkSchema = z.object({
  id: z.string(),
  documentId: z.string(),
  documentName: z.string(),
  chunkIndex: z.number().int().nonnegative(),
  content: z.string().min(1),
  score: z.number(),
  metadata: z.record(z.string(), z.unknown()).default({}),
});
export type RetrievedChunk = z.infer<typeof retrievedChunkSchema>;

const stringLikeSchema = z.union([z.string(), z.number()]).transform((value) => String(value));
const nullableStringLikeSchema = z.union([z.string(), z.number()]).transform((value) => String(value)).nullable().optional();

export const n8nWorkflowSchema = z
  .object({
    id: stringLikeSchema,
    name: z.string().min(1),
    active: z.boolean().default(false),
    tags: z.array(z.object({ id: stringLikeSchema.optional(), name: z.string().min(1) }).passthrough()).default([]),
    updatedAt: z.string().nullable().optional(),
  })
  .passthrough();
export type N8nWorkflow = z.infer<typeof n8nWorkflowSchema>;

export const n8nWorkflowListSchema = z.object({
  data: z.array(n8nWorkflowSchema).default([]),
  nextCursor: z.string().nullable().optional(),
});

const rawN8nExecutionSchema = z
  .object({
    id: stringLikeSchema,
    workflowId: nullableStringLikeSchema,
    status: z.string().nullable().optional(),
    finished: z.boolean().optional(),
    mode: z.string().nullable().optional(),
    startedAt: z.string().nullable().optional(),
    stoppedAt: z.string().nullable().optional(),
    waitTill: z.string().nullable().optional(),
    retryOf: nullableStringLikeSchema,
    data: z.unknown().optional(),
  })
  .passthrough();

export function normalizeN8nExecutionStatus(value: string | null | undefined): N8nExecutionStatus {
  const normalized = value?.trim().toLowerCase();

  switch (normalized) {
    case 'new':
    case 'running':
    case 'success':
    case 'error':
    case 'canceled':
    case 'crashed':
    case 'waiting':
      return normalized;
    case 'cancelled':
      return 'canceled';
    case 'failed':
      return 'error';
    default:
      return 'unknown';
  }
}

export const n8nExecutionSchema = rawN8nExecutionSchema.transform((execution) => ({
  id: execution.id,
  workflowId: execution.workflowId ?? null,
  status: normalizeN8nExecutionStatus(execution.status),
  rawStatus: execution.status ?? null,
  finished: execution.finished ?? Boolean(execution.stoppedAt),
  mode: execution.mode ?? null,
  startedAt: execution.startedAt ?? null,
  stoppedAt: execution.stoppedAt ?? null,
  waitTill: execution.waitTill ?? null,
  retryOf: execution.retryOf ?? null,
  data: execution.data ?? null,
}));
export type N8nExecution = z.infer<typeof n8nExecutionSchema>;

const rawN8nWorkflowStartResultSchema = z
  .object({
    executionId: nullableStringLikeSchema,
    id: nullableStringLikeSchema,
    workflowId: nullableStringLikeSchema,
    status: z.string().nullable().optional(),
  })
  .passthrough();

export const n8nWorkflowStartResultSchema = rawN8nWorkflowStartResultSchema.transform((result) => {
  const executionId = result.executionId ?? result.id;

  if (!executionId) {
    throw new Error('n8n workflow start response did not include an execution identifier.');
  }

  return {
    executionId,
    workflowId: result.workflowId ?? null,
    status: normalizeN8nExecutionStatus(result.status ?? 'new'),
  };
});
export type N8nWorkflowStartResult = z.infer<typeof n8nWorkflowStartResultSchema>;

export const n8nHealthResponseSchema = z
  .object({
    status: z.string().min(1),
  })
  .passthrough();
export type N8nHealthResponse = z.infer<typeof n8nHealthResponseSchema>;
