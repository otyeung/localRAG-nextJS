import 'server-only';

import pino from 'pino';

const validLogLevels = new Set(['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const);

type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

function readLogLevel(): LogLevel {
  const value = process.env.LOG_LEVEL?.trim().toLowerCase();

  return value && validLogLevels.has(value as LogLevel) ? (value as LogLevel) : 'info';
}

export const logger = pino({
  level: readLogLevel(),
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
