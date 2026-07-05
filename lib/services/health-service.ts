import 'server-only';

import { QdrantClient } from '@qdrant/js-client-rest';

import packageMetadata from '@/package.json';

export type HealthCheckName = 'app' | 'database' | 'n8n' | 'qdrant' | 'openai';
export type HealthCheckStatus = 'healthy' | 'degraded' | 'unhealthy';

export type SystemHealthCheckDto = {
  name: HealthCheckName;
  status: HealthCheckStatus;
  message: string;
  checkedAt: string;
  latencyMs: number;
};

export type SystemHealthDto = {
  status: HealthCheckStatus;
  checkedAt: string;
  version: string;
  uptimeSeconds: number;
  checks: SystemHealthCheckDto[];
};

type N8nSnapshot = {
  healthy: boolean;
  workflowCount: number;
};

type Awaitable<T> = T | Promise<T>;

type HealthServiceDependencies = {
  now?: () => Date;
  getUptimeSeconds?: () => number;
  checkDatabase?: () => Promise<void>;
  getN8nStatus?: () => Promise<N8nSnapshot>;
  checkQdrantCollection?: () => Promise<boolean>;
  isOpenAiConfigured?: () => Awaitable<boolean>;
  getOpenAiModel?: () => Awaitable<string>;
  getQdrantCollection?: () => Awaitable<string>;
};

type N8nHealthConfig = {
  baseUrl: string;
  apiKey: string;
  timeoutMs: number;
  retryCount: number;
  retryDelayMs: number;
};

type OpenAiHealthConfig = {
  apiKey: string;
  model: string;
};

type QdrantHealthConfig = {
  url: string;
  collection: string;
};

const DEFAULT_OPENAI_MODEL = 'gpt-4.1-mini';
const DEFAULT_N8N_TIMEOUT_MS = 30_000;
const DEFAULT_N8N_RETRY_COUNT = 3;
const DEFAULT_N8N_RETRY_DELAY_MS = 500;
const DEFAULT_QDRANT_COLLECTION = 'documents';

function roundLatency(startedAt: number) {
  return Math.max(0, Math.round(performance.now() - startedAt));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function readTrimmedEnv(name: string): string | null {
  const value = process.env[name];

  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readUrlEnv(name: string): string | null {
  const value = readTrimmedEnv(name);

  if (!value) {
    return null;
  }

  try {
    return new URL(value).toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

function readPositiveIntEnv(name: string, fallback: number, minimum = 1): number {
  const value = readTrimmedEnv(name);

  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed >= minimum ? parsed : fallback;
}

function readN8nHealthConfig(): N8nHealthConfig | null {
  const baseUrl = readUrlEnv('N8N_BASE_URL');
  const apiKey = readTrimmedEnv('N8N_API_KEY');

  if (!baseUrl || !apiKey) {
    return null;
  }

  return {
    baseUrl,
    apiKey,
    timeoutMs: readPositiveIntEnv('N8N_TIMEOUT', DEFAULT_N8N_TIMEOUT_MS),
    retryCount: readPositiveIntEnv('N8N_RETRY_COUNT', DEFAULT_N8N_RETRY_COUNT, 0),
    retryDelayMs: readPositiveIntEnv('N8N_RETRY_DELAY', DEFAULT_N8N_RETRY_DELAY_MS),
  };
}

function readOpenAiHealthConfig(): OpenAiHealthConfig {
  return {
    apiKey: readTrimmedEnv('OPENAI_API_KEY') ?? '',
    model: readTrimmedEnv('OPENAI_MODEL') ?? DEFAULT_OPENAI_MODEL,
  };
}

function readQdrantHealthConfig(): QdrantHealthConfig | null {
  const url = readUrlEnv('QDRANT_URL');
  const collection = readTrimmedEnv('QDRANT_COLLECTION') ?? DEFAULT_QDRANT_COLLECTION;

  if (!url) {
    return null;
  }

  return {
    url,
    collection,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

async function requestN8nJson(config: N8nHealthConfig, path: string, query?: Record<string, string>): Promise<unknown> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= config.retryCount; attempt += 1) {
    const url = new URL(path, `${config.baseUrl}/`);

    for (const [key, value] of Object.entries(query ?? {})) {
      url.searchParams.set(key, value);
    }

    try {
      const response = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          'X-N8N-API-KEY': config.apiKey,
        },
        signal: AbortSignal.timeout(config.timeoutMs),
      });

      if (!response.ok) {
        if (attempt === config.retryCount || !isRetryableStatus(response.status)) {
          throw new Error('n8n request failed.');
        }

        await sleep(config.retryDelayMs * 2 ** attempt);
        continue;
      }

      return (await response.json()) as unknown;
    } catch (error) {
      lastError = error;

      if (attempt === config.retryCount) {
        break;
      }

      await sleep(config.retryDelayMs * 2 ** attempt);
    }
  }

  throw lastError ?? new Error('n8n request failed.');
}

async function defaultCheckDatabase() {
  const { prisma } = await import('@/lib/db/prisma');

  await prisma.$queryRawUnsafe('SELECT 1');
}

async function defaultGetN8nStatus(): Promise<N8nSnapshot> {
  const config = readN8nHealthConfig();

  if (!config) {
    return {
      healthy: false,
      workflowCount: 0,
    };
  }

  try {
    const [healthResponse, workflowResponse] = await Promise.all([
      requestN8nJson(config, '/healthz'),
      requestN8nJson(config, '/api/v1/workflows', {
        active: 'true',
      }),
    ]);

    const healthy =
      isRecord(healthResponse) &&
      typeof healthResponse.status === 'string' &&
      healthResponse.status.trim().toLowerCase() === 'ok';
    const workflowCount =
      isRecord(workflowResponse) && Array.isArray(workflowResponse.data) ? workflowResponse.data.length : 0;

    return {
      healthy,
      workflowCount,
    };
  } catch {
    return {
      healthy: false,
      workflowCount: 0,
    };
  }
}

async function defaultCheckQdrantCollection(): Promise<boolean> {
  const config = readQdrantHealthConfig();

  if (!config) {
    throw new Error('Qdrant configuration is incomplete.');
  }

  const client = new QdrantClient({
    url: config.url,
  });

  try {
    await client.getCollections();
    await client.getCollection(config.collection);
    return true;
  } catch {
    return false;
  }
}

async function defaultIsOpenAiConfigured() {
  const config = readOpenAiHealthConfig();

  return Boolean(config.apiKey && config.model);
}

async function defaultGetOpenAiModel() {
  return readOpenAiHealthConfig().model;
}

async function defaultGetQdrantCollection() {
  return readQdrantHealthConfig()?.collection ?? DEFAULT_QDRANT_COLLECTION;
}

function summarizeStatus(checks: SystemHealthCheckDto[]): HealthCheckStatus {
  if (checks.some((check) => check.status === 'unhealthy')) {
    return 'unhealthy';
  }

  if (checks.some((check) => check.status === 'degraded')) {
    return 'degraded';
  }

  return 'healthy';
}

export class HealthService {
  private readonly now: () => Date;
  private readonly getUptimeSeconds: () => number;
  private readonly checkDatabase: () => Promise<void>;
  private readonly getN8nStatus: () => Promise<N8nSnapshot>;
  private readonly checkQdrantCollection: () => Promise<boolean>;
  private readonly isOpenAiConfigured: () => Awaitable<boolean>;
  private readonly getOpenAiModel: () => Awaitable<string>;
  private readonly getQdrantCollection: () => Awaitable<string>;

  constructor(dependencies: HealthServiceDependencies = {}) {
    this.now = dependencies.now ?? (() => new Date());
    this.getUptimeSeconds = dependencies.getUptimeSeconds ?? (() => process.uptime());
    this.checkDatabase = dependencies.checkDatabase ?? defaultCheckDatabase;
    this.getN8nStatus = dependencies.getN8nStatus ?? defaultGetN8nStatus;
    this.checkQdrantCollection = dependencies.checkQdrantCollection ?? defaultCheckQdrantCollection;
    this.isOpenAiConfigured = dependencies.isOpenAiConfigured ?? defaultIsOpenAiConfigured;
    this.getOpenAiModel = dependencies.getOpenAiModel ?? defaultGetOpenAiModel;
    this.getQdrantCollection = dependencies.getQdrantCollection ?? defaultGetQdrantCollection;
  }

  async getHealth(): Promise<SystemHealthDto> {
    const checkedAt = this.now().toISOString();
    const uptimeSeconds = Math.floor(this.getUptimeSeconds());
    const checks = await Promise.all([
      this.buildAppCheck(checkedAt, uptimeSeconds),
      this.buildDatabaseCheck(checkedAt),
      this.buildN8nCheck(checkedAt),
      this.buildQdrantCheck(checkedAt),
      this.buildOpenAiCheck(checkedAt),
    ]);

    return {
      status: summarizeStatus(checks),
      checkedAt,
      version: packageMetadata.version,
      uptimeSeconds,
      checks,
    };
  }

  private async buildAppCheck(checkedAt: string, uptimeSeconds: number): Promise<SystemHealthCheckDto> {
    const startedAt = performance.now();

    return {
      name: 'app',
      status: 'healthy',
      message: `Running version ${packageMetadata.version} with ${uptimeSeconds}s uptime.`,
      checkedAt,
      latencyMs: roundLatency(startedAt),
    };
  }

  private async buildDatabaseCheck(checkedAt: string): Promise<SystemHealthCheckDto> {
    const startedAt = performance.now();

    try {
      await this.checkDatabase();

      return {
        name: 'database',
        status: 'healthy',
        message: 'Database connection verified.',
        checkedAt,
        latencyMs: roundLatency(startedAt),
      };
    } catch {
      return {
        name: 'database',
        status: 'unhealthy',
        message: 'Database query failed.',
        checkedAt,
        latencyMs: roundLatency(startedAt),
      };
    }
  }

  private async buildN8nCheck(checkedAt: string): Promise<SystemHealthCheckDto> {
    const startedAt = performance.now();

    try {
      const snapshot = await this.getN8nStatus();

      return {
        name: 'n8n',
        status: snapshot.healthy ? 'healthy' : 'degraded',
        message: snapshot.healthy
          ? `n8n is healthy with ${snapshot.workflowCount} active workflows.`
          : 'n8n API unavailable or workflows could not be listed.',
        checkedAt,
        latencyMs: roundLatency(startedAt),
      };
    } catch {
      return {
        name: 'n8n',
        status: 'degraded',
        message: 'n8n API unavailable or workflows could not be listed.',
        checkedAt,
        latencyMs: roundLatency(startedAt),
      };
    }
  }

  private async buildQdrantCheck(checkedAt: string): Promise<SystemHealthCheckDto> {
    const startedAt = performance.now();

    try {
      const collection = await this.getQdrantCollection();
      const available = await this.checkQdrantCollection();

      return {
        name: 'qdrant',
        status: available ? 'healthy' : 'degraded',
        message: available
          ? `Qdrant collection "${collection}" is available.`
          : `Qdrant collection "${collection}" is unavailable.`,
        checkedAt,
        latencyMs: roundLatency(startedAt),
      };
    } catch {
      return {
        name: 'qdrant',
        status: 'degraded',
        message: 'Qdrant configuration or connectivity is unavailable.',
        checkedAt,
        latencyMs: roundLatency(startedAt),
      };
    }
  }

  private async buildOpenAiCheck(checkedAt: string): Promise<SystemHealthCheckDto> {
    const startedAt = performance.now();

    try {
      const model = await this.getOpenAiModel();
      const configured = await this.isOpenAiConfigured();

      return {
        name: 'openai',
        status: configured ? 'healthy' : 'degraded',
        message: configured ? `OpenAI model "${model}" is configured.` : 'OpenAI configuration is incomplete.',
        checkedAt,
        latencyMs: roundLatency(startedAt),
      };
    } catch {
      return {
        name: 'openai',
        status: 'degraded',
        message: 'OpenAI configuration is incomplete.',
        checkedAt,
        latencyMs: roundLatency(startedAt),
      };
    }
  }
}
