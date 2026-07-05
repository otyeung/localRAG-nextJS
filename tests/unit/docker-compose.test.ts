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

  it('bootstraps the Qdrant collection before application services start', () => {
    expect(compose).toContain('qdrant-init:');
    expect(compose).toContain('service_completed_successfully');
    expect(compose).toContain('QDRANT_VECTOR_SIZE');
    expect(compose).toContain('QDRANT_DISTANCE');
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

    expect(buildPointCode).toContain("$('Chunk Text').item.json");
    expect(buildPointCode).toContain('uploadId');
    expect(buildPointCode).toContain('fileName');
    expect(buildPointCode).toContain('chunkIndex');
    expect(buildPointCode).toContain('content');
    expect(upsertBody).toContain('"uploadId":$json.uploadId');
    expect(upsertBody).toContain('"fileName":$json.fileName');
  });

  it('preserves retrieval metadata after embedding when building the Qdrant search request', () => {
    const buildSearchNode = getNode(retrievalWorkflow, 'Build Search Body');
    const buildSearchCode = String(buildSearchNode.parameters?.jsCode ?? '');
    const normalizeChunksNode = getNode(retrievalWorkflow, 'Normalize Chunks');
    const normalizeChunksCode = String(normalizeChunksNode.parameters?.jsCode ?? '');

    expect(buildSearchCode).toContain("$('Normalize Query').first().json");
    expect(buildSearchCode).toContain('documentIds');
    expect(buildSearchCode).toContain('topK');
    expect(buildSearchCode).toContain('conversationId');
    expect(normalizeChunksCode).toContain('conversationId');
    expect(normalizeChunksCode).toContain('documentIds');
    expect(normalizeChunksCode).toContain('topK');
  });
});
