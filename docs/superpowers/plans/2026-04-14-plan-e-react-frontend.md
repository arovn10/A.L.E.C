# Plan E — React Frontend Overhaul + API Wiring
**Date:** 2026-04-14  
**Depends on:** Plans A, B, C, D (all merged)  
**Branch:** claude/plan-e-react-frontend

---

## Overview

Migrate the current 900-line vanilla HTML/JS frontend to a React + Vite SPA. Wire all new Plan A–D API endpoints. Replace the Plaid/brokerage Finance panel with a real estate debt portfolio dashboard (loans, DSCR, LTV, maturity wall, lender exposure, equity commitments). Plaid personal account linking moves to Settings.

**Tech stack:**
- Vite 5 (dev server :5173, proxy /api → :3001)
- React 18 + React Router 6
- Tailwind CSS 3 (dark mode via `class` strategy)
- Zustand (lightweight global state)
- Recharts (charts — bar, pie, line)
- react-dropzone (PDF upload)
- react-hot-toast (notifications)
- dompurify (sanitize markdown output — no raw innerHTML)

---

## File Layout

```
frontend/
  index.html
  vite.config.js
  tailwind.config.js
  postcss.config.js
  src/
    main.jsx
    App.jsx
    api/
      client.js
      chat.js
      reports.js
      review.js
      pdf.js
    store/
      chatStore.js
      reviewStore.js
    components/
      layout/
        Sidebar.jsx
        TopBar.jsx
      chat/
        ChatPanel.jsx
        MessageBubble.jsx
        TypingIndicator.jsx
        RagBadge.jsx
      dashboard/
        DashboardPanel.jsx
        StatCard.jsx
      finance/
        FinancePanel.jsx
        LoansTable.jsx
        MaturityWallChart.jsx
        LenderExposureChart.jsx
        DSCRTable.jsx
        LTVTable.jsx
        EquityTable.jsx
        ReportDownloadBar.jsx
      review/
        ReviewPanel.jsx
        ReviewCard.jsx
        FineTuneStatusBar.jsx
      pdf/
        PdfUploadPanel.jsx
        PdfSummaryCard.jsx
      settings/
        SettingsPanel.jsx
        PlaidLinkSection.jsx
    pages/
      Chat.jsx
      Dashboard.jsx
      Finance.jsx
      Review.jsx
      PdfUpload.jsx
      Settings.jsx
```

---

## Task 1 — Vite + Tailwind Scaffold

### 1.1 Create frontend/package.json
```bash
cd frontend
npm init -y
npm install react react-dom react-router-dom zustand recharts react-dropzone react-hot-toast dompurify
npm install -D vite @vitejs/plugin-react tailwindcss postcss autoprefixer
```

### 1.2 vite.config.js
```js
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:3001', changeOrigin: true },
      '/socket.io': { target: 'http://localhost:3001', ws: true },
    },
  },
  build: { outDir: 'dist', emptyOutDir: true },
});
```

### 1.3 tailwind.config.js
```js
export default {
  content: ['./src/**/*.{js,jsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        alec: { 900: '#0a0a14', 800: '#12121f', 700: '#1a1a2e', accent: '#6c63ff' },
      },
    },
  },
};
```

### 1.4 src/index.css
```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

### 1.5 src/main.jsx
```jsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
      <Toaster position="bottom-right" toastOptions={{ style: { background: '#1a1a2e', color: '#fff' } }} />
    </BrowserRouter>
  </React.StrictMode>
);
```

### 1.6 Update root package.json scripts
Add `concurrently` as devDep. Scripts:
```json
{
  "dev:backend": "nodemon backend/server.js",
  "dev:frontend": "cd frontend && npm run dev",
  "dev": "concurrently \"npm run dev:backend\" \"npm run dev:frontend\"",
  "build": "cd frontend && npm run build",
  "start": "NODE_ENV=production node backend/server.js"
}
```

### 1.7 Update backend/server.js — production static serving
After all API routes:
```js
if (process.env.NODE_ENV === 'production') {
  const distPath = path.join(__dirname, '../frontend/dist');
  app.use(express.static(distPath));
  app.get('*', (_req, res) => res.sendFile(path.join(distPath, 'index.html')));
}
```

**Verify:** `npm run dev` starts both; http://localhost:5173 shows React root; /api/health proxies correctly.

---

## Task 2 — API Client Layer

All API calls centralized — no raw fetch() in components.

### 2.1 src/api/client.js
```js
const BASE = '/api';

export async function apiFetch(path, opts = {}) {
  const res = await fetch(BASE + path, {
    headers: { 'Content-Type': 'application/json', ...opts.headers },
    ...opts,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || res.statusText);
  }
  return res.json();
}
```

### 2.2 src/api/chat.js
```js
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
  return () => es.close();
}
```

### 2.3 src/api/reports.js
```js
import { apiFetch } from './client';

export const getLoans = () => apiFetch('/reports/loans');
export const getMaturityWall = () => apiFetch('/reports/maturity');
export const getLenderExposure = () => apiFetch('/reports/lenders');
export const getDSCR = () => apiFetch('/reports/dscr');
export const getLTV = () => apiFetch('/reports/ltv');
export const getEquity = () => apiFetch('/reports/equity');
export const downloadReport = (name) => window.open(`/api/download/${encodeURIComponent(name)}`, '_blank');
```

### 2.4 src/api/review.js
```js
import { apiFetch } from './client';

export const getQueue = () => apiFetch('/review/queue');
export const approve = (id) => apiFetch(`/review/${id}/approve`, { method: 'POST' });
export const reject = (id) => apiFetch(`/review/${id}/reject`, { method: 'POST' });
export const getFineTuneStatus = () => apiFetch('/review/finetune/status');
```

### 2.5 src/api/pdf.js
```js
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
```

**Tests:** tests/apiClient.test.js — 5 tests using global.fetch mock; verify each function builds correct path/method.

---

## Task 3 — Layout Shell + Routing

### 3.1 src/App.jsx
```jsx
import { Routes, Route, Navigate } from 'react-router-dom';
import Sidebar from './components/layout/Sidebar';
import TopBar from './components/layout/TopBar';
import Chat from './pages/Chat';
import Dashboard from './pages/Dashboard';
import Finance from './pages/Finance';
import Review from './pages/Review';
import PdfUpload from './pages/PdfUpload';
import Settings from './pages/Settings';

export default function App() {
  return (
    <div className="flex h-screen bg-alec-900 text-white overflow-hidden">
      <Sidebar />
      <div className="flex flex-col flex-1 min-w-0">
        <TopBar />
        <main className="flex-1 overflow-auto">
          <Routes>
            <Route path="/" element={<Navigate to="/chat" replace />} />
            <Route path="/chat" element={<Chat />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/finance" element={<Finance />} />
            <Route path="/review" element={<Review />} />
            <Route path="/pdf" element={<PdfUpload />} />
            <Route path="/settings" element={<Settings />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}
```

### 3.2 Sidebar.jsx
Nav items with icons: Chat, Dashboard, Finance, Review, PDF, Settings.  
Active route: `bg-alec-accent/20 border-l-2 border-alec-accent`.  
Use `useLocation()` from react-router-dom to detect active path.

### 3.3 TopBar.jsx
- Current route title
- Backend health dot (polls GET /api/health every 30s with useEffect cleanup)
- Dark mode toggle (localStorage persisted, applies `dark` class to `<html>`)

**Verify:** All 6 routes render; sidebar highlights correct item; health dot responds to backend status.

---

## Task 4 — Chat Panel

### 4.1 src/store/chatStore.js (Zustand)
```js
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const useChatStore = create(persist(
  (set) => ({
    messages: [],
    sessionId: crypto.randomUUID(),
    isStreaming: false,
    addMessage: (msg) => set((s) => ({ messages: [...s.messages, msg] })),
    updateLastAssistant: (token) => set((s) => {
      const msgs = [...s.messages];
      const last = msgs[msgs.length - 1];
      if (last?.role === 'assistant') msgs[msgs.length - 1] = { ...last, content: last.content + token };
      return { messages: msgs };
    }),
    setStreaming: (v) => set({ isStreaming: v }),
    clearSession: () => set({ messages: [], sessionId: crypto.randomUUID() }),
  }),
  { name: 'alec-chat' }
));
```

### 4.2 ChatPanel.jsx
- Auto-scroll to bottom on new messages (useRef + useEffect on messages.length)
- Textarea: Enter sends, Shift+Enter newlines
- Streaming: call streamMessage(), push assistant placeholder, stream tokens via updateLastAssistant
- Cancel button during streaming (calls the cleanup function from streamMessage)
- TypingIndicator: three bouncing dots, shown while isStreaming and assistant placeholder is empty

### 4.3 MessageBubble.jsx
- User: right-aligned, purple tint
- Assistant: left-aligned, dark bg
- **Markdown rendering**: use DOMPurify.sanitize() on converted HTML — never raw innerHTML without sanitization
  ```jsx
  import DOMPurify from 'dompurify';
  // Simple converter: escape HTML first, then apply code/bold/link patterns
  const safeHtml = DOMPurify.sanitize(markdownToHtml(content));
  // Render via ref.innerHTML = safeHtml (not dangerouslySetInnerHTML with unsanitized content)
  ```
- RagBadge: if content includes `[RAG:` tag, show "📚 RAG sources" pill badge

**Verify:** Send message, streaming works, messages persist on refresh, markdown renders safely.

---

## Task 5 — Finance Panel (Real Estate Debt Dashboard)

Replaces the Plaid brokerage view. All data from /api/reports/*.

### 5.1 Finance.jsx structure
```jsx
const TABS = ['loans', 'maturity', 'lenders', 'dscr', 'ltv', 'equity'];
// State: activeTab, data per tab (lazy-loaded on first tab visit), loading flags
// useEffect on activeTab change: fetch if data not yet loaded
```

### 5.2 LoansTable.jsx
13 columns per spec. Sortable via useState(sortKey, sortDir).  
Row highlights: red border if `daysToMaturity < 90` or `covenantStatus === 'BREACH'`.  
Empty state: "Connect Azure SQL in Settings to view loan data."

### 5.3 MaturityWallChart.jsx
Recharts BarChart. X = quarter label (Q3 2026), Y = $ millions.  
Color fill: `#ef4444` if <90d, `#f59e0b` if <365d, `#22c55e` otherwise.

### 5.4 LenderExposureChart.jsx
Recharts PieChart + Legend. Tooltip: lender name, total balance, % of portfolio.

### 5.5 DSCRTable, LTVTable, EquityTable
Simple sorted tables.  
DSCR: red if < 1.20.  
LTV: red if > 75%.  
Equity: shows commitment / funded / unfunded columns.

### 5.6 ReportDownloadBar.jsx
Row of 6 buttons. Each calls `downloadReport(reportName)` from api/reports.js.  
Shows toast notification on click: "Generating report…"

**Verify:** All 6 tabs load; empty states show when backend returns []; download buttons open correct paths.

---

## Task 6 — Review Panel

### 6.1 src/store/reviewStore.js (Zustand)
```js
import { create } from 'zustand';
import { getQueue, approve, reject, getFineTuneStatus } from '../api/review';

export const useReviewStore = create((set) => ({
  queue: [],
  status: null,
  load: async () => {
    const [queue, status] = await Promise.all([getQueue(), getFineTuneStatus()]);
    set({ queue, status });
  },
  handleApprove: async (id) => {
    await approve(id);
    set((s) => ({ queue: s.queue.filter((c) => c.id !== id) }));
  },
  handleReject: async (id) => {
    await reject(id);
    set((s) => ({ queue: s.queue.filter((c) => c.id !== id) }));
  },
}));
```

### 6.2 FineTuneStatusBar.jsx
Shows: last run | eval score badge | active model version | examples until next trigger.

### 6.3 ReviewCard.jsx
User prompt + ALEC response, side by side. Quality score pill (green ≥0.75, amber 0.40–0.74, red <0.40).  
Keyboard shortcuts via useEffect: `a` = approve focused card, `r` = reject.

**Verify:** Queue loads, approve/reject removes card and updates store, status bar reflects API response.

---

## Task 7 — PDF Upload Panel

### 7.1 PdfUpload.jsx
react-dropzone drag zone. Accepted: `application/pdf`. Max 50MB.  
On drop: call uploadPdf(file), show progress (fake 0→80% during upload, 100% on response).  
On success: call getPdfSummary(docUuid), render PdfSummaryCard.

### 7.2 PdfSummaryCard.jsx
Two columns: extracted text preview (first 500 chars) | entities table (type, value, confidence).  
"Ask ALEC about this document" button: navigates to /chat and pre-fills input via chatStore.

**Verify:** Upload test PDF, entities appear, "Ask ALEC" pre-fills chat.

---

## Task 8 — Dashboard Panel

### 8.1 Dashboard.jsx
Four StatCards: Total Loan Exposure | Avg DSCR | Avg LTV | Loans Maturing <90d.  
Each fetches from the corresponding /api/reports/* endpoint, extracts summary value.

Two QuickAction cards:
- "Run Loans Report" → downloadReport('loans')
- "Sync STOA Brain" → POST /api/webhooks/github/sync, toast on success

Activity feed: last 10 review queue items with approve/reject status badges.

**Verify:** Stats render; quick actions fire toast confirmations; activity feed loads.

---

## Task 9 — Settings Panel

### 9.1 PlaidLinkSection.jsx
Plaid Link flow using existing backend Plaid endpoints. Lists linked accounts below button.

### 9.2 Preference toggles (localStorage persisted)
- Dark mode (syncs with TopBar toggle via shared localStorage key)
- Streaming vs. blocking chat mode
- RAG context injection on/off (sends `X-RAG-Enabled: false` header to /api/chat when off)
- Message sound notification

**Verify:** Plaid link works; toggles persist on refresh; dark mode toggle in TopBar stays in sync with Settings toggle.

---

## Task 10 — Backend: /api/download + Manual Sync Endpoint

### 10.1 GET /api/download/:filename
```js
app.get('/api/download/:filename', (req, res) => {
  // path.basename strips any path traversal attempts
  const safe = path.basename(req.params.filename);
  const filePath = path.join(__dirname, '../tmp/reports', safe);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Not found' });
  res.download(filePath);
});
```

### 10.2 POST /api/webhooks/github/sync (manual trigger)
```js
app.post('/api/webhooks/github/sync', async (_req, res) => {
  try {
    const result = stoaBrainSync ? await stoaBrainSync.fullSync() : { indexed: 0, skipped: 0 };
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
```

**Tests:** tests/downloadRoute.test.js — 3 tests (file exists returns stream, missing returns 404, basename sanitization strips `../`).

---

## Task 11 — Final Integration Verify

### 11.1 Full test suite
```bash
npm test -- --forceExit
```
Target: all suites green.

### 11.2 Production build
```bash
npm run build
NODE_ENV=production node backend/server.js
# http://localhost:3001 serves React app from frontend/dist
```

### 11.3 Smoke test checklist
- [ ] Chat: send message, see streaming tokens
- [ ] Finance: all 6 tabs load (empty states acceptable without Azure SQL)
- [ ] Review: queue loads, approve/reject works
- [ ] PDF: upload test PDF, entities render
- [ ] Dashboard: stat cards render, sync button toasts
- [ ] Settings: dark mode persists on refresh

---

## Hard Rules for This Plan

- **No Plaid UI in Finance panel** — Plaid lives in Settings only
- **Finance data from /api/reports/* only** — no hardcoded numbers in components
- **All markdown rendered via DOMPurify** — never raw HTML from LLM without sanitization
- **Download buttons use /api/download/:filename** — path.basename enforced server-side
- **Chat streaming uses EventSource** — not polling, not WebSocket
- **useEffect cleanup functions required** — EventSource and setInterval must return cleanup to prevent leaks

---

## Implementation Sequence

| Phase | Tasks | Mode |
|-------|-------|------|
| 1 | Tasks 1–2 (scaffold + API layer) | Sequential, single subagent |
| 2 | Tasks 3, 4, 5 (layout, chat, finance) | Parallel, 3 subagents |
| 3 | Tasks 6, 7, 8, 9, 10 (review, pdf, dashboard, settings, backend) | Parallel, 5 subagents |
| 4 | Task 11 (final verify) | Single subagent |
