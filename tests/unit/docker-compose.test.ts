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
  const ingestionWorkflow = JSON.parse(readFileSync('docker/n8n/workflows/ingestion.json', 'utf8')) as {
    active: boolean;
    nodes: WorkflowNode[];
    connections: WorkflowConnections;
  };
  const retrievalWorkflow = JSON.parse(readFileSync('docker/n8n/workflows/retrieval.json', 'utf8')) as {
    active: boolean;
    nodes: WorkflowNode[];
    connections: WorkflowConnections;
  };

  const getNode = (workflow: { nodes: WorkflowNode[] }, name: string) => {
    const node = workflow.nodes.find((candidate) => candidate.name === name);

    expect(node, `Expected workflow node "${name}" to exist.`).toBeDefined();

    return node as WorkflowNode;
  };

  it.each(['nextjs', 'postgres', 'n8n', 'qdrant', 'redis'])('defines service %s', (serviceName) => {
    expect(compose).toContain(`${serviceName}:`);
  });

  it('uses internal service names for application dependencies', () => {
    expect(compose).toContain('N8N_BASE_URL=http://n8n:5678');
    expect(compose).toContain('QDRANT_URL=http://qdrant:6333');
  });

  it('keeps n8n internal-only with service-network webhook wiring', () => {
    expect(compose).not.toContain('N8N_EDITOR_BASE_URL');
    expect(compose).toContain('WEBHOOK_URL: http://n8n:5678/');
  });

  it('bootstraps workflows server-side without requiring browser activation', () => {
    expect(compose).toContain('n8n import:workflow --separate --input=/workflows --overwrite');
    expect(compose).toContain('n8n update:workflow --all --active=true');
  });

  it('keeps n8n and qdrant internal by default', () => {
    expect(compose).not.toContain("'5678:5678'");
    expect(compose).not.toContain("'6333:6333'");
  });

  it('does not commit an n8n editor host-port override', () => {
    expect(existsSync('docker-compose.n8n-editor.yml')).toBe(false);
  });

  it('bootstraps the Qdrant collection before application services start', () => {
    expect(compose).toContain('qdrant-init:');
    expect(compose).toContain('service_completed_successfully');
    expect(compose).toContain('condition: service_started');
    expect(compose).not.toContain('qdrant:\n        condition: service_healthy');
    expect(compose).toContain('QDRANT_VECTOR_SIZE');
    expect(compose).toContain('QDRANT_DISTANCE');
    expect(compose).toContain('OPENAI_EMBEDDING_MODEL');
    expect(compose).toContain('N8N_WEBHOOK_SECRET');
  });

  it('defines a Qdrant healthcheck without relying on curl in the image', () => {
    const qdrantBlock = compose.match(/\n  qdrant:\n([\s\S]*?)\n  qdrant-init:/)?.[1] ?? '';

    expect(qdrantBlock).toContain('healthcheck:');
    expect(qdrantBlock).toContain('/proc/net/tcp');
    expect(qdrantBlock).toContain('18BD');
    expect(qdrantBlock).not.toContain("curl', '--fail', '--silent', 'http://127.0.0.1:6333/readyz");
  });

  it('requires an operator-created n8n api key instead of shipping a fake compose default', () => {
    expect(compose).toContain('- N8N_API_KEY=${N8N_API_KEY}');
    expect(compose).not.toContain('dev-n8n-api-key');
  });

  it('documents an empty n8n api key in the example env for post-setup manual provisioning', () => {
    expect(exampleEnv).toContain('N8N_API_KEY=');
    expect(exampleEnv).not.toContain('N8N_API_KEY=dev-');
    expect(exampleEnv).not.toContain('N8N_EDITOR_BASE_URL=');
    expect(exampleEnv).not.toContain('localhost:5678');
  });

  it('documents that api key bootstrap is optional and unsupported through compose cli-only bootstrap', () => {
    expect(n8nReadme).toContain('N8N_API_KEY');
    expect(n8nReadme).toContain('does not provide a supported CLI or environment-variable path to create n8n API keys');
    expect(n8nReadme).toContain('leave `N8N_API_KEY` unset');
    expect(n8nReadme).not.toContain('docker-compose.n8n-editor.yml');
    expect(n8nReadme).not.toContain('127.0.0.1:5678:5678');
    expect(n8nReadme).not.toContain('http://localhost:5678');
    expect(n8nReadme).not.toMatch(/open n8n/i);
    expect(n8nReadme).not.toMatch(/browser/i);
  });

  it('marks imported n8n workflows as active for production webhook registration', () => {
    expect(ingestionWorkflow.active).toBe(true);
    expect(retrievalWorkflow.active).toBe(true);
  });

  it('waits for Qdrant readiness inside the init container before creating the collection', () => {
    const ensureQdrant = readFileSync('scripts/ensure-qdrant-collection.mjs', 'utf8');

    expect(ensureQdrant).toContain('waitForReady');
    expect(ensureQdrant).toContain("readyUrl = `${baseUrl}/readyz`");
    expect(ensureQdrant).toContain('Timed out waiting for Qdrant to become ready');
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
    expect(upsertBody).toContain('"uploadId":$json.uploadId');
    expect(upsertBody).toContain('"fileName":$json.fileName');
    expect(upsertBody).not.toContain('extractedText');
    expect(embedBody).toContain('OPENAI_EMBEDDING_MODEL');
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
    const normalizeRequestConnections = ingestionWorkflow.connections['Normalize Request']?.main ?? [];
    const branchTargets = normalizeRequestConnections.flat().map((connection) => connection.node);

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
    const cleanupMetadataNode = getNode(ingestionWorkflow, 'Prepare Stale Point Cleanup');
    const cleanupMetadataCode = String(cleanupMetadataNode.parameters?.jsCode ?? '');
    const cleanupNode = getNode(ingestionWorkflow, 'Delete Stale Qdrant Points');
    const cleanupBody = String(cleanupNode.parameters?.jsonBody ?? '');
    const cleanupUrl = String(cleanupNode.parameters?.url ?? '');
    const upsertConnections = ingestionWorkflow.connections['Upsert Into Qdrant']?.main ?? [];
    const upsertTargets = upsertConnections.flat().map((connection) => connection.node);

    expect(cleanupMetadataCode).toContain("$('Build Qdrant Point').first().json");
    expect(cleanupMetadataCode).toContain('ingestionRunId');
    expect(cleanupUrl).toContain('/points/delete?wait=true');
    expect(cleanupBody).toContain('"documentId"');
    expect(cleanupBody).toContain('"ingestionRunId"');
    expect(cleanupBody).toContain('"must_not"');
    expect(cleanupBody).toContain('"value": $json.ingestionRunId');
    expect(upsertTargets).toContain('Prepare Stale Point Cleanup');
  });

  it('builds deterministic valid UUID qdrant point ids and tracks ingestion runs in the payload', () => {
    const normalizeRequestNode = getNode(ingestionWorkflow, 'Normalize Request');
    const normalizeRequestCode = String(normalizeRequestNode.parameters?.jsCode ?? '');
    const buildPointNode = getNode(ingestionWorkflow, 'Build Qdrant Point');
    const buildPointCode = String(buildPointNode.parameters?.jsCode ?? '');
    const upsertNode = getNode(ingestionWorkflow, 'Upsert Into Qdrant');
    const upsertBody = String(upsertNode.parameters?.jsonBody ?? '');

    expect(normalizeRequestCode).toContain('ingestionRunId: crypto.randomUUID()');
    expect(buildPointCode).toContain('crypto.subtle.digest');
    expect(buildPointCode).toContain('seed = `${source.documentId}:${source.chunkIndex}`');
    expect(buildPointCode).not.toContain('crypto.randomUUID()');
    expect(upsertBody).toContain('"documentId":$json.documentId');
    expect(upsertBody).toContain('"chunkIndex":$json.chunkIndex');
    expect(upsertBody).toContain('"ingestionRunId":$json.ingestionRunId');
  });

  it('preserves retrieval metadata after embedding when building the Qdrant search request', () => {
    const buildSearchNode = getNode(retrievalWorkflow, 'Build Search Body');
    const buildSearchCode = String(buildSearchNode.parameters?.jsCode ?? '');
    const normalizeChunksNode = getNode(retrievalWorkflow, 'Normalize Chunks');
    const normalizeChunksCode = String(normalizeChunksNode.parameters?.jsCode ?? '');
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
  });

  it('validates the internal webhook secret before workflow logic executes', () => {
    const ingestionValidationNode = getNode(ingestionWorkflow, 'Validate Webhook Secret');
    const retrievalValidationNode = getNode(retrievalWorkflow, 'Validate Webhook Secret');
    const ingestionValidationCode = String(ingestionValidationNode.parameters?.jsCode ?? '');
    const retrievalValidationCode = String(retrievalValidationNode.parameters?.jsCode ?? '');

    expect(ingestionValidationCode).toContain('x-n8n-webhook-secret');
    expect(ingestionValidationCode).toContain('N8N_WEBHOOK_SECRET');
    expect(retrievalValidationCode).toContain('x-n8n-webhook-secret');
    expect(retrievalValidationCode).toContain('N8N_WEBHOOK_SECRET');
  });

  it.each([
    ['ingestion', ingestionWorkflow],
    ['retrieval', retrievalWorkflow],
  ])('uses env-backed OpenAI auth in the %s workflow without imported credentials', (_name, workflow) => {
    const embeddingNodeName = workflow === ingestionWorkflow ? 'Create Embedding' : 'Embed Query';
    const embeddingNode = getNode(workflow, embeddingNodeName);
    const parameters = JSON.stringify(embeddingNode.parameters ?? {});
    const credentials = JSON.stringify((embeddingNode as WorkflowNode & { credentials?: unknown }).credentials ?? {});

    expect(parameters).toContain('"sendHeaders":true');
    expect(parameters).toContain('Authorization');
    expect(parameters).toContain('OPENAI_API_KEY');
    expect(parameters).not.toContain('predefinedCredentialType');
    expect(parameters).not.toContain('httpHeaderAuth');
    expect(credentials).toBe('{}');
  });
});
