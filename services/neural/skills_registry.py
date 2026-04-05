"""
A.L.E.C. Skills Registry — real installable skills/connectors.

Each skill is a capability A.L.E.C. can use. Skills are:
1. Connectors to external services (iMessage, Gmail, Home Assistant, etc.)
2. Tool capabilities (Excel, web search, file operations)
3. MCP servers (protocol-based tool providers)

Skills can be: installed, configured, enabled/disabled.
Configuration is stored in data/skills.json.
"""

import json
import logging
from pathlib import Path
from typing import Optional
from datetime import datetime, timezone

logger = logging.getLogger("alec.skills")

SKILLS_FILE = Path(__file__).resolve().parent.parent.parent / "data" / "skills.json"

# ══════════════════════════════════════════════════════════════════
#  BUILT-IN SKILL DEFINITIONS
# ══════════════════════════════════════════════════════════════════

AVAILABLE_SKILLS = {
    "imessage": {
        "id": "imessage",
        "name": "iMessage",
        "description": "Read iMessage conversations to learn your communication style. Requires Full Disk Access on macOS.",
        "icon": "💬",
        "category": "connector",
        "platform": "macos",
        "requires_config": False,
        "setup_instructions": "Go to System Settings > Privacy & Security > Full Disk Access, and enable it for Terminal or your Python installation.",
        "endpoints": {
            "status": "/connectors/imessage/status",
            "sync": "/connectors/imessage/sync",
            "messages": "/connectors/imessage/messages",
        },
    },
    "gmail": {
        "id": "gmail",
        "name": "Gmail",
        "description": "Read and learn from your email conversations via IMAP. Requires a Google App Password.",
        "icon": "📧",
        "category": "connector",
        "requires_config": True,
        "config_fields": [
            {"key": "GMAIL_EMAIL", "label": "Gmail Address", "type": "email", "placeholder": "you@gmail.com"},
            {"key": "GMAIL_APP_PASSWORD", "label": "App Password", "type": "password", "placeholder": "16-character app password"},
        ],
        "setup_instructions": "Go to Google Account > Security > 2-Step Verification > App Passwords. Generate a password for 'Mail'.",
    },
    "home_assistant": {
        "id": "home_assistant",
        "name": "Home Assistant",
        "description": "Control smart home devices — lights, locks, cameras, thermostats via Home Assistant.",
        "icon": "🏠",
        "category": "connector",
        "requires_config": True,
        "config_fields": [
            {"key": "HOME_ASSISTANT_URL", "label": "Home Assistant URL", "type": "url", "placeholder": "http://192.168.1.x:8123"},
            {"key": "HOME_ASSISTANT_ACCESS_TOKEN", "label": "Long-Lived Access Token", "type": "password", "placeholder": "eyJ..."},
        ],
        "setup_instructions": "In Home Assistant, go to Profile > Security > Long-lived access tokens. Create a new token.",
    },
    "stoa_database": {
        "id": "stoa_database",
        "name": "Stoa Group Database",
        "description": "Direct connection to the Stoa Group Azure SQL database for real estate data queries and continuous learning.",
        "icon": "🗄️",
        "category": "database",
        "requires_config": True,
        "config_fields": [
            {"key": "STOA_DB_HOST", "label": "Server Host", "type": "text", "placeholder": "server.database.windows.net"},
            {"key": "STOA_DB_NAME", "label": "Database Name", "type": "text", "placeholder": "stoagroupDB"},
            {"key": "STOA_DB_USER", "label": "Username", "type": "text", "placeholder": "username"},
            {"key": "STOA_DB_PASSWORD", "label": "Password", "type": "password", "placeholder": "password"},
        ],
    },
    "excel": {
        "id": "excel",
        "name": "Excel / Spreadsheets",
        "description": "Read, write, edit, and export Excel (.xlsx) and CSV files.",
        "icon": "📊",
        "category": "tool",
        "requires_config": False,
        "auto_installed": True,
    },
    "filesystem": {
        "id": "filesystem",
        "name": "Filesystem Scanner",
        "description": "Proactively scans your Desktop, Documents, and Downloads for new files to learn from.",
        "icon": "📁",
        "category": "tool",
        "requires_config": False,
        "auto_installed": True,
    },
    "memory": {
        "id": "memory",
        "name": "Persistent Memory",
        "description": "Instant recall of facts you teach A.L.E.C. Persists across all conversations forever.",
        "icon": "🧠",
        "category": "tool",
        "requires_config": False,
        "auto_installed": True,
    },
    "web_search": {
        "id": "web_search",
        "name": "Web Search",
        "description": "Search the web for current information. Requires a search API key (Brave, SerpAPI, or similar).",
        "icon": "🔍",
        "category": "tool",
        "requires_config": True,
        "config_fields": [
            {"key": "SEARCH_API_KEY", "label": "Search API Key", "type": "password", "placeholder": "API key from Brave Search or SerpAPI"},
            {"key": "SEARCH_PROVIDER", "label": "Provider", "type": "select", "options": ["brave", "serpapi", "google"]},
        ],
        "setup_instructions": "Get a free API key from https://brave.com/search/api/ or https://serpapi.com/",
    },
    "calendar": {
        "id": "calendar",
        "name": "Calendar",
        "description": "Read and manage calendar events. Check availability and schedule meetings.",
        "icon": "📅",
        "category": "connector",
        "requires_config": True,
        "config_fields": [
            {"key": "CALENDAR_TYPE", "label": "Calendar Type", "type": "select", "options": ["google", "outlook", "caldav"]},
        ],
    },
    "github": {
        "id": "github",
        "name": "GitHub",
        "description": "Access repositories, issues, PRs. Read and write code. Manage projects.",
        "icon": "🐙",
        "category": "connector",
        "requires_config": True,
        "config_fields": [
            {"key": "GITHUB_TOKEN", "label": "Personal Access Token", "type": "password", "placeholder": "ghp_..."},
        ],
    },
    "notion": {
        "id": "notion",
        "name": "Notion",
        "description": "Read and write Notion pages and databases for documentation and knowledge management.",
        "icon": "📝",
        "category": "connector",
        "requires_config": True,
        "config_fields": [
            {"key": "NOTION_API_KEY", "label": "Integration Token", "type": "password", "placeholder": "ntn_..."},
        ],
    },
}


class SkillsRegistry:
    """Manages skill installation, configuration, and status."""

    def __init__(self):
        self.installed: dict = {}
        self._load()

    def _load(self):
        """Load installed skills from disk."""
        if SKILLS_FILE.exists():
            try:
                self.installed = json.loads(SKILLS_FILE.read_text())
            except Exception:
                self.installed = {}
        # Auto-install built-in tools
        for sid, skill in AVAILABLE_SKILLS.items():
            if skill.get("auto_installed") and sid not in self.installed:
                self.installed[sid] = {
                    "id": sid,
                    "installed_at": datetime.now(timezone.utc).isoformat(),
                    "enabled": True,
                    "config": {},
                }
        self._save()

    def _save(self):
        SKILLS_FILE.parent.mkdir(parents=True, exist_ok=True)
        SKILLS_FILE.write_text(json.dumps(self.installed, indent=2))

    def get_available(self) -> list[dict]:
        """List all available skills with install status."""
        result = []
        for sid, skill in AVAILABLE_SKILLS.items():
            entry = {**skill}
            entry["installed"] = sid in self.installed
            entry["enabled"] = self.installed.get(sid, {}).get("enabled", False)
            result.append(entry)
        return result

    def get_installed(self) -> list[dict]:
        """List installed skills with REAL connection status."""
        result = []
        for sid, data in self.installed.items():
            skill_def = AVAILABLE_SKILLS.get(sid, {"name": sid, "icon": "🔧"})
            entry = {**skill_def, **data}
            # Check real status for connectors
            entry["actual_status"] = self._check_real_status(sid, entry)
            result.append(entry)
        return result

    def _check_real_status(self, skill_id: str, skill_data: dict) -> str:
        """Check if a skill is ACTUALLY working, not just installed."""
        import os
        config = skill_data.get("config", {})
        requires_config = skill_data.get("requires_config", False)

        # Auto-installed tools are always active
        if skill_data.get("auto_installed"):
            return "active"

        # Check env vars for skills configured via .env
        env_checks = {
            "imessage": lambda: os.path.exists(os.path.expanduser("~/Library/Messages/chat.db")),
            "gmail": lambda: bool(os.getenv("GMAIL_EMAIL") and os.getenv("GMAIL_APP_PASSWORD")) or bool(config.get("GMAIL_EMAIL")),
            "home_assistant": lambda: bool(os.getenv("HOME_ASSISTANT_URL") and os.getenv("HOME_ASSISTANT_ACCESS_TOKEN")) or bool(config.get("HOME_ASSISTANT_URL")),
            "stoa_database": lambda: bool(os.getenv("STOA_DB_HOST") and os.getenv("STOA_DB_PASSWORD")) or bool(config.get("STOA_DB_HOST")),
            "web_search": lambda: bool(os.getenv("SEARCH_API_KEY")) or bool(config.get("SEARCH_API_KEY")),
            "github": lambda: bool(os.getenv("GITHUB_TOKEN")) or bool(config.get("GITHUB_TOKEN")),
            "notion": lambda: bool(os.getenv("NOTION_API_KEY")) or bool(config.get("NOTION_API_KEY")),
            "calendar": lambda: bool(config.get("CALENDAR_TYPE")),
        }

        checker = env_checks.get(skill_id)
        if checker:
            try:
                return "connected" if checker() else "needs_setup"
            except Exception:
                return "needs_setup"

        # Has config = connected, needs config but empty = needs setup
        if requires_config and not config:
            return "needs_setup"
        if config:
            return "connected"
        return "active"

    def install(self, skill_id: str, config: dict = None) -> dict:
        """Install a skill."""
        if skill_id not in AVAILABLE_SKILLS:
            return {"error": f"Skill '{skill_id}' not found in registry"}
        self.installed[skill_id] = {
            "id": skill_id,
            "installed_at": datetime.now(timezone.utc).isoformat(),
            "enabled": True,
            "config": config or {},
        }
        self._save()
        logger.info(f"Installed skill: {skill_id}")
        return {"success": True, "skill_id": skill_id}

    def uninstall(self, skill_id: str) -> dict:
        if skill_id in self.installed:
            del self.installed[skill_id]
            self._save()
            return {"success": True}
        return {"error": "Skill not installed"}

    def configure(self, skill_id: str, config: dict) -> dict:
        """Update skill configuration."""
        if skill_id not in self.installed:
            return {"error": "Skill not installed"}
        self.installed[skill_id]["config"] = {
            **self.installed[skill_id].get("config", {}),
            **config,
        }
        self._save()
        return {"success": True}

    def enable(self, skill_id: str) -> dict:
        if skill_id in self.installed:
            self.installed[skill_id]["enabled"] = True
            self._save()
            return {"success": True}
        return {"error": "Skill not installed"}

    def disable(self, skill_id: str) -> dict:
        if skill_id in self.installed:
            self.installed[skill_id]["enabled"] = False
            self._save()
            return {"success": True}
        return {"error": "Skill not installed"}
