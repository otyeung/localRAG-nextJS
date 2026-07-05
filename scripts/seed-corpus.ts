import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DocumentStatus, WorkflowStatus } from '@prisma/client';

import { createAnonymousFingerprintHash } from '@/lib/auth/anonymous-provider';
import { prisma } from '@/lib/db/prisma';
import { UserRepository } from '@/lib/repositories/user-repository';
import { UploadService, type UploadResult } from '@/lib/services/upload-service';
import { WorkflowService, type WorkflowExecutionDto } from '@/lib/services/workflow-service';

const corpusFiles = ['1706.03762v7.pdf', 'cymbal-starlight-2024.pdf'] as const;
const SEED_USER_FINGERPRINT = 'seed-corpus-local-user';

function hashFile(path: string): string {
  const hash = createHash('sha256');
  hash.update(readFileSync(path));
  return hash.digest('hex');
}

type CorpusRecord = {
  file: string;
  path: string;
  sha256: string;
};

export type SeedCorpusResult = {
  totalFiles: number;
  skipped: Array<{
    file: string;
    documentId: string;
  }>;
  ingested: Array<{
    file: string;
    workflowExecutionId: string;
    documentId: string;
    uploadId: string;
  }>;
  failed: Array<{
    file: string;
    reason: string;
  }>;
};

type SeedCorpusDependencies = {
  userRepository?: Pick<UserRepository, 'findOrCreateAnonymousUser'>;
  uploadService?: Pick<UploadService, 'createUpload'>;
  workflowService?: Pick<WorkflowService, 'getWorkflowStatus'>;
  findReadyDocumentByHash?: (userId: string, fileHash: string) => Promise<{ id: string } | null>;
  findReusableUploadByHash?: (userId: string, fileHash: string) => Promise<UploadResult | null>;
  createFingerprintHash?: (fingerprint: string) => Promise<string>;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
  pollIntervalMs?: number;
};

function hasRepositoryMarkers(root: string): boolean {
  return existsSync(resolve(root, 'package.json')) && corpusFiles.every((file) => existsSync(resolve(root, file)));
}

function findRepositoryRoot(startPath: string): string | null {
  let current = startPath;

  while (true) {
    if (hasRepositoryMarkers(current)) {
      return current;
    }

    const parent = dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

function resolveRepositoryRoot(): string {
  const moduleDirectory = dirname(fileURLToPath(import.meta.url));
  const searchRoots = [process.cwd(), moduleDirectory];

  for (const searchRoot of searchRoots) {
    const resolvedRoot = findRepositoryRoot(resolve(searchRoot));
    if (resolvedRoot) {
      return resolvedRoot;
    }
  }

  throw new Error('Unable to locate repository root for seed corpus files.');
}

function resolveCorpusRecords(root = resolveRepositoryRoot()): CorpusRecord[] {
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, ms);
  });
}

export async function seedCorpus(dependencies: SeedCorpusDependencies = {}): Promise<SeedCorpusResult> {
  const records = resolveCorpusRecords();
  const userRepository = dependencies.userRepository ?? new UserRepository(prisma);
  const uploadService = dependencies.uploadService ?? new UploadService();
  const workflowService = dependencies.workflowService ?? new WorkflowService();
  const fingerprintHash =
    (await (dependencies.createFingerprintHash ?? createAnonymousFingerprintHash)(SEED_USER_FINGERPRINT));
  const user = await userRepository.findOrCreateAnonymousUser(fingerprintHash);
  const findReadyDocumentByHash =
    dependencies.findReadyDocumentByHash ??
    (async (userId: string, fileHash: string) =>
      prisma.document.findFirst({
        where: {
          userId,
          fileHash,
          status: DocumentStatus.READY,
          deletedAt: null,
        },
        select: { id: true },
      }));
  const findReusableUploadByHash =
    dependencies.findReusableUploadByHash ??
    (async (userId: string, fileHash: string) => {
      const document = await prisma.document.findFirst({
        where: {
          userId,
          fileHash,
          deletedAt: null,
          workflows: {
            some: {
              workflowKey: 'ingestion',
              externalExecutionId: {
                not: null,
              },
              status: {
                in: [WorkflowStatus.QUEUED, WorkflowStatus.RUNNING, WorkflowStatus.WAITING, WorkflowStatus.SUCCESS],
              },
            },
          },
        },
        orderBy: {
          updatedAt: 'desc',
        },
        select: {
          id: true,
          uploadId: true,
          storagePath: true,
          workflows: {
            where: {
              workflowKey: 'ingestion',
              externalExecutionId: {
                not: null,
              },
              status: {
                in: [WorkflowStatus.QUEUED, WorkflowStatus.RUNNING, WorkflowStatus.WAITING, WorkflowStatus.SUCCESS],
              },
            },
            orderBy: {
              createdAt: 'desc',
            },
            take: 1,
            select: {
              id: true,
              externalExecutionId: true,
              status: true,
              metadata: true,
            },
          },
        },
      });

      const workflow = document?.workflows[0];
      if (!document || !workflow) {
        return null;
      }

      const metadata = workflow.metadata;
      const reconciliationRequired =
        !!metadata && typeof metadata === 'object' && !Array.isArray(metadata) && 'reconciliationRequired' in metadata
          ? metadata.reconciliationRequired === true
          : false;

      return {
        uploadId: document.uploadId,
        documentId: document.id,
        workflowExecutionId: workflow.id,
        externalExecutionId: workflow.externalExecutionId,
        status: workflow.status,
        storagePath: document.storagePath,
        reconciliationRequired,
      };
    });
  const wait = dependencies.sleep ?? sleep;
  const timeoutMs = dependencies.timeoutMs ?? 120_000;
  const pollIntervalMs = dependencies.pollIntervalMs ?? 2_000;
  const result: SeedCorpusResult = {
    totalFiles: records.length,
    skipped: [],
    ingested: [],
    failed: [],
  };

  for (const record of records) {
    const existingDocument = await findReadyDocumentByHash(user.id, record.sha256);

    if (existingDocument) {
      result.skipped.push({
        file: record.file,
        documentId: existingDocument.id,
      });
      continue;
    }

    let uploadResult = await findReusableUploadByHash(user.id, record.sha256);
    if (!uploadResult) {
      try {
        uploadResult = await uploadService.createUpload({
          userId: user.id,
          fileName: record.file,
          mimeType: 'application/pdf',
          bytes: new Uint8Array(readFileSync(record.path)),
        });
      } catch (error) {
        result.failed.push({
          file: record.file,
          reason: error instanceof Error ? error.message : String(error),
        });
        continue;
      }
    }

    const startedAt = Date.now();
    let workflow: WorkflowExecutionDto | undefined;

    while (Date.now() - startedAt <= timeoutMs) {
      workflow = await workflowService.getWorkflowStatus(user.id, uploadResult.workflowExecutionId);
      if (workflow.status === 'SUCCESS') {
        result.ingested.push({
          file: record.file,
          workflowExecutionId: workflow.id,
          documentId: uploadResult.documentId,
          uploadId: uploadResult.uploadId,
        });
        break;
      }
      if (workflow.status === 'ERROR' || workflow.status === 'CANCELED') {
        result.failed.push({
          file: record.file,
          reason: workflow.errorMessage ?? `Workflow finished with status ${workflow.status}.`,
        });
        break;
      }
      await wait(pollIntervalMs);
    }

    if (!workflow || (workflow.status !== 'SUCCESS' && workflow.status !== 'ERROR' && workflow.status !== 'CANCELED')) {
      result.failed.push({
        file: record.file,
        reason: 'Timed out waiting for ingestion workflow completion.',
      });
    }
  }

  return result;
}

const executedPath = process.argv[1] ? resolve(process.argv[1]) : '';
const modulePath = fileURLToPath(import.meta.url);

if (modulePath === executedPath) {
  seedCorpus()
    .then((result) => {
      console.log(`[seed:corpus] processed ${result.totalFiles} corpus files`);
      for (const skipped of result.skipped) {
        console.log(`[seed:corpus] skipped ${skipped.file} (${skipped.documentId})`);
      }
      for (const ingested of result.ingested) {
        console.log(`[seed:corpus] ingested ${ingested.file} (${ingested.workflowExecutionId})`);
      }
      if (result.failed.length > 0) {
        for (const failure of result.failed) {
          console.error(`[seed:corpus] failed ${failure.file}: ${failure.reason}`);
        }
        process.exitCode = 1;
      }
    })
    .catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[seed:corpus] failed: ${message}`);
      process.exitCode = 1;
    });
}
