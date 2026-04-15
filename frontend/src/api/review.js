import { apiFetch } from './client';

const FINE_TUNE_BATCH = 50;

// Transform snake_case DB fields → camelCase for components
function transformQueueItem(item) {
  return {
    id:           item.id,
    turnId:       item.turn_id,
    sessionId:    item.session_id,
    userMessage:  item.user_msg,
    alecResponse: item.alec_response,
    qualityScore: item.quality_score != null ? Number(item.quality_score) : null,
    status:       item.status,
    createdAt:    item.created_at,
  };
}

// Transform fine_tune_jobs row → shape expected by FineTuneStatusBar
function transformFineTuneStatus(raw) {
  const job = raw?.job ?? null;
  if (!job) return { evalScore: null, lastRun: null, modelVersion: null, examplesUntilNext: null };
  return {
    evalScore:        job.eval_score != null ? Number(job.eval_score) : null,
    lastRun:          job.created_at ?? null,
    modelVersion:     job.status ?? null,
    examplesUntilNext: Math.max(0, FINE_TUNE_BATCH - ((job.example_count ?? 0) % FINE_TUNE_BATCH)),
  };
}

export const getQueue = () =>
  apiFetch('/review/queue').then((r) => ({
    ...r,
    items: (r.items ?? []).map(transformQueueItem),
  }));

export const approve = (id) => apiFetch(`/review/${id}/approve`, { method: 'POST' });
export const reject  = (id) => apiFetch(`/review/${id}/reject`,  { method: 'POST' });

export const getFineTuneStatus = () =>
  apiFetch('/review/finetune/status').then(transformFineTuneStatus);
