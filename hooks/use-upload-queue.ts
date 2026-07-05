'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useRef, useState } from 'react';

const MAX_UPLOAD_BYTES = 52_428_800;
const allowedMimeTypesByExtension = new Map<string, string>([
  ['pdf', 'application/pdf'],
  ['docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  ['txt', 'text/plain'],
  ['md', 'text/markdown'],
  ['csv', 'text/csv'],
  ['xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  ['pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'],
  ['json', 'application/json'],
  ['html', 'text/html'],
  ['png', 'image/png'],
  ['jpg', 'image/jpeg'],
  ['jpeg', 'image/jpeg'],
  ['zip', 'application/zip'],
]);

export type UploadQueueItem = {
  id: string;
  fileName: string;
  size: number;
  progress: number;
  status: 'queued' | 'uploading' | 'success' | 'error' | 'canceled';
  errorMessage: string | null;
  file?: File;
};

export type UploadHistoryItem = {
  id: string;
  status: 'PENDING' | 'VALIDATING' | 'INGESTING' | 'COMPLETED' | 'FAILED' | 'CANCELED';
  originalFilename: string;
  mimeType: string;
  fileSizeBytes: number;
  createdAt: string;
  updatedAt: string;
  errorMessage: string | null;
};

type UploadResult = {
  uploadId: string;
  documentId: string;
  workflowExecutionId: string;
  status: string;
  reconciliationRequired: boolean;
};

type ApiResponse<T> = { data: T };

function createQueueId() {
  return `queue_${Math.random().toString(36).slice(2, 10)}`;
}

function validateFile(file: File): string | null {
  if (file.size > MAX_UPLOAD_BYTES) {
    return 'File exceeds the maximum upload size.';
  }

  const extension = file.name.split('.').pop()?.toLowerCase();

  if (!extension) {
    return 'A file extension is required.';
  }

  const expectedMimeType = allowedMimeTypesByExtension.get(extension);

  if (!expectedMimeType) {
    return 'Unsupported file type.';
  }

  if (!file.type) {
    return 'MIME type is required.';
  }

  if (file.type && file.type !== expectedMimeType) {
    return 'File extension does not match MIME type.';
  }

  return null;
}

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

export function useUploadQueue() {
  const queryClient = useQueryClient();
  const [queue, setQueue] = useState<UploadQueueItem[]>([]);
  const requestsRef = useRef(new Map<string, XMLHttpRequest>());

  const historyQuery = useQuery({
    queryKey: ['uploads'],
    queryFn: () => requestJson<UploadHistoryItem[]>('/api/uploads'),
  });

  const finalizeUpload = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['uploads'] }),
      queryClient.invalidateQueries({ queryKey: ['documents'] }),
      queryClient.invalidateQueries({ queryKey: ['workflows'] }),
    ]);
  }, [queryClient]);

  const uploadMutation = useMutation({
    mutationFn: ({ id, file }: { id: string; file: File }) =>
      new Promise<UploadResult>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        requestsRef.current.set(id, xhr);
        xhr.open('POST', '/api/upload');
        xhr.responseType = 'json';

        xhr.upload.onprogress = (event) => {
          if (!event.lengthComputable) {
            return;
          }

          const progress = Math.round((event.loaded / event.total) * 100);
          setQueue((items) =>
            items.map((item) => (item.id === id ? { ...item, progress, status: 'uploading' } : item)),
          );
        };

        xhr.onerror = () => {
          reject(new Error('Network error during upload.'));
        };

        xhr.onabort = () => {
          reject(new Error('Upload canceled.'));
        };

        xhr.onload = () => {
          const responseBody = (xhr.response ?? JSON.parse(xhr.responseText || '{}')) as
            | ApiResponse<UploadResult>
            | { error?: { message?: string } };

          if (xhr.status >= 200 && xhr.status < 300 && 'data' in responseBody) {
            resolve(responseBody.data);
            return;
          }

          reject(new Error('error' in responseBody ? responseBody.error?.message ?? 'Upload failed.' : 'Upload failed.'));
        };

        const formData = new FormData();
        formData.append('file', file);
        xhr.send(formData);
      }),
    onSuccess: async (_, variables) => {
      requestsRef.current.delete(variables.id);
      setQueue((items) =>
        items.map((item) =>
          item.id === variables.id ? { ...item, progress: 100, status: 'success', errorMessage: null } : item,
        ),
      );
      await finalizeUpload();
    },
    onError: (error, variables) => {
      requestsRef.current.delete(variables.id);
      setQueue((items) =>
        items.map((item) =>
          item.id === variables.id
            ? {
                ...item,
                status: error.message === 'Upload canceled.' ? 'canceled' : 'error',
                errorMessage: error.message === 'Upload canceled.' ? null : error.message,
              }
            : item,
        ),
      );
    },
  });

  const startUpload = useCallback(
    (item: UploadQueueItem) => {
      if (!item.file) {
        return;
      }

      setQueue((items) =>
        items.map((entry) =>
          entry.id === item.id ? { ...entry, status: 'uploading', progress: 0, errorMessage: null } : entry,
        ),
      );
      uploadMutation.mutate({ id: item.id, file: item.file });
    },
    [uploadMutation],
  );

  const onFilesSelected = useCallback(
    (files: FileList | File[]) => {
      const list = Array.from(files);
      const nextItems = list.map<UploadQueueItem>((file) => {
        const errorMessage = validateFile(file);

        return {
          id: createQueueId(),
          fileName: file.name,
          size: file.size,
          progress: 0,
          status: errorMessage ? 'error' : 'queued',
          errorMessage,
          file,
        };
      });

      setQueue((items) => [...nextItems, ...items]);

      nextItems.filter((item) => item.status === 'queued').forEach((item) => startUpload(item));
    },
    [startUpload],
  );

  const cancelUpload = useCallback((id: string) => {
    const request = requestsRef.current.get(id);
    if (request) {
      request.abort();
      requestsRef.current.delete(id);
    }
    setQueue((items) => items.map((item) => (item.id === id ? { ...item, status: 'canceled' } : item)));
  }, []);

  const retryUpload = useCallback(
    (id: string) => {
      const item = queue.find((entry) => entry.id === id);
      if (!item?.file) {
        return;
      }

      startUpload(item);
    },
    [queue, startUpload],
  );

  return {
    queue,
    uploadHistory: historyQuery.data ?? [],
    isLoadingHistory: historyQuery.isLoading,
    onFilesSelected,
    cancelUpload,
    retryUpload,
  };
}
