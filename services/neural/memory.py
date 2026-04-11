"""
A.L.E.C. Memory System — persistent knowledge that the owner teaches directly.

This is not training data. This is INSTANT memory:
- Owner says "Stoa Group is based in Hammond, LA" → stored immediately
- Next time anyone asks about Stoa Group → A.L.E.C. knows the answer
- No retraining needed. Memory is injected into every prompt.

Memory types:
1. FACTS — things the owner teaches ("The Heights at Picardy is in Baton Rouge")
2. CORRECTIONS — things A.L.E.C. got wrong and was corrected on
3. PREFERENCES — how the owner likes things done
4. PEOPLE — info about people the owner mentions
5. PROPERTIES — real estate property details
"""

import json
import logging
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

logger = logging.getLogger("alec.memory")

MEMORY_DB = Path(__file__).resolve().parent.parent.parent / "data" / "memory.db"


class ALECMemory:
    """Persistent memory system — instant recall, no retraining needed."""

    def __init__(self):
        self._conn: Optional[sqlite3.Connection] = None
        self._init_db()

    def _init_db(self):
        MEMORY_DB.parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(str(MEMORY_DB), check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._conn.executescript("""
            CREATE TABLE IF NOT EXISTS memories (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                category TEXT NOT NULL,
                key TEXT NOT NULL,
                value TEXT NOT NULL,
                source TEXT DEFAULT 'owner',
                confidence REAL DEFAULT 1.0,
                times_referenced INTEGER DEFAULT 0,
                created_at TEXT DEFAULT (datetime('now')),
                updated_at TEXT DEFAULT (datetime('now')),
                UNIQUE(category, key)
            );
            CREATE INDEX IF NOT EXISTS idx_mem_category ON memories(category);
            CREATE INDEX IF NOT EXISTS idx_mem_key ON memories(key);

            CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
                key, value, category, content=memories, content_rowid=id
            );

            -- Triggers to keep FTS in sync
            CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
                INSERT INTO memories_fts(rowid, key, value, category) VALUES (new.id, new.key, new.value, new.category);
            END;
            CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
                INSERT INTO memories_fts(memories_fts, rowid, key, value, category) VALUES('delete', old.id, old.key, old.value, old.category);
            END;
            CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
                INSERT INTO memories_fts(memories_fts, rowid, key, value, category) VALUES('delete', old.id, old.key, old.value, old.category);
                INSERT INTO memories_fts(rowid, key, value, category) VALUES (new.id, new.key, new.value, new.category);
            END;
        """)
        self._conn.commit()
        count = self._conn.execute("SELECT COUNT(*) FROM memories").fetchone()[0]
        logger.info(f"Memory system initialized: {count} memories loaded")

    # ── Store ────────────────────────────────────────────────────

    def teach(self, category: str, key: str, value: str, source: str = "owner") -> dict:
        """
        Teach A.L.E.C. something. Stored instantly, available in all future conversations.

        Examples:
            teach("fact", "stoa_group_location", "Stoa Group is based in Hammond, Louisiana")
            teach("person", "alec_rovner", "Alec Rovner is the founder of Stoa Group and Campus Rentals LLC")
            teach("property", "heights_at_picardy", "The Heights at Picardy is a student housing property in Baton Rouge, LA")
            teach("correction", "stoa_not_nyc", "Stoa Group is NOT in New York. It's in Hammond, LA.")
            teach("preference", "response_style", "Alec prefers short, direct answers")
        """
        now = datetime.now(timezone.utc).isoformat()
        try:
            # Check if this key already exists (for version tracking)
            existing = self._conn.execute(
                "SELECT value, version FROM memories WHERE category = ? AND key = ?",
                (category, key)
            ).fetchone()
            prev_value = None
            new_version = 1
            if existing:
                prev_value = existing[0]
                new_version = (existing[1] or 1) + 1
            self._conn.execute("""
                INSERT INTO memories (category, key, value, source, created_at, updated_at, previous_value, version)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(category, key) DO UPDATE SET
                    value = excluded.value,
                    source = excluded.source,
                    updated_at = excluded.updated_at,
                    previous_value = memories.value,
                    version = memories.version + 1
            """, (category, key, value, source, now, now, prev_value, new_version))
            self._conn.commit()
            logger.info(f"Memory stored: [{category}] {key}")
            return {"success": True, "category": category, "key": key}
        except Exception as e:
            logger.error(f"Failed to store memory: {e}")
            return {"error": str(e)}

    def learn_from_correction(self, wrong: str, right: str, context: str = "") -> dict:
        """Store a correction so A.L.E.C. never makes the same mistake."""
        key = f"correction_{hash(wrong) % 100000}"
        value = f"WRONG: {wrong}\nCORRECT: {right}"
        if context:
            value += f"\nCONTEXT: {context}"
        return self.teach("correction", key, value, source="correction")

    def learn_from_conversation(self, user_message: str, alec_response: str, user_feedback: str) -> dict:
        """Extract and store facts from a conversation where the user provided feedback."""
        # If the user corrected A.L.E.C., store the correction
        if any(word in user_feedback.lower() for word in ["wrong", "incorrect", "no", "nope", "actually"]):
            return self.learn_from_correction(
                wrong=alec_response[:200],
                right=user_feedback,
                context=user_message[:200],
            )
        return {"stored": False, "reason": "No correction detected"}

    # ── Recall ───────────────────────────────────────────────────

    def recall(self, query: str, limit: int = 10) -> list[dict]:
        """Search memory for relevant facts. Uses full-text search."""
        try:
            cursor = self._conn.execute("""
                SELECT m.id, m.category, m.key, m.value, m.source, m.confidence,
                       m.times_referenced, m.created_at
                FROM memories_fts f
                JOIN memories m ON f.rowid = m.id
                WHERE memories_fts MATCH ?
                ORDER BY rank
                LIMIT ?
            """, (query, limit))
            results = [dict(row) for row in cursor.fetchall()]

            # Update reference counts
            for r in results:
                self._conn.execute(
                    "UPDATE memories SET times_referenced = times_referenced + 1 WHERE id = ?",
                    (r["id"],)
                )
            if results:
                self._conn.commit()

            return results
        except Exception:
            # Fallback to LIKE search if FTS fails
            try:
                cursor = self._conn.execute("""
                    SELECT * FROM memories
                    WHERE value LIKE ? OR key LIKE ?
                    ORDER BY times_referenced DESC
                    LIMIT ?
                """, (f"%{query}%", f"%{query}%", limit))
                return [dict(row) for row in cursor.fetchall()]
            except Exception as e:
                logger.error(f"Memory recall failed: {e}")
                return []

    def recall_by_category(self, category: str, limit: int = 50) -> list[dict]:
        """Get all memories in a category."""
        cursor = self._conn.execute(
            "SELECT * FROM memories WHERE category = ? ORDER BY updated_at DESC LIMIT ?",
            (category, limit)
        )
        return [dict(row) for row in cursor.fetchall()]

    def get_core_memories(self, limit: int = 20) -> list[dict]:
        """Get the most important memories — always injected, every conversation, forever."""
        try:
            cursor = self._conn.execute("""
                SELECT * FROM memories
                ORDER BY
                    CASE category
                        WHEN 'correction' THEN 1
                        WHEN 'person' THEN 2
                        WHEN 'company' THEN 3
                        WHEN 'property' THEN 4
                        WHEN 'preference' THEN 5
                        WHEN 'fact' THEN 6
                        ELSE 7
                    END,
                    times_referenced DESC,
                    updated_at DESC
                LIMIT ?
            """, (limit,))
            return [dict(row) for row in cursor.fetchall()]
        except Exception:
            return []

    def get_context_injection(self, user_message: str, max_memories: int = 20) -> str:
        """
        Generate a context string injected into EVERY prompt, EVERY conversation.
        Memory persists forever across all sessions. A.L.E.C. never forgets.

        Priority: corrections > people > companies > properties > preferences > facts
        Plus: query-specific memories relevant to the current message.
        """
        seen_ids = set()
        parts = []

        # 1. ALWAYS include core memories (every single conversation, forever)
        core = self.get_core_memories(limit=10)
        if core:
            parts.append("## PERMANENT KNOWLEDGE (you were taught these — always use them):")
            for m in core:
                parts.append(f"- [{m['category']}] {m['value']}")
                seen_ids.add(m['id'])

        # 2. Always include ALL corrections (never repeat mistakes)
        corrections = self.recall_by_category("correction", limit=10)
        new_corrections = [c for c in corrections if c['id'] not in seen_ids]
        if new_corrections:
            parts.append("\n## CORRECTIONS (mistakes you made — NEVER repeat these):")
            for c in new_corrections:
                parts.append(f"- {c['value']}")
                seen_ids.add(c['id'])

        # 3. Search for memories relevant to THIS specific message
        remaining = max_memories - len(seen_ids)
        if remaining > 0 and user_message:
            relevant = self.recall(user_message, limit=remaining)
            new_relevant = [r for r in relevant if r['id'] not in seen_ids]
            if new_relevant:
                parts.append("\n## RELEVANT TO THIS QUESTION:")
                for r in new_relevant:
                    parts.append(f"- [{r['category']}] {r['value']}")

        return "\n".join(parts) if parts else ""

    # ── Management ───────────────────────────────────────────────

    def get_all(self, limit: int = 100) -> list[dict]:
        cursor = self._conn.execute(
            "SELECT * FROM memories ORDER BY updated_at DESC LIMIT ?", (limit,)
        )
        return [dict(row) for row in cursor.fetchall()]

    def delete(self, memory_id: int) -> bool:
        self._conn.execute("DELETE FROM memories WHERE id = ?", (memory_id,))
        self._conn.commit()
        return True

    def get_stats(self) -> dict:
        total = self._conn.execute("SELECT COUNT(*) FROM memories").fetchone()[0]
        categories = {}
        for row in self._conn.execute("SELECT category, COUNT(*) as cnt FROM memories GROUP BY category"):
            categories[row[0]] = row[1]
        most_referenced = self._conn.execute(
            "SELECT key, value, times_referenced FROM memories ORDER BY times_referenced DESC LIMIT 5"
        ).fetchall()

        return {
            "total_memories": total,
            "categories": categories,
            "most_referenced": [dict(r) for r in most_referenced],
            "db_path": str(MEMORY_DB),
        }
