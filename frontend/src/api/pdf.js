export async function uploadPdf(file) {
  const form = new FormData();
  form.append('pdf', file);
  const res = await fetch('/api/pdf/upload', { method: 'POST', body: form });
  if (!res.ok) throw new Error('Upload failed');
  return res.json();
}

export async function getPdfSummary(docUuid) {
  const res = await fetch(`/api/pdf/${encodeURIComponent(docUuid)}/summary`);
  if (!res.ok) throw new Error('Summary failed');
  return res.json();
}
