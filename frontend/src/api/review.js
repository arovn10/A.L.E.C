import { apiFetch } from './client';

export const getQueue = () => apiFetch('/review/queue');
export const approve = (id) => apiFetch(`/review/${id}/approve`, { method: 'POST' });
export const reject = (id) => apiFetch(`/review/${id}/reject`, { method: 'POST' });
export const getFineTuneStatus = () => apiFetch('/review/finetune/status');
