<![CDATA[# A.L.E.C. — Autonomous Language Embedded Cognition

> A self-improving AI agent that runs locally, trains on your data, and gets smarter every day.
> Not a wrapper. Not a chatbot. A proprietary intelligence platform you own completely.

[![CI](https://github.com/arovn10/A.L.E.C/actions/workflows/ci.yml/badge.svg)](https://github.com/arovn10/A.L.E.C/actions/workflows/ci.yml)

---

## What is A.L.E.C.?

A.L.E.C. is a **self-hosted, self-improving AI agent** built on a two-process architecture: a Node.js API server and a Python neural engine running **Qwen2.5-Coder-7B** locally on Apple Silicon. It's not a wrapper around someone else's API — it's a complete AI platform where you own the model weights, the training data, and every inference.

**The 75/25 Architecture:**
- **75%** = Pre-trained Qwen2.5-Coder-7B foundation (downloaded once, ~4.4 GB)
- **25%** = LoRA fine-tuning on your personal data — this IS A.L.E.C.'s brain, and it grows with every conversation

## Features

### Intelligence
- 🧠 **Local LLM Inference** — Qwen2.5-Coder-7B with Metal acceleration on Apple Silicon (30-50 tok/s)
- 🎓 **LoRA Fine-Tuning** — Continuous training on your conversations, files, and database
- 🧠 **Persistent Memory** — Teach it facts once, it remembers forever across all sessions
- 🚫 **No Hallucination Directive** — If it doesn't know, it says so. Facts only.
- 📊 **Self-Analysis** — Analyzes its own performance and identifies weaknesses

### Dashboard
- 💬 **Chat** — Claude-like interface with file upload, feedback (thumbs up/down), latency tracking
- 📊 **Metrics** — Real-time engine stats, conversation analytics, training history
- 📁 **Files** — Drag-and-drop upload, convert files to training data
- 🏋️ **Training** — Start LoRA runs, track loss/progress, manage adapters
- 🔌 **Skills** — MCP skill browser and installer
- 🗄️ **Stoa Data** — Live connection to Azure SQL with 109 tables of real estate data
- 📋 **Tasks** — Background task monitor (Stoa sync, auto-training, file scanning)
- 🧠 **Memory** — Teach A.L.E.C. facts, search its knowledge base, manage memories
- ⚙️ **Settings** — Personality config, user management, system status

### Autonomy
- 🔍 **Filesystem Scanner** — Proactively scans your machine for new files to learn from
- 📈 **Auto-Training** — Triggers LoRA retraining when enough rated conversations accumulate
- 🗄️ **Stoa DB Sync** — Pulls real estate data every 6 hours and generates training examples
- 💡 **MCP Discovery** — Suggests new tools and skills to expand its capabilities
- 📝 **Excel Engine** — Read, write, edit, and export Excel/CSV files

### Access & Security
- 🔐 **Admin Auth** — bcrypt-hashed passwords, JWT tokens, role-based access
- 👥 **User Management** — Owner creates accounts, assigns roles (admin/editor/viewer)
- 🏢 **Domo Integration** — Auto-auth for Stoa Group employees via Domo embeds
- 🌐 **LAN + Tailscale** — Access from any device on your network or remotely
- 🖥️ **VS Code Agent** — Use A.L.E.C. as a local coding assistant via Continue.dev

## Architecture

```
┌─────────────────┐     ┌──────────────────────────────────────┐
│  Browser / Phone │────▶│  Node.js Express (port 3001)          │
│  Dashboard UI    │◀────│  Auth, file upload, API routing       │
└─────────────────┘     └──────────────┬───────────────────────┘
                                        │ HTTP
                        ┌──────────────▼───────────────────────┐
                        │  Python FastAPI (port 8000)           │
                        │  ├── engine.py     (LLM inference)    │
                        │  ├── memory.py     (persistent recall)│
                        │  ├── training.py   (LoRA fine-tuning) │
                        │  ├── initiative.py (autonomous agent) │
                        │  ├── stoa.py       (Azure SQL conn)   │
                        │  ├── excel.py      (spreadsheets)     │
                        │  ├── tasks.py      (background jobs)  │
                        │  └── personality.py (directive/voice)  │
                        └──────────────────────────────────────┘
                                        │
                   ┌────────────────────┼────────────────────┐
                   │                    │                     │
            ┌──────▼──────┐  ┌──────────▼────────┐  ┌───────▼───────┐
            │  SQLite      │  │  Azure SQL (Stoa)  │  │  GGUF Model   │
            │  data/alec.db│  │  109 tables         │  │  + LoRA       │
            └─────────────┘  └───────────────────┘  └───────────────┘
```

## Quick Start

```bash
git clone https://github.com/arovn10/A.L.E.C.git
cd A.L.E.C
cp .env.example .env          # Edit with your credentials
bash scripts/setup-local.sh   # Installs everything + downloads model (~4.4 GB)
bash scripts/start-alec.sh    # Launches both servers
```

Open `http://localhost:3001` and log in.

### Requirements
- **macOS** (Apple Silicon recommended, Intel supported with CPU inference)
- **Node.js 18+**
- **Python 3.11+**
- **8 GB+ RAM** (16 GB+ recommended)
- **6 GB disk** for the model

### Hardware Performance

| Machine | GPU Layers | Tokens/sec | Notes |
|---------|-----------|------------|-------|
| MacBook Pro M5 Max (64 GB) | -1 (all Metal) | 30-50 | Primary target |
| MacBook Pro M1/M2/M3 (16 GB+) | -1 (all Metal) | 20-40 | Works great |
| MacBook Pro Intel i9 + AMD 5600M | 0 (CPU only) | 5-10 | Functional, slower |
| Future: Threadripper + RTX 5080 | -1 (CUDA) | 50-80 | Planned build |

## Project Structure

```
A.L.E.C/
├── backend/server.js           # Express API (1,200+ lines)
├── frontend/                   # Dashboard UI (3,700+ lines)
│   ├── index.html              # 9-panel dashboard layout
│   ├── app.js                  # All panel logic, auth, polling
│   └── styles.css              # Dark theme, glass morphism
├── services/neural/            # Python neural engine (3,100+ lines)
│   ├── server.py               # FastAPI with 40+ endpoints
│   ├── engine.py               # llama-cpp-python inference
│   ├── memory.py               # Persistent memory (FTS5 search)
│   ├── training.py             # LoRA fine-tuning pipeline
│   ├── initiative.py           # Autonomous file scanner + self-analysis
│   ├── personality.py          # Directive, voice, no-hallucination rules
│   ├── stoa.py                 # Stoa Group Azure SQL connector
│   ├── excel.py                # Excel read/write/edit/export
│   ├── tasks.py                # Background task scheduler
│   ├── database.py             # Azure SQL + SQLite dual-mode
│   └── auth.py                 # Admin auth + user management
├── scripts/
│   ├── setup-local.sh          # First-time setup
│   ├── start-alec.sh           # Launch both servers
│   └── download-model.sh       # Download Qwen2.5-Coder-7B GGUF
├── .github/workflows/ci.yml   # GitHub Actions validation
├── .continue/config.json       # VS Code agent config
├── ARCHITECTURE.md             # Full system reference
└── .env.example                # Environment template
```

## How A.L.E.C. Learns

1. **Conversations** — Every chat is logged. Rate responses with 👍/👎.
2. **Direct Teaching** — Go to the Memory panel and teach it facts. Instant recall, no retraining.
3. **File Scanning** — A.L.E.C. proactively scans your Desktop, Documents, Downloads for new files.
4. **Stoa Database** — Pulls real estate data every 6 hours and generates training Q&A pairs.
5. **LoRA Training** — When enough rated data accumulates, fine-tune the model to absorb it permanently.
6. **Corrections** — When you correct A.L.E.C., it stores the correction and never repeats the mistake.

## License

**PROPRIETARY** — All code, model weights, and training data are owned by Alec Rovner.
]]>