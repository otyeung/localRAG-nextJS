import { describe, expect, it } from 'vitest';
import packageJson from '../../package.json';

describe('project configuration', () => {
  it('exposes required lifecycle scripts', () => {
    expect(packageJson.scripts).toMatchObject({
      build: expect.any(String),
      dev: expect.any(String),
      lint: expect.any(String),
      start: expect.any(String),
      typecheck: expect.any(String),
      test: expect.any(String),
      'test:e2e': expect.any(String),
      'test:integration': expect.any(String),
      'test:unit': expect.any(String),
      'prisma:generate': expect.any(String),
      'prisma:migrate': expect.any(String),
      'seed:corpus': expect.any(String),
    });
  });

  it('pins the required framework families', () => {
    expect(packageJson.dependencies?.next).toMatch(/^(\^|~)?15\./);
    expect(packageJson.dependencies?.react).toMatch(/^(\^|~)?19\./);
    expect(packageJson.dependencies?.['react-dom']).toMatch(/^(\^|~)?19\./);
  });
});
