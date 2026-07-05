import 'server-only';

import { z } from 'zod';

const rawEnvSchema = z.object({
  OPENAI_API_KEY: z.string().min(1),
  OPENAI_MODEL: z.string().min(1).default('gpt-4.1-mini'),
  OPENAI_EMBEDDING_MODEL: z.string().min(1).default('text-embedding-3-small'),
  DATABASE_URL: z.string().url(),
  N8N_BASE_URL: z.string().url(),
  N8N_API_KEY: z
    .string()
    .trim()
    .optional()
    .transform((value) => (value && value.length > 0 ? value : null)),
  N8N_WEBHOOK_SECRET: z.string().min(1),
  N8N_TIMEOUT: z.coerce.number().int().positive().default(30_000),
  N8N_RETRY_COUNT: z.coerce.number().int().min(0).max(10).default(3),
  N8N_RETRY_DELAY: z.coerce.number().int().positive().default(500),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  MAX_UPLOAD_SIZE: z.coerce.number().int().positive().default(52_428_800),
  TEMP_UPLOAD_DIRECTORY: z.string().min(1).default('/tmp/localrag-nextjs/uploads'),
  QDRANT_URL: z.string().url(),
  QDRANT_COLLECTION: z.string().min(1).default('documents'),
  QDRANT_VECTOR_SIZE: z.coerce.number().int().positive().default(1_536),
  QDRANT_DISTANCE: z.enum(['Cosine', 'Dot', 'Euclid', 'Manhattan']).default('Cosine'),
  ANONYMOUS_COOKIE_SECRET: z.string().min(1),
});

export type AppEnv = {
  openai: {
    apiKey: string;
    model: string;
    embeddingModel: string;
  };
  database: {
    url: string;
  };
  n8n: {
    baseUrl: string;
    apiKey: string | null;
    webhookSecret: string;
    timeoutMs: number;
    retryCount: number;
    retryDelayMs: number;
  };
  logger: {
    level: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';
  };
  upload: {
    maxBytes: number;
    tempDirectory: string;
  };
  qdrant: {
    url: string;
    collection: string;
    vectorSize: number;
    distance: 'Cosine' | 'Dot' | 'Euclid' | 'Manhattan';
  };
  auth: {
    anonymousCookieSecret: string;
  };
};

export type EnvSource = Record<string, string | undefined>;

export function createEnv(source: EnvSource): AppEnv {
  const parsed = rawEnvSchema.parse(source);

  return {
    openai: {
      apiKey: parsed.OPENAI_API_KEY,
      model: parsed.OPENAI_MODEL,
      embeddingModel: parsed.OPENAI_EMBEDDING_MODEL,
    },
    database: {
      url: parsed.DATABASE_URL,
    },
    n8n: {
      baseUrl: parsed.N8N_BASE_URL.replace(/\/$/, ''),
      apiKey: parsed.N8N_API_KEY,
      webhookSecret: parsed.N8N_WEBHOOK_SECRET,
      timeoutMs: parsed.N8N_TIMEOUT,
      retryCount: parsed.N8N_RETRY_COUNT,
      retryDelayMs: parsed.N8N_RETRY_DELAY,
    },
    logger: {
      level: parsed.LOG_LEVEL,
    },
    upload: {
      maxBytes: parsed.MAX_UPLOAD_SIZE,
      tempDirectory: parsed.TEMP_UPLOAD_DIRECTORY,
    },
    qdrant: {
      url: parsed.QDRANT_URL.replace(/\/$/, ''),
      collection: parsed.QDRANT_COLLECTION,
      vectorSize: parsed.QDRANT_VECTOR_SIZE,
      distance: parsed.QDRANT_DISTANCE,
    },
    auth: {
      anonymousCookieSecret: parsed.ANONYMOUS_COOKIE_SECRET,
    },
  };
}

const testEnvDefaults: EnvSource = {
  OPENAI_API_KEY: 'sk-test',
  OPENAI_MODEL: 'gpt-4.1-mini',
  OPENAI_EMBEDDING_MODEL: 'text-embedding-3-small',
  DATABASE_URL: 'postgresql://localhost:5432/db',
  N8N_BASE_URL: 'http://n8n:5678',
  N8N_API_KEY: 'n8n-test',
  N8N_WEBHOOK_SECRET: 'localrag-nextjs-test-webhook-secret',
  N8N_TIMEOUT: '30000',
  N8N_RETRY_COUNT: '3',
  N8N_RETRY_DELAY: '500',
  LOG_LEVEL: 'info',
  MAX_UPLOAD_SIZE: '52428800',
  TEMP_UPLOAD_DIRECTORY: '/tmp/localrag-nextjs/uploads',
  QDRANT_URL: 'http://qdrant:6333',
  QDRANT_COLLECTION: 'documents',
  QDRANT_VECTOR_SIZE: '1536',
  QDRANT_DISTANCE: 'Cosine',
  ANONYMOUS_COOKIE_SECRET: 'localrag-nextjs-test-anonymous-cookie-secret',
};

const envSource = process.env.NODE_ENV === 'test' ? { ...testEnvDefaults, ...process.env } : process.env;

export const env = createEnv(envSource);
