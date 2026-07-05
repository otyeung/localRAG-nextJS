import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('prisma schema', () => {
  const schema = readFileSync(join(process.cwd(), 'prisma/schema.prisma'), 'utf8');

  it.each([
    'User',
    'Conversation',
    'Message',
    'Attachment',
    'Document',
    'ChunkMetadata',
    'EmbeddingMetadata',
    'WorkflowExecution',
    'Upload',
    'AgentRun',
    'ToolCall',
    'AuditLog',
    'Settings',
  ])('defines model %s', (modelName) => {
    expect(schema).toContain(`model ${modelName}`);
  });

  it('uses PostgreSQL through Prisma', () => {
    expect(schema).toContain('provider = "postgresql"');
  });
});
