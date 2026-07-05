import 'server-only';

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

function roundLatency(startedAt: number) {
  return Math.max(0, Math.round(performance.now() - startedAt));
}

async function defaultCheckDatabase() {
  const { prisma } = await import('@/lib/db/prisma');

  await prisma.$queryRawUnsafe('SELECT 1');
}

async function defaultGetN8nStatus(): Promise<N8nSnapshot> {
  const { N8nHealthService } = await import('@/lib/n8n/health');

  const snapshot = await new N8nHealthService().getStatus();

  return {
    healthy: snapshot.healthy,
    workflowCount: snapshot.workflowCount,
  };
}

async function defaultCheckQdrantCollection(): Promise<boolean> {
  const [{ env }, { createQdrantClient }] = await Promise.all([
    import('@/lib/config/env'),
    import('@/lib/qdrant/client'),
  ]);

  const qdrant = createQdrantClient();
  const reachable = await qdrant.ping();

  if (!reachable) {
    return false;
  }

  await qdrant.client.getCollection(env.qdrant.collection);

  return true;
}

async function defaultIsOpenAiConfigured() {
  const { env } = await import('@/lib/config/env');

  return Boolean(env.openai.apiKey.trim() && env.openai.model.trim());
}

async function defaultGetOpenAiModel() {
  const { env } = await import('@/lib/config/env');

  return env.openai.model;
}

async function defaultGetQdrantCollection() {
  const { env } = await import('@/lib/config/env');

  return env.qdrant.collection;
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
    const collection = await this.getQdrantCollection();

    try {
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
        message: `Qdrant collection "${collection}" is unavailable.`,
        checkedAt,
        latencyMs: roundLatency(startedAt),
      };
    }
  }

  private async buildOpenAiCheck(checkedAt: string): Promise<SystemHealthCheckDto> {
    const startedAt = performance.now();
    const model = await this.getOpenAiModel();
    const configured = await this.isOpenAiConfigured();

    return {
      name: 'openai',
      status: configured ? 'healthy' : 'degraded',
      message: configured ? `OpenAI model "${model}" is configured.` : 'OpenAI configuration is incomplete.',
      checkedAt,
      latencyMs: roundLatency(startedAt),
    };
  }
}
