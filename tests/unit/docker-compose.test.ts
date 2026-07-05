import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

type WorkflowNode = {
  name: string;
  parameters?: Record<string, unknown>;
};

describe('docker compose', () => {
  const compose = readFileSync('docker-compose.yml', 'utf8');
  const ingestionWorkflow = JSON.parse(readFileSync('docker/n8n/workflows/ingestion.json', 'utf8')) as {
    active: boolean;
    nodes: WorkflowNode[];
  };
  const retrievalWorkflow = JSON.parse(readFileSync('docker/n8n/workflows/retrieval.json', 'utf8')) as {
    active: boolean;
    nodes: WorkflowNode[];
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

  it('keeps n8n and qdrant internal by default', () => {
    expect(compose).not.toContain("'5678:5678'");
    expect(compose).not.toContain("'6333:6333'");
  });

  it('bootstraps the Qdrant collection before application services start', () => {
    expect(compose).toContain('qdrant-init:');
    expect(compose).toContain('service_completed_successfully');
    expect(compose).toContain('QDRANT_VECTOR_SIZE');
    expect(compose).toContain('QDRANT_DISTANCE');
    expect(compose).toContain('OPENAI_EMBEDDING_MODEL');
    expect(compose).toContain('N8N_WEBHOOK_SECRET');
  });

  it('marks imported n8n workflows as active for production webhook registration', () => {
    expect(ingestionWorkflow.active).toBe(true);
    expect(retrievalWorkflow.active).toBe(true);
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
    expect(upsertBody).toContain('"uploadId":$json.uploadId');
    expect(upsertBody).toContain('"fileName":$json.fileName');
    expect(embedBody).toContain('OPENAI_EMBEDDING_MODEL');
  });

  it('returns an app-compatible ingestion start result contract from the webhook response', () => {
    const summarizeNode = getNode(ingestionWorkflow, 'Summarize Result');
    const summarizeCode = String(summarizeNode.parameters?.jsCode ?? '');

    expect(summarizeCode).toContain('executionId');
    expect(summarizeCode).toContain('$execution.id');
    expect(summarizeCode).toContain('workflowId');
    expect(summarizeCode).toContain('status');
    expect(summarizeCode).toContain('message');
    expect(summarizeCode).not.toContain('chunkCount');
    expect(summarizeCode).not.toContain('contentPreview');
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
});
