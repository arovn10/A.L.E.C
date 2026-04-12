/**
 * A.L.E.C. LlamaEngine — embedded local inference via node-llama-cpp
 *
 * Uses Apple Metal via node-llama-cpp's own llama.cpp build, which
 * works on macOS 15.4+ where Ollama's ggml Metal init crashes.
 *
 * NOTE: This uses the SAME underlying technology as Ollama (llama.cpp)
 * but embedded directly in Node.js — no separate server, no Metal crash.
 *
 * Model search order (prefers Ollama/HuggingFace over LM Studio):
 *   1. ALEC_MODEL_PATH env var (explicit path to .gguf)
 *   2. ~/.ollama/models/blobs  (Ollama downloaded models)
 *   3. ~/.cache/huggingface/hub (HuggingFace downloaded models)
 *   4. ~/.lmstudio/models/**   (LM Studio fallback)
 */

const path  = require('path');
const fs    = require('fs');
const os    = require('os');

// ── Model discovery ──────────────────────────────────────────────

// HuggingFace model IDs to auto-download if nothing is found locally
const HF_AUTO_DOWNLOAD = process.env.ALEC_HF_MODEL || 'bartowski/Llama-3.2-3B-Instruct-GGUF';
const HF_AUTO_FILE     = process.env.ALEC_HF_FILE  || 'Llama-3.2-3B-Instruct-Q4_K_M.gguf';

// Preferred model filenames (smallest first for speed)
// Model preference order: balance quality vs speed
// HuggingFace models get +3 bonus, so a score of 8 here beats LM Studio score of 10
const PREFER_NAMES = [
  'Meta-Llama-3.1-8B',  // Llama 3.1 8B - excellent quality from HuggingFace
  'Llama-3.2-3B',       // Fast 3B
  'Llama-3.2-1B',       // Tiny
  'llama3.1:8b',        // Ollama alias
  'Nemotron-3-Nano-4B', // Good fast model
  'qwen2.5-3b', 'qwen3.5-9b', 'Qwen3.5-9B',
  'gemma-2-2b', 'phi-3', 'mistral-7b',
];

function scoreModel(filePath) {
  const name = path.basename(filePath).toLowerCase();
  // mmproj / vision encoders are not chat models
  if (name.includes('mmproj') || name.includes('embed') || name.includes('rerank')) return -1;
  // Prefer quantisations that balance quality / speed
  let score = 0;
  if (name.includes('q4_k_m') || name.includes('q4_k_s')) score += 10;
  if (name.includes('q5_k_m')) score += 8;
  if (name.includes('q8_0')) score += 5;
  // Prefer smaller models (faster TTFT)
  PREFER_NAMES.forEach((pref, i) => {
    if (name.includes(pref.toLowerCase())) score += (PREFER_NAMES.length - i) * 2;
  });
  return score;
}

function findModel() {
  // 1. Explicit env override
  if (process.env.ALEC_MODEL_PATH && fs.existsSync(process.env.ALEC_MODEL_PATH)) {
    return process.env.ALEC_MODEL_PATH;
  }

  const candidates = [];

  // 2. Ollama models (GGUF blobs stored in ~/.ollama/models/blobs)
  //    Ollama also stores manifests in ~/.ollama/models/manifests — we find the
  //    corresponding blob via the sha256 digest in the manifest.
  const ollamaBlobs = path.join(os.homedir(), '.ollama', 'models', 'blobs');
  if (fs.existsSync(ollamaBlobs)) {
    try {
      // Ollama blobs are sha256-prefixed files without extension — check size
      for (const f of fs.readdirSync(ollamaBlobs)) {
        const full = path.join(ollamaBlobs, f);
        const stat = fs.statSync(full);
        // GGUF files are > 500MB; skip small metadata blobs
        if (stat.size > 500 * 1024 * 1024) {
          candidates.push({ path: full, score: 5, size: stat.size });
        }
      }
    } catch (_) {}
  }

  // 3. HuggingFace hub cache (~/.cache/huggingface/hub/)
  const hfDir = path.join(os.homedir(), '.cache', 'huggingface', 'hub');
  if (fs.existsSync(hfDir)) {
    const hfFiles = collectGguf(hfDir);
    hfFiles.forEach(item => {
      const p = typeof item === 'string' ? item : item.path;
      try { candidates.push({ path: p, score: scoreModel(p) + 3, size: fs.statSync(p).size }); } catch(_){}
    });
  }

  // 4. LM Studio models (fallback)
  const lmDir = path.join(os.homedir(), '.lmstudio', 'models');
  if (fs.existsSync(lmDir)) {
    const lmFiles = collectGguf(lmDir);
    lmFiles.forEach(item => {
      const p = typeof item === 'string' ? item : item.path;
      try { candidates.push({ path: p, score: scoreModel(p), size: fs.statSync(p).size }); } catch(_){}
    });
  }

  // Sort: highest score wins; break ties by preferring smaller files (faster)
  candidates.sort((a, b) => b.score - a.score || a.size - b.size);
  const valid = candidates.filter(c => c.score >= 0);
  return valid.length ? valid[0].path : null;
}

/**
 * Download a GGUF model from HuggingFace Hub using node-llama-cpp's
 * built-in downloader. Resolves to the local file path.
 */
async function downloadFromHuggingFace(repoId, fileName) {
  console.log(`⬇ Downloading ${repoId}/${fileName} from HuggingFace…`);
  const { getLlama } = await import('node-llama-cpp');
  const llama = await getLlama();
  const { hf } = await import('node-llama-cpp');
  // node-llama-cpp exposes a HuggingFace downloader
  if (typeof hf !== 'undefined' && hf.download) {
    const modelPath = await hf.download({ model: repoId, file: fileName });
    console.log(`✅ Downloaded to: ${modelPath}`);
    return modelPath;
  }
  // Fallback: tell user to use `ollama pull` or download manually
  throw new Error(`Auto-download not available. Run: ollama pull ${repoId} or download ${fileName} manually to ~/.cache/huggingface/hub/`);
}

function findGguf(dir) {
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const nested = findGguf(full);
        if (nested) return nested;
      } else if (entry.name.endsWith('.gguf') && !entry.name.includes('mmproj')) {
        return full;
      }
    }
  } catch (_) {}
  return null;
}

// ── Singleton state ──────────────────────────────────────────────

let _llama   = null;
let _model   = null;
let _loading = false;
let _modelPath = null;

async function getLlamaAndModel() {
  if (_llama && _model) return { llama: _llama, model: _model };
  if (_loading) {
    // Wait for in-progress load
    await new Promise(resolve => {
      const check = setInterval(() => {
        if (!_loading) { clearInterval(check); resolve(); }
      }, 200);
    });
    if (_llama && _model) return { llama: _llama, model: _model };
  }

  _loading = true;
  try {
    const modelPath = findModel();
    if (!modelPath) throw new Error('No GGUF model found. Set ALEC_MODEL_PATH or install a model via LM Studio.');

    console.log(`🦙 Loading model: ${path.basename(modelPath)}`);
    _modelPath = modelPath;

    // ESM dynamic import for node-llama-cpp
    const { getLlama } = await import('node-llama-cpp');
    _llama = await getLlama();
    console.log(`🔥 Inference backend: ${_llama.gpu || 'cpu'}`);

    _model = await _llama.loadModel({ modelPath });
    console.log(`✅ Model ready: ${path.basename(modelPath)}`);
  } finally {
    _loading = false;
  }

  return { llama: _llama, model: _model };
}

// ── Chat session pool ────────────────────────────────────────────
// Each conversation gets its own context. We keep a small pool.
const MAX_CONTEXTS = 4;
const _contexts = []; // { ctx, sequence, lastUsed }

async function getContext(model) {
  // Reuse an idle context
  if (_contexts.length < MAX_CONTEXTS) {
    const ctx = await model.createContext({ contextSize: 4096 });
    const sequence = ctx.getSequence();
    const entry = { ctx, sequence, lastUsed: Date.now() };
    _contexts.push(entry);
    return entry;
  }
  // LRU eviction
  _contexts.sort((a, b) => a.lastUsed - b.lastUsed);
  const entry = _contexts[0];
  entry.lastUsed = Date.now();
  return entry;
}

// ── Public API ───────────────────────────────────────────────────

/**
 * Generate a response (non-streaming).
 * messages: [{ role: 'system'|'user'|'assistant', content: string }]
 */
async function generate(messages, { maxTokens = 1024, temperature = 0.7 } = {}) {
  const { LlamaChatSession } = await import('node-llama-cpp');
  const { model } = await getLlamaAndModel();
  const { sequence } = await getContext(model);

  const systemMsg = messages.find(m => m.role === 'system')?.content || '';
  const chatMsgs  = messages.filter(m => m.role !== 'system');

  const session = new LlamaChatSession({
    contextSequence: sequence,
    systemPrompt: systemMsg,
  });

  // Build a single prompt string from history + last user message
  // node-llama-cpp handles chat templates internally
  const last = chatMsgs[chatMsgs.length - 1];
  if (!last || last.role !== 'user') return 'No user message provided.';

  // For multi-turn, concatenate prior turns as context in the final prompt
  let contextPrefix = '';
  if (chatMsgs.length > 1) {
    const history = chatMsgs.slice(0, -1);
    contextPrefix = history.map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`).join('\n') + '\n';
  }

  const finalPrompt = contextPrefix ? `${contextPrefix}User: ${last.content}` : last.content;
  const reply = await session.prompt(finalPrompt, { maxTokens, temperature });
  return reply.trim() || 'No response generated.';
}

/**
 * Stream tokens via async generator.
 * Yields token strings as they arrive.
 */
async function* generateStream(messages, { maxTokens = 1024, temperature = 0.7 } = {}) {
  const { LlamaChatSession } = await import('node-llama-cpp');
  const { model } = await getLlamaAndModel();
  const { sequence } = await getContext(model);

  const systemMsg = messages.find(m => m.role === 'system')?.content || '';
  const chatMsgs  = messages.filter(m => m.role !== 'system');

  const session = new LlamaChatSession({
    contextSequence: sequence,
    systemPrompt: systemMsg,
  });

  const last = chatMsgs[chatMsgs.length - 1];
  if (!last || last.role !== 'user') return;

  // Multi-turn context prefix
  let contextPrefix = '';
  if (chatMsgs.length > 1) {
    const history = chatMsgs.slice(0, -1);
    contextPrefix = history.map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`).join('\n') + '\n';
  }
  const finalPrompt = contextPrefix ? `${contextPrefix}User: ${last.content}` : last.content;

  const tokenQueue = [];
  let promptDone = false;

  const promptPromise = session.prompt(finalPrompt, {
    maxTokens,
    temperature,
    onToken: (chunk) => {
      tokenQueue.push(model.detokenize(chunk));
    },
  }).then(() => { promptDone = true; }).catch(() => { promptDone = true; });

  // Yield tokens as they arrive, poll every 10ms
  while (!promptDone || tokenQueue.length > 0) {
    if (tokenQueue.length > 0) {
      yield tokenQueue.shift();
    } else {
      await new Promise(r => setTimeout(r, 10));
    }
  }

  // Drain any tokens pushed during the final poll cycle
  while (tokenQueue.length > 0) yield tokenQueue.shift();
}

/**
 * Status info for health endpoint.
 */
function getStatus() {
  return {
    loaded:    !!_model,
    modelPath: _modelPath ? path.basename(_modelPath) : null,
    gpu:       _llama?.gpu || null,
    contexts:  _contexts.length,
  };
}

/**
 * List all available GGUF models on disk (Ollama, HuggingFace, LM Studio).
 */
function listModels() {
  const models = [];
  const searchDirs = [
    { dir: path.join(os.homedir(), '.ollama', 'models'),            source: 'Ollama'      },
    { dir: path.join(os.homedir(), '.cache', 'huggingface', 'hub'), source: 'HuggingFace' },
    { dir: path.join(os.homedir(), '.lmstudio', 'models'),          source: 'LM Studio'   },
    { dir: process.env.ALEC_MODELS_DIR,                             source: 'Custom'      },
  ].filter(d => d.dir && typeof d.dir === 'string');

  for (const { dir, source } of searchDirs) {
    if (!fs.existsSync(dir)) continue;
    const found = collectGguf(dir);
    found.forEach(item => {
      // collectGguf may return objects {name,path,sizeGB} or strings
      const filePath  = typeof item === 'string' ? item : item.path;
      const sizeGB    = typeof item === 'string' ? null : item.sizeGB;
      try {
        const stat = fs.statSync(filePath);
        if (stat.size < 10 * 1024 * 1024) return; // skip tiny non-model files
        models.push({ name: path.basename(filePath), path: filePath, sizeGB: sizeGB || (stat.size / 1e9).toFixed(2), source });
      } catch (_) {}
    });
  }
  // Sort: Ollama first, then by score
  models.sort((a,b) => {
    const srcOrder = { Ollama:0, HuggingFace:1, 'LM Studio':2, Custom:3 };
    return (srcOrder[a.source]||9) - (srcOrder[b.source]||9) || scoreModel(a.path) - scoreModel(b.path);
  });
  return models;
}

function collectGguf(dir, results = []) {
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        collectGguf(full, results);
      } else if (entry.name.endsWith('.gguf') && !entry.name.includes('mmproj')) {
        const stat = fs.statSync(full);
        results.push({ name: entry.name, path: full, sizeGB: (stat.size / 1e9).toFixed(2) });
      }
    }
  } catch (_) {}
  return results;
}

// Warm up the model on startup (non-blocking)
function warmUp() {
  setTimeout(() => {
    getLlamaAndModel().catch(err =>
      console.warn('⚠️  LlamaEngine warm-up failed:', err.message)
    );
  }, 2000); // Wait 2s after server starts
}

module.exports = { generate, generateStream, getStatus, listModels, warmUp, findModel, downloadFromHuggingFace };
