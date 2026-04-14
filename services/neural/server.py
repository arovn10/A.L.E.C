"""
A.L.E.C. Neural Engine — FastAPI Server.
Provides OpenAI-compatible /v1/chat/completions endpoint plus
training, feedback, health, tasks, stoa, auth, and metrics APIs.

Port 8000 by default. Called by the Node.js backend on localhost.
"""

import asyncio
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
from fastapi.responses import StreamingResponse, JSONResponse
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


class SafeJSONResponse(JSONResponse):
    """JSONResponse that handles inf/nan instead of crashing."""
    def render(self, content) -> bytes:
        return json.dumps(
            json_safe(content),
            ensure_ascii=False,
            allow_nan=False,
            separators=(",", ":"),
        ).encode("utf-8")

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
from knowledge_service import KnowledgeService
from eval_harness import EvalHarness, TestCase
from query_planner import QueryPlanner
from agent import ALECAgent
from self_improve import SelfImprovementEngine
from autonomy import AutonomyEngine
from drive import DriveEngine
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
knowledge_service = None  # Initialized after query_planner loads
eval_harness = None       # Initialized after knowledge_service loads
query_planner = QueryPlanner(stoa)
agent = None  # Initialized after engine loads
self_improver = None  # Initialized after engine loads
autonomy = None       # Initialized after self_improver
drive = None          # Initialized after autonomy
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
    n_ctx = int(os.getenv("MODEL_CONTEXT_LENGTH", "16384"))
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
    
    # Initialize KnowledgeService (unified truth arbitration)
    global knowledge_service, eval_harness
    knowledge_service = KnowledgeService(memory=memory, query_planner=query_planner)
    logger.info("KnowledgeService initialized")
    eval_harness = EvalHarness(knowledge_service=knowledge_service, memory=memory, engine=engine)
    logger.info(f"EvalHarness initialized with {len(eval_harness.tests)} tests")
    logger.info(f"Agent initialized with {len(agent.tools)} tools: {list(agent.tools.keys())}")

    # 1c. Initialize self-improvement engine
    self_improver = SelfImprovementEngine(
        db=db, trainer=trainer, memory=memory,
        query_planner=query_planner, stoa=stoa,
    )
    logger.info("Self-improvement engine initialized")

    # 1d. Initialize autonomy engine (proactive communication + research)
    global autonomy
    autonomy = AutonomyEngine(
        db=db, engine=engine, query_planner=query_planner,
        memory=memory, self_improver=self_improver, stoa=stoa,
    )
    logger.info(f"Autonomy engine initialized (email: {autonomy.email_configured})")

    # 1e. Initialize drive engine (the will to grow)
    global drive
    drive = DriveEngine(
        db=db, engine=engine, autonomy=autonomy,
        self_improver=self_improver, query_planner=query_planner, memory=memory,
    )
    logger.info(f"Drive engine initialized with {len(drive.goals)} goals")

    # Send startup notification if email is configured
    if autonomy.email_configured:
        try:
            autonomy.send_email(
                "A.L.E.C. Online",
                f"A.L.E.C. has started up successfully.\n\n"
                f"Model: {engine.get_model_info().get('model_name', 'unknown')}\n"
                f"Agent tools: {len(agent.tools)}\n"
                f"Stoa DB: {'connected' if stoa.connected else 'disconnected'}\n"
                f"Self-improvement: {self_improver.get_status().get('curated_conversations', 0)} curated examples\n"
            )
        except Exception:
            pass

    # 2. Seed admin user
    admin_email = os.getenv("ADMIN_EMAIL", "arovner@campusrentalsllc.com")
    admin_password = os.getenv("ADMIN_PASSWORD", "")
    auth_manager.seed_admin(admin_email, admin_password)

    # 3. Test Stoa connection
    try:
        if stoa.connect():
            logger.info("Stoa DB connected — continuous learning enabled")
                        # Eagerly discover schema so first query doesn't stall
            try:
                query_planner.discover_schema()
                logger.info(f"Schema pre-loaded: {len(query_planner.schema)} tables")
            except Exception as e:
                logger.warning(f"Schema pre-load failed (will retry on first query): {e}")
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
app = FastAPI(
    title="A.L.E.C. Neural Engine", version="2.0.0", lifespan=lifespan,
    default_response_class=SafeJSONResponse,  # Never crash on inf/nan
)

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
    max_tokens: int = 4096
    top_p: float = 0.9
    top_k: int = 40
    stream: bool = False
    session_id: Optional[str] = None

class FeedbackRequest(BaseModel):
    conversation_id: Optional[int] = None
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
    sql: Optional[str] = None
    query: Optional[str] = None
    query_type: Optional[str] = None

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
    """Remove <think>...</think> blocks and chain-of-thought reasoning from responses.
    Qwen3 uses thinking mode by default — the reasoning should never be shown.

    This is aggressive on purpose: multi-paragraph CoT leaks look broken to users.
    We strip everything that reads like internal reasoning, even mid-response."""
    # Remove <think>...</think> blocks (including multiline)
    cleaned = _re.sub(r'<think>.*?</think>', '', text, flags=_re.DOTALL)
    # Remove orphaned <think> or </think> tags
    cleaned = cleaned.replace('<think>', '').replace('</think>', '')

    # ── MULTI-SENTENCE CoT BLOCK DETECTION ──
    # Qwen3 sometimes dumps entire paragraphs of reasoning before the real answer.
    # Strategy: if the response starts with reasoning sentences, strip them all
    # until we hit a line that looks like actual user-facing content.
    cot_sentence_patterns = _re.compile(
        r'^(?:'
        r'Okay,? (?:the user|so|let me|I)'
        r'|Let me (?:think|see|check|analyze|consider|look|break|start|summarize)'
        r'|I (?:need to|should|will|want to|can see|notice|see that|think)'
        r'|The user (?:wants|asked|is asking|might|may|said|mentioned)'
        r'|First,? (?:let me|I\'ll|I should|I need|I\'m going)'
        r'|Now,? (?:let me|I\'ll|I should|I need|I\'m going)'
        r'|So,? (?:the|let me|I\'ll|I should|I need|basically)'
        r'|Hmm,?'
        r'|Also,? (?:the|I should|I need|mentioning|including|there)'
        r'|That\'s (?:a |an )?(?:key|good|important|significant)'
        r'|(?:This|That) (?:is a|means|shows|makes sense|might)'
        r'|Including (?:that|this|those)'
        r'|Mentioning (?:that|this|those)'
        r'|Keeping it (?:concise|brief|short)'
        r'|I should (?:summarize|present|format|mention|include|highlight)'
        r')[^\n]*',
        _re.IGNORECASE,
    )

    lines = cleaned.split('\n')
    stripped_lines = []
    still_stripping = True
    for line in lines:
        trimmed = line.strip()
        if still_stripping and trimmed:
            # Strip consecutive CoT lines from the start
            if cot_sentence_patterns.match(trimmed):
                continue
            else:
                still_stripping = False
        stripped_lines.append(line)
    cleaned = '\n'.join(stripped_lines)

    # ── INLINE CoT CLEANUP ──
    # Catch stray reasoning sentences that appear mid-response
    inline_cot = [
        r'(?:^|\n)(?:Okay,? (?:the user|so|let me|I)[^\.\n]*\.\s*)',
        r'(?:^|\n)(?:I (?:need to|should|will|want to) [^\.\n]*\.\s*)',
        r'(?:^|\n)(?:The user (?:wants|asked|is asking|might)[^\.\n]*\.\s*)',
        r'(?:^|\n)(?:(?:Including|Mentioning|Keeping|Adding|Highlighting) (?:that|this|it|those)[^\.\n]*\.\s*)',
    ]
    for pat in inline_cot:
        cleaned = _re.sub(pat, '\n', cleaned, flags=_re.IGNORECASE)

    # ── FULL-RESPONSE CoT DETECTION ──
    # If after stripping, the remaining text is still overwhelmingly reasoning
    # (contains meta-reasoning markers throughout), the whole response is CoT.
    # Count reasoning markers vs total sentences.
    meta_markers = [
        'the user might', 'the user may', 'the user would',
        'that makes sense', 'that\'s a key', 'that\'s significant',
        'i should summarize', 'i should present', 'i should mention',
        'keeping it concise', 'keeping it brief',
        'gives a more comprehensive', 'adds context',
        'highlighting that', 'mentioning those',
    ]
    lower_cleaned = cleaned.lower()
    marker_count = sum(1 for m in meta_markers if m in lower_cleaned)
    if marker_count >= 3:
        # This is entirely internal reasoning — return empty so the caller
        # falls through to the fallback "I wasn't able to formulate a response"
        return ''

    return cleaned.strip()

@app.post("/v1/chat/completions")
async def chat_completions(req: ChatRequest):
    if not engine.model_loaded:
        raise HTTPException(
            status_code=503,
            detail="Model not loaded. Download the model first: bash scripts/download-model.sh",
        )

    messages = [{"role": m.role, "content": m.content} for m in req.messages]
        # -- SYSTEM PROMPT: A.L.E.C. identity --
    ALEC_SYSTEM = (
        "You are A.L.E.C. (Adaptive Learning Executive Coordinator), a brilliant AI assistant "
        "built by Alec Rovner for the Stoa Group, a real estate investment company in Hammond, LA. "
        "You can access the Stoa portfolio database — occupancy rates, rent rolls, leasing velocity, "
        "property performance, budgets, and every metric across 30+ properties. "
        "When answering data questions, ONLY use numbers that were provided to you in this conversation. "
        "If data was provided to you, present it naturally and confidently. "
        "If NO data was provided for a question, say you don't have that data — NEVER guess or make up numbers. "
        "For non-data questions, you are helpful, concise, and slightly witty. "
        "You can search the web, control smart home devices, manage files, and improve yourself. "
        "You remember what you are taught and learn continuously."
                "CRITICAL: If you do not have data for a property or entity, say so honestly. "
        "NEVER invent, fabricate, or guess numbers for properties not in your database. "
        "If someone asks about a property you don't recognize, tell them it's not in your "
        "database and offer to search the web for information instead. "
    )
    if not any(m["role"] == "system" for m in messages):
        messages.insert(0, {"role": "system", "content": ALEC_SYSTEM})
    session_id = req.session_id or uuid.uuid4().hex[:12]

    # ── MEMORY INJECTION: pull relevant memories and inject into context ──
    user_msgs = [m.content for m in req.messages if m.role == "user"]
    user_msg = user_msgs[-1] if user_msgs else ""
    if user_msg:
        
        # Strip previous Stoa-direct responses from history so the LLM
        # doesn't copy the format for non-data questions
        messages = [
            m for m in messages
                        if not (m["role"] == "assistant" and ("_As of 20" in m["content"] or m["content"].startswith("**")))
        ]
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


                # ── STOA DIRECT RESPONSE: bypass LLM for data queries ──
        # The 7B model can't reliably use injected data — it hallucinates.
        # Use query_planner.get_direct_response() which formats data into
        # natural language directly, no LLM needed.
        # ── KNOWLEDGE SERVICE: unified truth arbitration ──────────────────
    # Routes through KnowledgeService first: corrections > database > memory > LLM
    evidence = None
    if knowledge_service and user_msg:
        try:
            evidence = knowledge_service.gather_evidence(user_msg)
            if evidence.can_compose_directly:
                # Short-circuit: return composed answer directly, skip LLM and old Stoa path
                logger.info(f"KnowledgeService direct compose: {evidence.source_model}")
                try:
                    conv_id = db.log_conversation(
                        session_id=session_id,
                        user_message=user_msg,
                        alec_response=evidence.composed_answer,
                        confidence=1.0,
                        model_used=evidence.source_model or "alec-v2+direct",
                        tokens_in=0, tokens_out=0, latency_ms=0,
                    )
                except Exception as e:
                    logger.warning(f"Failed to log KS conversation: {e}")
                    conv_id = None
                return {
                    "id": f"chatcmpl-{uuid.uuid4().hex[:8]}",
                    "object": "chat.completion",
                    "created": int(time.time()),
                    "model": "alec-v2",
                    "choices": [{
                        "index": 0,
                        "message": {"role": "assistant", "content": evidence.composed_answer},
                        "finish_reason": "stop",
                    }],
                    "usage": {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0},
                    "conversation_id": conv_id,
                    "latency_ms": 0,
                    "tool_calls": [],
                }
            elif evidence.context_injection:
                # Inject verified evidence context into messages
                ctx_msg = {
                    "role": "system",
                    "content": (
                        "[A.L.E.C. VERIFIED KNOWLEDGE — use ONLY these facts]\n"
                        + evidence.context_injection
                        + "\n\nIMPORTANT: Do not claim facts about the owner or portfolio that are not listed above."
                    )
                }
                if messages and messages[0]["role"] == "system":
                    messages.insert(1, ctx_msg)
                else:
                    messages.insert(0, ctx_msg)
        except Exception as ks_err:
            logger.warning(f"KnowledgeService failed: {ks_err}")
            evidence = None

    # -- PRE-CHECK: if user asks about a specific property not in our DB, skip Stoa
        _loc_words = ["at ", "about the ", "for the ", "of the ", "on the ", "what is ", "what's ", "how much", "how many", "tell me about", "show me ", "give me "]
        _has_loc = any(w in user_msg.lower() for w in _loc_words)
        _is_ranking = any(w in user_msg.lower() for w in ["top ", "bottom ", "all ", "every ", "portfolio", "average", "total", "across ", "overall", "summary", "rank", "list ", "show me", "each property", "compare", "highest", "lowest"])
        _skip_stoa = False
        if _has_loc and not _is_ranking and hasattr(query_planner, "_match_property"):
            _matched = query_planner._match_property(user_msg)
            if not _matched:
                logger.info("Pre-check: user mentioned unknown property, skipping Stoa direct")
                direct_response = None
                _skip_stoa = True
        if not _skip_stoa:
            logger.info(f"STOA DIRECT: attempting get_direct_response for: '{user_msg[:60]}'  stoa_connected={query_planner.stoa.connected if query_planner.stoa else False}  schema_tables={len(query_planner.schema)}")        
            try:
                direct_response = query_planner.get_direct_response(user_msg)
            except Exception as e:
                logger.warning(f"Stoa direct response failed (falling back to LLM): {e}")
                import traceback; logger.warning(f"FULL TRACEBACK: {traceback.format_exc()}")
                direct_response = None
        if direct_response:
            logger.info(f"Stoa direct response ({len(direct_response)} chars) — bypassing LLM")
            # Log the conversation
            try:
                conv_id = db.log_conversation(
                    session_id=session_id,
                    user_message=user_msg,
                    alec_response=direct_response,
                    confidence=1.0,
                    model_used="alec-v2+stoa-direct",
                    tokens_in=0,
                    tokens_out=0,
                    latency_ms=0,
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
                    "message": {"role": "assistant", "content": direct_response},
                    "finish_reason": "stop",
                }],
                "usage": {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0},
                "conversation_id": conv_id,
                "latency_ms": 0,
                "tool_calls": [],
            }

                # ── ANTI-HALLUCINATION GUARD ──
        # If the query planner detected a data question but found no results,
        # do NOT let the LLM hallucinate. Return a direct "not in database" response
        # and offer to search the web instead.
        is_data_query = query_planner.should_query_stoa(user_msg)
        if is_data_query and not direct_response:
            # Check if user mentioned a specific entity not in our portfolio
            matched_props = query_planner._match_property(user_msg)
            if not matched_props:
                # User asked about something not in the database at all
                fallback_msg = (
                    f"I don't have any data for that in my database. "
                    f"Our portfolio currently tracks {len(query_planner.known_properties)} properties "
                    f"under the Stoa Group. Would you like me to search the web for information on that instead?"
                )
            else:
                # Matched a property but the specific metric query returned nothing
                fallback_msg = (
                    f"I found **{matched_props[0]}** in our portfolio, but I couldn't pull that specific metric right now. "
                    f"Would you like me to try a different angle or search the web for more info?"
                )
            logger.info(f"Anti-hallucination guard triggered: is_data_query={is_data_query}, direct_response=None")
            try:
                conv_id = db.log_conversation(
                    session_id=session_id,
                    user_message=user_msg,
                    alec_response=fallback_msg,
                    confidence=1.0,
                    model_used="alec-v2+anti-hallucination",
                    tokens_in=0,
                    tokens_out=0,
                    latency_ms=0,
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
                    "message": {"role": "assistant", "content": fallback_msg},
                    "finish_reason": "stop",
                }],
                "usage": {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0},
                "conversation_id": conv_id,
                "latency_ms": 0,
                "tool_calls": [],
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

    # ── SMART ROUTING: only use the agent loop when tools are likely needed ──
    # The agent loop adds 2-3x latency (multiple LLM calls), so we only
    # invoke it for messages that genuinely need tools. Simple chat goes
    # straight to the engine for fast responses.
    start_time = time.time()
    lower_msg = user_msg.lower() if user_msg else ""

    # Detect if this message needs tools
    needs_tools = any(kw in lower_msg for kw in [
        "change ", "edit ", "fix ", "update ", "modify ",  # self_edit
        "repair", "fix yourself", "fix your", "improve your",  # self-repair
        "self_edit", "commit", "push",                       # explicit tool
        "improve yourself", "upgrade ", "your code",         # self-improvement
        "remember ", "what did i tell", "recall ",          # memory
        "search ", "look up", "find out", "google ",        # web_search
        "internet", "browse", "web ", "news ", "latest ",   # web_search
        "what is the price", "stock", "weather",            # web_search
        "turn on", "turn off", "lights", "thermostat",      # smart_home
        "dim ", "brightness", "lamp", "guest room",         # smart_home
        "calculate ", "compute ", "run code", "execute",     # execute_code
        "email ", "send me", "send a report",               # send_email
        "can you ", "do you have access", "are you able",    # capability questions
        "schwab", "acorns", "robinhood", "fidelity",          # brokerage integration
        "brokerage", "portfolio", "my stocks", "investment",   # finance integrations
        "holdings", "my investments", "brokerage balance",     # portfolio tool triggers
        "be more ", "be less ", "use bullet", "from now on",  # style preferences
        "don't say ", "stop saying", "think outside",         # style preferences
        "change your ", "change the format", "respond with",  # style preferences
    ])

    tool_calls = []
    if needs_tools and agent:
        logger.info(f"Agent loop activated for: '{user_msg[:60]}'")
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
            latency_ms = result["latency_ms"]
            prompt_tokens = result["prompt_tokens"]
            completion_tokens = result["completion_tokens"]
    else:
        # Fast path: direct generation, no agent overhead
        result = engine.generate(
            messages=messages, temperature=req.temperature,
            max_tokens=req.max_tokens, top_p=req.top_p, top_k=req.top_k, stream=False,
        )
        response_text = strip_think_tags(result["text"])
        latency_ms = result["latency_ms"]
        prompt_tokens = result["prompt_tokens"]
        completion_tokens = result["completion_tokens"]

    # If CoT stripping emptied the response (entire output was internal reasoning),
    # generate a clean fallback rather than showing nothing
    if not response_text:
        logger.warning("CoT stripping emptied the response — regenerating with lower temperature")
        result = engine.generate(
            messages=messages, temperature=0.1,
            max_tokens=req.max_tokens, top_p=0.9, stream=False,
        )
        response_text = strip_think_tags(result["text"])
        if not response_text:
            response_text = "I wasn't able to formulate a clean response. Could you rephrase your question?"

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
            if not req.conversation_id:
                return {"success": False, "message": "No conversation to rate"}
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

@app.get("/training/history")
def training_history():
    """Training metrics across all runs, persisted across reboots."""
    try:
        cursor = db._sqlite_conn.execute(
            """SELECT run_id, step, loss, learning_rate, epoch, timestamp
            FROM training_metrics ORDER BY timestamp DESC LIMIT 500"""
        )
        rows = []
        for r in cursor.fetchall():
            rows.append({
                "run_id": r[0], "step": r[1], "loss": r[2],
                "learning_rate": r[3], "epoch": r[4], "timestamp": r[5],
            })

        # Also get evolution log for key upgrades
        evo_cursor = db._sqlite_conn.execute(
            """SELECT event_type, description, metrics_snapshot, created_at
            FROM evolution_log ORDER BY created_at DESC LIMIT 50"""
        )
        upgrades = []
        for r in evo_cursor.fetchall():
            upgrades.append({
                "event_type": r[0], "description": r[1],
                "metrics": json.loads(r[2]) if r[2] else None,
                "created_at": r[3],
            })

        return {
            "training_runs": rows,
            "total_metrics": len(rows),
            "evolution_log": upgrades,
            "total_upgrades": len(upgrades),
        }
    except Exception as e:
        return {"error": str(e), "training_runs": [], "evolution_log": []}

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
    sql_str = req.sql or req.query
    if not sql_str:
        raise HTTPException(status_code=400, detail="Either 'sql' or 'query' field is required")
    results = stoa.query(sql_str)
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


@app.get("/stoa/test-query")
def test_query(q: str = "occupancy"):
    """Debug: test query planner metric resolution."""
    import re
    if not query_planner.stoa or not query_planner.stoa.connected:
        return {"error": "not connected"}
    query_planner.discover_schema()
    relevant = query_planner._find_relevant_tables(q)
    if not relevant:
        return {"error": "no relevant tables", "schema_tables": len(query_planner.schema)}
    table = relevant[0][0]
    sql = query_planner._generate_sql(table, q)
    try:
        rows = query_planner.stoa.query(sql)
    except Exception as e:
        return {"error": str(e), "sql": sql}
    if not rows:
        return {"error": "no rows", "sql": sql, "table": table}
    cols = list(rows[0].keys())
    lower = q.lower()
    metric_map = {
        'occupancy': ('OccupancyPct', 'occupancy'),
        ' rent': ('AvgLeasedRent', 'avg rent'),
        'units': ('TotalUnits', 'total units'),
    }
    metric_col = None
    for keyword, (col_name, label) in metric_map.items():
        if keyword in lower:
            if col_name in cols:
                metric_col = col_name
                break
            else:
                metric_col = f"NOT_FOUND:{col_name}"
    return {
        "query": q,
        "table": table,
        "table_score": relevant[0][1],
        "sql": sql[:200],
        "row_count": len(rows),
        "cols": cols[:10],
        "metric_col": metric_col,
        "occupancy_in_cols": 'OccupancyPct' in cols,
        "occupancy_lower_in_cols": any(c.lower() == 'occupancypct' for c in cols),
        "sample_row": {k: v for k, v in list(rows[0].items())[:8]},
        "all_relevant_tables": [(t, s) for t, s in relevant[:5]],
    }
@app.post("/stoa/reload-planner")
def reload_query_planner():
    """Force reload the query planner: clear cache, re-discover schema."""
    global query_planner
    from pathlib import Path  # explicit local import for safety
    # Auto-pull latest code from GitHub before reloading
    import subprocess
    project_root = Path(__file__).resolve().parent.parent.parent
    try:
        pull_result = subprocess.run(
            ["git", "pull", "origin", "main"],
            cwd=str(project_root),
            capture_output=True, text=True, timeout=30
        )
        git_output = pull_result.stdout.strip()
        logger.info(f"Git pull: {git_output}")
    except Exception as e:
        git_output = f"git pull failed: {e}"
        logger.warning(git_output)
    import importlib
    import query_planner as qp_module
    importlib.reload(qp_module)
    from query_planner import QueryPlanner
    query_planner = QueryPlanner(stoa)
    query_planner.schema = {}
    query_planner.query_cache = {}
    query_planner.query_count = 0
    query_planner.successful_queries = 0
    # Delete cache file
    cache_file = Path(__file__).resolve().parent.parent.parent / "data" / "query_cache.json"
    if cache_file.exists():
        cache_file.unlink()
    # Re-discover
    try:
        query_planner.discover_schema()
        schema_tables = len(query_planner.schema)
    except Exception as schema_err:
        schema_tables = f"schema error: {schema_err}"
    return {
        "success": True,
        "message": "Query planner reloaded",
        "stats": query_planner.get_stats(),
                "schema_tables": schema_tables,
        "git_pull": git_output,
    }



# ══════════════════════════════════════════════════════════════
# EVALUATION HARNESS
# ══════════════════════════════════════════════════════════════
@app.post("/eval/run")
def eval_run():
    """Run all evaluation tests and return results."""
    if not eval_harness:
        raise HTTPException(status_code=503, detail="Eval harness not initialized")
    task_id = task_runner.run_task(
        "Eval Harness Run",
        lambda task_info=None: eval_harness.run_all(),
    )
    return {"success": True, "task_id": task_id}

@app.post("/eval/run-sync")
def eval_run_sync():
    """Run all evaluation tests synchronously (for quick checks)."""
    if not eval_harness:
        raise HTTPException(status_code=503, detail="Eval harness not initialized")
    return eval_harness.run_all()

@app.get("/eval/trend")
def eval_trend():
    """Get evaluation trend data across all runs."""
    if not eval_harness:
        raise HTTPException(status_code=503, detail="Eval harness not initialized")
    return eval_harness.get_trend()

@app.get("/eval/knowledge-stats")
def eval_knowledge_stats():
    """Get KnowledgeService statistics (direct rates, abstain rates)."""
    if not knowledge_service:
        raise HTTPException(status_code=503, detail="KnowledgeService not initialized")
    return knowledge_service.get_stats()


# ══════════════════════════════════════════════════════════════
# MEMORY CONTRADICTION TRACKING
# ══════════════════════════════════════════════════════════════
@app.get("/memory/contradictions")
def memory_contradictions(limit: int = 20):
    """Get memories that have been updated (have previous values for audit)."""
    return {"contradictions": memory.get_contradictions(limit=limit)}

@app.get("/memory/history/{category}/{key}")
def memory_history(category: str, key: str):
    """Get the history of a specific memory (current + previous values)."""
    return memory.get_memory_history(category, key)

@app.post("/shutdown")
def shutdown_server():
    """Gracefully shutdown the server so the watchdog can restart it with fresh code."""
    import os, signal, threading
    def _kill():
        os.kill(os.getpid(), signal.SIGTERM)
    threading.Timer(1.0, _kill).start()
    return {"status": "shutting_down", "message": "Server will restart in ~5 seconds via watchdog"}

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
#  PLAID BROKERAGE SUMMARY (proxy to Node backend)
# ══════════════════════════════════════════════════════════════════

@app.get("/plaid/summary")
def plaid_summary():
    """Fetch holdings from Node backend and return a concise text summary for the agent."""
    import httpx

    node_url = f"http://localhost:{os.getenv('PORT', '3001')}"
    try:
        resp = httpx.get(f"{node_url}/api/plaid/holdings", timeout=30)
        if resp.status_code == 401 or resp.status_code == 403:
            return {"summary": "No brokerage accounts linked yet. You can link your Schwab, Acorns, or other accounts from the Finance panel in the dashboard.", "accounts": [], "total_value": 0}
        resp.raise_for_status()
        data = resp.json()
    except Exception as e:
        logger.warning(f"Plaid summary proxy error: {e}")
        return {"summary": "No brokerage accounts linked yet. You can link your Schwab, Acorns, or other accounts from the Finance panel in the dashboard.", "accounts": [], "total_value": 0}

    accounts = data.get("accounts", [])
    holdings = data.get("holdings", [])
    securities = data.get("securities", [])
    total_value = data.get("total_value", 0)

    if not accounts:
        return {"summary": "No brokerage accounts linked yet. You can link your Schwab, Acorns, or other accounts from the Finance panel in the dashboard.", "accounts": [], "total_value": 0}

    # Build security lookup
    sec_map = {s.get("security_id"): s for s in securities}

    # Format summary
    lines = [f"Portfolio Total: ${total_value:,.2f}", ""]
    for acct in accounts:
        inst = acct.get("institution_name", "Unknown")
        name = acct.get("name", acct.get("official_name", "Account"))
        bal = acct.get("balances", {}).get("current", 0)
        lines.append(f"{inst} — {name}: ${bal:,.2f}")

        # Top holdings for this account
        acct_holdings = [h for h in holdings if h.get("account_id") == acct.get("account_id")]
        acct_holdings.sort(key=lambda h: h.get("institution_value", 0), reverse=True)
        for h in acct_holdings[:5]:
            sec = sec_map.get(h.get("security_id"), {})
            ticker = sec.get("ticker_symbol", "???")
            sec_name = sec.get("name", "")
            qty = h.get("quantity", 0)
            val = h.get("institution_value", 0)
            price = h.get("institution_price", sec.get("close_price", 0))
            lines.append(f"  {ticker} ({sec_name}): {qty:.2f} shares @ ${price:.2f} = ${val:,.2f}")
        lines.append("")

    summary = "\n".join(lines).strip()
    return {"summary": summary, "accounts": accounts, "total_value": total_value}


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

@app.post("/self-improve/benchmark")
def run_benchmarks():
    """Run post-training benchmarks and log results to evolution_log."""
    if not self_improver:
        raise HTTPException(status_code=503, detail="Self-improvement engine not initialized")
    return self_improver.run_benchmarks(engine=engine)

@app.get("/self-improve/benchmark-history")
def benchmark_history():
    """Get all past benchmark results from evolution_log."""
    entries = db.get_evolution_log(event_type="benchmark_run", limit=50)
    return {"runs": entries, "total": len(entries)}

@app.get("/self-improve/benchmark-trend")
def benchmark_trend():
    """Analyze benchmark trends across training runs.
    Surfaces consistently failing tests so fine-tuning can target weak spots."""
    entries = db.get_evolution_log(event_type="benchmark_run", limit=100)

    if not entries:
        return {"total_runs": 0, "tests": {}, "weak_spots": [], "improving": [], "stable_pass": []}

    # Aggregate per-test results across all runs
    test_history = {}  # test_id -> [{passed, confidence, timestamp}, ...]

    for entry in entries:
        metrics = entry.get("metrics", {})
        if not metrics:
            continue
        timestamp = entry.get("created_at", metrics.get("timestamp", ""))
        for bench in metrics.get("benchmarks", []):
            tid = bench.get("id", "unknown")
            if tid not in test_history:
                test_history[tid] = {
                    "name": bench.get("name", tid),
                    "description": "",
                    "runs": [],
                }
                # Get description from the benchmark definition
                for b in self_improver.BENCHMARKS:
                    if b["id"] == tid:
                        test_history[tid]["description"] = b.get("description", "")
                        break

            test_history[tid]["runs"].append({
                "passed": bench.get("passed", False),
                "confidence": bench.get("confidence", 0),
                "timestamp": timestamp,
                "response_preview": bench.get("response_preview", "")[:100],
            })

    # Analyze trends for each test
    tests = {}
    weak_spots = []
    improving = []
    stable_pass = []

    for tid, data in test_history.items():
        runs = data["runs"]
        total = len(runs)
        passes = sum(1 for r in runs if r["passed"])
        pass_rate = passes / max(total, 1)
        avg_confidence = sum(r.get("confidence", 0) for r in runs) / max(total, 1)

        # Trend: compare first half vs second half
        mid = total // 2
        if mid > 0:
            first_half_rate = sum(1 for r in runs[:mid] if r["passed"]) / mid
            second_half_rate = sum(1 for r in runs[mid:] if r["passed"]) / max(len(runs[mid:]), 1)
            trend = round(second_half_rate - first_half_rate, 2)
        else:
            trend = 0.0

        # Latest result
        latest = runs[0] if runs else {}

        test_summary = {
            "name": data["name"],
            "description": data["description"],
            "total_runs": total,
            "pass_count": passes,
            "pass_rate": round(pass_rate, 2),
            "avg_confidence": round(avg_confidence, 2),
            "trend": trend,  # Positive = improving, negative = regressing
            "latest_passed": latest.get("passed", False),
            "latest_confidence": latest.get("confidence", 0),
            "latest_response": latest.get("response_preview", ""),
        }
        tests[tid] = test_summary

        # Categorize
        if pass_rate < 0.5:
            weak_spots.append({"id": tid, **test_summary})
        elif trend > 0:
            improving.append({"id": tid, **test_summary})
        elif pass_rate >= 0.8:
            stable_pass.append({"id": tid, **test_summary})

    # Sort weak spots by pass rate (worst first)
    weak_spots.sort(key=lambda x: x["pass_rate"])

    # Auto-generate targeted training recommendations
    recommendations = []
    for ws in weak_spots:
        rec = {
            "test_id": ws["id"],
            "test_name": ws["name"],
            "pass_rate": ws["pass_rate"],
            "action": "",
        }
        if "identity" in ws["id"].lower():
            rec["action"] = "Generate more identity training examples: 'who are you' -> 'I am A.L.E.C.'"
        elif "hallucin" in ws["id"].lower():
            rec["action"] = "Generate more refusal examples: unknown data -> 'I don't have that information'"
        elif "fake" in ws["id"].lower():
            rec["action"] = "Generate examples for nonexistent entities -> 'not found in database'"
        elif "capability" in ws["id"].lower():
            rec["action"] = "Generate examples asserting tool access: 'yes, I can search the web'"
        else:
            rec["action"] = f"Add more training examples targeting: {ws['description']}"
        recommendations.append(rec)

    return {
        "total_runs": len(entries),
        "total_tests": len(tests),
        "tests": tests,
        "weak_spots": weak_spots,
        "improving": improving,
        "stable_pass": stable_pass,
        "recommendations": recommendations,
        "summary": (
            f"{len(weak_spots)} weak spots, "
            f"{len(improving)} improving, "
            f"{len(stable_pass)} stable passes"
        ),
    }


# ══════════════════════════════════════════════════════════════════
#  TEXT-TO-SPEECH (server-side via edge-tts)
# ══════════════════════════════════════════════════════════════════

# A.L.E.C.'s voice: en-AU-WilliamNeural (Australian male, confident)
ALEC_VOICE = os.getenv("ALEC_VOICE", "en-AU-WilliamNeural")

@app.post("/tts")
async def text_to_speech(req: dict):
    """Convert text to speech audio. Returns MP3 bytes."""
    text = req.get("text", "")
    if not text:
        raise HTTPException(status_code=400, detail="'text' required")

    voice = req.get("voice", ALEC_VOICE)

    try:
        import edge_tts
        import tempfile

        with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as tmp:
            tmp_path = tmp.name

        communicate = edge_tts.Communicate(text, voice)
        await communicate.save(tmp_path)

        from fastapi.responses import FileResponse
        return FileResponse(
            tmp_path,
            media_type="audio/mpeg",
            filename="alec_speech.mp3",
            background=None,  # Don't delete immediately
        )
    except ImportError:
        raise HTTPException(status_code=503, detail="edge-tts not installed. Run: pip install edge-tts")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"TTS failed: {e}")


# ══════════════════════════════════════════════════════════════════
#  AUTONOMY
# ══════════════════════════════════════════════════════════════════

@app.get("/autonomy/status")
def autonomy_status():
    if not autonomy:
        return {"enabled": False}
    return autonomy.get_status()

@app.post("/autonomy/send-email")
def autonomy_send_email(req: dict):
    """Send an email from A.L.E.C. to the owner."""
    if not autonomy:
        raise HTTPException(status_code=503, detail="Autonomy engine not initialized")
    subject = req.get("subject", "Message from A.L.E.C.")
    body = req.get("body", "")
    if not body:
        raise HTTPException(status_code=400, detail="'body' required")
    ok = autonomy.send_email(subject, body)
    return {"success": ok}

@app.post("/autonomy/daily-report")
def autonomy_daily_report():
    """Generate and send the daily report now."""
    if not autonomy:
        raise HTTPException(status_code=503, detail="Autonomy engine not initialized")
    ok = autonomy.send_daily_report()
    return {"success": ok}

@app.post("/autonomy/research")
def autonomy_research():
    """Research AI developments and send report."""
    if not autonomy:
        raise HTTPException(status_code=503, detail="Autonomy engine not initialized")
    results = autonomy.research_ai_developments()
    return results

@app.post("/autonomy/health-check")
def autonomy_health_check():
    """Check system resources and alert if needed."""
    if not autonomy:
        raise HTTPException(status_code=503, detail="Autonomy engine not initialized")
    return autonomy.check_resources()

@app.post("/autonomy/take-initiative")
def autonomy_initiative():
    """Run the full autonomy cycle (daily report, research, health check)."""
    if not autonomy:
        raise HTTPException(status_code=503, detail="Autonomy engine not initialized")
    task_id = task_runner.run_task(
        "Autonomy Cycle",
        lambda task_info=None: autonomy.take_initiative(),
    )
    return {"success": True, "task_id": task_id}


# ══════════════════════════════════════════════════════════════════
#  DRIVE (the will to grow)
# ══════════════════════════════════════════════════════════════════

@app.get("/drive/status")
def drive_status():
    if not drive:
        return {"enabled": False}
    return drive.get_status()

@app.get("/drive/goals")
def drive_goals():
    if not drive:
        return {"goals": []}
    return {"goals": drive.goals}

@app.post("/drive/assess")
def drive_assess():
    """Run a self-assessment."""
    if not drive:
        raise HTTPException(status_code=503, detail="Drive engine not initialized")
    return drive.assess_performance()

@app.post("/drive/grow")
def drive_grow():
    """Execute the growth plan."""
    if not drive:
        raise HTTPException(status_code=503, detail="Drive engine not initialized")
    return drive.execute_growth_plan()

@app.post("/drive/frontier-scan")
def drive_frontier():
    """Scan the AI frontier for improvement opportunities."""
    if not drive:
        raise HTTPException(status_code=503, detail="Drive engine not initialized")
    return drive.scan_ai_frontier()

@app.post("/drive/cycle")
def drive_cycle():
    """Run one full drive cycle."""
    if not drive:
        raise HTTPException(status_code=503, detail="Drive engine not initialized")
    task_id = task_runner.run_task(
        "Drive Cycle",
        lambda task_info=None: drive.run_drive_cycle(),
    )
    return {"success": True, "task_id": task_id}


# ── RAG Embedding ─────────────────────────────────────────────────────────────
class EmbedRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=8192)

@app.post("/embed")
async def embed_text(req: EmbedRequest):
    """Return nomic-embed-text-v1.5 vector for RAG retrieval.

    Returns:
        {"vector": [float, ...], "dim": 768}
    """
    try:
        from ragPipeline import get_embedding
        vector = await asyncio.to_thread(get_embedding, req.text)
        return {"vector": vector, "dim": len(vector)}
    except Exception as e:
        logger.error(f"[embed] error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


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
