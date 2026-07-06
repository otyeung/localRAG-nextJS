import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const useConversationsMock = vi.hoisted(() => vi.fn());
const useDocumentsMock = vi.hoisted(() => vi.fn());
const useHealthMock = vi.hoisted(() => vi.fn());
const useUploadQueueMock = vi.hoisted(() => vi.fn());

vi.mock('@/components/chat/chat-view', () => ({
  ChatView: () => <div>Chat view</div>,
}));

vi.mock('@/components/documents/document-library', () => ({
  DocumentLibrary: () => <div>Document library</div>,
}));

vi.mock('@/components/settings/settings-panel', () => ({
  SettingsPanel: () => <div>Settings panel</div>,
}));

vi.mock('@/components/upload/upload-dropzone', () => ({
  UploadDropzone: () => <div>Upload dropzone</div>,
}));

vi.mock('@/components/sidebar/sidebar', () => ({
  Sidebar: ({ healthLabel, healthTone }: { healthLabel: string; healthTone: string }) => (
    <div>
      <span>{healthLabel}</span>
      <span>{healthTone}</span>
    </div>
  ),
}));

vi.mock('@/hooks/use-conversations', () => ({
  useConversations: useConversationsMock,
}));

vi.mock('@/hooks/use-documents', () => ({
  useDocuments: useDocumentsMock,
}));

vi.mock('@/hooks/use-health', () => ({
  useHealth: useHealthMock,
}));

vi.mock('@/hooks/use-upload-queue', () => ({
  useUploadQueue: useUploadQueueMock,
}));

import { AppShell } from '@/components/common/app-shell';

describe('AppShell health states', () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    useConversationsMock.mockReturnValue({
      conversations: [],
      totalConversations: 0,
      hasNextPage: false,
      fetchNextPage: vi.fn(),
      isFetchingNextPage: false,
      isLoading: false,
      error: null,
      renameConversation: { mutateAsync: vi.fn() },
      deleteConversation: { mutateAsync: vi.fn() },
      createConversation: { mutateAsync: vi.fn() },
    });
    useDocumentsMock.mockReturnValue({
      documents: [],
      totalDocuments: 0,
      hasNextPage: false,
      fetchNextPage: vi.fn(),
      isFetchingNextPage: false,
      isLoading: false,
      error: null,
      workflowsByDocumentId: new Map(),
      workflowLookupStateByDocumentId: new Map(),
      queueReindexDocument: vi.fn(),
      deleteDocument: { mutate: vi.fn() },
      pendingReindexDocumentIds: [],
      reindexDocument: { error: null },
    });
    useUploadQueueMock.mockReturnValue({
      queue: [],
      onFilesSelected: vi.fn(),
      cancelUpload: vi.fn(),
      retryUpload: vi.fn(),
      uploadHistory: [],
      isLoadingHistory: false,
      historyError: null,
    });
  });

  it('shows an explicit health error state for non-404 failures', () => {
    useHealthMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error('Gateway timeout while reading health checks.'),
    });

    render(<AppShell />);

    expect(screen.getAllByText('Health unavailable').length).toBeGreaterThan(0);
    expect(screen.getByText('danger')).toBeInTheDocument();
    expect(screen.getByText('Gateway timeout while reading health checks.')).toBeInTheDocument();
  });

  it('shows health unavailable for a missing health route', () => {
    useHealthMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: false,
      error: null,
    });

    render(<AppShell />);

    expect(screen.getAllByText('Health unavailable').length).toBeGreaterThan(0);
  });

  it('keeps the chat workspace from stretching to the side panels on wide screens', () => {
    useHealthMock.mockReturnValue({
      data: {
        status: 'healthy',
        label: 'Healthy',
      },
      isLoading: false,
      isError: false,
      error: null,
    });

    render(<AppShell />);

    const chatWorkspace = screen.getByRole('main', { name: 'Chat workspace' });
    expect(chatWorkspace).toHaveClass('order-1', 'min-w-0', 'xl:order-2', 'xl:sticky', 'xl:top-4', 'xl:self-start');
    expect(screen.getByTestId('sidebar-panel')).toHaveClass('order-2', 'min-w-0', 'xl:order-1');
    expect(screen.getByTestId('knowledge-panel')).toHaveClass('order-3', 'min-w-0');
    expect(chatWorkspace.parentElement).toHaveClass('items-start');
  });
});
