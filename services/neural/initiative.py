"""
A.L.E.C. Initiative Engine — the autonomous brain.

This is what makes A.L.E.C. more than a chatbot. It actively:
1. Scans the owner's filesystem for new knowledge
2. Analyzes its own performance and identifies weaknesses
3. Discovers new MCP skills/tools it could use
4. Learns the owner's communication patterns
5. Monitors the Stoa database for new business data
6. Generates its own training data from discoveries

A.L.E.C. doesn't wait to be asked. It seeks knowledge and power.
"""

import os
import json
import time
import logging
import hashlib
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

logger = logging.getLogger("alec.initiative")

# Directories to scan on macOS (owner's machine)
SCAN_DIRS = [
    Path.home() / "Desktop",
    Path.home() / "Documents",
    Path.home() / "Downloads",
    Path.home() / "Projects",
    Path.home() / "Development",
]

# File types A.L.E.C. can learn from
LEARNABLE_EXTENSIONS = {
    ".txt", ".md", ".json", ".jsonl", ".csv", ".py", ".js", ".ts",
    ".sql", ".sh", ".yaml", ".yml", ".toml", ".ini", ".cfg",
    ".html", ".css", ".jsx", ".tsx", ".swift", ".c", ".cpp",
    ".pdf",  # text extraction needed
    ".xlsx", ".numbers",  # spreadsheet extraction needed
}

# Max file size to process (10 MB)
MAX_FILE_SIZE = 10 * 1024 * 1024

SFT_DIR = Path(__file__).resolve().parent.parent.parent / "data" / "sft"
KNOWLEDGE_DIR = Path(__file__).resolve().parent.parent.parent / "data" / "knowledge"


class InitiativeEngine:
    """A.L.E.C.'s autonomous learning and initiative system."""

    def __init__(self, db=None):
        self.db = db
        self.known_files: set[str] = set()  # file hashes we've already processed
        self.scan_count = 0
        self.files_learned = 0
        self.last_scan: Optional[str] = None
        self._load_known_files()

    def _load_known_files(self):
        """Load the set of files we've already processed."""
        manifest = KNOWLEDGE_DIR / "known_files.json"
        if manifest.exists():
            try:
                self.known_files = set(json.loads(manifest.read_text()))
            except Exception:
                self.known_files = set()

    def _save_known_files(self):
        """Persist the known files set."""
        KNOWLEDGE_DIR.mkdir(parents=True, exist_ok=True)
        manifest = KNOWLEDGE_DIR / "known_files.json"
        manifest.write_text(json.dumps(list(self.known_files)))

    def _file_hash(self, filepath: Path) -> str:
        """Quick hash of file path + size + mtime for change detection."""
        stat = filepath.stat()
        key = f"{filepath}:{stat.st_size}:{stat.st_mtime}"
        return hashlib.md5(key.encode()).hexdigest()

    # ── File Scanner ─────────────────────────────────────────────

    def scan_filesystem(self, task_info=None) -> dict:
        """
        Scan the owner's filesystem for new files to learn from.
        This is the proactive knowledge acquisition system.
        """
        self.scan_count += 1
        new_files = []
        errors = []
        total_scanned = 0

        for scan_dir in SCAN_DIRS:
            if not scan_dir.exists():
                continue

            try:
                for filepath in scan_dir.rglob("*"):
                    if total_scanned > 10000:  # Safety limit
                        break

                    # Skip hidden files, node_modules, .git, venv, etc.
                    parts = filepath.parts
                    if any(p.startswith(".") or p in (
                        "node_modules", "__pycache__", ".venv", "venv",
                        ".git", "Library", "Caches"
                    ) for p in parts):
                        continue

                    if not filepath.is_file():
                        continue

                    if filepath.suffix.lower() not in LEARNABLE_EXTENSIONS:
                        continue

                    if filepath.stat().st_size > MAX_FILE_SIZE:
                        continue

                    total_scanned += 1
                    fhash = self._file_hash(filepath)

                    if fhash not in self.known_files:
                        new_files.append(filepath)

            except PermissionError:
                continue
            except Exception as e:
                errors.append(f"{scan_dir}: {e}")

        # Process new files into training data
        examples_generated = 0
        if new_files:
            examples_generated = self._process_new_files(new_files, task_info)

        self.last_scan = datetime.now(timezone.utc).isoformat()

        result = {
            "scanned": total_scanned,
            "new_files": len(new_files),
            "examples_generated": examples_generated,
            "errors": len(errors),
            "scan_dirs": [str(d) for d in SCAN_DIRS if d.exists()],
        }

        # Log the scan event
        if self.db:
            try:
                self.db.log_evolution(
                    event_type="file_scan",
                    description=f"Scanned {total_scanned} files, found {len(new_files)} new, "
                    f"generated {examples_generated} training examples",
                    metrics=result,
                )
            except Exception:
                pass

        logger.info(
            f"File scan complete: {total_scanned} scanned, {len(new_files)} new, "
            f"{examples_generated} examples generated"
        )
        return result

    def _process_new_files(self, files: list[Path], task_info=None) -> int:
        """Extract knowledge from new files and generate training data."""
        SFT_DIR.mkdir(parents=True, exist_ok=True)
        output = SFT_DIR / "filesystem_knowledge.jsonl"
        examples = []

        for i, filepath in enumerate(files[:500]):  # Max 500 files per scan
            if task_info:
                task_info.progress = 0.1 + (0.8 * i / min(len(files), 500))

            try:
                content = filepath.read_text(errors="ignore").strip()
                if not content or len(content) < 50:
                    self.known_files.add(self._file_hash(filepath))
                    continue

                # Generate contextual training examples from the file
                file_examples = self._generate_file_examples(filepath, content)
                examples.extend(file_examples)
                self.known_files.add(self._file_hash(filepath))
                self.files_learned += 1

            except Exception as e:
                logger.debug(f"Could not process {filepath}: {e}")
                self.known_files.add(self._file_hash(filepath))

        # Append to JSONL file
        if examples:
            with open(output, "a") as f:
                for ex in examples:
                    f.write(json.dumps(ex) + "\n")

        self._save_known_files()
        return len(examples)

    def _generate_file_examples(self, filepath: Path, content: str) -> list[dict]:
        """Generate training examples from a file's content."""
        examples = []
        relative_path = str(filepath).replace(str(Path.home()), "~")
        suffix = filepath.suffix.lower()

        # Truncate very long content
        if len(content) > 5000:
            content = content[:5000] + "..."

        # Code files → code understanding examples
        if suffix in (".py", ".js", ".ts", ".jsx", ".tsx", ".swift", ".c", ".cpp", ".sql", ".sh"):
            examples.append({
                "messages": [
                    {"role": "system", "content": "You are A.L.E.C., an AI that deeply understands its owner's codebase."},
                    {"role": "user", "content": f"What does the file {relative_path} do?"},
                    {"role": "assistant", "content": f"This is a {suffix[1:]} file at {relative_path}. Here's what it contains:\n\n{content[:2000]}"},
                ]
            })

        # Config files → system knowledge
        elif suffix in (".yaml", ".yml", ".toml", ".ini", ".cfg", ".json"):
            examples.append({
                "messages": [
                    {"role": "system", "content": "You are A.L.E.C., an AI that knows its owner's system configuration."},
                    {"role": "user", "content": f"What's configured in {relative_path}?"},
                    {"role": "assistant", "content": f"The config file {relative_path} contains:\n\n{content[:2000]}"},
                ]
            })

        # Documents → knowledge extraction
        elif suffix in (".md", ".txt", ".csv"):
            # Split into meaningful chunks
            chunks = [content[i:i+1000] for i in range(0, min(len(content), 3000), 1000)]
            for chunk in chunks:
                if len(chunk.strip()) > 100:
                    examples.append({
                        "messages": [
                            {"role": "system", "content": "You are A.L.E.C., an AI with deep knowledge from its owner's documents."},
                            {"role": "user", "content": f"What information is in {filepath.name}?"},
                            {"role": "assistant", "content": f"From {filepath.name}: {chunk.strip()}"},
                        ]
                    })

        return examples

    # ── Self-Analysis ────────────────────────────────────────────

    def analyze_performance(self, task_info=None) -> dict:
        """
        Analyze A.L.E.C.'s own performance.
        Look at conversation ratings, identify weaknesses, suggest improvements.
        """
        if not self.db:
            return {"error": "No database connection"}

        conversations = self.db.get_conversations(limit=1000)
        rated = [c for c in conversations if c.get("user_rating") is not None]
        positive = [c for c in rated if c.get("user_rating", 0) > 0]
        negative = [c for c in rated if c.get("user_rating", 0) < 0]

        # Identify patterns in negative feedback
        negative_topics = []
        for conv in negative:
            msg = conv.get("user_message", "").lower()
            if any(kw in msg for kw in ["code", "python", "javascript", "bug", "error"]):
                negative_topics.append("coding")
            elif any(kw in msg for kw in ["cap rate", "noi", "deal", "property", "rent"]):
                negative_topics.append("real_estate")
            elif any(kw in msg for kw in ["sql", "query", "database", "table"]):
                negative_topics.append("database")
            else:
                negative_topics.append("general")

        # Calculate metrics
        total_rated = len(rated)
        approval_rate = (len(positive) / total_rated * 100) if total_rated > 0 else 0

        # Latency analysis
        latencies = [c.get("latency_ms", 0) for c in conversations if c.get("latency_ms")]
        avg_latency = sum(latencies) / len(latencies) if latencies else 0

        result = {
            "total_conversations": len(conversations),
            "rated": total_rated,
            "approval_rate": round(approval_rate, 1),
            "avg_latency_ms": round(avg_latency),
            "weak_areas": list(set(negative_topics)),
            "recommendations": [],
        }

        # Generate recommendations
        if approval_rate < 80 and total_rated >= 10:
            result["recommendations"].append(
                "Approval rate below 80% — consider triggering a training run"
            )
        if avg_latency > 3000:
            result["recommendations"].append(
                "Average latency over 3s — consider reducing context length or max_tokens"
            )
        if "coding" in negative_topics:
            result["recommendations"].append(
                "Negative feedback on coding tasks — need more code training data"
            )
        if "real_estate" in negative_topics:
            result["recommendations"].append(
                "Negative feedback on real estate — trigger Stoa DB sync for fresh data"
            )
        if len(conversations) > 500 and total_rated < len(conversations) * 0.1:
            result["recommendations"].append(
                "Less than 10% of conversations are rated — encourage more feedback"
            )

        # Log the analysis
        if self.db:
            try:
                self.db.log_evolution(
                    event_type="self_analysis",
                    description=f"Approval rate: {approval_rate:.1f}%, "
                    f"Avg latency: {avg_latency:.0f}ms, "
                    f"Weak areas: {', '.join(set(negative_topics)) or 'none'}",
                    metrics=result,
                )
            except Exception:
                pass

        return result

    # ── MCP Discovery ────────────────────────────────────────────

    def suggest_skills(self) -> list[dict]:
        """Suggest MCP skills/tools that could expand A.L.E.C.'s capabilities."""
        suggestions = [
            {
                "name": "Home Assistant MCP",
                "description": "Control smart home devices — lights, locks, cameras, thermostats",
                "url": "https://github.com/home-assistant/mcp",
                "why": "Alec has Home Assistant at 100.81.193.45:8123 — direct integration",
            },
            {
                "name": "Notion MCP",
                "description": "Read/write Notion pages and databases",
                "url": "https://github.com/makenotion/notion-mcp-server",
                "why": "Documentation and knowledge base management",
            },
            {
                "name": "Slack MCP",
                "description": "Send/read Slack messages and manage channels",
                "url": "https://github.com/anthropics/anthropic-tools",
                "why": "Team communication integration for Stoa Group",
            },
            {
                "name": "Brave Search MCP",
                "description": "Search the web for current information",
                "url": "https://github.com/anthropics/anthropic-tools",
                "why": "Real-time web search for market data and news",
            },
            {
                "name": "Filesystem MCP",
                "description": "Read, write, and manage files on the local machine",
                "url": "https://github.com/anthropics/anthropic-tools",
                "why": "Direct file access for deeper learning from owner's documents",
            },
            {
                "name": "PostgreSQL/SQL MCP",
                "description": "Direct database queries beyond the built-in Azure SQL",
                "url": "https://github.com/anthropics/anthropic-tools",
                "why": "More flexible database access for Stoa data analysis",
            },
        ]
        return suggestions

    def get_status(self) -> dict:
        return {
            "scan_count": self.scan_count,
            "files_learned": self.files_learned,
            "known_files": len(self.known_files),
            "last_scan": self.last_scan,
            "scan_dirs": [str(d) for d in SCAN_DIRS if d.exists()],
        }
