import 'server-only';

import type { PrismaClient } from '@prisma/client';

import type { DbClient } from '@/lib/repositories/types';
import { prisma } from '@/lib/db/prisma';
import { AuditRepository } from '@/lib/repositories/audit-repository';

export type UserSettingsDto = {
  theme: 'system' | 'light' | 'dark';
  model: string;
  showReasoningMetadata: boolean;
};

export type UserSettingsUpdateInput = Partial<UserSettingsDto>;

export const defaultUserSettings: UserSettingsDto = {
  theme: 'system',
  model: 'gpt-4.1-mini',
  showReasoningMetadata: true,
};

type SettingsDb = Pick<DbClient, 'settings'>;
type SettingsTransactionDb = Pick<DbClient, 'settings' | 'auditLog'>;
type TransactionRunner = Pick<PrismaClient, '$transaction'>;

export type SettingsAuditContext = {
  requestId?: string;
  ipAddress?: string;
  userAgent?: string;
};

type StoredSettings = {
  theme?: string | null;
  model?: string | null;
  showReasoningMetadata?: boolean | null;
} | null | undefined;

function toThemePreference(theme: string | null | undefined): UserSettingsDto['theme'] {
  if (theme === 'light' || theme === 'dark' || theme === 'system') {
    return theme;
  }

  return defaultUserSettings.theme;
}

function toUserSettingsDto(settings: StoredSettings): UserSettingsDto {
  return {
    theme: toThemePreference(settings?.theme),
    model: settings?.model ?? defaultUserSettings.model,
    showReasoningMetadata: settings?.showReasoningMetadata ?? defaultUserSettings.showReasoningMetadata,
  };
}

function buildUpdateData(input: UserSettingsUpdateInput): UserSettingsUpdateInput {
  const nextInput: UserSettingsUpdateInput = {};

  if (input.theme !== undefined) {
    nextInput.theme = input.theme;
  }

  if (input.model !== undefined) {
    nextInput.model = input.model;
  }

  if (input.showReasoningMetadata !== undefined) {
    nextInput.showReasoningMetadata = input.showReasoningMetadata;
  }

  return nextInput;
}

function buildCreateData(userId: string, input: UserSettingsUpdateInput): UserSettingsDto & { userId: string } {
  return {
    userId,
    ...defaultUserSettings,
    ...buildUpdateData(input),
  };
}

export class SettingsService {
  constructor(
    private readonly db: SettingsDb = prisma,
    private readonly transactionRunner: TransactionRunner = prisma,
  ) {}

  async getForUser(userId: string): Promise<UserSettingsDto> {
    const settings = await this.db.settings.findUnique({
      where: { userId },
      select: {
        theme: true,
        model: true,
        showReasoningMetadata: true,
      },
    });

    return toUserSettingsDto(settings);
  }

  async updateForUser(userId: string, input: UserSettingsUpdateInput): Promise<UserSettingsDto> {
    return this.upsertForUser(this.db, userId, input);
  }

  async updateForUserWithAudit(
    userId: string,
    input: UserSettingsUpdateInput,
    auditContext: SettingsAuditContext,
  ): Promise<UserSettingsDto> {
    return this.transactionRunner.$transaction(async (transaction) => {
      const settings = await this.upsertForUser(transaction, userId, input);

      await new AuditRepository(transaction).create({
        userId,
        action: 'settings.updated',
        entityType: 'settings',
        entityId: userId,
        requestId: auditContext.requestId,
        metadata: settings,
        ipAddress: auditContext.ipAddress,
        userAgent: auditContext.userAgent,
      });

      return settings;
    });
  }

  private async upsertForUser(
    db: SettingsDb | SettingsTransactionDb,
    userId: string,
    input: UserSettingsUpdateInput,
  ): Promise<UserSettingsDto> {
    const settings = await db.settings.upsert({
      where: { userId },
      update: buildUpdateData(input),
      create: buildCreateData(userId, input),
      select: {
        theme: true,
        model: true,
        showReasoningMetadata: true,
      },
    });

    return toUserSettingsDto(settings);
  }
}
