import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { AppError } from '@/lib/http/api-errors';
import { AppQdrantClient } from '@/lib/qdrant/client';

describe('AppQdrantClient', () => {
  it('creates the collection when it does not exist', async () => {
    const client = {
      getCollections: vi.fn().mockResolvedValue({
        collections: [],
      }),
      createCollection: vi.fn().mockResolvedValue(true),
      getCollection: vi.fn(),
    };
    const qdrant = new AppQdrantClient(client as never);

    await qdrant.ensureCollection();

    expect(client.createCollection).toHaveBeenCalledWith('documents', {
      vectors: {
        size: 1536,
        distance: 'Cosine',
      },
    });
    expect(client.getCollection).not.toHaveBeenCalled();
  });

  it('accepts an existing collection with the expected vector shape', async () => {
    const client = {
      getCollections: vi.fn().mockResolvedValue({
        collections: [{ name: 'documents' }],
      }),
      getCollection: vi.fn().mockResolvedValue({
        config: {
          params: {
            vectors: {
              size: 1536,
              distance: 'Cosine',
            },
          },
        },
      }),
      createCollection: vi.fn(),
    };
    const qdrant = new AppQdrantClient(client as never);

    await expect(qdrant.ensureCollection()).resolves.toBeUndefined();

    expect(client.getCollection).toHaveBeenCalledWith('documents');
    expect(client.createCollection).not.toHaveBeenCalled();
  });

  it('throws a clear upstream error when the existing collection vector size does not match', async () => {
    const client = {
      getCollections: vi.fn().mockResolvedValue({
        collections: [{ name: 'documents' }],
      }),
      getCollection: vi.fn().mockResolvedValue({
        config: {
          params: {
            vectors: {
              size: 768,
              distance: 'Cosine',
            },
          },
        },
      }),
      createCollection: vi.fn(),
    };
    const qdrant = new AppQdrantClient(client as never);

    await expect(qdrant.ensureCollection()).rejects.toMatchObject({
      code: 'UPSTREAM_ERROR',
      message: 'Qdrant collection configuration does not match the application vector settings.',
    } satisfies Partial<AppError>);
  });

  it('throws a clear upstream error when the existing collection distance does not match', async () => {
    const client = {
      getCollections: vi.fn().mockResolvedValue({
        collections: [{ name: 'documents' }],
      }),
      getCollection: vi.fn().mockResolvedValue({
        config: {
          params: {
            vectors: {
              size: 1536,
              distance: 'Dot',
            },
          },
        },
      }),
      createCollection: vi.fn(),
    };
    const qdrant = new AppQdrantClient(client as never);

    await expect(qdrant.ensureCollection()).rejects.toMatchObject({
      code: 'UPSTREAM_ERROR',
      message: 'Qdrant collection configuration does not match the application vector settings.',
    } satisfies Partial<AppError>);
  });
});
