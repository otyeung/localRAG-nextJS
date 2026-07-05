'use client';

import { useEffect } from 'react';
import { useTheme } from 'next-themes';
import { useForm } from 'react-hook-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Save } from 'lucide-react';

import { StatusBadge } from '@/components/common/status-badge';

type SettingsForm = {
  theme: 'system' | 'light' | 'dark';
  model: string;
  showReasoningMetadata: boolean;
};

type ApiResponse<T> = { data: T };

async function requestJson<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  const body = (await response.json().catch(() => null)) as
    | ApiResponse<T>
    | { error?: { message?: string } }
    | null;

  if (!response.ok) {
    throw new Error(body && 'error' in body ? body.error?.message ?? 'Request failed.' : 'Request failed.');
  }

  return (body as ApiResponse<T>).data;
}

export function SettingsPanel() {
  const queryClient = useQueryClient();
  const { setTheme } = useTheme();
  const form = useForm<SettingsForm>({
    defaultValues: {
      theme: 'system',
      model: 'gpt-4.1-mini',
      showReasoningMetadata: true,
    },
  });

  const settingsQuery = useQuery({
    queryKey: ['settings'],
    queryFn: () => requestJson<SettingsForm>('/api/settings'),
  });

  useEffect(() => {
    if (settingsQuery.data) {
      const themeDirty = Boolean(form.formState.dirtyFields.theme);

      form.reset(settingsQuery.data, {
        keepDirtyValues: true,
      });

      if (!themeDirty) {
        setTheme(settingsQuery.data.theme);
      }
    }
  }, [form, form.formState.dirtyFields.theme, setTheme, settingsQuery.data]);

  const saveMutation = useMutation({
    mutationFn: (values: SettingsForm) =>
      requestJson<SettingsForm>('/api/settings', {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify(values),
      }),
    onSuccess: async (settings) => {
      setTheme(settings.theme);
      await queryClient.invalidateQueries({ queryKey: ['settings'] });
    },
  });

  const isSaving = saveMutation.isPending;

  return (
    <section className="rounded-[1.75rem] border border-[color:var(--border-soft)] bg-[color:var(--panel-elevated)] p-5 shadow-[var(--shadow-panel)]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-base font-semibold text-[color:var(--text-strong)]">Settings</h3>
          <p className="mt-1 text-sm text-[color:var(--text-muted)]">
            Personalize theme behavior, default model selection, and metadata visibility.
          </p>
        </div>
        <StatusBadge label={saveMutation.isSuccess ? 'Saved' : 'Synced'} tone={saveMutation.isSuccess ? 'success' : 'neutral'} />
      </div>

      <form
        className="mt-5 space-y-5"
        onSubmit={form.handleSubmit((values) => saveMutation.mutate(values))}
      >
        <label className="block space-y-2">
          <span className="text-sm font-medium text-[color:var(--text-strong)]">Theme mode</span>
          <select
            {...form.register('theme', {
              onChange: (event) => setTheme(event.target.value),
            })}
            className="w-full rounded-2xl border border-[color:var(--border-soft)] bg-[color:var(--panel-subtle)] px-4 py-3 text-sm text-[color:var(--text-strong)] outline-none focus:border-[color:var(--accent)]"
          >
            <option value="system">System</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </label>

        <label className="block space-y-2">
          <span className="text-sm font-medium text-[color:var(--text-strong)]">Default model</span>
          <input
            {...form.register('model')}
            className="w-full rounded-2xl border border-[color:var(--border-soft)] bg-[color:var(--panel-subtle)] px-4 py-3 text-sm text-[color:var(--text-strong)] outline-none focus:border-[color:var(--accent)]"
          />
        </label>

        <label className="flex items-center justify-between gap-3 rounded-2xl border border-[color:var(--border-soft)] bg-[color:var(--panel-subtle)] px-4 py-4">
          <span>
            <span className="block text-sm font-medium text-[color:var(--text-strong)]">Show reasoning metadata</span>
            <span className="block text-xs text-[color:var(--text-dim)]">
              Keep collapsible reasoning traces visible beside model outputs.
            </span>
          </span>
          <input
            type="checkbox"
            {...form.register('showReasoningMetadata')}
            className="h-4 w-4 rounded border-[color:var(--border-strong)] bg-transparent text-[color:var(--accent)]"
          />
        </label>

        {settingsQuery.error ? (
          <p className="text-sm text-rose-300">{settingsQuery.error.message}</p>
        ) : null}
        {saveMutation.error ? <p className="text-sm text-rose-300">{saveMutation.error.message}</p> : null}

        <button
          type="submit"
          disabled={isSaving}
          className="inline-flex items-center gap-2 rounded-full bg-[color:var(--accent)] px-4 py-2 text-sm font-semibold text-[color:var(--accent-foreground)] transition enabled:hover:translate-y-[-1px] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Save className="h-4 w-4" />
          {isSaving ? 'Saving…' : 'Save settings'}
        </button>
      </form>
    </section>
  );
}
