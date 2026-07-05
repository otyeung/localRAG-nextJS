import type { User } from '@prisma/client';

import type { DbClient } from '@/lib/repositories/types';

export class UserRepository {
  constructor(private readonly db: DbClient) {}

  async findOrCreateAnonymousUser(fingerprintHash: string): Promise<User> {
    return this.db.user.upsert({
      where: { fingerprintHash },
      update: {},
      create: {
        fingerprintHash,
        displayName: 'Local User',
      },
    });
  }
}
