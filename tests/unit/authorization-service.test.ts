import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    auditLog: { create: vi.fn() },
    settings: { findUnique: vi.fn(), upsert: vi.fn() },
  },
}));

import { AppError } from '@/lib/http/api-errors';
import { AuthorizationService } from '@/lib/services/authorization-service';
import { AuditService } from '@/lib/services/audit-service';
import { SettingsService, defaultUserSettings } from '@/lib/services/settings-service';

describe('AuthorizationService', () => {
  it('allows access when the user owns the resource', () => {
    const service = new AuthorizationService();

    expect(() => service.assertUserOwnsResource('user_1', 'user_1')).not.toThrow();
  });

  it('rejects access when the user does not own the resource', () => {
    const service = new AuthorizationService();

    expect(() => service.assertUserOwnsResource('user_1', 'user_2')).toThrow(
      new AppError('FORBIDDEN', 'You do not have access to this resource.'),
    );
  });
});

describe('AuditService', () => {
  it('records audit events through the repository', async () => {
    const create = vi.fn().mockResolvedValue(undefined);
    const service = new AuditService({ create } as never);

    await service.record({
      userId: 'user_1',
      action: 'settings.updated',
      entityType: 'settings',
      entityId: 'user_1',
      requestId: 'req_1',
      metadata: { theme: 'dark' },
      ipAddress: '127.0.0.1',
      userAgent: 'vitest',
    });

    expect(create).toHaveBeenCalledWith({
      userId: 'user_1',
      action: 'settings.updated',
      entityType: 'settings',
      entityId: 'user_1',
      requestId: 'req_1',
      metadata: { theme: 'dark' },
      ipAddress: '127.0.0.1',
      userAgent: 'vitest',
    });
  });
});

describe('SettingsService', () => {
  it('returns default settings when the user has no stored settings', async () => {
    const db = {
      settings: {
        findUnique: vi.fn().mockResolvedValue(null),
        upsert: vi.fn(),
      },
    };
    const service = new SettingsService(db as never);

    await expect(service.getForUser('user_1')).resolves.toEqual(defaultUserSettings);
  });

  it('returns the stored settings for the user', async () => {
    const db = {
      settings: {
        findUnique: vi.fn().mockResolvedValue({
          theme: 'dark',
          model: 'gpt-4.1-mini',
          showReasoningMetadata: false,
        }),
        upsert: vi.fn(),
      },
    };
    const service = new SettingsService(db as never);

    await expect(service.getForUser('user_1')).resolves.toEqual({
      theme: 'dark',
      model: 'gpt-4.1-mini',
      showReasoningMetadata: false,
    });
  });

  it('upserts patched settings while preserving defaults for omitted fields', async () => {
    const db = {
      settings: {
        findUnique: vi.fn().mockResolvedValue({
          theme: 'dark',
          model: 'gpt-4.1-mini',
          showReasoningMetadata: true,
        }),
        upsert: vi.fn().mockResolvedValue({
          theme: 'dark',
          model: 'gpt-4.1',
          showReasoningMetadata: true,
        }),
      },
    };
    const service = new SettingsService(db as never);

    await expect(service.updateForUser('user_1', { model: 'gpt-4.1' })).resolves.toEqual({
      theme: 'dark',
      model: 'gpt-4.1',
      showReasoningMetadata: true,
    });
    expect(db.settings.findUnique).not.toHaveBeenCalled();
    expect(db.settings.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'user_1' },
        update: {
          model: 'gpt-4.1',
        },
        create: {
          userId: 'user_1',
          theme: 'system',
          model: 'gpt-4.1',
          showReasoningMetadata: true,
        },
      }),
    );
  });

  it('updates settings and audit logging in one transaction', async () => {
    const tx = {
      settings: {
        upsert: vi.fn().mockResolvedValue({
          theme: 'dark',
          model: 'gpt-4.1-mini',
          showReasoningMetadata: true,
        }),
      },
      auditLog: {
        create: vi.fn().mockResolvedValue(undefined),
      },
    };
    const db = {
      settings: {
        findUnique: vi.fn(),
        upsert: vi.fn(),
      },
      $transaction: vi.fn(async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx)),
    };
    const service = new SettingsService(db as never, db as never);

    await expect(
      service.updateForUserWithAudit(
        'user_1',
        { theme: 'dark' },
        {
          requestId: 'req_1',
          ipAddress: '127.0.0.1',
          userAgent: 'vitest',
        },
      ),
    ).resolves.toEqual({
      theme: 'dark',
      model: 'gpt-4.1-mini',
      showReasoningMetadata: true,
    });

    expect(db.$transaction).toHaveBeenCalledOnce();
    expect(tx.settings.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'user_1' },
        update: {
          theme: 'dark',
        },
        create: {
          userId: 'user_1',
          theme: 'dark',
          model: 'gpt-4.1-mini',
          showReasoningMetadata: true,
        },
      }),
    );
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: {
        userId: 'user_1',
        action: 'settings.updated',
        entityType: 'settings',
        entityId: 'user_1',
        requestId: 'req_1',
        metadata: {
          theme: 'dark',
          model: 'gpt-4.1-mini',
          showReasoningMetadata: true,
        },
        ipAddress: '127.0.0.1',
        userAgent: 'vitest',
      },
    });
  });
});
