import { AppError } from '@/lib/http/api-errors';

const UNSERIALIZABLE_DETAILS = { message: 'Details could not be serialized.' } as const;

function serializeDetails(details: unknown): unknown {
  return sanitizeDetails(details, new WeakSet<object>());
}

function isObject(value: unknown): value is Record<string, unknown> | readonly unknown[] {
  return typeof value === 'object' && value !== null;
}

function sanitizeDetails(value: unknown, seen: WeakSet<object>): unknown {
  if (value === null) {
    return null;
  }

  const valueType = typeof value;
  if (valueType === 'string' || valueType === 'boolean') {
    return value;
  }
  if (valueType === 'number') {
    return Number.isFinite(value) ? value : String(value);
  }
  if (valueType === 'bigint') {
    return (value as bigint).toString();
  }
  if (valueType === 'undefined' || valueType === 'function' || valueType === 'symbol') {
    return UNSERIALIZABLE_DETAILS;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
    };
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) {
      return UNSERIALIZABLE_DETAILS;
    }
    seen.add(value);
    try {
      return value.map((item) => sanitizeDetails(item, seen));
    } finally {
      seen.delete(value);
    }
  }
  if (valueType === 'object') {
    if (!isObject(value)) {
      return UNSERIALIZABLE_DETAILS;
    }
    if (seen.has(value)) {
      return UNSERIALIZABLE_DETAILS;
    }
    seen.add(value);
    try {
      return Object.fromEntries(
        Object.entries(value).map(([key, entry]) => [key, sanitizeDetails(entry, seen)]),
      );
    } finally {
      seen.delete(value);
    }
  }

  return UNSERIALIZABLE_DETAILS;
}

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
        details: error.details === undefined ? undefined : serializeDetails(error.details),
      },
    },
    { status: error.status },
  );
}
