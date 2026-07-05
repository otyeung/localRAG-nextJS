'use client';

import { useQuery } from '@tanstack/react-query';

export type UserSettings = {
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

export function useUserSettings() {
  return useQuery({
    queryKey: ['settings'],
    queryFn: () => requestJson<UserSettings>('/api/settings'),
  });
}
