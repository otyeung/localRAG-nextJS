import 'server-only';

import { QdrantClient } from '@qdrant/js-client-rest';

import { env } from '@/lib/config/env';

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
    }
  }
}

export function createQdrantClient(): AppQdrantClient {
  return new AppQdrantClient();
}
