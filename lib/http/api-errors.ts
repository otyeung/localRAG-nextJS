export type AppErrorCode =
  | 'BAD_REQUEST'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'RATE_LIMITED'
  | 'CONFLICT'
  | 'VALIDATION_ERROR'
  | 'UPSTREAM_ERROR'
  | 'INTERNAL_ERROR';

const statusByCode: Record<AppErrorCode, number> = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  RATE_LIMITED: 429,
  CONFLICT: 409,
  VALIDATION_ERROR: 422,
  UPSTREAM_ERROR: 502,
  INTERNAL_ERROR: 500,
};

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: AppErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = statusByCode[code];
    this.details = details;
  }
}

export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) {
    return error;
  }

  return new AppError('INTERNAL_ERROR', 'An unexpected error occurred.');
}
