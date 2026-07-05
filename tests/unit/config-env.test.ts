import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { createEnv } from '@/lib/config/env';

describe('createEnv', () => {
  it('parses required server configuration', () => {
    const env = createEnv({
      OPENAI_API_KEY: 'sk-test',
      OPENAI_MODEL: 'gpt-4.1-mini',
      DATABASE_URL: 'postgresql://localhost:5432/db',
      N8N_BASE_URL: 'http://n8n:5678',
      N8N_API_KEY: 'n8n-test',
      N8N_TIMEOUT: '30000',
      N8N_RETRY_COUNT: '3',
      N8N_RETRY_DELAY: '500',
      LOG_LEVEL: 'info',
      MAX_UPLOAD_SIZE: '52428800',
      TEMP_UPLOAD_DIRECTORY: '/tmp/uploads',
      QDRANT_URL: 'http://qdrant:6333',
      QDRANT_COLLECTION: 'documents',
      QDRANT_VECTOR_SIZE: '1536',
      QDRANT_DISTANCE: 'Cosine',
      ANONYMOUS_COOKIE_SECRET: 'test-anonymous-cookie-secret',
    });

    expect(env.n8n.timeoutMs).toBe(30_000);
    expect(env.upload.maxBytes).toBe(52_428_800);
    expect(env.qdrant.collection).toBe('documents');
    expect(env.auth.anonymousCookieSecret).toBe('test-anonymous-cookie-secret');
  });

  it('rejects invalid URLs and numeric values', () => {
    expect(() =>
      createEnv({
        OPENAI_API_KEY: 'sk-test',
        OPENAI_MODEL: 'gpt-4.1-mini',
        DATABASE_URL: 'not-a-url',
        N8N_BASE_URL: 'http://n8n:5678',
        N8N_API_KEY: 'n8n-test',
        N8N_TIMEOUT: '-1',
        N8N_RETRY_COUNT: '3',
        N8N_RETRY_DELAY: '500',
        LOG_LEVEL: 'info',
        MAX_UPLOAD_SIZE: '52428800',
        TEMP_UPLOAD_DIRECTORY: '/tmp/uploads',
        QDRANT_URL: 'http://qdrant:6333',
        QDRANT_COLLECTION: 'documents',
        QDRANT_VECTOR_SIZE: '1536',
        QDRANT_DISTANCE: 'Cosine',
        ANONYMOUS_COOKIE_SECRET: '',
      }),
    ).toThrow();
  });
});
