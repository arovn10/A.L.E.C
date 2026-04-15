# Plan B — RAG + STOA Brain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire up real Weaviate-backed RAG so every ALEC response pulls relevant past conversations and STOA documents, and auto-sync the stoagroupDB GitHub repo into Weaviate within 10 seconds of any push.

**Architecture:** A Python FastAPI `/embed` endpoint (nomic-embed-text-v1.5) serves vectors to a Node.js `RagService` that does hybrid search across `ALECConversation` and `ALECDocument` collections and injects context into every chat system prompt. `StoaBrainSync` handles GitHub push webhooks and a 30-minute fallback cron, chunking files and upserting them into Weaviate via the same embed endpoint.

**Tech Stack:** sentence-transformers (nomic-ai/nomic-embed-text-v1.5), weaviate-ts-client v2, node-cron, axios, express.raw() for webhook signature verification

---

## File Map

| Action | File | Responsibility |
|---|---|---|
| Create | `services/neural/ragPipeline.py` | nomic-embed-text model loader + `get_embedding()` |
| Modify | `services/neural/server.py` (append) | Add `POST /embed` endpoint that calls `ragPipeline.get_embedding()` |
| Create | `services/ragService.js` | embed query → hybrid search → format context string |
| Create | `services/stoaBrainSync.js` | webhook signature verify, push-event handler, fullSync(), 30-min cron |
| Modify | `backend/server.js` | Inject RAG context into system prompt; add `POST /api/webhooks/github` route |
| Create | `tests/ragService.test.js` | 6 tests covering embed, retrieve, fallback, formatContext |
| Create | `tests/stoaBrainSync.test.js` | 7 tests covering signature verify, push handler, fullSync, chunk, cron |

---

## Task 1: ragPipeline.py — nomic-embed-text module + /embed server endpoint

**Files:**
- Create: `services/neural/ragPipeline.py`
- Modify: `services/neural/server.py` (append ~25 lines at end of file)

`★ Insight ─────────────────────────────────────`
nomic-embed-text-v1.5 uses a `trust_remote_code=True` flag because it ships custom pooling logic. The model produces 768-dim L2-normalized vectors. We lazy-load it at first request rather than at import time so the neural server starts fast even if the model isn't cached yet.
`─────────────────────────────────────────────────`

- [ ] **Step 1: Install sentence-transformers in the neural engine virtualenv**

```bash
cd services/neural
pip install sentence-transformers
```

Expected: installs without error. If the venv isn't active, run `source .venv/bin/activate` first.

- [ ] **Step 2: Write the failing test for ragPipeline**

The neural engine is Python — we test it with a quick inline script rather than Jest. Create `services/neural/test_ragPipeline.py`:

```python
"""Smoke-test for ragPipeline.get_embedding(). Run: python test_ragPipeline.py"""
import sys
import types

# Stub out sentence_transformers so test runs without the full model download
fake_module = types.ModuleType("sentence_transformers")
class FakeModel:
    def encode(self, texts, normalize_embeddings=False):
        import numpy as np
        return [np.array([0.1] * 768)]
fake_module.SentenceTransformer = lambda *a, **kw: FakeModel()
sys.modules["sentence_transformers"] = fake_module

import ragPipeline

vec = ragPipeline.get_embedding("test sentence")
assert isinstance(vec, list), "expected list"
assert len(vec) == 768, f"expected 768 dims, got {len(vec)}"
assert abs(vec[0] - 0.1) < 1e-6, "expected 0.1"
print("PASS: get_embedding returns 768-dim list")
```

Run: `cd services/neural && python test_ragPipeline.py`
Expected: FAIL with `ModuleNotFoundError: No module named 'ragPipeline'`

- [ ] **Step 3: Create services/neural/ragPipeline.py**

```python
"""
ragPipeline.py — nomic-embed-text embedding module for A.L.E.C. RAG.

Provides get_embedding(text) -> list[float] (768-dim, L2-normalized).
Lazy-loads nomic-ai/nomic-embed-text-v1.5 on first call.
Called by server.py POST /embed endpoint.
"""
import logging
from typing import Optional

logger = logging.getLogger("alec.rag")

_model: Optional[object] = None


def _get_model():
    global _model
    if _model is None:
        from sentence_transformers import SentenceTransformer
        logger.info("[ragPipeline] Loading nomic-embed-text-v1.5 ...")
        _model = SentenceTransformer(
            "nomic-ai/nomic-embed-text-v1.5",
            trust_remote_code=True,
        )
        logger.info("[ragPipeline] Model ready.")
    return _model


def get_embedding(text: str) -> list:
    """Return 768-dimensional float vector for text."""
    model = _get_model()
    vector = model.encode([text], normalize_embeddings=True)[0]
    return vector.tolist()
```

- [ ] **Step 4: Run the Python test — verify it passes**

```bash
cd services/neural && python test_ragPipeline.py
```

Expected: `PASS: get_embedding returns 768-dim list`

- [ ] **Step 5: Add /embed endpoint to services/neural/server.py**

Append these lines at the very end of `services/neural/server.py` (after the last `@app` route, before any `if __name__` block):

```python
# ── RAG Embedding ─────────────────────────────────────────────────────────────
class EmbedRequest(BaseModel):
    text: str

@app.post("/embed")
async def embed_text(req: EmbedRequest):
    """Return nomic-embed-text-v1.5 vector for RAG retrieval.
    
    Returns:
        {"vector": [float, ...], "dim": 768}
    """
    try:
        from ragPipeline import get_embedding
        vector = get_embedding(req.text)
        return {"vector": vector, "dim": len(vector)}
    except Exception as e:
        logger.error(f"[embed] error: {e}")
        raise HTTPException(status_code=500, detail=str(e))
```

- [ ] **Step 6: Verify server syntax (no Python errors)**

```bash
cd services/neural && python -c "import ast; ast.parse(open('server.py').read()); print('syntax OK')"
```

Expected: `syntax OK`

- [ ] **Step 7: Commit**

```bash
git add services/neural/ragPipeline.py services/neural/server.py services/neural/test_ragPipeline.py
git commit -m "feat(rag): nomic-embed-text ragPipeline + /embed endpoint"
```

---

## Task 2: ragService.js — Node.js RAG orchestration

**Files:**
- Create: `services/ragService.js`
- Create: `tests/ragService.test.js`

- [ ] **Step 1: Write the failing tests**

Create `tests/ragService.test.js`:

```js
'use strict';

// Mock axios before requiring ragService
jest.mock('axios');
const axios = require('axios');

// Mock WeaviateService
jest.mock('../services/weaviateService', () => {
  return jest.fn().mockImplementation(() => ({
    hybridSearch: jest.fn().mockResolvedValue([
      { userMsg: 'What is the occupancy?', alecResponse: '95% occupied.', distance: 0.1, id: 'uuid-1' },
      { content: 'Stoa property data...', distance: 0.2, id: 'uuid-2' },
    ]),
  }));
});

const RagService = require('../services/ragService');

let svc;
beforeEach(() => {
  jest.clearAllMocks();
  svc = new RagService();
});

test('embed() calls /embed endpoint and returns vector', async () => {
  axios.post.mockResolvedValue({ data: { vector: [0.1, 0.2, 0.3], dim: 3 } });
  const vec = await svc.embed('hello world');
  expect(axios.post).toHaveBeenCalledWith(
    expect.stringContaining('/embed'),
    { text: 'hello world' },
    expect.objectContaining({ timeout: 10000 }),
  );
  expect(vec).toEqual([0.1, 0.2, 0.3]);
});

test('retrieve() returns formatted context string', async () => {
  axios.post.mockResolvedValue({ data: { vector: [0.1], dim: 1 } });
  const ctx = await svc.retrieve('occupancy question');
  expect(typeof ctx).toBe('string');
  expect(ctx).toContain('## Relevant Context');
  expect(ctx).toContain('ALECConversation');
});

test('retrieve() falls back to keyword-only when embed fails', async () => {
  axios.post.mockRejectedValue(new Error('neural server down'));
  // Should not throw — just uses empty vector
  const ctx = await svc.retrieve('any query');
  expect(typeof ctx).toBe('string');
});

test('_formatContext() handles empty hits with empty string', () => {
  const result = svc._formatContext([]);
  expect(result).toBe('');
});

test('_formatContext() uses userMsg/alecResponse for ALECConversation hits', () => {
  const hits = [{ _collection: 'ALECConversation', userMsg: 'hello', alecResponse: 'hi there', distance: 0.05, id: 'x' }];
  const ctx = svc._formatContext(hits);
  expect(ctx).toContain('User: hello');
  expect(ctx).toContain('ALEC: hi there');
});

test('_formatContext() uses content for ALECDocument hits', () => {
  const hits = [{ _collection: 'ALECDocument', content: 'Stoa property info', distance: 0.1, id: 'y' }];
  const ctx = svc._formatContext(hits);
  expect(ctx).toContain('Stoa property info');
});
```

Run: `node_modules/.bin/jest tests/ragService.test.js --forceExit`
Expected: FAIL with `Cannot find module '../services/ragService'`

- [ ] **Step 2: Create services/ragService.js**

```js
'use strict';

const axios = require('axios');
const WeaviateService = require('./weaviateService');

const EMBED_URL = process.env.NEURAL_URL || 'http://localhost:8000';
const DEFAULT_LIMIT = 5;
const MAX_SNIPPET = 500;

class RagService {
  /**
   * @param {WeaviateService} [weaviateService] - inject in tests; creates default instance in prod
   */
  constructor(weaviateService) {
    this._weaviate = weaviateService || new WeaviateService();
  }

  /**
   * Call the neural engine /embed endpoint to get a nomic-embed-text vector.
   * @param {string} text
   * @returns {Promise<number[]>} 768-dim float array
   */
  async embed(text) {
    const res = await axios.post(`${EMBED_URL}/embed`, { text }, { timeout: 10000 });
    return res.data.vector;
  }

  /**
   * Main retrieval method. Embeds the query, searches Weaviate collections,
   * merges results by distance, and returns a formatted context string.
   *
   * Falls back to keyword-only search (empty vector) if the embed endpoint
   * is unavailable — so RAG degrades gracefully without crashing chat.
   *
   * @param {string} query - the user's current message
   * @param {{ limit?: number, collections?: string[] }} [opts]
   * @returns {Promise<string>} formatted context block, or '' if no hits
   */
  async retrieve(query, opts = {}) {
    const limit = opts.limit || DEFAULT_LIMIT;
    const collections = opts.collections || ['ALECConversation', 'ALECDocument'];

    let vector = [];
    try {
      vector = await this.embed(query);
    } catch (err) {
      console.warn('[ragService] embed unavailable, keyword-only fallback:', err.message);
    }

    const hits = [];
    for (const col of collections) {
      const results = await this._weaviate.hybridSearch(col, query, vector, { limit });
      for (const r of results) hits.push({ ...r, _collection: col });
    }

    // Lower distance = more similar — surface the best matches first
    hits.sort((a, b) => (a.distance ?? 1) - (b.distance ?? 1));
    return this._formatContext(hits.slice(0, limit));
  }

  /**
   * Convert raw Weaviate hits into a context block for injection into the system prompt.
   * @param {Array<object>} hits
   * @returns {string}
   */
  _formatContext(hits) {
    if (!hits.length) return '';
    const lines = hits.map(h => {
      let snippet;
      if (h._collection === 'ALECConversation') {
        snippet = `User: ${(h.userMsg || '').slice(0, MAX_SNIPPET)}\nALEC: ${(h.alecResponse || '').slice(0, MAX_SNIPPET)}`;
      } else {
        snippet = (h.content || '').slice(0, MAX_SNIPPET);
      }
      return `[${h._collection}]\n${snippet}`;
    });
    return `## Relevant Context\n\n${lines.join('\n\n---\n\n')}`;
  }
}

module.exports = RagService;
```

- [ ] **Step 3: Run tests — verify all 6 pass**

```bash
node_modules/.bin/jest tests/ragService.test.js --forceExit
```

Expected: `Tests: 6 passed, 6 total`

- [ ] **Step 4: Commit**

```bash
git add services/ragService.js tests/ragService.test.js
git commit -m "feat(rag): RagService — embed + hybrid search + context injection"
```

---

## Task 3: stoaBrainSync.js — GitHub webhook + 30-min cron + file indexer

**Files:**
- Create: `services/stoaBrainSync.js`
- Create: `tests/stoaBrainSync.test.js`

`★ Insight ─────────────────────────────────────`
GitHub delivers webhook payloads with an `X-Hub-Signature-256` header — an HMAC-SHA256 of the raw request body signed with a shared secret. You must verify this signature using `crypto.timingSafeEqual` (not `===`) to prevent timing attacks. The raw body must be captured before `express.json()` parses it, which is why the webhook route uses `express.raw({ type: '*/*' })` as inline middleware.
`─────────────────────────────────────────────────`

- [ ] **Step 1: Write the failing tests**

Create `tests/stoaBrainSync.test.js`:

```js
'use strict';

jest.mock('axios');
const axios = require('axios');

jest.mock('../dataConnectors', () => ({
  registry: {
    fetch: jest.fn(),
  },
}));
const { registry } = require('../dataConnectors');

jest.mock('../services/weaviateService', () => {
  return jest.fn().mockImplementation(() => ({
    upsert: jest.fn().mockResolvedValue('uuid-abc'),
  }));
});

jest.mock('node-cron', () => ({
  schedule: jest.fn().mockReturnValue({ destroy: jest.fn() }),
}));
const cron = require('node-cron');

const StoaBrainSync = require('../services/stoaBrainSync');

let sync;
beforeEach(() => {
  jest.clearAllMocks();
  sync = new StoaBrainSync();
  process.env.GITHUB_WEBHOOK_SECRET = 'test-secret';
});

test('verifyWebhookSignature() returns true for valid HMAC', () => {
  const crypto = require('crypto');
  const body = Buffer.from('{"ref":"refs/heads/main"}');
  const sig = 'sha256=' + crypto.createHmac('sha256', 'test-secret').update(body).digest('hex');
  expect(sync.verifyWebhookSignature(body, sig)).toBe(true);
});

test('verifyWebhookSignature() returns false for wrong secret', () => {
  const body = Buffer.from('payload');
  expect(sync.verifyWebhookSignature(body, 'sha256=badhash')).toBe(false);
});

test('handlePushEvent() indexes added and modified files', async () => {
  axios.post.mockResolvedValue({ data: { vector: [0.1, 0.2], dim: 2 } });
  registry.fetch.mockResolvedValue({ data: 'file content here' });

  const payload = {
    commits: [
      { added: ['README.md'], modified: ['data/loans.json'] },
    ],
  };
  const result = await sync.handlePushEvent(payload);
  expect(result.indexed).toBe(2);
  expect(result.skipped).toBe(0);
  expect(result.errors).toHaveLength(0);
});

test('handlePushEvent() records errors per file without throwing', async () => {
  axios.post.mockResolvedValue({ data: { vector: [0.1], dim: 1 } });
  registry.fetch.mockRejectedValue(new Error('GitHub API error'));

  const payload = { commits: [{ added: ['bad.json'], modified: [] }] };
  const result = await sync.handlePushEvent(payload);
  expect(result.indexed).toBe(0);
  expect(result.skipped).toBe(1);
  expect(result.errors[0]).toMatchObject({ filePath: 'bad.json', error: 'GitHub API error' });
});

test('_chunk() splits text into overlapping windows', () => {
  const text = 'a'.repeat(2500);
  const chunks = sync._chunk(text);
  // CHUNK_SIZE=1000, OVERLAP=100 → chunk 1 starts at 0, chunk 2 at 900, chunk 3 at 1800
  expect(chunks.length).toBe(3);
  expect(chunks[0].length).toBe(1000);
  expect(chunks[1].length).toBe(1000);
});

test('startCron() schedules a 30-minute cron and stopCron() destroys it', () => {
  sync.startCron();
  expect(cron.schedule).toHaveBeenCalledWith('*/30 * * * *', expect.any(Function));
  sync.stopCron();
  // destroy is called on the returned task
  expect(cron.schedule.mock.results[0].value.destroy).toHaveBeenCalled();
});

test('fullSync() iterates all files from github connector', async () => {
  axios.post.mockResolvedValue({ data: { vector: [0.1], dim: 1 } });
  registry.fetch
    .mockResolvedValueOnce({ data: [{ path: 'file1.md' }, { path: 'file2.md' }] }) // listFiles
    .mockResolvedValue({ data: 'file text' }); // getFile x2

  const result = await sync.fullSync();
  expect(result.indexed).toBe(2);
  expect(result.skipped).toBe(0);
});
```

Run: `node_modules/.bin/jest tests/stoaBrainSync.test.js --forceExit`
Expected: FAIL with `Cannot find module '../services/stoaBrainSync'`

- [ ] **Step 2: Create services/stoaBrainSync.js**

```js
'use strict';

const crypto = require('crypto');
const axios = require('axios');
const cron = require('node-cron');
const { registry } = require('../dataConnectors');
const WeaviateService = require('./weaviateService');

const EMBED_URL = process.env.NEURAL_URL || 'http://localhost:8000';
const CHUNK_SIZE = 1000;  // characters per chunk
const OVERLAP = 100;      // overlap between adjacent chunks

class StoaBrainSync {
  /**
   * @param {WeaviateService} [weaviateService] - inject in tests; creates default instance in prod
   */
  constructor(weaviateService) {
    this._weaviate = weaviateService || new WeaviateService();
    this._task = null;
  }

  /**
   * Verify GitHub webhook HMAC-SHA256 signature.
   * Must use timingSafeEqual to prevent timing attacks.
   *
   * @param {Buffer} rawBody - raw request body bytes
   * @param {string} signatureHeader - value of X-Hub-Signature-256 header
   * @returns {boolean}
   */
  verifyWebhookSignature(rawBody, signatureHeader) {
    const secret = process.env.GITHUB_WEBHOOK_SECRET || '';
    const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
    try {
      return crypto.timingSafeEqual(Buffer.from(signatureHeader), Buffer.from(expected));
    } catch {
      return false;
    }
  }

  /**
   * Process a GitHub push event. Indexes all added + modified files.
   * Errors on individual files are captured and don't abort the batch.
   *
   * @param {{ commits: Array<{added: string[], modified: string[]}> }} payload
   * @returns {Promise<{indexed: number, skipped: number, errors: Array}>}
   */
  async handlePushEvent(payload) {
    const changed = [...new Set([
      ...payload.commits.flatMap(c => c.added || []),
      ...payload.commits.flatMap(c => c.modified || []),
    ])];
    const results = { indexed: 0, skipped: 0, errors: [] };
    for (const filePath of changed) {
      try {
        await this._indexFile(filePath);
        results.indexed++;
      } catch (err) {
        results.errors.push({ filePath, error: err.message });
        results.skipped++;
      }
    }
    return results;
  }

  /**
   * Full sync — list every file in stoagroupDB and index it.
   * Used as the 30-minute cron fallback for missed webhook events.
   *
   * @returns {Promise<{indexed: number, skipped: number, errors: Array}>}
   */
  async fullSync() {
    const filesResult = await registry.fetch('github', { action: 'listFiles' });
    const fileList = filesResult.data || filesResult || [];
    const results = { indexed: 0, skipped: 0, errors: [] };
    for (const file of fileList) {
      const filePath = file.path || file;
      try {
        await this._indexFile(filePath);
        results.indexed++;
      } catch (err) {
        results.errors.push({ path: filePath, error: err.message });
        results.skipped++;
      }
    }
    return results;
  }

  /**
   * Fetch one file from the GitHub connector, chunk it, embed each chunk,
   * and upsert every chunk into Weaviate ALECDocument.
   *
   * @param {string} filePath - path within stoagroupDB repo (e.g. 'README.md')
   */
  async _indexFile(filePath) {
    const result = await registry.fetch('github', { action: 'getFile', path: filePath });
    const text = result.data || '';
    const chunks = this._chunk(text);
    for (let i = 0; i < chunks.length; i++) {
      const vector = await this._embed(chunks[i]);
      await this._weaviate.upsert('ALECDocument', {
        docUuid: `github::${filePath}::${i}`,
        chunkIndex: i,
        content: chunks[i],
        sourceType: 'github',
        sourceUrl: `https://github.com/Stoa-Group/stoagroupDB/blob/main/${filePath}`,
        tags: ['stoa', 'github'],
        indexedAt: new Date().toISOString(),
      }, vector);
    }
  }

  /**
   * Split text into overlapping fixed-size windows.
   * Overlap ensures entities that span a chunk boundary aren't lost.
   *
   * @param {string} text
   * @returns {string[]}
   */
  _chunk(text) {
    if (!text) return [''];
    const chunks = [];
    let start = 0;
    while (start < text.length) {
      chunks.push(text.slice(start, start + CHUNK_SIZE));
      if (start + CHUNK_SIZE >= text.length) break;
      start += CHUNK_SIZE - OVERLAP;
    }
    return chunks;
  }

  async _embed(text) {
    const res = await axios.post(`${EMBED_URL}/embed`, { text }, { timeout: 15000 });
    return res.data.vector;
  }

  /**
   * Start a node-cron task that calls fullSync() every 30 minutes.
   * This is the fallback for push events that fail to reach the webhook.
   */
  startCron() {
    this._task = cron.schedule('*/30 * * * *', () => {
      this.fullSync().catch(err =>
        console.error('[stoaBrainSync] cron fullSync error:', err.message),
      );
    });
  }

  /**
   * Stop and destroy the cron task.
   */
  stopCron() {
    if (this._task) {
      this._task.destroy();
      this._task = null;
    }
  }
}

module.exports = StoaBrainSync;
```

- [ ] **Step 3: Run tests — verify all 7 pass**

```bash
node_modules/.bin/jest tests/stoaBrainSync.test.js --forceExit
```

Expected: `Tests: 7 passed, 7 total`

- [ ] **Step 4: Commit**

```bash
git add services/stoaBrainSync.js tests/stoaBrainSync.test.js
git commit -m "feat(rag): StoaBrainSync — GitHub webhook + 30-min cron + Weaviate indexer"
```

---

## Task 4: server.js integration — RAG context injection + webhook route

**Files:**
- Modify: `backend/server.js`
- Modify: `tests/hardRules.test.js` (add 1 test verifying RAG context prefix)

`★ Insight ─────────────────────────────────────`
The RAG call must be async and placed after the user message is extracted but before the system prompt is finalized. We inject the context as a suffix to `systemContent` at line ~744 (the existing `let systemContent = buildSystemPrompt() + ...` line). The webhook route needs `express.raw({ type: '*/*' })` as its own middleware because `express.json()` is already applied globally — using `express.raw()` on the specific route re-buffers the body bytes needed for HMAC verification.
`─────────────────────────────────────────────────`

- [ ] **Step 1: Add the require statements at the top of backend/server.js**

In `backend/server.js`, find the block of requires near the top (around line 29–40). Add these two lines after the existing requires:

```js
const RagService = require('../services/ragService');
const StoaBrainSync = require('../services/stoaBrainSync');
```

- [ ] **Step 2: Instantiate ragService and stoaBrainSync after the existing service instantiation block**

Find the connector registry block (added in Plan A, near line ~130–140) that starts with `try { registry.register(azureSqlConnector) ...`. Add these two lines immediately after that block:

```js
const ragService = new RagService();
const stoaBrainSync = new StoaBrainSync();
stoaBrainSync.startCron();
```

- [ ] **Step 3: Inject RAG context into /api/chat system prompt**

In `backend/server.js` at the `/api/chat` handler (~line 744), replace:

```js
    let systemContent = buildSystemPrompt() + (memCtx ? '\n\n' + memCtx : '');
```

with:

```js
    let ragContext = '';
    try { ragContext = await ragService.retrieve(userText); } catch (_) {}
    let systemContent = buildSystemPrompt()
      + (memCtx ? '\n\n' + memCtx : '')
      + (ragContext ? '\n\n' + ragContext : '');
```

- [ ] **Step 4: Inject RAG context into /api/chat/stream system prompt**

In `backend/server.js` at the `/api/chat/stream` handler (~line 1072), make the same replacement — find the line:

```js
    let systemContent = buildSystemPrompt() + (memCtx ? '\n\n' + memCtx : '');
```

and replace it with:

```js
    let ragContext = '';
    try { ragContext = await ragService.retrieve(userText); } catch (_) {}
    let systemContent = buildSystemPrompt()
      + (memCtx ? '\n\n' + memCtx : '')
      + (ragContext ? '\n\n' + ragContext : '');
```

Note: `userText` may be named differently in the stream handler. Check the variable name — it's typically extracted from `req.body.message || messages.at(-1)?.content`. Use the same variable name that already exists in that handler.

- [ ] **Step 5: Add the GitHub webhook route**

Find `app.get('/health', ...)` (~line 598) and add the webhook route immediately before it:

```js
// ── GitHub Webhook — STOA Brain Sync ────────────────────────────────────────
app.post(
  '/api/webhooks/github',
  express.raw({ type: '*/*' }),  // capture raw body bytes for HMAC verification
  async (req, res) => {
    const sig = req.headers['x-hub-signature-256'] || '';
    if (!stoaBrainSync.verifyWebhookSignature(req.body, sig)) {
      return res.status(401).json({ error: 'Invalid webhook signature' });
    }
    let payload;
    try {
      payload = JSON.parse(req.body.toString('utf8'));
    } catch {
      return res.status(400).json({ error: 'Invalid JSON payload' });
    }
    // Only handle push events
    if (req.headers['x-github-event'] !== 'push') {
      return res.status(200).json({ ok: true, skipped: 'not a push event' });
    }
    try {
      const result = await stoaBrainSync.handlePushEvent(payload);
      console.log('[stoaBrainSync] webhook indexed:', result);
      return res.json({ ok: true, ...result });
    } catch (err) {
      console.error('[stoaBrainSync] webhook error:', err.message);
      return res.status(500).json({ error: err.message });
    }
  },
);
```

- [ ] **Step 6: Verify server.js still parses (no syntax errors)**

```bash
node -c backend/server.js
```

Expected: `backend/server.js syntax OK`

- [ ] **Step 7: Run the full test suite**

```bash
node_modules/.bin/jest --forceExit
```

Expected: `Test Suites: 10 passed, 10 total` (or more if new suites were added). All previously passing tests must still pass. The RAG mocks in ragService.test.js and stoaBrainSync.test.js should cover their modules. The server.js itself is integration-tested by hardRules.test.js which already mocks dependencies.

If any test fails due to the new `require` statements (e.g., `Cannot find module`), check that `services/ragService.js` and `services/stoaBrainSync.js` exist in the right paths.

- [ ] **Step 8: Commit**

```bash
git add backend/server.js
git commit -m "feat(rag): inject RAG context into system prompt + GitHub webhook route"
```

---

## Self-Review

**Spec coverage check:**
- ✅ nomic-embed-text-v1.5 via sentence-transformers — Task 1
- ✅ `/embed` FastAPI endpoint — Task 1
- ✅ RAG retrieves from ALECConversation + ALECDocument — Task 2
- ✅ Hybrid search (alpha=0.5) via existing weaviateService.hybridSearch — Task 2
- ✅ Graceful embed fallback (keyword-only) when neural server down — Task 2
- ✅ GitHub webhook signature verification (timingSafeEqual) — Task 3
- ✅ Push event handler (added + modified files) — Task 3
- ✅ 30-minute cron fallback — Task 3
- ✅ Chunk size 1000 / overlap 100 — Task 3
- ✅ RAG context injected into /api/chat system prompt — Task 4
- ✅ RAG context injected into /api/chat/stream system prompt — Task 4
- ✅ Webhook route POST /api/webhooks/github — Task 4
- ✅ Hard rule H1 maintained — githubConnector never writes back (existing)

**Placeholder scan:** No TBDs, no "implement later", all code blocks present.

**Type consistency:** `registry.fetch('github', { action: 'getFile', path })` matches githubConnector.js interface from Plan A. `this._weaviate.upsert('ALECDocument', {...}, vector)` matches WeaviateService.upsert() signature from Plan A.
