import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const prismaClientCalls = vi.fn();
const prismaPgCalls = vi.fn();

class PrismaClientMock {
  constructor(options: unknown) {
    prismaClientCalls(options);
    return { __tag: 'client' } as object;
  }
}

class PrismaPgMock {
  constructor(options: unknown) {
    prismaPgCalls(options);
    return { __tag: 'adapter' } as object;
  }
}

vi.mock('server-only', () => ({}));
vi.mock('@prisma/client', () => ({
  PrismaClient: PrismaClientMock,
}));
vi.mock('@prisma/adapter-pg', () => ({
  PrismaPg: PrismaPgMock,
}));

describe('prisma client singleton', () => {
  beforeEach(() => {
    vi.resetModules();
    prismaClientCalls.mockClear();
    prismaPgCalls.mockClear();
    vi.unstubAllEnvs();
    delete (globalThis as { prisma?: unknown }).prisma;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    delete (globalThis as { prisma?: unknown }).prisma;
  });

  it('configures PrismaClient with a pg adapter and development logging', async () => {
    vi.stubEnv('DATABASE_URL', 'postgresql://localhost:5432/localrag_nextjs');
    vi.stubEnv('NODE_ENV', 'development');

    const { prisma } = await import('@/lib/db/prisma');

    expect(prismaPgCalls).toHaveBeenCalledWith({
      connectionString: 'postgresql://localhost:5432/localrag_nextjs',
    });
    expect(prismaClientCalls).toHaveBeenCalledWith({
      adapter: { __tag: 'adapter' },
      log: ['query', 'warn', 'error'],
    });
    expect((globalThis as { prisma?: unknown }).prisma).toBe(prisma);
  });
});
