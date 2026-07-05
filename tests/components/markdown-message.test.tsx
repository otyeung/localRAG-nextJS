import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { MarkdownMessage } from '@/components/chat/markdown-message';

describe('MarkdownMessage', () => {
  it('renders inline math tokens and custom mermaid/math block containers without pre wrappers', () => {
    const { container } = render(
      <MarkdownMessage
        content={[
          'Inline math $E=mc^2$ stays formatted.',
          '',
          '```mermaid',
          'flowchart TD',
          '  A-->B',
          '```',
          '',
          '```math',
          'x^2 + y^2 = z^2',
          '```',
        ].join('\n')}
      />,
    );

    expect(container.querySelector('span.katex')).toBeInTheDocument();

    const mermaidHeading = screen.getByText('Mermaid diagram');
    expect(mermaidHeading.closest('pre')).toBeNull();

    const mathHeading = screen.getByText('Math');
    expect(mathHeading.closest('pre')).toBeNull();
  });
});
