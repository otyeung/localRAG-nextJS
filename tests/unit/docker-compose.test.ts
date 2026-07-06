import { existsSync, readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

type WorkflowNode = {
  name: string;
  parameters?: Record<string, unknown>;
};

type WorkflowConnection = {
  node: string;
  type: string;
  index: number;
};

type WorkflowConnections = Record<string, { main?: WorkflowConnection[][] }>;

describe('docker compose', () => {
  const compose = readFileSync('docker-compose.yml', 'utf8');
  const exampleEnv = readFileSync('.env.example', 'utf8');
  const n8nReadme = readFileSync('docker/n8n/README.md', 'utf8');
  const n8nBootstrapScript = readFileSync(
    'docker/n8n/publish-targeted-workflows.mjs',
    'utf8',
  );
  const ingestionWorkflow = JSON.parse(
    readFileSync('docker/n8n/workflows/ingestion.json', 'utf8'),
  ) as {
    active: boolean;
    nodes: WorkflowNode[];
    connections: WorkflowConnections;
  };
  const retrievalWorkflow = JSON.parse(
    readFileSync('docker/n8n/workflows/retrieval.json', 'utf8'),
  ) as {
    active: boolean;
    nodes: WorkflowNode[];
    connections: WorkflowConnections;
  };

  const getNode = (workflow: { nodes: WorkflowNode[] }, name: string) => {
    const node = workflow.nodes.find((candidate) => candidate.name === name);

    expect(node, `Expected workflow node "${name}" to exist.`).toBeDefined();

    return node as WorkflowNode;
  };

  it.each(['nextjs', 'postgres', 'n8n', 'qdrant', 'redis'])(
    'defines service %s',
    (serviceName) => {
      expect(compose).toContain(`${serviceName}:`);
    },
  );

  it('uses internal service names for application dependencies', () => {
    expect(compose).toContain('schema=app');
    expect(compose).toContain('N8N_BASE_URL=http://n8n:5678');
    expect(compose).toContain('LOCALRAG_APP_URL: http://nextjs:3000');
    expect(compose).toContain('QDRANT_URL=http://qdrant:6333');
  });

  it('publishes the n8n editor on loopback while preserving service-network webhook wiring', () => {
    expect(compose).toContain('N8N_EDITOR_BASE_URL: http://localhost:5678');
    expect(compose).toContain('WEBHOOK_URL: http://n8n:5678/');
    expect(compose).toContain("'127.0.0.1:5678:5678'");
  });

  it('bootstraps workflows server-side without requiring browser activation', () => {
    expect(compose).toContain(
      'n8n import:workflow --separate --input=/n8n-bootstrap/workflows --overwrite',
    );
    expect(compose).toContain('publish-targeted-workflows.mjs');
    expect(compose).not.toContain('n8n update:workflow --all --active=true');
  });

  it('applies committed Prisma migrations before starting the Next.js dev server', () => {
    expect(compose).toContain('pnpm prisma generate');
    expect(compose).toContain('pnpm prisma migrate deploy');
    expect(compose).toContain('pnpm dev --hostname 0.0.0.0 --port 3000');
  });

  it('keeps n8n editor loopback-only and qdrant internal by default', () => {
    expect(compose).toContain("'127.0.0.1:5678:5678'");
    expect(compose).not.toContain("'0.0.0.0:5678:5678'");
    expect(compose).not.toContain("'- 5678:5678'");
    expect(compose).not.toContain("'6333:6333'");
  });

  it('does not commit an n8n editor host-port override', () => {
    expect(existsSync('docker-compose.n8n-editor.yml')).toBe(false);
  });

  it('keeps the Qdrant init sidecar healthy before application services start', () => {
    expect(compose).toContain('qdrant-init:');
    expect(compose).toContain('condition: service_healthy');
    expect(compose).not.toContain('service_completed_successfully');
    expect(compose).toContain('tail -f /dev/null');
    expect(compose).toContain('node scripts/ensure-qdrant-collection.mjs');
    expect(compose).toContain('QDRANT_VECTOR_SIZE');
    expect(compose).toContain('QDRANT_DISTANCE');
    expect(compose).toContain('OPENAI_API_URL');
    expect(compose).toContain('OPENAI_EMBEDDING_MODEL');
    expect(compose).toContain('N8N_WEBHOOK_SECRET');
  });

  it('allows containers to reach a host-local OpenAI-compatible runtime', () => {
    expect(compose).toContain('LOCALRAG_DOCKER=true');
    expect(compose).toContain('host.docker.internal:host-gateway');
    expect(exampleEnv).toContain('OPENAI_API_URL=');
  });

  it('defines healthchecks for every long-running docker service', () => {
    for (const serviceName of [
      'postgres',
      'qdrant',
      'qdrant-init',
      'redis',
      'n8n',
      'nextjs',
    ]) {
      const serviceBlock =
        compose.match(
          new RegExp(
            `\\n  ${serviceName}:\\n([\\s\\S]*?)(?=\\n  [a-zA-Z0-9_-]+:|\\nnetworks:)`,
          ),
        )?.[1] ?? '';

      expect(
        serviceBlock,
        `Expected service ${serviceName} block to exist.`,
      ).not.toBe('');
      expect(
        serviceBlock,
        `Expected service ${serviceName} to define a healthcheck.`,
      ).toContain('healthcheck:');
    }

    expect(compose).toContain("'redis-cli', 'ping'");
    expect(compose).toContain('http://127.0.0.1:3000/api/health/fleet');
  });

  it('defines a Qdrant healthcheck without relying on curl in the image', () => {
    const qdrantBlock =
      compose.match(/\n  qdrant:\n([\s\S]*?)\n  qdrant-init:/)?.[1] ?? '';

    expect(qdrantBlock).toContain('healthcheck:');
    expect(qdrantBlock).toContain('/proc/net/tcp');
    expect(qdrantBlock).toContain('18BD');
    expect(qdrantBlock).not.toContain(
      "curl', '--fail', '--silent', 'http://127.0.0.1:6333/readyz",
    );
  });

  it('requires an operator-created n8n api key instead of shipping a fake compose default', () => {
    expect(compose).toContain('- N8N_API_KEY=${N8N_API_KEY}');
    expect(compose).not.toContain('dev-n8n-api-key');
  });

  it('documents an empty n8n api key in the example env for post-setup manual provisioning', () => {
    expect(exampleEnv).toContain('N8N_API_KEY=');
    expect(exampleEnv).not.toContain('N8N_API_KEY=dev-');
    expect(exampleEnv).not.toContain('N8N_EDITOR_BASE_URL=');
  });

  it('documents that api key bootstrap is optional and unsupported through compose cli-only bootstrap', () => {
    expect(n8nReadme).toContain('N8N_API_KEY');
    expect(n8nReadme).toContain(
      'does not provide a supported CLI or environment-variable path to create n8n API keys',
    );
    expect(n8nReadme).toContain('leave `N8N_API_KEY` unset');
    expect(n8nReadme).toContain(
      'activate only the committed `ingestion` and `retrieval` workflows',
    );
    expect(n8nReadme).not.toContain('docker-compose.n8n-editor.yml');
    expect(n8nReadme).toContain('http://localhost:5678');
    expect(n8nReadme).toContain('127.0.0.1:5678:5678');
    expect(n8nReadme).toContain('browser');
  });

  it('activates only the committed n8n workflow ids after import', () => {
    expect(n8nBootstrapScript).toContain(
      "allowedWorkflowNames = new Set(['ingestion', 'retrieval'])",
    );
    expect(n8nBootstrapScript).toContain(
      "'update:workflow', '--id', workflow.id, '--active=true'",
    );
    expect(n8nBootstrapScript).toContain(
      'Refusing to activate unexpected workflow',
    );
    expect(n8nBootstrapScript).not.toContain('--all');
    expect(n8nBootstrapScript).not.toContain('publish:workflow');
  });

  it('marks imported n8n workflows as active for production webhook registration', () => {
    expect(ingestionWorkflow.active).toBe(true);
    expect(retrievalWorkflow.active).toBe(true);
  });

  it('waits for Qdrant readiness inside the init container before creating the collection', () => {
    const ensureQdrant = readFileSync(
      'scripts/ensure-qdrant-collection.mjs',
      'utf8',
    );

    expect(ensureQdrant).toContain('waitForReady');
    expect(ensureQdrant).toContain('readyUrl = `${baseUrl}/readyz`');
    expect(ensureQdrant).toContain(
      'Timed out waiting for Qdrant to become ready',
    );
  });

  it('preserves ingestion metadata after embedding before building Qdrant points', () => {
    const buildPointNode = getNode(ingestionWorkflow, 'Build Qdrant Point');
    const buildPointCode = String(buildPointNode.parameters?.jsCode ?? '');
    const upsertNode = getNode(ingestionWorkflow, 'Upsert Into Qdrant');
    const upsertBody = String(upsertNode.parameters?.jsonBody ?? '');
    const embedNode = getNode(ingestionWorkflow, 'Create Embedding');
    const embedBody = String(embedNode.parameters?.jsonBody ?? '');

    expect(buildPointCode).toContain("$('Chunk Text').item.json");
    expect(buildPointCode).toContain('uploadId');
    expect(buildPointCode).toContain('fileName');
    expect(buildPointCode).toContain('chunkIndex');
    expect(buildPointCode).toContain('content');
    expect(buildPointCode).not.toContain('extractedText');
    expect(upsertBody).toContain('uploadId: $json.uploadId');
    expect(upsertBody).toContain('fileName: $json.fileName');
    expect(upsertBody).not.toContain('extractedText');
    expect(embedBody).toContain('OPENAI_EMBEDDING_MODEL');
    expect(embedBody).toContain('prompt');
    expect(embedBody).toContain('input');
  });

  it('chunks text from n8n PDF extraction fallback fields', () => {
    const chunkNode = getNode(ingestionWorkflow, 'Chunk Text');
    const chunkCode = String(chunkNode.parameters?.jsCode ?? '');

    expect(chunkCode).toContain('extractText(item.json)');
    expect(chunkCode).toContain('json.extractedText');
    expect(chunkCode).toContain('json.data');
  });

  it('does not duplicate full extracted text into chunk or point payloads', () => {
    const chunkNode = getNode(ingestionWorkflow, 'Chunk Text');
    const chunkCode = String(chunkNode.parameters?.jsCode ?? '');
    const buildPointNode = getNode(ingestionWorkflow, 'Build Qdrant Point');
    const buildPointCode = String(buildPointNode.parameters?.jsCode ?? '');
    const upsertNode = getNode(ingestionWorkflow, 'Upsert Into Qdrant');
    const upsertBody = String(upsertNode.parameters?.jsonBody ?? '');

    expect(chunkCode).not.toContain('extractedText: text');
    expect(buildPointCode).not.toContain('extractedText');
    expect(upsertBody).not.toContain('extractedText');
  });

  it('returns an app-compatible async ingestion start result contract from the webhook response', () => {
    const summarizeNode = getNode(ingestionWorkflow, 'Summarize Result');
    const summarizeCode = String(summarizeNode.parameters?.jsCode ?? '');
    const normalizeRequestConnections =
      ingestionWorkflow.connections['Normalize Request']?.main ?? [];
    const branchTargets = normalizeRequestConnections
      .flat()
      .map((connection) => connection.node);

    expect(summarizeCode).toContain('executionId');
    expect(summarizeCode).toContain('$execution.id');
    expect(summarizeCode).toContain('workflowId');
    expect(summarizeCode).toContain("status: 'running'");
    expect(summarizeCode).toContain('message');
    expect(summarizeCode).not.toContain('chunkCount');
    expect(summarizeCode).not.toContain('contentPreview');
    expect(branchTargets).toContain('Summarize Result');
    expect(branchTargets).toContain('Read PDF From Shared Volume');
  });

  it('cleans up stale qdrant points for the same document after upserting the current ingestion run', () => {
    const cleanupMetadataNode = getNode(
      ingestionWorkflow,
      'Prepare Stale Point Cleanup',
    );
    const cleanupMetadataCode = String(
      cleanupMetadataNode.parameters?.jsCode ?? '',
    );
    const cleanupNode = getNode(
      ingestionWorkflow,
      'Delete Stale Qdrant Points',
    );
    const callbackMetadataNode = getNode(
      ingestionWorkflow,
      'Prepare Completion Callback',
    );
    const callbackNode = getNode(
      ingestionWorkflow,
      'Complete App Ingestion Callback',
    );
    const cleanupBody = String(cleanupNode.parameters?.jsonBody ?? '');
    const cleanupUrl = String(cleanupNode.parameters?.url ?? '');
    const callbackMetadataCode = String(
      callbackMetadataNode.parameters?.jsCode ?? '',
    );
    const callbackUrl = String(callbackNode.parameters?.url ?? '');
    const callbackBody = String(callbackNode.parameters?.jsonBody ?? '');
    const callbackHeaders = JSON.stringify(
      callbackNode.parameters?.headerParameters ?? {},
    );
    const upsertConnections =
      ingestionWorkflow.connections['Upsert Into Qdrant']?.main ?? [];
    const upsertTargets = upsertConnections
      .flat()
      .map((connection) => connection.node);
    const cleanupConnections =
      ingestionWorkflow.connections['Delete Stale Qdrant Points']?.main ?? [];
    const cleanupTargets = cleanupConnections
      .flat()
      .map((connection) => connection.node);

    expect(cleanupMetadataCode).toContain(
      "$('Normalize Request').first().json",
    );
    expect(cleanupMetadataCode).toContain('ingestionRunId');
    expect(cleanupUrl).toContain('/points/delete?wait=true');
    expect(cleanupBody).toContain("key: 'documentId'");
    expect(cleanupBody).toContain("key: 'ingestionRunId'");
    expect(cleanupBody).toContain('must_not');
    expect(cleanupBody).toContain('value: $json.ingestionRunId');
    expect(upsertTargets).toContain('Prepare Stale Point Cleanup');
    expect(cleanupTargets).toContain('Prepare Completion Callback');
    expect(callbackMetadataCode).toContain("$('Build Qdrant Point').all()");
    expect(callbackMetadataCode).toContain('externalExecutionId');
    expect(callbackMetadataCode).toContain('embeddingModel');
    expect(callbackUrl).toContain('LOCALRAG_APP_URL');
    expect(callbackUrl).toContain('/api/ingestion/callback');
    expect(callbackBody).toContain('$json');
    expect(callbackNode.parameters?.specifyHeaders).toBe('keypair');
    expect(callbackHeaders).toContain('x-n8n-webhook-secret');
    expect(callbackHeaders).toContain('N8N_WEBHOOK_SECRET');
  });

  it('builds deterministic valid UUID qdrant point ids and tracks ingestion runs in the payload', () => {
    const normalizeRequestNode = getNode(
      ingestionWorkflow,
      'Normalize Request',
    );
    const normalizeRequestCode = String(
      normalizeRequestNode.parameters?.jsCode ?? '',
    );
    const buildPointNode = getNode(ingestionWorkflow, 'Build Qdrant Point');
    const buildPointCode = String(buildPointNode.parameters?.jsCode ?? '');
    const chunkTextNode = getNode(ingestionWorkflow, 'Chunk Text');
    const chunkTextCode = String(chunkTextNode.parameters?.jsCode ?? '');
    const upsertNode = getNode(ingestionWorkflow, 'Upsert Into Qdrant');
    const upsertBody = String(upsertNode.parameters?.jsonBody ?? '');

    expect(normalizeRequestCode).toContain('createRunId()');
    expect(normalizeRequestCode).not.toContain('crypto.randomUUID()');
    expect(chunkTextCode).toContain("$('Normalize Request').first().json");
    expect(chunkTextCode).toContain('documentId: source.documentId');
    expect(chunkTextCode).toContain('uploadId: source.uploadId');
    expect(buildPointCode).toContain('fnv1aHex');
    expect(buildPointCode).not.toContain('crypto.subtle.digest');
    expect(buildPointCode).toContain(
      'seed = `${source.documentId}:${source.chunkIndex}`',
    );
    expect(buildPointCode).not.toContain('crypto.randomUUID()');
    expect(buildPointCode).toContain('return {');
    expect(buildPointCode).not.toContain('json: {');
    expect(upsertBody).toContain('documentId: $json.documentId');
    expect(upsertBody).toContain('chunkIndex: $json.chunkIndex');
    expect(upsertBody).toContain('ingestionRunId: $json.ingestionRunId');
  });

  it('preserves retrieval metadata after embedding when building the Qdrant search request', () => {
    const buildSearchNode = getNode(retrievalWorkflow, 'Build Search Body');
    const buildSearchCode = String(buildSearchNode.parameters?.jsCode ?? '');
    const normalizeChunksNode = getNode(retrievalWorkflow, 'Normalize Chunks');
    const normalizeChunksCode = String(
      normalizeChunksNode.parameters?.jsCode ?? '',
    );
    const embedNode = getNode(retrievalWorkflow, 'Embed Query');
    const embedBody = String(embedNode.parameters?.jsonBody ?? '');

    expect(buildSearchCode).toContain("$('Normalize Query').first().json");
    expect(buildSearchCode).toContain('documentIds');
    expect(buildSearchCode).toContain('topK');
    expect(buildSearchCode).toContain('conversationId');
    expect(normalizeChunksCode).toContain('conversationId');
    expect(normalizeChunksCode).toContain('documentIds');
    expect(normalizeChunksCode).toContain('topK');
    expect(embedBody).toContain('OPENAI_EMBEDDING_MODEL');
    expect(embedBody).toContain('prompt');
    expect(embedBody).toContain('input');
  });

  it('validates the internal webhook secret before workflow logic executes', () => {
    const ingestionValidationNode = getNode(
      ingestionWorkflow,
      'Validate Webhook Secret',
    );
    const retrievalValidationNode = getNode(
      retrievalWorkflow,
      'Validate Webhook Secret',
    );
    const ingestionValidationCode = String(
      ingestionValidationNode.parameters?.jsCode ?? '',
    );
    const retrievalValidationCode = String(
      retrievalValidationNode.parameters?.jsCode ?? '',
    );

    expect(ingestionValidationCode).toContain('x-n8n-webhook-secret');
    expect(ingestionValidationCode).toContain('N8N_WEBHOOK_SECRET');
    expect(retrievalValidationCode).toContain('x-n8n-webhook-secret');
    expect(retrievalValidationCode).toContain('N8N_WEBHOOK_SECRET');
  });

  it.each([
    ['ingestion', ingestionWorkflow],
    ['retrieval', retrievalWorkflow],
  ])(
    'uses env-backed OpenAI auth in the %s workflow without imported credentials',
    (_name, workflow) => {
      const embeddingNodeName =
        workflow === ingestionWorkflow ? 'Create Embedding' : 'Embed Query';
      const embeddingNode = getNode(workflow, embeddingNodeName);
      const parameters = JSON.stringify(embeddingNode.parameters ?? {});
      const credentials = JSON.stringify(
        (embeddingNode as WorkflowNode & { credentials?: unknown })
          .credentials ?? {},
      );

      expect(parameters).toContain('"sendHeaders":true');
      expect(parameters).toContain('Authorization');
      expect(parameters).toContain('OPENAI_API_KEY');
      expect(parameters).toContain('OPENAI_API_URL');
      expect(parameters).toContain('/api/embeddings');
      expect(parameters).toContain('/embeddings');
      expect(parameters).not.toContain('predefinedCredentialType');
      expect(parameters).not.toContain('httpHeaderAuth');
      expect(credentials).toBe('{}');
    },
  );
});
