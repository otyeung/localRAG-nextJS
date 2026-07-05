const timeoutMs = 15_000;
const readyTimeoutMs = 120_000;
const readyIntervalMs = 1_000;

function readRequiredEnv(name) {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function parseVectorSize(value) {
  const size = Number.parseInt(value, 10);

  if (!Number.isInteger(size) || size <= 0) {
    throw new Error(`QDRANT_VECTOR_SIZE must be a positive integer. Received: ${value}`);
  }

  return size;
}

async function requestJson(url, init) {
  const response = await fetch(url, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init?.headers ?? {}),
    },
    signal: AbortSignal.timeout(timeoutMs),
  });

  const text = await response.text();
  const json = text ? JSON.parse(text) : null;

  return { response, json };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForReady(baseUrl) {
  const readyUrl = `${baseUrl}/readyz`;
  const startedAt = Date.now();

  while (Date.now() - startedAt < readyTimeoutMs) {
    try {
      const response = await fetch(readyUrl, {
        method: 'GET',
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (response.ok) {
        return;
      }
    } catch (error) {
      void error;
    }

    await sleep(readyIntervalMs);
  }

  throw new Error(`Timed out waiting for Qdrant to become ready at ${readyUrl}`);
}

function readExistingVectorShape(payload) {
  const vectors = payload?.result?.config?.params?.vectors;

  if (!vectors || typeof vectors !== 'object' || Array.isArray(vectors)) {
    return null;
  }

  if (typeof vectors.size !== 'number' || typeof vectors.distance !== 'string') {
    return null;
  }

  return {
    size: vectors.size,
    distance: vectors.distance,
  };
}

async function ensureCollection() {
  const baseUrl = readRequiredEnv('QDRANT_URL').replace(/\/$/, '');
  const collection = readRequiredEnv('QDRANT_COLLECTION');
  const vectorSize = parseVectorSize(readRequiredEnv('QDRANT_VECTOR_SIZE'));
  const distance = readRequiredEnv('QDRANT_DISTANCE');
  const collectionUrl = `${baseUrl}/collections/${encodeURIComponent(collection)}`;

  await waitForReady(baseUrl);

  const { response, json } = await requestJson(collectionUrl, { method: 'GET' });

  if (response.status === 404) {
    const createResult = await requestJson(collectionUrl, {
      method: 'PUT',
      body: JSON.stringify({
        vectors: {
          size: vectorSize,
          distance,
        },
      }),
    });

    if (!createResult.response.ok) {
      throw new Error(
        `Failed to create Qdrant collection "${collection}": ${createResult.response.status} ${JSON.stringify(createResult.json)}`,
      );
    }

    console.log(`Created Qdrant collection "${collection}" with ${vectorSize}-dim ${distance} vectors.`);
    return;
  }

  if (!response.ok) {
    throw new Error(`Failed to inspect Qdrant collection "${collection}": ${response.status} ${JSON.stringify(json)}`);
  }

  const existing = readExistingVectorShape(json);

  if (!existing || existing.size !== vectorSize || existing.distance !== distance) {
    throw new Error(
      `Qdrant collection "${collection}" has unexpected vector settings: ${JSON.stringify({
        expected: { size: vectorSize, distance },
        actual: existing,
      })}`,
    );
  }

  console.log(`Verified Qdrant collection "${collection}" with ${existing.size}-dim ${existing.distance} vectors.`);
}

await ensureCollection();
