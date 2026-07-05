import 'server-only';

import type { DbClient } from '@/lib/repositories/types';
import { prisma } from '@/lib/db/prisma';

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

export class SettingsService {
  constructor(private readonly db: SettingsDb = prisma) {}

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
    const current = await this.getForUser(userId);
    const nextSettings: UserSettingsDto = {
      ...current,
      ...input,
    };

    const settings = await this.db.settings.upsert({
      where: { userId },
      update: nextSettings,
      create: {
        userId,
        ...nextSettings,
      },
      select: {
        theme: true,
        model: true,
        showReasoningMetadata: true,
      },
    });

    return toUserSettingsDto(settings);
  }
}
