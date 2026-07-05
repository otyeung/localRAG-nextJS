import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

describe('docker compose', () => {
  const compose = readFileSync('docker-compose.yml', 'utf8');

  it.each(['nextjs', 'postgres', 'n8n', 'qdrant', 'redis'])('defines service %s', (serviceName) => {
    expect(compose).toContain(`${serviceName}:`);
  });

  it('uses internal service names for application dependencies', () => {
    expect(compose).toContain('N8N_BASE_URL=http://n8n:5678');
    expect(compose).toContain('QDRANT_URL=http://qdrant:6333');
  });
});
