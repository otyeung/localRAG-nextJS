import { ZodError } from 'zod';

import { AppError } from '@/lib/http/api-errors';

export class N8nError extends AppError {
  constructor(message: string, details?: unknown) {
    super('UPSTREAM_ERROR', message, details);
    this.name = 'N8nError';
  }
}

export function toN8nError(error: unknown, fallbackMessage: string): N8nError {
  if (error instanceof N8nError) {
    return error;
  }

  if (error instanceof ZodError) {
    return new N8nError(fallbackMessage, {
      issues: error.issues,
    });
  }

  if (error instanceof Error) {
    return new N8nError(fallbackMessage, {
      cause: error.message,
    });
  }

  return new N8nError(fallbackMessage, {
    cause: error,
  });
}
