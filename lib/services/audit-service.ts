import 'server-only';

import type { Prisma } from '@prisma/client';

import { prisma } from '@/lib/db/prisma';
import { AuditRepository } from '@/lib/repositories/audit-repository';

export type AuditEventInput = {
  userId: string;
  action: string;
  entityType: string;
  entityId?: string;
  requestId?: string;
  metadata?: Prisma.InputJsonValue;
  ipAddress?: string;
  userAgent?: string;
};

type AuditRepositoryLike = Pick<AuditRepository, 'create'>;

export class AuditService {
  constructor(private readonly repository: AuditRepositoryLike = new AuditRepository(prisma)) {}

  async record(input: AuditEventInput): Promise<void> {
    await this.repository.create(input);
  }
}
