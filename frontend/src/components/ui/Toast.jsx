/**
 * frontend/src/components/ui/Toast.jsx
 *
 * S5.4 — lightweight toast system. A context-based queue so any component
 * in the tree can call `pushToast({kind, title, detail})` without needing
 * to mount a dedicated portal per page.
 *
 * Each toast carries an optional `detail` string; when present the user
 * can click "Show details" to expand, which is how we surface
 * `error.response?.data` JSON without dumping it into the title.
 *
 * Auto-dismiss defaults to 6 seconds for success toasts; error toasts
 * stick until dismissed so the user actually reads them.
 */
import { createContext, useCallback, useContext, useRef, useState } from 'react';

const ToastCtx = createContext({ pushToast: () => {} });

let idSeq = 0;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  // We keep a ref to the setter so auto-dismiss timers captured outside
  // the render tree still see the latest state.
  const tRef = useRef(null);
  tRef.current = toasts;

  const dismiss = useCallback((id) => {
    setToasts((cur) => cur.filter((t) => t.id !== id));
  }, []);

  const pushToast = useCallback(({ kind = 'info', title, detail, ttl } = {}) => {
    const id = ++idSeq;
    setToasts((cur) => [...cur, { id, kind, title: title || '', detail: detail || '' }]);
    const effectiveTtl = ttl ?? (kind === 'error' ? 0 : 6000);
    if (effectiveTtl > 0) {
      setTimeout(() => dismiss(id), effectiveTtl);
    }
    return id;
  }, [dismiss]);

  return (
    <ToastCtx.Provider value={{ pushToast, dismiss }}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastCtx.Provider>
  );
}

export function useToast() {
  return useContext(ToastCtx);
}

function ToastViewport({ toasts, onDismiss }) {
  if (!toasts.length) return null;
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-96 flex-col gap-2"
      data-testid="toast-viewport"
    >
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDismiss={() => onDismiss(t.id)} />
      ))}
    </div>
  );
}

function ToastItem({ toast, onDismiss }) {
  const [showDetail, setShowDetail] = useState(false);
  const color = toast.kind === 'error'
    ? 'border-red-500/40 bg-red-950/80 text-red-100'
    : toast.kind === 'ok' || toast.kind === 'success'
      ? 'border-green-500/40 bg-green-950/80 text-green-100'
      : 'border-alec-600 bg-alec-800 text-gray-100';
  return (
    <div className={`pointer-events-auto rounded border ${color} px-3 py-2 text-sm shadow-lg`}>
      <div className="flex items-start justify-between gap-2">
        <span className="flex-1 font-medium">{toast.title}</span>
        <button
          onClick={onDismiss}
          aria-label="Dismiss"
          className="text-xs text-gray-400 hover:text-white"
        >
          ×
        </button>
      </div>
      {toast.detail && (
        <div className="mt-1">
          <button
            onClick={() => setShowDetail((v) => !v)}
            className="text-xs underline hover:text-white"
          >
            {showDetail ? 'Hide details' : 'Show details'}
          </button>
          {showDetail && (
            <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded bg-black/30 p-2 text-xs">
              {toast.detail}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

// Helper — normalize a thrown error into {title, detail} for pushToast.
export function toastFromError(err, fallbackTitle = 'Something went wrong') {
  let detail = '';
  try {
    if (err?.response?.data) detail = JSON.stringify(err.response.data, null, 2);
    else if (err?.body)       detail = JSON.stringify(err.body, null, 2);
    else if (err?.stack)      detail = String(err.stack);
  } catch { /* ignore serialization failure */ }
  return { kind: 'error', title: err?.message || fallbackTitle, detail };
}
