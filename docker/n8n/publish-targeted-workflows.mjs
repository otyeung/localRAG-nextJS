import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const allowedWorkflowNames = new Set(['ingestion', 'retrieval']);

function parseArgs(argv) {
  const args = { input: '/n8n-bootstrap/workflows' };

  for (let index = 2; index < argv.length; index += 1) {
    const value = argv[index];

    if (value === '--input') {
      args.input = argv[index + 1];
      index += 1;
      continue;
    }

    if (value.startsWith('--input=')) {
      args.input = value.slice('--input='.length);
    }
  }

  return args;
}

function fail(message) {
  throw new Error(message);
}

async function loadWorkflowEntries(inputDir) {
  const fileNames = await readdir(inputDir);

  return Promise.all(
    fileNames
      .filter((fileName) => fileName.endsWith('.json'))
      .map(async (fileName) => {
        const filePath = path.join(inputDir, fileName);
        const workflow = JSON.parse(await readFile(filePath, 'utf8'));

        if (!workflow || typeof workflow !== 'object') {
          fail(`Workflow file ${fileName} did not parse to an object.`);
        }

        if (!allowedWorkflowNames.has(workflow.name)) {
          fail(
            `Refusing to activate unexpected workflow "${workflow.name}" from ${fileName}.`,
          );
        }

        if (typeof workflow.id !== 'string' || !workflow.id.trim()) {
          fail(`Workflow file ${fileName} is missing an activatable id.`);
        }

        return {
          fileName,
          id: workflow.id.trim(),
          name: workflow.name,
        };
      }),
  );
}

function activateWorkflow(workflow) {
  const result = spawnSync(
    'n8n',
    ['update:workflow', '--id', workflow.id, '--active=true'],
    {
      stdio: 'inherit',
      env: process.env,
    },
  );

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    fail(
      `Failed to activate workflow "${workflow.name}" from ${workflow.fileName}.`,
    );
  }
}

const { input } = parseArgs(process.argv);
const workflows = await loadWorkflowEntries(input);
const orderedWorkflows = workflows.sort((left, right) =>
  left.name.localeCompare(right.name),
);

if (orderedWorkflows.length !== allowedWorkflowNames.size) {
  fail(
    `Expected ${allowedWorkflowNames.size} target workflow files but found ${orderedWorkflows.length}.`,
  );
}

for (const workflow of orderedWorkflows) {
  activateWorkflow(workflow);
}
