import 'server-only';

import pino from 'pino';

import { env } from '@/lib/config/env';

export const logger = pino({
  level: env.logger.level,
  transport:
    process.env.NODE_ENV === 'development'
      ? {
          target: 'pino-pretty',
          options: {
            colorize: true,
            singleLine: true,
          },
        }
      : undefined,
  redact: {
    paths: ['OPENAI_API_KEY', 'N8N_API_KEY', '*.authorization', '*.apiKey', '*.password'],
    remove: true,
  },
});
