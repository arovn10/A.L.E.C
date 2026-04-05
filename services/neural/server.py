"""
A.L.E.C. Neural Engine — FastAPI Server.
Provides OpenAI-compatible /v1/chat/completions endpoint plus
training, feedback, and health APIs.

Port 8000 by default. Called by the Node.js backend on localhost.
"""

import os
import uuid
import time
import logging
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from dotenv import load_dotenv

load_dotenv()

from engine import ALECEngine
from database import ALECDatabase
from training import ALECTrainer

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


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Load model on startup, clean up on shutdown."""
    # Resolve MODEL_PATH relative to project root (two dirs up from services/neural/)
    raw_path = os.getenv(
        "MODEL_PATH", "data/models/qwen2.5-coder-7b-instruct-q4_k_m.gguf"
    )
    project_root = Path(__file__).resolve().parent.parent.parent
    model_path = str(project_root / raw_path) if not os.path.isabs(raw_path) else raw_path
    n_ctx = int(os.getenv("MODEL_CONTEXT_LENGTH", "4096"))
    n_gpu = int(os.getenv("N_GPU_LAYERS", "-1"))

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

    yield  # app runs here

    logger.info("Shutting down neural engine.")


# ── FastAPI app ──────────────────────────────────────────────────
app = FastAPI(title="A.L.E.C. Neural Engine", version="1.0.0", lifespan=lifespan)

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
    model: str = "alec-local"
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


# ── Health / Info ────────────────────────────────────────────────

@app.get("/health")
def health():
    return {
        "status": "ok",
        "model_loaded": engine.model_loaded,
        "service": "alec-neural-engine",
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }


@app.get("/v1/models")
def list_models():
    info = engine.get_model_info()
    return {
        "object": "list",
        "data": [
            {
                "id": "alec-local",
                "object": "model",
                "owned_by": "alec-rovner",
                "loaded": info["loaded"],
                "model_name": info.get("model_name"),
            }
        ],
    }


@app.get("/model/info")
def model_info():
    return engine.get_model_info()


# ── Chat Completions (OpenAI-compatible) ─────────────────────────

@app.post("/v1/chat/completions")
async def chat_completions(req: ChatRequest):
    if not engine.model_loaded:
        raise HTTPException(
            status_code=503,
            detail="Model not loaded. Download the model first: bash scripts/download-model.sh",
        )

    messages = [{"role": m.role, "content": m.content} for m in req.messages]
    session_id = req.session_id or uuid.uuid4().hex[:12]

    if req.stream:
        return StreamingResponse(
            _stream_response(messages, req, session_id),
            media_type="text/event-stream",
        )

    # Non-streaming
    result = engine.generate(
        messages=messages,
        temperature=req.temperature,
        max_tokens=req.max_tokens,
        top_p=req.top_p,
        top_k=req.top_k,
        stream=False,
    )

    # Log to database
    user_msg = next((m.content for m in req.messages if m.role == "user"), "")
    try:
        conv_id = db.log_conversation(
            session_id=session_id,
            user_message=user_msg,
            alec_response=result["text"],
            confidence=0.0,
            model_used="qwen2.5-coder-7b",
            tokens_in=result["prompt_tokens"],
            tokens_out=result["completion_tokens"],
            latency_ms=result["latency_ms"],
        )
    except Exception as e:
        logger.warning(f"Failed to log conversation: {e}")
        conv_id = None

    # Return OpenAI-compatible format
    return {
        "id": f"chatcmpl-{uuid.uuid4().hex[:8]}",
        "object": "chat.completion",
        "created": int(time.time()),
        "model": "alec-local",
        "choices": [
            {
                "index": 0,
                "message": {"role": "assistant", "content": result["text"]},
                "finish_reason": result["finish_reason"],
            }
        ],
        "usage": {
            "prompt_tokens": result["prompt_tokens"],
            "completion_tokens": result["completion_tokens"],
            "total_tokens": result["total_tokens"],
        },
        "conversation_id": conv_id,
        "latency_ms": result["latency_ms"],
    }


async def _stream_response(messages, req, session_id):
    """SSE streaming generator."""
    import json as _json

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
            "model": "alec-local",
            "choices": [
                {"index": 0, "delta": {"content": chunk}, "finish_reason": None}
            ],
        }
        yield f"data: {_json.dumps(payload)}\n\n"

    # Final chunk
    yield "data: [DONE]\n\n"

    # Log complete response
    full_text = "".join(collected)
    user_msg = next(
        (m["content"] for m in messages if m["role"] == "user"), ""
    )
    try:
        db.log_conversation(
            session_id=session_id,
            user_message=user_msg,
            alec_response=full_text,
            model_used="qwen2.5-coder-7b",
        )
    except Exception:
        pass


# ── Feedback ─────────────────────────────────────────────────────

@app.post("/feedback")
def submit_feedback(req: FeedbackRequest):
    try:
        db.rate_conversation(req.conversation_id, req.rating, req.feedback)
        return {"success": True, "message": "Feedback recorded"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Conversations ────────────────────────────────────────────────

@app.get("/conversations")
def get_conversations(limit: int = 50, rated_only: bool = False):
    return {"conversations": db.get_conversations(limit=limit, rated_only=rated_only)}


# ── Training ─────────────────────────────────────────────────────

@app.post("/training/start")
def start_training(req: TrainingRequest):
    try:
        run_id = trainer.start_training(
            data_path=req.data_path, config=req.config
        )
        return {"success": True, "run_id": run_id}
    except RuntimeError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))


@app.get("/training/status")
def training_status():
    return trainer.get_status()


@app.get("/training/adapters")
def list_adapters():
    return {"adapters": trainer.get_available_adapters()}


@app.post("/training/export")
def export_training_data():
    """Export rated conversations as JSONL for LoRA training."""
    count = db.export_training_data()
    return {"success": True, "examples_exported": count}


# ── Run ──────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("NEURAL_PORT", "8000"))
    is_dev = os.getenv("NODE_ENV") == "development"
    uvicorn.run(
        "server:app",
        host="0.0.0.0",
        port=port,
        reload=is_dev,
        reload_excludes=[".*", ".venv/*", "__pycache__/*", "*.pyc"] if is_dev else None,
        log_level="info",
    )
