# A.L.E.C. — Architecture Reference

> Autonomous Language Embedded Cognition
> Owner: Alec Rovner | Repo: github.com/arovn10/A.L.E.C
> License: PROPRIETARY — all data and model weights owned by Alec Rovner

---

## System Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│  CLIENT (Browser)                                                    │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  Dashboard UI (frontend/)                                    │    │
│  │  - Login / Domo embed detection                              │    │
│  │  - Chat panel with file upload + feedback                    │    │
│  │  - Metrics & training dashboard                              │    │
│  │  - File manager                                              │    │
│  │  - Skills/MCP browser                                        │    │
│  │  - Settings & admin                                          │    │
│  └──────────────────────┬──────────────────────────────────────┘    │
│                          │ HTTP/WS                                    │
├──────────────────────────┼──────────────────────────────────────────┤
│  NODE.JS BACKEND         │ (backend/server.js — port 3001)           │
│  ┌───────────────────────▼──────────────────────────────────────┐   │
│  │  Express API                                                  │   │
│  │  - POST /api/auth/login          → JWT auth                   │   │
│  │  - POST /api/chat                → proxies to Python engine   │   │
│  │  - POST /api/feedback            → rate conversations         │   │
│  │  - GET  /api/conversations/history                            │   │
│  │  - GET  /api/model/info                                       │   │
│  │  - POST /api/training/start|status|export                     │   │
│  │  - POST /api/files/upload        → multer → data/uploads/    │   │
│  │  - GET  /api/files                                            │   │
│  │  - GET  /api/tasks               → background task status     │   │
│  │  - GET  /api/stoa/status|tables|sync                          │   │
│  │  - GET  /api/metrics/dashboard                                │   │
│  │  - *    /api/mcp/*               → MCP skill management       │   │
│  │  - *    /api/self-evolution/*                                  │   │
│  │  - *    /api/sync/*              → cross-device sync           │   │
│  │  - *    /api/smarthome/*                                       │   │
│  └───────────────────────┬──────────────────────────────────────┘   │
│                          │ HTTP (localhost:8000)                      │
├──────────────────────────┼──────────────────────────────────────────┤
│  PYTHON NEURAL ENGINE    │ (services/neural/ — port 8000)            │
│  ┌───────────────────────▼──────────────────────────────────────┐   │
│  │  FastAPI Server (server.py)                                   │   │
│  │  ├── engine.py      → llama-cpp-python inference (GGUF)       │   │
│  │  ├── database.py    → Azure SQL + SQLite dual-mode            │   │
│  │  ├── training.py    → LoRA fine-tuning (peft/transformers)    │   │
│  │  ├── tasks.py       → Background task runner + scheduler      │   │
│  │  ├── stoa.py        → Stoa Group DB connector + training gen  │   │
│  │  └── auth.py        → Password hashing + admin user mgmt      │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                      │
├──────────────────────────────────────────────────────────────────────┤
│  DATA LAYER                                                          │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐  │
│  │  Azure SQL        │  │  SQLite           │  │  GGUF Model      │  │
│  │  (stoagroupdb)    │  │  (data/alec.db)   │  │  (data/models/)  │  │
│  │                   │  │                   │  │                   │  │
│  │  alec.* schema:   │  │  Same tables as   │  │  qwen2.5-coder-  │  │
│  │  - conversations  │  │  Azure SQL but    │  │  7b-instruct     │  │
│  │  - training_metrics│ │  local fallback   │  │  Q4_K_M (~4.4GB) │  │
│  │  - learned_queries│  │                   │  │                   │  │
│  │  - evolution_log  │  │  + admin_users    │  │  + LoRA adapters  │  │
│  │  - admin_users    │  │  + background_tasks│ │  in data/models/  │  │
│  │                   │  │  + uploaded_files  │  │  lora/            │  │
│  │  Stoa tables:     │  │                   │  │                   │  │
│  │  - projects       │  └──────────────────┘  └──────────────────┘  │
│  │  - deals, banks   │                                               │
│  │  - loans, leasing │  ┌──────────────────┐                        │
│  │  - contracts, T12 │  │  Training Data    │                        │
│  └──────────────────┘  │  data/sft/         │                        │
│                         │  - conversations.jsonl (from rated chats)   │
│                         │  - stoa_training.jsonl (from Stoa DB)      │
│                         │  - uploads/*.jsonl (from file uploads)      │
│                         └──────────────────┘                         │
└──────────────────────────────────────────────────────────────────────┘
```

---

## Directory Structure

```
A.L.E.C/
├── backend/
│   └── server.js              # Express API server (port 3001)
├── frontend/
│   ├── index.html             # Dashboard UI
│   ├── app.js                 # Dashboard logic
│   └── styles.css             # Dark theme styles
├── services/
│   ├── neuralEngine.js        # Node→Python bridge (HTTP calls to :8000)
│   ├── neural/
│   │   ├── server.py          # FastAPI server (port 8000)
│   │   ├── engine.py          # LLM inference (llama-cpp-python)
│   │   ├── database.py        # Azure SQL + SQLite dual-mode
│   │   ├── training.py        # LoRA fine-tuning pipeline
│   │   ├── tasks.py           # Background task runner
│   │   ├── stoa.py            # Stoa Group DB connector
│   │   ├── auth.py            # Password hashing + user management
│   │   ├── requirements.txt   # Python dependencies
│   │   └── .venv/             # Python virtual environment (gitignored)
│   ├── adaptiveLearning.js    # Pattern detection (legacy)
│   ├── selfEvolution.js       # Model version management
│   ├── mcpSkills.js           # MCP skill management
│   ├── voiceInterface.js      # Voice WebSocket
│   ├── smartHomeConnector.js  # Home Assistant integration
│   ├── tokenManager.js        # JWT token generation
│   └── crossDeviceSync.js     # Tailscale sync
├── scripts/
│   ├── setup-local.sh         # Full first-time setup
│   ├── start-alec.sh          # Launch both servers
│   ├── download-model.sh      # Download Qwen2.5-Coder-7B GGUF
│   └── migrate-azure-sql.sql  # Azure SQL schema migration
├── data/
│   ├── models/                # GGUF models + LoRA adapters (gitignored)
│   ├── sft/                   # Training data JSONL (gitignored)
│   ├── uploads/               # User-uploaded files (gitignored)
│   ├── context/               # User context profiles
│   └── alec.db                # SQLite database (gitignored)
├── .env                       # Environment config (gitignored)
├── .env.example               # Template for new deployments
├── package.json               # Node.js deps
├── ARCHITECTURE.md            # THIS FILE
├── ALEC_Structure_Guide.md    # Long-term transformer architecture vision
└── README.md                  # Setup instructions
```

---

## Authentication Flow

```
Browser Request
     │
     ▼
┌─ Is it from Domo? (check Referer header or ?embed=domo query param) ─┐
│                                                                        │
│  YES (Domo embed)              NO (direct access)                      │
│  ├─ Check user email           ├─ Show login page                      │
│  ├─ @stoagroup.com →           ├─ POST /api/auth/login                 │
│  │  STOA_ACCESS token          │  {email, password}                    │
│  └─ Other → STOA_ACCESS        ├─ Verify bcrypt hash                   │
│     (read-only Stoa data)      ├─ Return JWT                           │
│                                 └─ FULL_CAPABILITIES token              │
└────────────────────────────────────────────────────────────────────────┘
```

### Token Types
| Type | Scope | Who Gets It |
|------|-------|-------------|
| `STOA_ACCESS` | Chat, Stoa data queries, read-only | Domo embed users, @stoagroup.com |
| `FULL_CAPABILITIES` | Everything: training, files, admin, smart home, self-evolution | Direct login (arovner@campusrentalsllc.com) |

### Default Admin
- Email: `arovner@campusrentalsllc.com`
- Password: `SiennaBean12345!` (bcrypt hashed in DB)
- Seeded on first startup if not exists

---

## Model Strategy

### 75/25 Architecture
- **75% = Pre-trained foundation**: Qwen2.5-Coder-7B-Instruct (Q4_K_M GGUF, ~4.4 GB)
- **25% = LoRA fine-tuning**: Personal data, Stoa DB, conversation feedback

### Training Data Sources
1. **Rated conversations** — User thumbs up/down → exported as JSONL
2. **Stoa database** — Real estate tables → Q&A training pairs (auto-generated)
3. **Uploaded files** — User documents → processed into training examples
4. **Learned queries** — SQL/code that worked or failed → correction pairs

### Self-Improvement Loop
1. Conversations logged to `conversations` table
2. User rates responses (thumbs up/down)
3. Scheduler checks hourly: if 500+ rated examples OR 30 days → trigger training
4. Export rated data → `data/sft/conversations.jsonl`
5. LoRA fine-tune → save adapter to `data/models/lora/{run_id}/`
6. Evaluate: if val_loss regresses > 5%, reject and keep old weights
7. Log evolution event to `evolution_log`

---

## Background Tasks

### Scheduled (automatic)
| Task | Interval | Description |
|------|----------|-------------|
| Metrics Snapshot | 5 min | Log engine stats to evolution_log |
| Stoa Data Sync | 6 hours | Pull Stoa DB → generate training JSONL |
| Auto-Training Check | 1 hour | If threshold met, trigger LoRA retrain |

### On-Demand (user-triggered)
| Task | Trigger | Description |
|------|---------|-------------|
| Start Training | POST /api/training/start | Manual LoRA fine-tune |
| Export Training Data | POST /api/training/export | Dump rated convos to JSONL |
| Stoa Sync Now | POST /api/stoa/sync | Immediate Stoa data pull |
| Process File | POST /api/files/:id/process | Convert uploaded file to training data |

---

## Network Configuration

### Local Development
- Node.js: `http://0.0.0.0:3001` (LAN accessible)
- Python: `http://0.0.0.0:8000` (localhost only, called by Node)
- Frontend: `http://localhost:3001` or `http://<LAN-IP>:3001`

### Remote Access
- **Tailscale**: Install on Mac + phone → access via Tailscale IP
- **Vercel**: API proxy for remote access (project: prj_qA3OzQpLdv8JUqkbmLqe4lgy4NKc)

---

## Database Schema

### `alec.conversations`
| Column | Type | Description |
|--------|------|-------------|
| id | INT PK | Auto-increment |
| session_id | TEXT | Groups a conversation thread |
| user_message | TEXT | What the user said |
| alec_response | TEXT | What A.L.E.C. replied |
| confidence | REAL | Response confidence score |
| model_used | TEXT | Model name |
| tokens_in | INT | Prompt tokens |
| tokens_out | INT | Completion tokens |
| latency_ms | INT | Response time |
| user_rating | INT | 1=good, -1=bad, NULL=unrated |
| feedback | TEXT | Optional text feedback |
| created_at | DATETIME | Timestamp |

### `alec.training_metrics`
| Column | Type | Description |
|--------|------|-------------|
| id | INT PK | Auto-increment |
| run_id | TEXT | Training run identifier |
| epoch | INT | Current epoch |
| step | INT | Current step |
| train_loss | REAL | Training loss |
| val_loss | REAL | Validation loss |
| perplexity | REAL | Perplexity metric |
| learning_rate | REAL | Current LR |
| lora_rank | INT | LoRA rank used |
| dataset_size | INT | Training examples count |
| model_version | TEXT | Version string |

### `alec.learned_queries`
| Column | Type | Description |
|--------|------|-------------|
| id | INT PK | Auto-increment |
| query_text | TEXT | The query/code |
| query_type | TEXT | sql, code, api, etc. |
| was_successful | BIT | Did it work? |
| error_message | TEXT | Error if failed |
| correction | TEXT | What should have been done |
| domain | TEXT | general, real_estate, code, etc. |
| times_used | INT | Reuse count |

### `alec.evolution_log`
| Column | Type | Description |
|--------|------|-------------|
| id | INT PK | Auto-increment |
| event_type | TEXT | training, bias_adjust, metrics_snapshot, etc. |
| description | TEXT | Human-readable description |
| model_version_before | TEXT | Previous version |
| model_version_after | TEXT | New version |
| metrics_snapshot | TEXT | JSON blob of metrics |

### `admin_users`
| Column | Type | Description |
|--------|------|-------------|
| id | INT PK | Auto-increment |
| email | TEXT UNIQUE | Login email |
| password_hash | TEXT | bcrypt or PBKDF2 hash |
| role | TEXT | admin, viewer |
| last_login | DATETIME | Last login time |

### `background_tasks`
| Column | Type | Description |
|--------|------|-------------|
| id | INT PK | Auto-increment |
| task_id | TEXT UNIQUE | UUID-based task ID |
| name | TEXT | Human-readable task name |
| status | TEXT | pending, running, completed, failed, cancelled |
| progress | REAL | 0.0 to 1.0 |
| result | TEXT | JSON result on completion |
| error | TEXT | Error message if failed |

### `uploaded_files`
| Column | Type | Description |
|--------|------|-------------|
| id | INT PK | Auto-increment |
| filename | TEXT | Stored filename (UUID-based) |
| original_name | TEXT | Original upload name |
| size_bytes | INT | File size |
| mime_type | TEXT | MIME type |
| processed | INT | 0=raw, 1=processed for training |
| training_examples | INT | Number of examples generated |

---

## Environment Variables

```env
# Server
PORT=3001
NEURAL_PORT=8000
HOST=0.0.0.0
NODE_ENV=development
JWT_SECRET=<random-256-bit-hex>

# Model
MODEL_PATH=data/models/qwen2.5-coder-7b-instruct-q4_k_m.gguf
MODEL_CONTEXT_LENGTH=4096
N_GPU_LAYERS=-1
NEURAL_BACKEND=llama-cpp

# A.L.E.C. Database (Azure SQL — optional, SQLite fallback automatic)
AZURE_SQL_CONNECTION_STRING=Server=tcp:stoagroupdb.database.windows.net,1433;...

# Stoa Group Database (for continuous learning)
STOA_DB_HOST=stoagroupdb.database.windows.net
STOA_DB_PORT=1433
STOA_DB_NAME=stoagroupDB
STOA_DB_USER=arovner
STOA_DB_PASSWORD=<password>
STOA_DB_SSL=true

# Home Assistant (optional)
HOME_ASSISTANT_URL=http://100.81.193.45:8123
HOME_ASSISTANT_ACCESS_TOKEN=<token>

# Admin (seeded on first startup)
ADMIN_EMAIL=arovner@campusrentalsllc.com
ADMIN_PASSWORD=SiennaBean12345!
```

---

## Hardware Targets

### Primary: MacBook Pro M5 Max (64 GB)
- Qwen2.5-Coder-7B Q4_K_M: ~5.4 GB with KV cache
- LoRA training: fits comfortably in 64 GB unified memory
- Metal acceleration: `N_GPU_LAYERS=-1` (offload all layers)
- Expected: 30-50 tokens/sec inference

### Future: Home Server (Threadripper PRO + RTX 5080)
- 128 GB+ RAM, CUDA acceleration
- Can run 70B+ models
- Tensor parallelism with vLLM
- Dedicated training machine

---

## Portability

To deploy A.L.E.C. on a new machine:
```bash
git clone https://github.com/arovn10/A.L.E.C.git
cd A.L.E.C
cp .env.example .env        # Edit with your credentials
bash scripts/setup-local.sh  # Installs everything + downloads model
bash scripts/start-alec.sh   # Launches both servers
```

The system always connects back to Azure SQL for centralized data.
SQLite fallback ensures it works offline.
Model weights are downloaded locally — never committed to git.
LoRA adapters are local and can be synced via git or Tailscale.
