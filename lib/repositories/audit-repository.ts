import type { AuditLog } from '@prisma/client';

import type { CreateAuditLogInput, DbClient } from '@/lib/repositories/types';

export class AuditRepository {
  constructor(private readonly db: DbClient) {}

  async create(input: CreateAuditLogInput): Promise<AuditLog> {
    return this.db.auditLog.create({
      data: {
        userId: input.userId,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        requestId: input.requestId,
        metadata: input.metadata,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      },
    });
  }
}
