import 'server-only';

import { QdrantClient } from '@qdrant/js-client-rest';

import { env } from '@/lib/config/env';
import { AppError } from '@/lib/http/api-errors';

type ExistingVectorShape = {
  size: number;
  distance: string;
};

function getExistingVectorShape(config: unknown): ExistingVectorShape | null {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return null;
  }

  if (!('size' in config) || !('distance' in config)) {
    return null;
  }

  const { size, distance } = config;

  if (typeof size !== 'number' || typeof distance !== 'string') {
    return null;
  }

  return { size, distance };
}

export class AppQdrantClient {
  readonly client: QdrantClient;

  constructor(client = new QdrantClient({ url: env.qdrant.url })) {
    this.client = client;
  }

  async ping(): Promise<boolean> {
    try {
      await this.client.getCollections();
      return true;
    } catch {
      return false;
    }
  }

  async ensureCollection(): Promise<void> {
    const collections = await this.client.getCollections();
    const exists = collections.collections.some((collection) => collection.name === env.qdrant.collection);

    if (!exists) {
      await this.client.createCollection(env.qdrant.collection, {
        vectors: {
          size: env.qdrant.vectorSize,
          distance: env.qdrant.distance,
        },
      });
      return;
    }

    const collection = await this.client.getCollection(env.qdrant.collection);
    const existingVectorShape = getExistingVectorShape(collection.config.params.vectors);

    if (
      !existingVectorShape ||
      existingVectorShape.size !== env.qdrant.vectorSize ||
      existingVectorShape.distance !== env.qdrant.distance
    ) {
      throw new AppError(
        'UPSTREAM_ERROR',
        'Qdrant collection configuration does not match the application vector settings.',
        {
          collection: env.qdrant.collection,
          expected: {
            size: env.qdrant.vectorSize,
            distance: env.qdrant.distance,
          },
          actual: existingVectorShape,
        },
      );
    }
  }
}

export function createQdrantClient(): AppQdrantClient {
  return new AppQdrantClient();
}
