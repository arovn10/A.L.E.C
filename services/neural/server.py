"""
A.L.E.C. Neural Engine — FastAPI Server.
Provides OpenAI-compatible /v1/chat/completions endpoint plus
training, feedback, health, tasks, stoa, auth, and metrics APIs.

Port 8000 by default. Called by the Node.js backend on localhost.
"""

import os
import uuid
import time
import json
import logging
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from dotenv import load_dotenv
import math

def json_safe(obj):
    """Recursively replace inf/nan with None for JSON serialization."""
    if isinstance(obj, dict):
        return {k: json_safe(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [json_safe(v) for v in obj]
    if isinstance(obj, float) and (math.isinf(obj) or math.isnan(obj)):
        return None
    return obj

load_dotenv()

from engine import ALECEngine
from database import ALECDatabase
from training import ALECTrainer
from tasks import BackgroundTaskRunner
from stoa import StoaConnector
from auth import AuthManager
from excel import ExcelEngine
from initiative import InitiativeEngine
from memory import ALECMemory
from query_planner import QueryPlanner
from agent import ALECAgent
from self_improve import SelfImprovementEngine
from connectors import ConnectorManager
from encryption import get_encryptor
from skills_registry import SkillsRegistry

# ── Logging ──────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
)
logger = logging.getLogger("alec.server")

# ── Globals ──────────────────────────────────────────────────────
engine = ALECEngine()
db = ALECDatabase()
trainer = ALECTrainer(db=db)
task_runner = BackgroundTaskRunner(db=db)
stoa = StoaConnector()
auth_manager = AuthManager(db=db)
excel_engine = ExcelEngine()
initiative = InitiativeEngine(db=db)
memory = ALECMemory()
query_planner = QueryPlanner(stoa)
agent = None  # Initialized after engine loads
self_improver = None  # Initialized after engine loads
connectors = ConnectorManager()
skills = SkillsRegistry()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Load model on startup, initialize all subsystems."""
    # Resolve MODEL_PATH relative to project root
    raw_path = os.getenv(
        "MODEL_PATH", "data/models/qwen2.5-coder-7b-instruct-q4_k_m.gguf"
    )
    project_root = Path(__file__).resolve().parent.parent.parent
    model_path = str(project_root / raw_path) if not os.path.isabs(raw_path) else raw_path
    n_ctx = int(os.getenv("MODEL_CONTEXT_LENGTH", "4096"))
    n_gpu = int(os.getenv("N_GPU_LAYERS", "-1"))

    # 1. Load model
    try:
        engine.load_model(model_path=model_path, n_ctx=n_ctx, n_gpu_layers=n_gpu)
        logger.info("Neural engine ready.")
    except FileNotFoundError:
        logger.warning(
            f"Model not found at {model_path}. "
            "Server will start in stub mode — run scripts/download-model.sh first."
        )
    except Exception as e:
        logger.error(f"Failed to load model: {e}")

    # 1b. Initialize agent (tool-calling loop)
    global agent, self_improver
    agent = ALECAgent(engine=engine, query_planner=query_planner, memory_module=memory)
    logger.info(f"Agent initialized with {len(agent.tools)} tools: {list(agent.tools.keys())}")

    # 1c. Initialize self-improvement engine
    self_improver = SelfImprovementEngine(
        db=db, trainer=trainer, memory=memory,
        query_planner=query_planner, stoa=stoa,
    )
    logger.info("Self-improvement engine initialized")

    # 2. Seed admin user
    admin_email = os.getenv("ADMIN_EMAIL", "arovner@campusrentalsllc.com")
    admin_password = os.getenv("ADMIN_PASSWORD", "")
    auth_manager.seed_admin(admin_email, admin_password)

    # 3. Test Stoa connection
    try:
        if stoa.connect():
            logger.info("Stoa DB connected — continuous learning enabled")
        else:
            logger.info("Stoa DB not available — will retry on sync")
    except Exception:
        logger.info("Stoa DB connection deferred")

    # 4. Start background scheduler
    task_runner.start_scheduler(engine=engine, trainer=trainer, stoa=stoa)

    # 5. Initial filesystem scan (owner's machine knowledge acquisition)
    try:
        task_runner.run_task(
            "Startup Filesystem Scan",
            lambda task_info=None: initiative.scan_filesystem(task_info),
        )
        logger.info("Startup filesystem scan initiated")
    except Exception as e:
        logger.debug(f"Startup scan skipped: {e}")

    yield  # app runs here

    task_runner.stop_scheduler()
    logger.info("Shutting down neural engine.")


# ── FastAPI app ──────────────────────────────────────────────────
app = FastAPI(title="A.L.E.C. Neural Engine", version="2.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Pydantic schemas ─────────────────────────────────────────────

class ChatMessage(BaseModel):
    role: str = "user"
    content: str

class ChatRequest(BaseModel):
    model: str = "alec-v2"
    messages: list[ChatMessage]
    temperature: float = 0.7
    max_tokens: int = 1024
    top_p: float = 0.9
    top_k: int = 40
    stream: bool = False
    session_id: Optional[str] = None

class FeedbackRequest(BaseModel):
    conversation_id: int
    rating: int = Field(..., ge=-1, le=1)
    feedback: str = ""

class TrainingRequest(BaseModel):
    data_path: Optional[str] = None
    config: Optional[dict] = None

class LoginRequest(BaseModel):
    email: str
    password: str
    is_domo_embed: bool = False

class StoaQueryRequest(BaseModel):
    sql: str

class FileProcessRequest(BaseModel):
    filepath: str


# ══════════════════════════════════════════════════════════════════
#  HEALTH / INFO
# ══════════════════════════════════════════════════════════════════

@app.get("/health")
def health():
    return {
        "status": "ok",
        "model_loaded": engine.model_loaded,
        "service": "alec-neural-engine",
        "version": "2.0.0",
        "stoa_connected": stoa.connected,
        "tasks_running": len([t for t in task_runner.tasks.values() if t.status == "running"]),
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }

@app.get("/v1/models")
def list_models():
    info = engine.get_model_info()
    return {
        "object": "list",
        "data": [{
            "id": "alec-v2",
            "object": "model",
            "owned_by": "alec-rovner",
            "loaded": info["loaded"],
            "model_name": info.get("model_name"),
        }],
    }

@app.get("/model/info")
def model_info():
    return engine.get_model_info()


# ══════════════════════════════════════════════════════════════════
#  AUTH
# ══════════════════════════════════════════════════════════════════

@app.post("/auth/login")
def login(req: LoginRequest):
    user = auth_manager.authenticate(req.email, req.password)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid email or password")
    access_level = auth_manager.determine_access_level(req.email, req.is_domo_embed)
    return {
        "success": True,
        "user": user,
        "access_level": access_level,
    }

class CreateUserRequest(BaseModel):
    email: str
    password: str
    role: str = "viewer"  # viewer, editor, admin

class UpdateRoleRequest(BaseModel):
    email: str
    role: str

class ChangePasswordRequest(BaseModel):
    email: str
    new_password: str

@app.get("/auth/users")
def list_users():
    return {"users": auth_manager.list_users()}

@app.post("/auth/users/create")
def create_user(req: CreateUserRequest):
    result = auth_manager.create_user(req.email, req.password, req.role)
    if result and result.get("error"):
        raise HTTPException(status_code=400, detail=result["error"])
    return result

@app.post("/auth/users/role")
def update_role(req: UpdateRoleRequest):
    result = auth_manager.update_user_role(req.email, req.role)
    if result and result.get("error"):
        raise HTTPException(status_code=400, detail=result["error"])
    return result

@app.post("/auth/users/password")
def change_password(req: ChangePasswordRequest):
    result = auth_manager.change_password(req.email, req.new_password)
    if result and result.get("error"):
        raise HTTPException(status_code=400, detail=result["error"])
    return result

@app.delete("/auth/users/{email}")
def delete_user(email: str):
    result = auth_manager.delete_user(email)
    if result and result.get("error"):
        raise HTTPException(status_code=400, detail=result["error"])
    return result

class TrustDeviceRequest(BaseModel):
    device_id: str
    user_email: str
    ip_address: str = ""
    user_agent_hash: str = ""
    device_name: str = ""

class CheckDeviceRequest(BaseModel):
    device_id: str

@app.post("/auth/device/trust")
def trust_device(req: TrustDeviceRequest):
    result = auth_manager.trust_device(req.device_id, req.user_email, req.ip_address, req.user_agent_hash, req.device_name)
    return result

@app.post("/auth/device/check")
def check_device(req: CheckDeviceRequest):
    result = auth_manager.check_trusted_device(req.device_id)
    if not result:
        raise HTTPException(status_code=404, detail="Device not trusted")
    access_level = auth_manager.determine_access_level(result["user"]["email"])
    return {**result, "access_level": access_level}

@app.get("/auth/devices")
def list_devices():
    return {"devices": auth_manager.list_trusted_devices()}

@app.delete("/auth/device/{device_id}")
def revoke_device(device_id: str):
    return auth_manager.revoke_device(device_id)

@app.post("/auth/domo")
def domo_auth():
    """Auto-authenticate for Domo embeds — STOA_ACCESS only."""
    return {
        "success": True,
        "user": {"email": "domo@stoagroup.com", "role": "viewer"},
        "access_level": "STOA_ACCESS",
    }


# ══════════════════════════════════════════════════════════════════
#  CHAT COMPLETIONS (OpenAI-compatible)
# ══════════════════════════════════════════════════════════════════

import re as _re

def strip_think_tags(text: str) -> str:
    """Remove <think>...</think> blocks from Qwen3 responses.
    Qwen3 uses thinking mode by default — the reasoning is useful internally
    but should never be shown to the user."""
    # Remove <think>...</think> blocks (including multiline)
    cleaned = _re.sub(r'<think>.*?</think>', '', text, flags=_re.DOTALL)
    # Also remove orphaned <think> or </think> tags
    cleaned = cleaned.replace('<think>', '').replace('</think>', '')
    # Clean up leading whitespace/newlines left behind
    return cleaned.strip()

@app.post("/v1/chat/completions")
async def chat_completions(req: ChatRequest):
    if not engine.model_loaded:
        raise HTTPException(
            status_code=503,
            detail="Model not loaded. Download the model first: bash scripts/download-model.sh",
        )

    messages = [{"role": m.role, "content": m.content} for m in req.messages]
    session_id = req.session_id or uuid.uuid4().hex[:12]

    # ── MEMORY INJECTION: pull relevant memories and inject into context ──
    user_msg = next((m.content for m in req.messages if m.role == "user"), "")
    if user_msg:
        memory_context = memory.get_context_injection(user_msg)
        if memory_context:
            # Inject memories as a system message right after the main system prompt
            memory_msg = {
                "role": "system",
                "content": f"[A.L.E.C. MEMORY — facts you've been taught, use these]\n{memory_context}"
            }
            # Insert after first system message, or at the start
            if messages and messages[0]["role"] == "system":
                messages.insert(1, memory_msg)
            else:
                messages.insert(0, memory_msg)

        # ── STOA DATA: query real data and return DIRECTLY (bypass LLM) ──
        # The 7B model can't reliably use injected table data — it hallucinates
        # fake values like "Property A" instead of reading real data. So when
        # the query planner finds results, we format and return them directly.
        stoa_response = query_planner.get_direct_response(user_msg)
        if stoa_response:
            logger.info(f"Stoa direct response ({len(stoa_response)} chars) — bypassing LLM")
            try:
                conv_id = db.log_conversation(
                    session_id=session_id,
                    user_message=user_msg,
                    alec_response=stoa_response,
                    confidence=0.95,
                    model_used="stoa-query-planner",
                    tokens_in=0,
                    tokens_out=0,
                    latency_ms=0,
                )
            except Exception:
                conv_id = None
            return {
                "id": f"chatcmpl-stoa-{uuid.uuid4().hex[:8]}",
                "object": "chat.completion",
                "model": "alec-v2",
                "choices": [{
                    "index": 0,
                    "message": {"role": "assistant", "content": stoa_response},
                    "finish_reason": "stop",
                }],
                "usage": {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0},
                "conversation_id": conv_id,
                "latency_ms": 0,
            }

        # ── CURIOSITY: detect teaching moments and store them ──
        lower_msg = user_msg.lower()
        # Detect direct teaching: "X is Y", "remember that", "actually", corrections
        teaching_patterns = [
            "is based in", "is located in", "is in", "was founded",
            "remember that", "remember this", "for your information",
            "fyi", "actually", "the correct", "it's actually",
            "i want you to know", "take note", "note that",
        ]
        if any(pat in lower_msg for pat in teaching_patterns):
            # Auto-extract and store as a memory
            category = "fact"
            if any(w in lower_msg for w in ["actually", "wrong", "correct", "nope", "no,"]):
                category = "correction"
            elif any(w in lower_msg for w in ["i prefer", "i like", "i want", "always", "never"]):
                category = "preference"
            key = f"auto_{hash(user_msg) % 1000000}"
            memory.teach(category, key, user_msg, source="conversation")

    if req.stream:
        return StreamingResponse(
            _stream_response(messages, req, session_id),
            media_type="text/event-stream",
        )

    # ── AGENT LOOP: route through the tool-calling agent ──
    # The agent decides: respond directly OR call tools (stoa_query,
    # memory, web_search, self_edit, etc.) then respond with real data.
    start_time = time.time()
    if agent:
        try:
            agent_result = agent.run(
                user_message=user_msg,
                messages=messages,
                session_id=session_id,
            )
            response_text = strip_think_tags(agent_result.get("text", ""))
            tool_calls = agent_result.get("tool_calls", [])
            latency_ms = agent_result.get("latency_ms", round((time.time() - start_time) * 1000))
            prompt_tokens = agent_result.get("prompt_tokens", 0)
            completion_tokens = agent_result.get("completion_tokens", 0)

            if tool_calls:
                logger.info(f"Agent used {len(tool_calls)} tools: {[tc['tool'] for tc in tool_calls]}")
        except Exception as e:
            logger.error(f"Agent loop failed, falling back to direct generation: {e}")
            result = engine.generate(
                messages=messages, temperature=req.temperature,
                max_tokens=req.max_tokens, top_p=req.top_p, top_k=req.top_k, stream=False,
            )
            response_text = strip_think_tags(result["text"])
            tool_calls = []
            latency_ms = result["latency_ms"]
            prompt_tokens = result["prompt_tokens"]
            completion_tokens = result["completion_tokens"]
    else:
        # No agent — direct generation
        result = engine.generate(
            messages=messages, temperature=req.temperature,
            max_tokens=req.max_tokens, top_p=req.top_p, top_k=req.top_k, stream=False,
        )
        response_text = strip_think_tags(result["text"])
        tool_calls = []
        latency_ms = result["latency_ms"]
        prompt_tokens = result["prompt_tokens"]
        completion_tokens = result["completion_tokens"]

    # Log the conversation
    try:
        conv_id = db.log_conversation(
            session_id=session_id,
            user_message=user_msg,
            alec_response=response_text,
            confidence=0.0,
            model_used="alec-v2" + (f"+{len(tool_calls)}tools" if tool_calls else ""),
            tokens_in=prompt_tokens,
            tokens_out=completion_tokens,
            latency_ms=latency_ms,
        )
    except Exception as e:
        logger.warning(f"Failed to log conversation: {e}")
        conv_id = None

    return {
        "id": f"chatcmpl-{uuid.uuid4().hex[:8]}",
        "object": "chat.completion",
        "created": int(time.time()),
        "model": "alec-v2",
        "choices": [{
            "index": 0,
            "message": {"role": "assistant", "content": response_text},
            "finish_reason": "stop",
        }],
        "usage": {
            "prompt_tokens": prompt_tokens,
            "completion_tokens": completion_tokens,
            "total_tokens": prompt_tokens + completion_tokens,
        },
        "conversation_id": conv_id,
        "latency_ms": latency_ms,
        "tool_calls": [tc["tool"] for tc in tool_calls] if tool_calls else [],
    }


async def _stream_response(messages, req, session_id):
    collected = []
    for chunk in engine.generate(
        messages=messages,
        temperature=req.temperature,
        max_tokens=req.max_tokens,
        top_p=req.top_p,
        top_k=req.top_k,
        stream=True,
    ):
        collected.append(chunk)
        payload = {
            "id": f"chatcmpl-{uuid.uuid4().hex[:8]}",
            "object": "chat.completion.chunk",
            "created": int(time.time()),
            "model": "alec-v2",
            "choices": [{"index": 0, "delta": {"content": chunk}, "finish_reason": None}],
        }
        yield f"data: {json.dumps(payload)}\n\n"
    yield "data: [DONE]\n\n"

    full_text = "".join(collected)
    user_msg = next((m["content"] for m in messages if m["role"] == "user"), "")
    try:
        db.log_conversation(session_id=session_id, user_message=user_msg, alec_response=full_text, model_used="alec-v2")
    except Exception:
        pass


# ══════════════════════════════════════════════════════════════════
#  FEEDBACK
# ══════════════════════════════════════════════════════════════════

@app.post("/feedback")
def submit_feedback(req: FeedbackRequest):
    try:
        db.rate_conversation(req.conversation_id, req.rating, req.feedback)
        return {"success": True, "message": "Feedback recorded"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ══════════════════════════════════════════════════════════════════
#  CONVERSATIONS
# ══════════════════════════════════════════════════════════════════

@app.get("/conversations")
def get_conversations(limit: int = 50, rated_only: bool = False):
    return {"conversations": db.get_conversations(limit=limit, rated_only=rated_only)}


# ══════════════════════════════════════════════════════════════════
#  TRAINING
# ══════════════════════════════════════════════════════════════════

@app.post("/training/start")
def start_training(req: TrainingRequest):
    try:
        run_id = trainer.start_training(data_path=req.data_path, config=req.config)
        return {"success": True, "run_id": run_id}
    except RuntimeError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))

@app.get("/training/status")
def training_status():
    return json_safe(trainer.get_status())

@app.get("/training/adapters")
def list_adapters():
    return {"adapters": trainer.get_available_adapters()}

@app.post("/training/export")
def export_training_data():
    count = db.export_training_data()
    return {"success": True, "examples_exported": count}


# ══════════════════════════════════════════════════════════════════
#  BACKGROUND TASKS
# ══════════════════════════════════════════════════════════════════

@app.get("/tasks")
def list_tasks(limit: int = 50):
    return {"tasks": task_runner.list_tasks(limit=limit)}

@app.get("/tasks/{task_id}")
def get_task(task_id: str):
    task = task_runner.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    return task

@app.post("/tasks/{task_id}/cancel")
def cancel_task(task_id: str):
    success = task_runner.cancel_task(task_id)
    return {"success": success}


# ══════════════════════════════════════════════════════════════════
#  STOA DATABASE
# ══════════════════════════════════════════════════════════════════

@app.get("/stoa/status")
def stoa_status():
    return stoa.get_status()

@app.get("/stoa/tables")
def stoa_tables():
    tables = stoa.discover_tables()
    return {"tables": tables, "count": len(tables)}

@app.post("/stoa/sync")
def stoa_sync():
    task_id = task_runner.run_task("Stoa Data Sync", lambda task_info=None: stoa.sync_and_generate_training_data())
    return {"success": True, "task_id": task_id}

@app.post("/stoa/query")
def stoa_query(req: StoaQueryRequest):
    results = stoa.query(req.sql)
    return {"results": results, "count": len(results)}


# ══════════════════════════════════════════════════════════════════
#  FILE PROCESSING
# ══════════════════════════════════════════════════════════════════

@app.post("/files/process")
def process_file(req: FileProcessRequest):
    """Convert an uploaded file into training JSONL."""
    fpath = Path(req.filepath)
    if not fpath.exists():
        raise HTTPException(status_code=404, detail=f"File not found: {req.filepath}")

    sft_dir = Path(__file__).resolve().parent.parent.parent / "data" / "sft"
    sft_dir.mkdir(parents=True, exist_ok=True)
    output = sft_dir / f"upload_{fpath.stem}.jsonl"

    examples = []
    try:
        content = fpath.read_text(errors="ignore")
        # Split into chunks of ~500 chars for training examples
        chunks = [content[i:i+500] for i in range(0, len(content), 500) if content[i:i+500].strip()]
        for i, chunk in enumerate(chunks[:200]):  # Max 200 examples per file
            examples.append({
                "messages": [
                    {"role": "system", "content": "You are A.L.E.C., a brilliant AI assistant with deep knowledge."},
                    {"role": "user", "content": f"What do you know about this: {chunk[:100]}...?"},
                    {"role": "assistant", "content": f"Based on the document '{fpath.name}': {chunk}"},
                ]
            })

        with open(output, "w") as f:
            for ex in examples:
                f.write(json.dumps(ex) + "\n")

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Processing failed: {e}")

    return {"success": True, "examples_generated": len(examples), "output_path": str(output)}


# ══════════════════════════════════════════════════════════════════
#  METRICS DASHBOARD
# ══════════════════════════════════════════════════════════════════

@app.get("/metrics/dashboard")
def metrics_dashboard():
    """Comprehensive metrics for the dashboard."""
    # Engine stats
    engine_info = engine.get_model_info()

    # DB counts
    all_convos = db.get_conversations(limit=100000)
    rated = [c for c in all_convos if c.get("user_rating") is not None]
    positive = [c for c in rated if c.get("user_rating", 0) > 0]
    negative = [c for c in rated if c.get("user_rating", 0) < 0]

    # Training info
    training_info = trainer.get_status()
    adapters = trainer.get_available_adapters()

    return json_safe({
        "engine": engine_info,
        "conversations": {
            "total": len(all_convos),
            "rated": len(rated),
            "positive": len(positive),
            "negative": len(negative),
            "unrated": len(all_convos) - len(rated),
        },
        "training": {
            "status": training_info,
            "adapters": len(adapters),
            "adapters_list": adapters,
        },
        "stoa": stoa.get_status(),
        "tasks": {
            "total": len(task_runner.tasks),
            "running": len([t for t in task_runner.tasks.values() if t.status == "running"]),
            "recent": task_runner.list_tasks(limit=10),
        },
    })


# ══════════════════════════════════════════════════════════════════
#  MEMORY (Teaching & Learning)
# ══════════════════════════════════════════════════════════════════

class TeachRequest(BaseModel):
    category: str = "fact"  # fact, correction, preference, person, property
    key: str
    value: str

class MemorySearchRequest(BaseModel):
    query: str
    limit: int = 10

@app.post("/memory/teach")
def memory_teach(req: TeachRequest):
    """Teach A.L.E.C. something it will remember forever."""
    return memory.teach(req.category, req.key, req.value)

@app.post("/memory/search")
def memory_search(req: MemorySearchRequest):
    results = memory.recall(req.query, limit=req.limit)
    return {"results": results, "count": len(results)}

@app.get("/memory/all")
def memory_all(limit: int = 100):
    return {"memories": memory.get_all(limit=limit)}

@app.get("/memory/stats")
def memory_stats():
    return memory.get_stats()

@app.get("/memory/category/{category}")
def memory_by_category(category: str, limit: int = 50):
    return {"memories": memory.recall_by_category(category, limit=limit)}

@app.delete("/memory/{memory_id}")
def memory_delete(memory_id: int):
    return {"success": memory.delete(memory_id)}


# ══════════════════════════════════════════════════════════════════
#  EXCEL
# ══════════════════════════════════════════════════════════════════

class ExcelReadRequest(BaseModel):
    filepath: str
    sheet_name: Optional[str] = None
    max_rows: int = 1000

class ExcelExportRequest(BaseModel):
    data: dict
    filename: Optional[str] = None
    format: str = "xlsx"  # xlsx or csv

class ExcelEditRequest(BaseModel):
    filepath: str
    operations: list[dict]

@app.post("/excel/read")
def excel_read(req: ExcelReadRequest):
    return excel_engine.read_file(req.filepath, req.sheet_name, req.max_rows)

@app.post("/excel/export")
def excel_export(req: ExcelExportRequest):
    if req.format == "csv":
        return excel_engine.export_to_csv(req.data, req.filename)
    return excel_engine.export_to_excel(req.data, req.filename)

@app.post("/excel/edit")
def excel_edit(req: ExcelEditRequest):
    return excel_engine.edit_file(req.filepath, req.operations)

@app.post("/excel/analyze")
def excel_analyze(req: ExcelReadRequest):
    return excel_engine.analyze(req.filepath)

@app.get("/excel/status")
def excel_status():
    return excel_engine.get_status()


# ══════════════════════════════════════════════════════════════════
#  INITIATIVE (Autonomous Agent)
# ══════════════════════════════════════════════════════════════════

@app.post("/initiative/scan")
def initiative_scan():
    """Trigger a filesystem scan to learn from new files."""
    task_id = task_runner.run_task(
        "Filesystem Knowledge Scan",
        lambda task_info=None: initiative.scan_filesystem(task_info),
    )
    return {"success": True, "task_id": task_id}

@app.get("/initiative/status")
def initiative_status():
    return initiative.get_status()

@app.post("/initiative/analyze-performance")
def initiative_analyze():
    return initiative.analyze_performance()

@app.get("/initiative/suggest-skills")
def initiative_suggest_skills():
    return {"suggestions": initiative.suggest_skills()}


# ══════════════════════════════════════════════════════════════════
#  SKILLS REGISTRY
# ══════════════════════════════════════════════════════════════════

class SkillConfigRequest(BaseModel):
    skill_id: str
    config: dict = {}

@app.get("/skills/available")
def skills_available():
    return {"skills": skills.get_available()}

@app.get("/skills/installed")
def skills_installed():
    return {"skills": skills.get_installed()}

@app.post("/skills/install")
def skills_install(req: SkillConfigRequest):
    result = skills.install(req.skill_id, req.config)
    if result.get("error"):
        raise HTTPException(status_code=400, detail=result["error"])
    return result

@app.post("/skills/uninstall")
def skills_uninstall(req: SkillConfigRequest):
    return skills.uninstall(req.skill_id)

@app.post("/skills/configure")
def skills_configure(req: SkillConfigRequest):
    return skills.configure(req.skill_id, req.config)

@app.post("/skills/enable")
def skills_enable(req: SkillConfigRequest):
    return skills.enable(req.skill_id)

@app.post("/skills/disable")
def skills_disable(req: SkillConfigRequest):
    return skills.disable(req.skill_id)


# ══════════════════════════════════════════════════════════════════
#  CONNECTORS (iMessage, Gmail)
# ══════════════════════════════════════════════════════════════════

@app.get("/stoa/debug")
def stoa_debug():
    """Debug endpoint: show what tables exist and sample data."""
    tables = stoa.discover_tables() if stoa.connected else []
    # Try to find property-related tables
    property_tables = [t for t in tables if any(kw in t.lower() for kw in ['propert', 'unit', 'building', 'asset', 'occupan', 'lease'])]
    samples = {}
    for t in property_tables[:5]:
        try:
            rows = stoa.query(f"SELECT TOP 3 * FROM {t}")
            samples[t] = rows
        except Exception as e:
            samples[t] = {"error": str(e)}
    return {
        "connected": stoa.connected,
        "total_tables": len(tables),
        "all_tables": tables,
        "property_related_tables": property_tables,
        "samples": samples,
        "query_planner_stats": query_planner.get_stats(),
    }

@app.post("/stoa/reload-planner")
def reload_query_planner():
    """Force reload the query planner: clear cache, re-discover schema."""
    query_planner.schema = {}
    query_planner.query_cache = {}
    query_planner.query_count = 0
    query_planner.successful_queries = 0
    # Delete cache file
    from pathlib import Path
    cache_file = Path(__file__).resolve().parent.parent.parent / "data" / "query_cache.json"
    if cache_file.exists():
        cache_file.unlink()
    # Re-discover
    query_planner.discover_schema()
    return {
        "success": True,
        "message": "Query planner reloaded",
        "stats": query_planner.get_stats(),
    }

@app.get("/connectors/status")
def connectors_status():
    return connectors.get_all_status()

@app.post("/connectors/imessage/sync")
def imessage_sync():
    task_id = task_runner.run_task(
        "iMessage Sync",
        lambda task_info=None: connectors.imessage.generate_training_data(),
    )
    return {"success": True, "task_id": task_id}

@app.get("/connectors/imessage/messages")
def imessage_messages(limit: int = 50, days: int = 30):
    return {"messages": connectors.imessage.get_recent_messages(limit=limit, days=days)}

@app.get("/connectors/imessage/conversations")
def imessage_conversations(limit: int = 20):
    return {"conversations": connectors.imessage.get_conversations(limit=limit)}

@app.post("/connectors/gmail/sync")
def gmail_sync():
    task_id = task_runner.run_task(
        "Gmail Sync",
        lambda task_info=None: connectors.gmail.generate_training_data(),
    )
    return {"success": True, "task_id": task_id}

@app.get("/connectors/gmail/emails")
def gmail_emails(limit: int = 50):
    return {"emails": connectors.gmail.get_recent_emails(limit=limit)}

@app.post("/connectors/sync-all")
def sync_all_connectors():
    task_id = task_runner.run_task(
        "Sync All Connectors",
        lambda task_info=None: connectors.sync_all(),
    )
    return {"success": True, "task_id": task_id}


# ══════════════════════════════════════════════════════════════════
#  SELF-IMPROVEMENT
# ══════════════════════════════════════════════════════════════════

@app.get("/self-improve/status")
def self_improve_status():
    if not self_improver:
        return {"enabled": False}
    return self_improver.get_status()

@app.post("/self-improve/generate-batch")
def self_improve_generate():
    """Generate a training batch from all data sources."""
    if not self_improver:
        raise HTTPException(status_code=503, detail="Self-improvement engine not initialized")
    batch_file, count = self_improver.generate_training_batch()
    return {"success": True, "batch_file": batch_file, "examples": count}

@app.post("/self-improve/run-cycle")
def self_improve_cycle():
    """Run one full self-improvement cycle (curate + generate + train)."""
    if not self_improver:
        raise HTTPException(status_code=503, detail="Self-improvement engine not initialized")
    task_id = task_runner.run_task(
        "Self-Improvement Cycle",
        lambda task_info=None: self_improver.run_improvement_cycle(),
    )
    return {"success": True, "task_id": task_id}

@app.post("/self-improve/score-conversation")
def score_conversation(req: dict):
    """Score a conversation for training quality (for debugging)."""
    if not self_improver:
        return {"score": 0}
    return {"score": self_improver.score_conversation(req)}


# ══════════════════════════════════════════════════════════════════
#  RUN
# ══════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("NEURAL_PORT", "8000"))
    uvicorn.run(
        "server:app",
        host="0.0.0.0",
        port=port,
        reload=False,
        log_level="info",
    )
