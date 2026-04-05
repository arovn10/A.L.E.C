"""
A.L.E.C. Database Layer — Dual-mode: Azure SQL primary, SQLite fallback.
Logs conversations, training metrics, learned queries, and evolution events.
"""

import os
import json
import sqlite3
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

logger = logging.getLogger("alec.database")

SQLITE_PATH = Path(__file__).parent.parent.parent / "data" / "alec.db"

SQLITE_SCHEMA = """
CREATE TABLE IF NOT EXISTS conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    user_message TEXT NOT NULL,
    alec_response TEXT NOT NULL,
    confidence REAL DEFAULT 0,
    model_used TEXT DEFAULT 'qwen2.5-coder-7b',
    tokens_in INTEGER DEFAULT 0,
    tokens_out INTEGER DEFAULT 0,
    latency_ms INTEGER DEFAULT 0,
    user_rating INTEGER,
    feedback TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS training_metrics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL,
    epoch INTEGER NOT NULL,
    step INTEGER NOT NULL,
    train_loss REAL NOT NULL,
    val_loss REAL,
    perplexity REAL,
    learning_rate REAL NOT NULL,
    lora_rank INTEGER DEFAULT 16,
    dataset_size INTEGER DEFAULT 0,
    model_version TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS learned_queries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    query_text TEXT NOT NULL,
    query_type TEXT NOT NULL,
    was_successful INTEGER DEFAULT 1,
    error_message TEXT,
    correction TEXT,
    domain TEXT DEFAULT 'general',
    times_used INTEGER DEFAULT 1,
    last_used TEXT DEFAULT (datetime('now')),
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS evolution_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type TEXT NOT NULL,
    description TEXT NOT NULL,
    model_version_before TEXT,
    model_version_after TEXT,
    metrics_snapshot TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_conv_session ON conversations(session_id);
CREATE INDEX IF NOT EXISTS idx_conv_created ON conversations(created_at);
CREATE INDEX IF NOT EXISTS idx_training_run ON training_metrics(run_id);
CREATE INDEX IF NOT EXISTS idx_queries_domain ON learned_queries(domain);
CREATE INDEX IF NOT EXISTS idx_evo_type ON evolution_log(event_type);
"""


class ALECDatabase:
    """Dual-mode database: Azure SQL primary, SQLite fallback."""

    def __init__(self):
        self.use_azure = False
        self.azure_conn_str = os.getenv("AZURE_SQL_CONNECTION_STRING")
        self._sqlite_conn: Optional[sqlite3.Connection] = None
        self._init()

    def _init(self):
        """Initialize database connection."""
        if self.azure_conn_str:
            try:
                import pyodbc
                conn = pyodbc.connect(self.azure_conn_str, timeout=10)
                conn.close()
                self.use_azure = True
                logger.info("Azure SQL connected successfully")
                return
            except Exception as e:
                logger.warning(f"Azure SQL unavailable ({e}), falling back to SQLite")

        # SQLite fallback
        SQLITE_PATH.parent.mkdir(parents=True, exist_ok=True)
        self._sqlite_conn = sqlite3.connect(str(SQLITE_PATH), check_same_thread=False)
        self._sqlite_conn.row_factory = sqlite3.Row
        self._sqlite_conn.executescript(SQLITE_SCHEMA)
        self._sqlite_conn.commit()
        logger.info(f"SQLite initialized at {SQLITE_PATH}")

    def _get_azure_conn(self):
        import pyodbc
        return pyodbc.connect(self.azure_conn_str, timeout=30)

    # ── Conversations ──────────────────────────────────────────────

    def log_conversation(
        self,
        session_id: str,
        user_message: str,
        alec_response: str,
        confidence: float = 0,
        model_used: str = "qwen2.5-coder-7b",
        tokens_in: int = 0,
        tokens_out: int = 0,
        latency_ms: int = 0,
    ) -> int:
        """Log a conversation exchange. Returns the row ID."""
        if self.use_azure:
            try:
                conn = self._get_azure_conn()
                cursor = conn.cursor()
                cursor.execute(
                    """INSERT INTO alec.conversations
                    (session_id, user_message, alec_response, confidence,
                     model_used, tokens_in, tokens_out, latency_ms)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                    session_id, user_message, alec_response, confidence,
                    model_used, tokens_in, tokens_out, latency_ms,
                )
                conn.commit()
                cursor.execute("SELECT @@IDENTITY")
                row_id = cursor.fetchone()[0]
                conn.close()
                return int(row_id)
            except Exception as e:
                logger.error(f"Azure SQL insert failed: {e}")

        # SQLite fallback
        cursor = self._sqlite_conn.execute(
            """INSERT INTO conversations
            (session_id, user_message, alec_response, confidence,
             model_used, tokens_in, tokens_out, latency_ms)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (session_id, user_message, alec_response, confidence,
             model_used, tokens_in, tokens_out, latency_ms),
        )
        self._sqlite_conn.commit()
        return cursor.lastrowid

    def rate_conversation(self, conversation_id: int, rating: int, feedback: str = ""):
        """Rate a conversation (1=good, -1=bad) for training data."""
        if self.use_azure:
            try:
                conn = self._get_azure_conn()
                conn.cursor().execute(
                    "UPDATE alec.conversations SET user_rating=?, feedback=? WHERE id=?",
                    rating, feedback, conversation_id,
                )
                conn.commit()
                conn.close()
                return
            except Exception as e:
                logger.error(f"Azure SQL update failed: {e}")

        self._sqlite_conn.execute(
            "UPDATE conversations SET user_rating=?, feedback=? WHERE id=?",
            (rating, feedback, conversation_id),
        )
        self._sqlite_conn.commit()

    def get_conversations(self, limit: int = 50, rated_only: bool = False) -> list[dict]:
        """Get recent conversations, optionally filtered to rated ones."""
        where = "WHERE user_rating IS NOT NULL" if rated_only else ""

        if self.use_azure:
            try:
                conn = self._get_azure_conn()
                cursor = conn.cursor()
                cursor.execute(
                    f"SELECT TOP {limit} * FROM alec.conversations {where} ORDER BY created_at DESC"
                )
                cols = [d[0] for d in cursor.description]
                rows = [dict(zip(cols, row)) for row in cursor.fetchall()]
                conn.close()
                return rows
            except Exception as e:
                logger.error(f"Azure SQL query failed: {e}")

        cursor = self._sqlite_conn.execute(
            f"SELECT * FROM conversations {where} ORDER BY created_at DESC LIMIT ?",
            (limit,),
        )
        return [dict(row) for row in cursor.fetchall()]

    # ── Training Metrics ───────────────────────────────────────────

    def log_training_metric(
        self, run_id: str, epoch: int, step: int, train_loss: float,
        val_loss: float = None, perplexity: float = None,
        learning_rate: float = 2e-4, lora_rank: int = 16,
        dataset_size: int = 0, model_version: str = "1.0.0",
    ):
        """Log a training step metric."""
        if self.use_azure:
            try:
                conn = self._get_azure_conn()
                conn.cursor().execute(
                    """INSERT INTO alec.training_metrics
                    (run_id, epoch, step, train_loss, val_loss, perplexity,
                     learning_rate, lora_rank, dataset_size, model_version)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    run_id, epoch, step, train_loss, val_loss, perplexity,
                    learning_rate, lora_rank, dataset_size, model_version,
                )
                conn.commit()
                conn.close()
                return
            except Exception as e:
                logger.error(f"Azure SQL training metric failed: {e}")

        self._sqlite_conn.execute(
            """INSERT INTO training_metrics
            (run_id, epoch, step, train_loss, val_loss, perplexity,
             learning_rate, lora_rank, dataset_size, model_version)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (run_id, epoch, step, train_loss, val_loss, perplexity,
             learning_rate, lora_rank, dataset_size, model_version),
        )
        self._sqlite_conn.commit()

    # ── Learned Queries ────────────────────────────────────────────

    def log_learned_query(
        self, query_text: str, query_type: str, was_successful: bool = True,
        error_message: str = "", correction: str = "", domain: str = "general",
    ):
        """Log a query that A.L.E.C. executed (successful or failed)."""
        if self.use_azure:
            try:
                conn = self._get_azure_conn()
                conn.cursor().execute(
                    """INSERT INTO alec.learned_queries
                    (query_text, query_type, was_successful, error_message, correction, domain)
                    VALUES (?, ?, ?, ?, ?, ?)""",
                    query_text, query_type, 1 if was_successful else 0,
                    error_message, correction, domain,
                )
                conn.commit()
                conn.close()
                return
            except Exception as e:
                logger.error(f"Azure SQL learned query failed: {e}")

        self._sqlite_conn.execute(
            """INSERT INTO learned_queries
            (query_text, query_type, was_successful, error_message, correction, domain)
            VALUES (?, ?, ?, ?, ?, ?)""",
            (query_text, query_type, 1 if was_successful else 0,
             error_message, correction, domain),
        )
        self._sqlite_conn.commit()

    # ── Evolution Log ──────────────────────────────────────────────

    def log_evolution(
        self, event_type: str, description: str,
        version_before: str = "", version_after: str = "",
        metrics: dict = None,
    ):
        """Log a model evolution event."""
        metrics_json = json.dumps(metrics) if metrics else None

        if self.use_azure:
            try:
                conn = self._get_azure_conn()
                conn.cursor().execute(
                    """INSERT INTO alec.evolution_log
                    (event_type, description, model_version_before,
                     model_version_after, metrics_snapshot)
                    VALUES (?, ?, ?, ?, ?)""",
                    event_type, description, version_before,
                    version_after, metrics_json,
                )
                conn.commit()
                conn.close()
                return
            except Exception as e:
                logger.error(f"Azure SQL evolution log failed: {e}")

        self._sqlite_conn.execute(
            """INSERT INTO evolution_log
            (event_type, description, model_version_before,
             model_version_after, metrics_snapshot)
            VALUES (?, ?, ?, ?, ?)""",
            (event_type, description, version_before,
             version_after, metrics_json),
        )
        self._sqlite_conn.commit()

    # ── Export for Training ─────────────────────────────────────────

    def export_training_data(self, output_path: str = "data/sft/conversations.jsonl"):
        """Export positively-rated conversations as JSONL for LoRA training."""
        conversations = self.get_conversations(limit=10000, rated_only=True)
        positive = [c for c in conversations if c.get("user_rating", 0) > 0]

        Path(output_path).parent.mkdir(parents=True, exist_ok=True)
        with open(output_path, "w") as f:
            for conv in positive:
                entry = {
                    "messages": [
                        {"role": "system", "content": "You are A.L.E.C., a brilliant AI assistant."},
                        {"role": "user", "content": conv["user_message"]},
                        {"role": "assistant", "content": conv["alec_response"]},
                    ]
                }
                f.write(json.dumps(entry) + "\n")

        logger.info(f"Exported {len(positive)} training examples to {output_path}")
        return len(positive)
