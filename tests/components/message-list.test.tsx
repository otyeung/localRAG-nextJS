import '@testing-library/jest-dom/vitest';
import { createElement } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MessageList } from '@/components/chat/message-list';

describe('MessageList', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders repeated citations for the same document once without duplicate React keys', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const messages: Parameters<typeof MessageList>[0]['messages'] = [
      {
        id: 'assistant_duplicate_sources',
        role: 'assistant',
        parts: [
          { type: 'text', text: 'The cargo capacity is 13.5 cubic feet.' },
          {
            type: 'source-document',
            sourceId: 'ggxbQtWhqJTE0cigijBf_',
            mediaType: 'application/pdf',
            title: 'Cymbal Starlight 2024',
          },
          {
            type: 'source-document',
            sourceId: 'ggxbQtWhqJTE0cigijBf_',
            mediaType: 'application/pdf',
            title: 'Cymbal Starlight 2024',
          },
        ],
      },
    ];

    render(
      createElement(MessageList, {
        messages,
        onCopy: vi.fn(),
        onRetry: vi.fn(),
      }),
    );

    expect(screen.getAllByTestId('citation-item')).toHaveLength(1);
    expect(screen.getByText('Cymbal Starlight 2024')).toBeInTheDocument();
    expect(
      consoleError.mock.calls.some((call) =>
        call.some((entry) => String(entry).includes('same key')),
      ),
    ).toBe(false);
  });
});
