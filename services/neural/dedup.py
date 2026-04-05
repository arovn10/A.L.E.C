"""
A.L.E.C. Dedup Cache — Shared cross-cycle deduplication for autonomous scans.

Every autonomous subsystem (research, frontier scan, innovation, growth plan,
smart home patterns) produces findings/actions that repeat across cycles.
This module provides a single persistent {key: timestamp} cache on disk so
the same item doesn't resurface until it expires.

Usage:
    cache = DedupCache("research")       # → data/dedup/research.json
    cache = DedupCache("frontier_opps")  # → data/dedup/frontier_opps.json

    if cache.is_new(url):
        # first time seeing this URL
        ...
    cache.mark_seen(url)
    cache.save()           # prunes expired entries and writes to disk
"""

import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

logger = logging.getLogger("alec.dedup")

DATA_DIR = Path(__file__).resolve().parent.parent.parent / "data" / "dedup"

# Default: items older than this can resurface
DEFAULT_TTL_DAYS = 90


class DedupCache:
    """
    Persistent URL/key → ISO-timestamp cache backed by a JSON file.

    Supports:
    - Cross-cycle dedup  (same key won't pass is_new until TTL expires)
    - Within-cycle dedup (batch_filter deduplicates a list in one call)
    - TTL-based expiry   (pruned on every save)
    - Atomic save        (write-then-rename for crash safety)
    """

    def __init__(self, namespace: str, ttl_days: int = DEFAULT_TTL_DAYS):
        """
        Args:
            namespace: Unique name for this cache.  Becomes the filename.
            ttl_days:  Days before an entry expires and can resurface.
        """
        self.namespace = namespace
        self.ttl_days = ttl_days
        self._file = DATA_DIR / f"{namespace}.json"
        self._seen: dict[str, str] = self._load()

    # ── Public API ────────────────────────────────────────────

    def is_new(self, key: str) -> bool:
        """True if this key hasn't been seen (or has expired)."""
        return key not in self._seen

    def mark_seen(self, key: str) -> None:
        """Record that we've seen this key now."""
        self._seen[key] = datetime.now(timezone.utc).isoformat()

    def mark_many(self, keys: list[str]) -> None:
        """Record multiple keys at once."""
        now = datetime.now(timezone.utc).isoformat()
        for k in keys:
            self._seen[k] = now

    def batch_filter(self, items: list[dict], key_field: str = "url") -> tuple[list[dict], int]:
        """
        Filter a list of dicts, returning only unseen items.
        Marks accepted items as seen automatically.

        Returns:
            (new_items, skipped_count)
        """
        new = []
        skipped = 0
        now = datetime.now(timezone.utc).isoformat()
        within_cycle: set[str] = set()

        for item in items:
            key = item.get(key_field, "")
            if not key:
                new.append(item)
                continue
            if key in within_cycle or key in self._seen:
                skipped += 1
                continue
            within_cycle.add(key)
            self._seen[key] = now
            new.append(item)

        return new, skipped

    def save(self) -> None:
        """Prune expired entries and persist to disk."""
        self._prune()
        try:
            DATA_DIR.mkdir(parents=True, exist_ok=True)
            tmp = self._file.with_suffix(".tmp")
            tmp.write_text(json.dumps(self._seen, indent=2))
            tmp.rename(self._file)        # atomic on POSIX
        except Exception as e:
            logger.warning(f"[dedup:{self.namespace}] save failed: {e}")

    @property
    def size(self) -> int:
        return len(self._seen)

    # ── Internals ─────────────────────────────────────────────

    def _load(self) -> dict[str, str]:
        try:
            if self._file.exists():
                data = json.loads(self._file.read_text())
                if isinstance(data, dict):
                    return data
        except Exception as e:
            logger.warning(f"[dedup:{self.namespace}] load failed: {e}")
        return {}

    def _prune(self) -> None:
        now = datetime.now(timezone.utc)
        pruned = {}
        for key, ts in self._seen.items():
            try:
                seen_dt = datetime.fromisoformat(ts)
                if (now - seen_dt).days <= self.ttl_days:
                    pruned[key] = ts
            except (ValueError, TypeError):
                continue
        self._seen = pruned
