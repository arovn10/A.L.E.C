import { apiFetch } from './client';

export const sendMessage = (message, sessionId) =>
  apiFetch('/chat', { method: 'POST', body: JSON.stringify({ message, sessionId }) });

export function streamMessage(message, sessionId, onToken, onDone, onError) {
  const url = `/api/chat/stream?message=${encodeURIComponent(message)}&sessionId=${encodeURIComponent(sessionId)}`;
  const es = new EventSource(url);
  es.onmessage = (e) => {
    const d = JSON.parse(e.data);
    if (d.done) { es.close(); onDone(); }
    else onToken(d.token ?? '');
  };
  es.onerror = (e) => { es.close(); onError(e); };
  // Return cleanup function — must be called from useEffect cleanup to prevent leaks
  return () => es.close();
}
