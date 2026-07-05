import { AppError } from '@/lib/http/api-errors';

export function jsonOk<T>(data: T, init?: ResponseInit): Response {
  return Response.json({ data }, init);
}

export function jsonError(error: AppError, requestId: string): Response {
  return Response.json(
    {
      error: {
        code: error.code,
        message: error.message,
        requestId,
        details: error.details,
      },
    },
    { status: error.status },
  );
}
