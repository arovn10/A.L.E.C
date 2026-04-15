import { apiFetch } from './client';

export const getLoans = () => apiFetch('/reports/loans');
export const getMaturityWall = () => apiFetch('/reports/maturity');
export const getLenderExposure = () => apiFetch('/reports/lenders');
export const getDSCR = () => apiFetch('/reports/dscr');
export const getLTV = () => apiFetch('/reports/ltv');
export const getEquity = () => apiFetch('/reports/equity');
export const downloadReport = (name) => window.open(`/api/download/${encodeURIComponent(name)}`, '_blank');
