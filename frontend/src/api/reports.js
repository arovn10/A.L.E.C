import { apiFetch } from './client';

// Finance data endpoints — return { rows, noData } for table/chart display
export const getLoans         = () => apiFetch('/finance/loans').then((r) => r.rows ?? []);
export const getMaturityWall  = () => apiFetch('/finance/maturity').then((r) => r.rows ?? []);
export const getLenderExposure = () => apiFetch('/finance/lenders').then((r) => r.rows ?? []);
export const getDSCR          = () => apiFetch('/finance/dscr').then((r) => r.rows ?? []);
export const getLTV           = () => apiFetch('/finance/ltv').then((r) => r.rows ?? []);
export const getEquity        = () => apiFetch('/finance/equity').then((r) => r.rows ?? []);

// Report download — triggers Excel generation and opens download link
export const downloadReport   = (name) => window.open(`/api/download/${encodeURIComponent(name)}`, '_blank');
