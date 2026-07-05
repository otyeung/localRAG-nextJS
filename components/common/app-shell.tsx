'use client';

import { useEffect, useMemo, useState } from 'react';

import { ChatView } from '@/components/chat/chat-view';
import { DocumentLibrary } from '@/components/documents/document-library';
import { SettingsPanel } from '@/components/settings/settings-panel';
import { Sidebar } from '@/components/sidebar/sidebar';
import { StatusBadge } from '@/components/common/status-badge';
import { UploadDropzone } from '@/components/upload/upload-dropzone';
import { useConversations, type ConversationSummary } from '@/hooks/use-conversations';
import { useDocuments } from '@/hooks/use-documents';
import { useHealth } from '@/hooks/use-health';
import { useUploadQueue } from '@/hooks/use-upload-queue';

type RightPanel = 'knowledge' | 'settings';

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

  const healthLabel = health.data?.label ?? (health.isLoading ? 'Checking' : 'Pending Task 9');
  const healthTone =
    health.data?.status === 'healthy'
      ? 'success'
      : health.data?.status === 'degraded'
        ? 'warning'
        : health.isError
          ? 'danger'
          : 'neutral';

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
          />

          <main aria-label="Chat workspace" className="min-w-0">
            <ChatView initialConversationId={activeConversationId} />
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
                  workflowsByDocumentId={documents.workflowsByDocumentId}
                  uploadHistory={uploads.uploadHistory}
                  search={documentSearch}
                  statusFilter={documentStatus}
                  sort={documentSort}
                  onSearchChange={setDocumentSearch}
                  onStatusFilterChange={setDocumentStatus}
                  onSortChange={setDocumentSort}
                  onDelete={(id) => documents.deleteDocument.mutate(id)}
                  onReindex={(id) => documents.reindexDocument.mutate(id)}
                  reindexingDocumentId={documents.reindexDocument.isPending ? documents.reindexDocument.variables : null}
                  reindexError={documents.reindexDocument.error?.message ?? null}
                />
              </>
            ) : (
              <SettingsPanel />
            )}

            <section className="rounded-[1.75rem] border border-[color:var(--border-soft)] bg-[color:var(--panel-elevated)] p-5 shadow-[var(--shadow-panel)]">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-base font-semibold text-[color:var(--text-strong)]">System Status</h3>
                  <p className="mt-1 text-sm text-[color:var(--text-muted)]">
                    Infrastructure telemetry and service health snapshots.
                  </p>
                </div>
                <StatusBadge label={healthLabel} tone={healthTone} />
              </div>
              <div className="mt-4 space-y-3">
                {health.data?.services?.length ? (
                  health.data.services.map((service) => (
                    <div
                      key={service.name}
                      className="rounded-2xl border border-[color:var(--border-soft)] bg-[color:var(--panel-subtle)] px-4 py-3"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-sm font-medium text-[color:var(--text-strong)]">{service.name}</span>
                        <StatusBadge label={service.status} tone={service.status === 'healthy' ? 'success' : 'warning'} />
                      </div>
                      {service.detail ? <p className="mt-2 text-xs text-[color:var(--text-dim)]">{service.detail}</p> : null}
                    </div>
                  ))
                ) : (
                  <div className="rounded-2xl border border-dashed border-[color:var(--border-strong)] bg-[color:var(--panel-subtle)] p-4 text-sm text-[color:var(--text-muted)]">
                    The health route is expected in Task 9. This placeholder is already wired to consume it when available.
                  </div>
                )}
              </div>
            </section>
          </aside>
        </div>
      </div>
    </div>
  );
}
