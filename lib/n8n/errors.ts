import { ZodError } from 'zod';

import { AppError } from '@/lib/http/api-errors';

export class N8nError extends AppError {
  constructor(message: string, details?: unknown) {
    super('UPSTREAM_ERROR', message, details);
    this.name = 'N8nError';
  }
}

export class N8nConfigurationError extends AppError {
  constructor(message: string, details?: unknown) {
    super('BAD_REQUEST', message, details);
    this.name = 'N8nConfigurationError';
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

export function isAmbiguousN8nWebhookStartError(error: unknown): boolean {
  if (!(error instanceof N8nError) || typeof error.details !== 'object' || error.details === null) {
    return false;
  }

  const details = error.details as {
    kind?: string;
  };

  return details.kind === 'transport' || details.kind === 'timeout';
}
