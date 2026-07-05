import 'server-only';

import { extname } from 'node:path';

import { AppError } from '@/lib/http/api-errors';

type UploadValidationInput = {
  fileName: string;
  mimeType: string;
  size: number;
};

export type UploadValidationResult = {
  normalizedExtension: string;
  normalizedMimeType: string;
};

const allowedMimeTypesByExtension = new Map<string, string>([
  ['pdf', 'application/pdf'],
  ['docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  ['txt', 'text/plain'],
  ['md', 'text/markdown'],
  ['csv', 'text/csv'],
  ['xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  ['pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'],
  ['json', 'application/json'],
  ['html', 'text/html'],
  ['png', 'image/png'],
  ['jpg', 'image/jpeg'],
  ['jpeg', 'image/jpeg'],
  ['zip', 'application/zip'],
]);

export class UploadValidationService {
  constructor(private readonly options: { maxBytes: number }) {}

  async validate(input: UploadValidationInput): Promise<UploadValidationResult> {
    const fileName = input.fileName.trim();
    const mimeType = input.mimeType.trim().toLowerCase();

    if (!fileName) {
      throw new AppError('VALIDATION_ERROR', 'A file name is required.');
    }

    if (!Number.isFinite(input.size) || input.size <= 0) {
      throw new AppError('VALIDATION_ERROR', 'File size must be greater than zero.');
    }

    if (input.size > this.options.maxBytes) {
      throw new AppError('VALIDATION_ERROR', 'File exceeds the maximum upload size.', {
        maxBytes: this.options.maxBytes,
      });
    }

    const normalizedExtension = extname(fileName).slice(1).toLowerCase();

    if (!normalizedExtension) {
      throw new AppError('VALIDATION_ERROR', 'A file extension is required.');
    }

    const expectedMimeType = allowedMimeTypesByExtension.get(normalizedExtension);

    if (!expectedMimeType) {
      throw new AppError('VALIDATION_ERROR', 'Unsupported file type.', {
        extension: normalizedExtension,
      });
    }

    if (mimeType !== expectedMimeType) {
      throw new AppError('VALIDATION_ERROR', 'File extension does not match MIME type.', {
        extension: normalizedExtension,
        mimeType,
        expectedMimeType,
      });
    }

    return {
      normalizedExtension,
      normalizedMimeType: expectedMimeType,
    };
  }
}
