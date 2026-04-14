"""
ragPipeline.py — nomic-embed-text embedding module for A.L.E.C. RAG.

Provides get_embedding(text) -> list[float] (768-dim, L2-normalized).
Lazy-loads nomic-ai/nomic-embed-text-v1.5 on first call.
Thread-safe via double-checked locking.
Called by server.py POST /embed endpoint.
"""
import logging
import threading
from typing import Optional

logger = logging.getLogger("alec.rag")

_model: Optional[object] = None
_model_lock = threading.Lock()


def _get_model():
    global _model
    if _model is None:
        with _model_lock:
            if _model is None:  # double-checked locking
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
