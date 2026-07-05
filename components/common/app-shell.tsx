'use client';

import { useEffect, useMemo, useState } from 'react';

import { ChatView } from '@/components/chat/chat-view';
import { DocumentLibrary } from '@/components/documents/document-library';
import { SettingsPanel } from '@/components/settings/settings-panel';
import { Sidebar } from '@/components/sidebar/sidebar';
import { StatusBadge } from '@/components/common/status-badge';
import { SystemStatus } from '@/components/common/system-status';
import { UploadDropzone } from '@/components/upload/upload-dropzone';
import { useConversations, type ConversationSummary } from '@/hooks/use-conversations';
import { useDocuments } from '@/hooks/use-documents';
import { useHealth } from '@/hooks/use-health';
import { useUploadQueue } from '@/hooks/use-upload-queue';

type RightPanel = 'knowledge' | 'settings';
type HealthTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

export function AppShell() {
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [conversationSearch, setConversationSearch] = useState('');
  const [panel, setPanel] = useState<RightPanel>('knowledge');
  const [documentSearch, setDocumentSearch] = useState('');
  const [documentStatus, setDocumentStatus] = useState<'ALL' | 'PENDING' | 'INGESTING' | 'READY' | 'FAILED'>('ALL');
  const [documentSort, setDocumentSort] = useState<'createdAt' | 'updatedAt' | 'title'>('updatedAt');

  const conversations = useConversations({
    query: conversationSearch,
    pageSize: 30,
  });
  const documents = useDocuments({
    search: documentSearch,
    status: documentStatus === 'ALL' ? undefined : documentStatus,
    sort: documentSort,
    pageSize: 40,
  });
  const health = useHealth();
  const uploads = useUploadQueue();

  useEffect(() => {
    if (!activeConversationId && conversations.conversations.length > 0) {
      setActiveConversationId(conversations.conversations[0]?.id ?? null);
    }
  }, [activeConversationId, conversations.conversations]);

  const activeConversation = useMemo(
    () => conversations.conversations.find((conversation) => conversation.id === activeConversationId) ?? null,
    [activeConversationId, conversations.conversations],
  );

  const handleConversationRename = async (conversation: ConversationSummary) => {
    const nextTitle = window.prompt('Rename conversation', conversation.title);
    if (!nextTitle?.trim()) {
      return;
    }

    await conversations.renameConversation.mutateAsync({
      id: conversation.id,
      title: nextTitle.trim(),
    });
  };

  const handleConversationDelete = async (conversation: ConversationSummary) => {
    await conversations.deleteConversation.mutateAsync(conversation.id);

    if (activeConversationId === conversation.id) {
      const nextConversation = conversations.conversations.find((item) => item.id !== conversation.id);
      setActiveConversationId(nextConversation?.id ?? null);
    }
  };

  const handleNewChat = async () => {
    const nextConversation = await conversations.createConversation.mutateAsync({});
    setActiveConversationId(nextConversation.id);
  };

  const handleDocumentReindex = async (id: string) => {
    try {
      await documents.queueReindexDocument(id);
    } catch {
      // The document library already renders the latest mutation error state.
    }
  };

  let healthLabel = health.data?.label ?? (health.isLoading ? 'Checking' : 'Health unavailable');
  let healthTone: HealthTone =
    health.data?.status === 'healthy'
      ? 'success'
      : health.data?.status === 'degraded' || health.data?.status === 'pending'
        ? 'warning'
        : health.data?.status === 'unhealthy'
          ? 'danger'
          : 'neutral';

  if (health.isError) {
    healthLabel = 'Health unavailable';
    healthTone = 'danger';
  }

  return (
    <div className="min-h-screen bg-[color:var(--app-bg)] px-4 py-4 text-[color:var(--text-strong)] sm:px-5 lg:px-6">
      <div className="mx-auto max-w-[1800px]">
        <header className="mb-4 flex flex-col gap-4 rounded-[2rem] border border-[color:var(--border-soft)] bg-[color:var(--panel-elevated)] px-6 py-5 shadow-[var(--shadow-panel)] xl:flex-row xl:items-center xl:justify-between">
          <div>
            <p className="text-[0.7rem] uppercase tracking-[0.26em] text-[color:var(--text-dim)]">Command center</p>
            <h1 className="mt-2 font-display text-4xl text-[color:var(--text-strong)]">
              Private document intelligence
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-7 text-[color:var(--text-muted)]">
              Refined orchestration for grounded chats, ingestion workflows, and knowledge-base operations across your confidential corpus.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge label={healthLabel} tone={healthTone} pulse={healthTone === 'success'} />
            {activeConversation?.activeAgentName ? (
              <StatusBadge label={activeConversation.activeAgentName} tone="info" />
            ) : null}
            {uploads.queue.some((item) => item.status === 'uploading') ? (
              <StatusBadge label="Uploads active" tone="warning" pulse />
            ) : null}
          </div>
        </header>

        <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)_420px]">
          <Sidebar
            conversations={conversations.conversations}
            totalConversations={conversations.totalConversations}
            hasMoreConversations={Boolean(conversations.hasNextPage)}
            onLoadMoreConversations={() => {
              void conversations.fetchNextPage();
            }}
            isLoadingMoreConversations={conversations.isFetchingNextPage}
            isLoadingConversations={conversations.isLoading}
            conversationsError={conversations.error?.message ?? null}
            activeConversationId={activeConversationId}
            conversationSearchValue={conversationSearch}
            onConversationSearchChange={setConversationSearch}
            onConversationSelect={setActiveConversationId}
            onNewChat={handleNewChat}
            onConversationRename={handleConversationRename}
            onConversationDelete={handleConversationDelete}
            onKnowledgeBase={() => setPanel('knowledge')}
            onSettings={() => setPanel('settings')}
            healthLabel={healthLabel}
            healthTone={healthTone}
          />

          <main aria-label="Chat workspace" className="min-w-0">
            <ChatView initialConversationId={activeConversationId} onConversationResolved={setActiveConversationId} />
          </main>

          <aside className="space-y-4">
            {panel === 'knowledge' ? (
              <>
                <UploadDropzone
                  queue={uploads.queue}
                  onFilesSelected={uploads.onFilesSelected}
                  onCancel={uploads.cancelUpload}
                  onRetry={uploads.retryUpload}
                />
                <DocumentLibrary
                  documents={documents.documents}
                  totalDocuments={documents.totalDocuments}
                  hasMoreDocuments={Boolean(documents.hasNextPage)}
                  onLoadMoreDocuments={() => {
                    void documents.fetchNextPage();
                  }}
                  isLoadingMoreDocuments={documents.isFetchingNextPage}
                  isLoadingDocuments={documents.isLoading}
                  documentsError={documents.error?.message ?? null}
                  workflowsByDocumentId={documents.workflowsByDocumentId}
                  workflowLookupStateByDocumentId={documents.workflowLookupStateByDocumentId}
                  uploadHistory={uploads.uploadHistory}
                  isLoadingUploadHistory={uploads.isLoadingHistory}
                  uploadHistoryError={uploads.historyError?.message ?? null}
                  search={documentSearch}
                  statusFilter={documentStatus}
                  sort={documentSort}
                  onSearchChange={setDocumentSearch}
                  onStatusFilterChange={setDocumentStatus}
                  onSortChange={setDocumentSort}
                  onDelete={(id) => documents.deleteDocument.mutate(id)}
                  onReindex={handleDocumentReindex}
                  pendingReindexDocumentIds={documents.pendingReindexDocumentIds}
                  reindexError={documents.reindexDocument.error?.message ?? null}
                />
              </>
            ) : (
              <SettingsPanel />
            )}

            <SystemStatus health={health} />
          </aside>
        </div>
      </div>
    </div>
  );
}
