#!/usr/bin/env python3
"""
harvest-sft-corpus.py — pull high-rated conversations into the SFT corpus.

Reads from the alec.db `conversations` table and appends positively-rated
rows (user_rating >= 4) to services/neural/data/sft/conversations.jsonl
in the OpenAI chat-turn format expected by downstream fine-tuners
(Unsloth / torchtune / trl).

Safe to re-run: uses (created_at, session_id, user_message) as a dedup key
against what's already in the JSONL file.

Format:
    {"messages": [
        {"role": "system", "content": "..."},
        {"role": "user", "content": "..."},
        {"role": "assistant", "content": "..."}
    ], "meta": {"rating": 5, "session_id": "...", "created_at": "..."}}

Run:
    python scripts/harvest-sft-corpus.py
    python scripts/harvest-sft-corpus.py --min-rating 3   # include neutrals
    python scripts/harvest-sft-corpus.py --dry-run         # count only
"""
from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CORPUS_PATH = ROOT / "services" / "neural" / "data" / "sft" / "conversations.jsonl"

# The `conversations` table may live in any of these DBs depending on which
# process populated it (neural engine in-repo, desktop userData, or bundle).
# Probe in order; first one that has the table wins.
CANDIDATE_DBS = [
    ROOT / "data" / "alec.db",
    Path.home() / "Library" / "Application Support" / "alec-desktop" / "alec-data" / "alec.db",
    Path("/Applications/ALEC.app/Contents/Resources/alec/data/alec.db"),
]


def _resolve_db() -> Path:
    for p in CANDIDATE_DBS:
        if not p.exists():
            continue
        try:
            conn = sqlite3.connect(str(p))
            row = conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name='conversations'"
            ).fetchone()
            conn.close()
            if row:
                return p
        except sqlite3.Error:
            continue
    print("error: no alec.db candidate contains a 'conversations' table.", file=sys.stderr)
    for p in CANDIDATE_DBS:
        print(f"  - tried: {p}", file=sys.stderr)
    sys.exit(2)

DEFAULT_SYSTEM_PROMPT = (
    "You are A.L.E.C., Alec Rovner's personal AI chief-of-staff. You are direct, "
    "action-oriented, and never fabricate data. When a tool is required and "
    "unavailable, say so plainly instead of inventing output."
)


def load_existing_keys(path: Path) -> set[str]:
    keys: set[str] = set()
    if not path.exists():
        return keys
    with path.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                continue
            meta = row.get("meta", {})
            msgs = row.get("messages", [])
            user_msg = next(
                (m.get("content", "") for m in msgs if m.get("role") == "user"),
                "",
            )
            key = f"{meta.get('created_at', '')}|{meta.get('session_id', '')}|{user_msg[:120]}"
            keys.add(key)
    return keys


def harvest(min_rating: int, dry_run: bool) -> tuple[int, int]:
    db_path = _resolve_db()
    print(f"source db: {db_path}")

    CORPUS_PATH.parent.mkdir(parents=True, exist_ok=True)
    existing = load_existing_keys(CORPUS_PATH)

    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    rows = conn.execute(
        """
        SELECT id, session_id, user_message, alec_response,
               user_rating, feedback, created_at
          FROM conversations
         WHERE user_rating IS NOT NULL
           AND user_rating >= ?
           AND user_message IS NOT NULL
           AND alec_response IS NOT NULL
           AND LENGTH(user_message) > 3
         ORDER BY created_at ASC
        """,
        (min_rating,),
    ).fetchall()
    conn.close()

    added = 0
    skipped = 0
    mode = "a" if CORPUS_PATH.exists() else "w"
    buf: list[str] = []
    for r in rows:
        key = f"{r['created_at']}|{r['session_id']}|{(r['user_message'] or '')[:120]}"
        if key in existing:
            skipped += 1
            continue
        example = {
            "messages": [
                {"role": "system", "content": DEFAULT_SYSTEM_PROMPT},
                {"role": "user", "content": r["user_message"]},
                {"role": "assistant", "content": r["alec_response"]},
            ],
            "meta": {
                "rating": r["user_rating"],
                "feedback": r["feedback"] or "",
                "session_id": r["session_id"],
                "created_at": r["created_at"],
                "source_row_id": r["id"],
            },
        }
        buf.append(json.dumps(example, ensure_ascii=False))
        existing.add(key)
        added += 1

    if not dry_run and buf:
        with CORPUS_PATH.open(mode, encoding="utf-8") as f:
            f.write("\n".join(buf))
            f.write("\n")

    return added, skipped


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--min-rating", type=int, default=4,
                    help="Minimum user_rating to include (default: 4)")
    ap.add_argument("--dry-run", action="store_true",
                    help="Count candidates without writing")
    args = ap.parse_args()

    added, skipped = harvest(args.min_rating, args.dry_run)
    verb = "would add" if args.dry_run else "added"
    print(f"{verb} {added} example(s); skipped {skipped} duplicate(s)")
    print(f"corpus: {CORPUS_PATH}")
    if not args.dry_run and CORPUS_PATH.exists():
        total = sum(1 for _ in CORPUS_PATH.open("r", encoding="utf-8") if _.strip())
        print(f"total examples in corpus: {total}")


if __name__ == "__main__":
    main()
