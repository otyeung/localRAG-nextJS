import 'server-only';

import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL is required to initialize Prisma.');
}

function getPrismaSchema(url: string): string | undefined {
  try {
    return new URL(url).searchParams.get('schema') ?? undefined;
  } catch {
    return undefined;
  }
}

const prismaSchema = getPrismaSchema(connectionString);

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter: new PrismaPg(
      { connectionString },
      prismaSchema ? { schema: prismaSchema } : undefined,
    ),
    log:
      process.env.NODE_ENV === 'development'
        ? ['query', 'warn', 'error']
        : ['warn', 'error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
