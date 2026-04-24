/**
 * frontend/src/api/ml.js — wrappers for /api/ml/*
 */
import { apiFetch } from './client';

export const listRuns         = ()        => apiFetch('/ml/runs');
export const getRun           = (id)      => apiFetch(`/ml/runs/${encodeURIComponent(id)}`);
export const getRecommendations = ()      => apiFetch('/ml/recommendations');
export const listModels       = (target)  => apiFetch(`/ml/models?target=${encodeURIComponent(target)}`);
export const getForecast      = (modelId) => apiFetch(`/ml/forecast/${encodeURIComponent(modelId)}`);
export const triggerNightly   = ()        => apiFetch('/ml/run', { method: 'POST', body: JSON.stringify({}) });
export const listAlerts       = (opts={}) => apiFetch(`/ml/alerts${opts.kind ? `?kind=${encodeURIComponent(opts.kind)}` : ''}`);
export const ackAlert         = (id)      => apiFetch(`/ml/alerts/${encodeURIComponent(id)}/ack`, { method: 'POST', body: '{}' });
export const getWhatsNew      = ()        => apiFetch('/ml/whats-new');
export const exportRunXlsxUrl = (runId)   => `/api/ml/export/run/${encodeURIComponent(runId)}.xlsx`;
export const exportRunPdfUrl  = (runId)   => `/api/ml/export/run/${encodeURIComponent(runId)}.pdf`;
