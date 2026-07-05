import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const corpusFiles = ['1706.03762v7.pdf', 'cymbal-starlight-2024.pdf'];

function hashFile(path: string): string {
  const hash = createHash('sha256');
  hash.update(readFileSync(path));
  return hash.digest('hex');
}

export function seedCorpus() {
  const root = process.cwd();
  const records = corpusFiles.map((file) => {
    const path = resolve(root, file);
    statSync(path);

    return {
      file,
      path,
      sha256: hashFile(path),
    };
  });

  return records;
}

const executedPath = process.argv[1] ? resolve(process.argv[1]) : '';
const modulePath = fileURLToPath(import.meta.url);

if (modulePath === executedPath) {
  try {
    const records = seedCorpus();
    console.log(`[seed:corpus] verified ${records.length} corpus PDFs`);
    for (const record of records) {
      console.log(`${record.file} ${record.sha256}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[seed:corpus] failed: ${message}`);
    process.exitCode = 1;
  }
}
