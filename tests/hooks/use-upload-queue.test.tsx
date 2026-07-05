import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useUploadQueue } from '@/hooks/use-upload-queue';

type XhrPlan =
  | { type: 'load'; status: number; body: unknown }
  | { type: 'error' }
  | { type: 'abort' };

class MockXMLHttpRequest {
  static plans: XhrPlan[] = [];
  static sends = 0;

  static reset(plans: XhrPlan[] = []) {
    MockXMLHttpRequest.plans = [...plans];
    MockXMLHttpRequest.sends = 0;
  }

  upload = {} as XMLHttpRequest['upload'];
  responseType = '';
  response: unknown = null;
  responseText = '';
  status = 0;
  onerror: ((event: ProgressEvent<EventTarget>) => void) | null = null;
  onabort: ((event: ProgressEvent<EventTarget>) => void) | null = null;
  onload: ((event: ProgressEvent<EventTarget>) => void) | null = null;

  open() {}

  send() {
    MockXMLHttpRequest.sends += 1;
    const plan = MockXMLHttpRequest.plans.shift() ?? { type: 'error' };

    queueMicrotask(() => {
      if (plan.type === 'error') {
        this.onerror?.(new ProgressEvent('error'));
        return;
      }

      if (plan.type === 'abort') {
        this.onabort?.(new ProgressEvent('abort'));
        return;
      }

      this.status = plan.status;
      this.response = plan.body;
      this.responseText = JSON.stringify(plan.body);
      this.onload?.(new ProgressEvent('load'));
    });
  }

  abort() {
    this.onabort?.(new ProgressEvent('abort'));
  }
}

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  const Wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
  Wrapper.displayName = 'UploadQueueQueryClientWrapper';

  return Wrapper;
}

describe('useUploadQueue', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    MockXMLHttpRequest.reset();
    vi.stubGlobal('XMLHttpRequest', MockXMLHttpRequest);
  });

  it('rejects files without a browser-provided MIME type before upload starts', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const { result } = renderHook(() => useUploadQueue(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isLoadingHistory).toBe(false));

    const file = new File(['content'], 'report.pdf', { type: '' });

    result.current.onFilesSelected([file]);

    await waitFor(() =>
      expect(result.current.queue).toEqual([
        expect.objectContaining({
          fileName: 'report.pdf',
          status: 'error',
          errorMessage: 'MIME type is required.',
          isRetryable: false,
        }),
      ]),
    );
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(MockXMLHttpRequest.sends).toBe(0);
  });

  it('keeps validation failures rejected locally when retry is requested', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const { result } = renderHook(() => useUploadQueue(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isLoadingHistory).toBe(false));

    const file = new File(['content'], 'report.pdf', { type: '' });

    result.current.onFilesSelected([file]);

    await waitFor(() => expect(result.current.queue[0]?.errorMessage).toBe('MIME type is required.'));

    result.current.retryUpload(result.current.queue[0]!.id);

    expect(MockXMLHttpRequest.sends).toBe(0);
    expect(result.current.queue[0]).toMatchObject({
      status: 'error',
      errorMessage: 'MIME type is required.',
      isRetryable: false,
    });
  });

  it('preserves retry for transient upload failures and succeeds on retry', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    MockXMLHttpRequest.reset([
      {
        type: 'load',
        status: 500,
        body: { error: { message: 'Upload failed on the server.' } },
      },
      {
        type: 'load',
        status: 200,
        body: {
          data: {
            uploadId: 'upload_1',
            documentId: 'document_1',
            workflowExecutionId: 'workflow_1',
            status: 'COMPLETED',
            reconciliationRequired: false,
          },
        },
      },
    ]);

    const { result } = renderHook(() => useUploadQueue(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isLoadingHistory).toBe(false));

    const file = new File(['content'], 'report.pdf', { type: 'application/pdf' });

    result.current.onFilesSelected([file]);

    await waitFor(() =>
      expect(result.current.queue[0]).toMatchObject({
        fileName: 'report.pdf',
        status: 'error',
        errorMessage: 'Upload failed on the server.',
        isRetryable: true,
      }),
    );
    expect(MockXMLHttpRequest.sends).toBe(1);

    result.current.retryUpload(result.current.queue[0]!.id);

    await waitFor(() =>
      expect(result.current.queue[0]).toMatchObject({
        fileName: 'report.pdf',
        status: 'success',
        errorMessage: null,
        isRetryable: false,
      }),
    );
    expect(MockXMLHttpRequest.sends).toBe(2);
  });
});
