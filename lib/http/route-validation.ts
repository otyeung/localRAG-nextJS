import { z } from 'zod';

import { AppError } from '@/lib/http/api-errors';

export async function parseJsonBody(request: Pick<Request, 'json'>, message = 'Invalid JSON body.'): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new AppError('BAD_REQUEST', message);
  }
}

export function validateWithSchema<TSchema extends z.ZodTypeAny>(
  schema: TSchema,
  input: unknown,
  message: string,
): z.infer<TSchema> {
  const parsed = schema.safeParse(input);

  if (!parsed.success) {
    throw new AppError('VALIDATION_ERROR', message, parsed.error.flatten());
  }

  return parsed.data;
}
