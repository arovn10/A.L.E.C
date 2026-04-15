import { apiFetchForm, getAuthHeaders } from './client';

export async function uploadPdf(file) {
  const form = new FormData();
  form.append('file', file);
  // apiFetchForm handles auth header + correct multipart encoding
  return apiFetchForm('/pdf/upload', form);
}

export async function getPdfSummary(docUuid) {
  const res = await fetch(`/api/pdf/${encodeURIComponent(docUuid)}/summary`, {
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error('Summary failed');
  const data = await res.json();
  // Backend returns { success, summary: { docUuid, chunks, ... } } — unwrap the inner object
  return data.summary ?? data;
}
