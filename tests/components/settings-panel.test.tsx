import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const setThemeMock = vi.hoisted(() => vi.fn());

vi.mock('next-themes', () => ({
  useTheme: () => ({
    setTheme: setThemeMock,
  }),
}));

import { SettingsPanel } from '@/components/settings/settings-panel';

function renderWithQueryClient(node: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return render(createElement(QueryClientProvider, { client: queryClient }, node));
}

describe('SettingsPanel', () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    setThemeMock.mockReset();
    vi.restoreAllMocks();
  });

  it('applies the saved theme on initial load', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            theme: 'dark',
            model: 'gpt-4.1-mini',
            showReasoningMetadata: true,
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    renderWithQueryClient(createElement(SettingsPanel));

    await waitFor(() => expect(setThemeMock).toHaveBeenCalledWith('dark'));
    await waitFor(() => expect((screen.getByLabelText('Theme mode') as HTMLSelectElement).value).toBe('dark'));
  });

  it('does not overwrite an unsaved manual theme change when settings resolve later', async () => {
    let resolveFetch: ((response: Response) => void) | undefined;
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        }),
    );

    renderWithQueryClient(createElement(SettingsPanel));

    fireEvent.change(screen.getAllByLabelText('Theme mode')[0], {
      target: { value: 'light' },
    });

    expect(setThemeMock).toHaveBeenCalledWith('light');

    resolveFetch?.(
      new Response(
        JSON.stringify({
          data: {
            theme: 'dark',
            model: 'gpt-4.1-mini',
            showReasoningMetadata: true,
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    await waitFor(() => expect((screen.getAllByLabelText('Theme mode')[0] as HTMLSelectElement).value).toBe('light'));
    expect(setThemeMock).not.toHaveBeenCalledWith('dark');
  });
});
