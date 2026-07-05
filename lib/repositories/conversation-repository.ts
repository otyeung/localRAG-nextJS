import { Conversation } from '@prisma/client';

import type { DbClient } from '@/lib/repositories/types';

const DEFAULT_CONVERSATION_TITLE = 'New Chat';

export class ConversationRepository {
  constructor(private readonly db: DbClient) {}

  async createForUser(userId: string, title = DEFAULT_CONVERSATION_TITLE): Promise<Conversation> {
    return this.db.conversation.create({
      data: {
        userId,
        title,
      },
    });
  }
}
