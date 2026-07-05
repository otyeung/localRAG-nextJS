import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useUploadQueue } from '@/hooks/use-upload-queue';

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
        }),
      ]),
    );
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
