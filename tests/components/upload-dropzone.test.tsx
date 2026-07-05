import '@testing-library/jest-dom/vitest';
import { createElement } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { UploadDropzone } from '@/components/upload/upload-dropzone';

describe('UploadDropzone', () => {
  it('supports browse uploads, clears the file input, and shows queued file states', () => {
    const onFilesSelected = vi.fn();

    render(
      createElement(UploadDropzone, {
        queue: [
          {
            id: 'upload_1',
            fileName: 'quarterly-report.pdf',
            size: 1024,
            progress: 56,
            status: 'uploading',
            errorMessage: null,
          },
          {
            id: 'upload_2',
            fileName: 'malware.exe',
            size: 128,
            progress: 0,
            status: 'error',
            errorMessage: 'Unsupported file type.',
          },
        ],
        onFilesSelected,
        onCancel: vi.fn(),
        onRetry: vi.fn(),
      }),
    );

    const input = screen.getByLabelText('Browse files');
    const file = new File(['report'], 'new-report.pdf', { type: 'application/pdf' });
    const valueSetter = vi.fn();

    Object.defineProperty(input, 'value', {
      configurable: true,
      get: () => '',
      set: valueSetter,
    });

    fireEvent.change(input, {
      target: {
        files: [file],
      },
    });

    expect(onFilesSelected).toHaveBeenCalled();
    expect(valueSetter).toHaveBeenCalledWith('');

    fireEvent.change(input, {
      target: {
        files: [file],
      },
    });

    expect(onFilesSelected).toHaveBeenCalledTimes(2);
    expect(screen.getByText('quarterly-report.pdf')).toBeInTheDocument();
    expect(screen.getByText('Unsupported file type.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry upload for malware.exe' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel upload for quarterly-report.pdf' })).toBeInTheDocument();
  });
});
