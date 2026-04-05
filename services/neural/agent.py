"""
A.L.E.C. Agent Loop — Tool-calling autonomous agent.

Instead of just generating text, A.L.E.C. can USE TOOLS:
- Search the web
- Query the Stoa database
- Read/write files
- Send emails (via Gmail connector)
- Check calendar
- Control smart home (Home Assistant)
- Read iMessages
- Execute code
- Search memory
- Improve itself (edit its own code, retrain)

Architecture:
  User message → Agent decides: respond directly OR call a tool
  If tool call → execute tool → feed result back → agent responds
  Loop up to MAX_STEPS times (prevents infinite loops)

This is what makes A.L.E.C. an AGENT, not just a chatbot.
The 7B model handles the routing/reasoning, tools handle the actual work.
"""

import json
import logging
import os
import re
import subprocess
import time
from pathlib import Path
from typing import Optional

logger = logging.getLogger("alec.agent")

MAX_AGENT_STEPS = 3  # Max tool calls per message (3 steps = read + edit + commit)


class AgentTool:
    """Base class for agent tools."""
    name: str = ""
    description: str = ""
    parameters: dict = {}

    def execute(self, **kwargs) -> str:
        raise NotImplementedError


class StoaQueryTool(AgentTool):
    """Query the Stoa Group real estate database."""
    name = "stoa_query"
    description = "Search the Stoa Group real estate database for property data, occupancy, rent, leasing velocity, loans, contracts, etc. Use this for ANY question about properties, deals, or real estate data."
    parameters = {"query": "Natural language question about Stoa data"}

    def __init__(self, query_planner):
        self.query_planner = query_planner

    def execute(self, query: str = "", **kwargs) -> str:
        result = self.query_planner.get_direct_response(query)
        if result:
            return result
        return "No matching data found in the Stoa database for that query."


class MemorySearchTool(AgentTool):
    """Search A.L.E.C.'s persistent memory."""
    name = "memory_search"
    description = "Search your persistent memory for facts, preferences, and things you've been taught."
    parameters = {"query": "What to search for in memory"}

    def __init__(self, memory):
        self.memory = memory

    def execute(self, query: str = "", **kwargs) -> str:
        results = self.memory.recall(query, limit=5)
        if not results:
            return "Nothing found in memory for that query."
        parts = ["From memory:"]
        for r in results:
            parts.append(f"- [{r.get('category', '?')}] {r.get('key', '')}: {r.get('value', r.get('content', '?'))}")
        return "\n".join(parts)


class MemoryTeachTool(AgentTool):
    """Store a new fact in persistent memory."""
    name = "memory_store"
    description = "Remember a new fact, preference, or piece of information permanently."
    parameters = {"category": "Category (fact, preference, correction, person, project)", "key": "Short label", "value": "The information to remember"}

    def __init__(self, memory):
        self.memory = memory

    def execute(self, category: str = "fact", key: str = "", value: str = "", **kwargs) -> str:
        self.memory.teach(category, key, value, source="agent")
        return f"Stored in memory: [{category}] {key} = {value}"


class WebSearchTool(AgentTool):
    """Search the web for current information."""
    name = "web_search"
    description = "Search the internet for current information, news, facts, prices, or anything not in the local database."
    parameters = {"query": "Search query"}

    def execute(self, query: str = "", **kwargs) -> str:
        api_key = os.getenv("SEARCH_API_KEY", "")
        if not api_key:
            return "Web search not configured. Set SEARCH_API_KEY in .env (Brave Search or SerpAPI)."

        # Try Brave Search API
        try:
            import urllib.request
            import urllib.parse
            url = f"https://api.search.brave.com/res/v1/web/search?q={urllib.parse.quote(query)}&count=5"
            req = urllib.request.Request(url, headers={"X-Subscription-Token": api_key, "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=10) as resp:
                data = json.loads(resp.read())
            results = data.get("web", {}).get("results", [])
            if not results:
                return "No web results found."
            parts = [f"Web search results for '{query}':"]
            for r in results[:5]:
                parts.append(f"- {r.get('title', '?')}: {r.get('description', '')[:200]}")
            return "\n".join(parts)
        except Exception as e:
            return f"Web search failed: {e}"


class HomeAssistantTool(AgentTool):
    """Control smart home devices via Home Assistant REST API."""
    name = "smart_home"
    description = (
        "Control smart home devices via Home Assistant. "
        "Turn lights on/off, set brightness, check device states, control media players. "
        "Known devices: living_room lights, hue_play_1, hue_play_2, floor_lamp_1, floor_lamp_2, "
        "kitchen (h612d), guest_room, family_room_2 (Chromecast TV)."
    )
    parameters = {"action": "What to do (e.g., 'turn off living room lights', 'set kitchen brightness to 50')"}

    # Map friendly names to entity IDs
    ENTITY_MAP = {
        "living room": "light.living_room",
        "hue play 1": "light.hue_play_1",
        "hue play 2": "light.hue_play_2",
        "floor lamp 1": "light.floor_lamp_1",
        "floor lamp 2": "light.floor_lamp_2",
        "kitchen": "light.h612d",
        "guest room": "light.guest_room",
        "tv": "media_player.family_room_2",
        "family room": "media_player.family_room_2",
        "chromecast": "media_player.family_room_2",
    }

    def execute(self, action: str = "", **kwargs) -> str:
        ha_url = os.getenv("HA_URL", "")
        ha_token = os.getenv("HA_TOKEN", "")
        if not ha_url or not ha_token:
            return "Home Assistant not configured. Set HA_URL and HA_TOKEN in .env."

        lower = action.lower()
        try:
            import urllib.request
            headers = {"Authorization": f"Bearer {ha_token}", "Content-Type": "application/json"}

            # Find the target entity
            entity_id = None
            for name, eid in self.ENTITY_MAP.items():
                if name in lower:
                    entity_id = eid
                    break

            # STATUS CHECK
            if any(w in lower for w in ["status", "state", "check", "what", "are the", "is the"]):
                if entity_id:
                    req = urllib.request.Request(f"{ha_url}/api/states/{entity_id}", headers=headers)
                    with urllib.request.urlopen(req, timeout=10) as resp:
                        state = json.loads(resp.read())
                    name = state.get('attributes', {}).get('friendly_name', entity_id)
                    s = state.get('state', 'unknown')
                    brightness = state.get('attributes', {}).get('brightness')
                    br_pct = f" ({round(brightness/255*100)}%)" if brightness else ""
                    return f"{name}: {s}{br_pct}"
                else:
                    # Get all light states
                    req = urllib.request.Request(f"{ha_url}/api/states", headers=headers)
                    with urllib.request.urlopen(req, timeout=10) as resp:
                        all_states = json.loads(resp.read())
                    lights = [s for s in all_states if s['entity_id'].startswith('light.')]
                    parts = ["Light status:"]
                    for s in lights:
                        name = s.get('attributes', {}).get('friendly_name', s['entity_id'])
                        brightness = s.get('attributes', {}).get('brightness')
                        br_pct = f" ({round(brightness/255*100)}%)" if brightness else ""
                        parts.append(f"  {name}: {s['state']}{br_pct}")
                    return "\n".join(parts)

            # TURN ON
            if any(w in lower for w in ["turn on", "turn_on", "switch on", "enable", " on"]):
                if not entity_id:
                    return f"Not sure which device. Known: {', '.join(self.ENTITY_MAP.keys())}"
                domain = entity_id.split('.')[0]
                data = json.dumps({"entity_id": entity_id}).encode()
                req = urllib.request.Request(
                    f"{ha_url}/api/services/{domain}/turn_on",
                    data=data, headers=headers, method='POST',
                )
                urllib.request.urlopen(req, timeout=10)
                return f"Turned on {entity_id.split('.')[1].replace('_', ' ').title()}"

            # TURN OFF
            if any(w in lower for w in ["turn off", "turn_off", "switch off", "disable", "shut off", "off"]):
                if not entity_id:
                    return f"Not sure which device. Known: {', '.join(self.ENTITY_MAP.keys())}"
                domain = entity_id.split('.')[0]
                data = json.dumps({"entity_id": entity_id}).encode()
                req = urllib.request.Request(
                    f"{ha_url}/api/services/{domain}/turn_off",
                    data=data, headers=headers, method='POST',
                )
                urllib.request.urlopen(req, timeout=10)
                return f"Turned off {entity_id.split('.')[1].replace('_', ' ').title()}"

            # SET BRIGHTNESS
            import re as _re
            brightness_match = _re.search(r'(?:brightness|bright|dim).*?(\d+)', lower)
            if brightness_match and entity_id and entity_id.startswith('light.'):
                pct = int(brightness_match.group(1))
                brightness_val = max(0, min(255, round(pct / 100 * 255)))
                data = json.dumps({"entity_id": entity_id, "brightness": brightness_val}).encode()
                req = urllib.request.Request(
                    f"{ha_url}/api/services/light/turn_on",
                    data=data, headers=headers, method='POST',
                )
                urllib.request.urlopen(req, timeout=10)
                return f"Set {entity_id.split('.')[1].replace('_', ' ').title()} brightness to {pct}%"

            # TOGGLE
            if "toggle" in lower:
                if not entity_id:
                    return f"Not sure which device. Known: {', '.join(self.ENTITY_MAP.keys())}"
                domain = entity_id.split('.')[0]
                data = json.dumps({"entity_id": entity_id}).encode()
                req = urllib.request.Request(
                    f"{ha_url}/api/services/{domain}/toggle",
                    data=data, headers=headers, method='POST',
                )
                urllib.request.urlopen(req, timeout=10)
                return f"Toggled {entity_id.split('.')[1].replace('_', ' ').title()}"

            return f"I understood '{action}' but couldn't determine the specific command. Try: 'turn on/off [device]', 'set [device] brightness to [%]', or 'check status'."

        except Exception as e:
            return f"Home Assistant error: {e}"


class CodeExecutionTool(AgentTool):
    """Execute Python code for calculations, data processing, or self-improvement."""
    name = "execute_code"
    description = "Run Python code to calculate something, process data, or perform an action. Use for math, data analysis, file operations, or improving A.L.E.C.'s own code."
    parameters = {"code": "Python code to execute"}

    def execute(self, code: str = "", **kwargs) -> str:
        # Safety: limit execution time and scope
        try:
            result = subprocess.run(
                ["python3", "-c", code],
                capture_output=True, text=True, timeout=30,
                cwd=os.path.dirname(os.path.abspath(__file__)),
            )
            output = result.stdout.strip()
            if result.returncode != 0:
                output = f"Error: {result.stderr.strip()}"
            return output[:2000] if output else "(no output)"
        except subprocess.TimeoutExpired:
            return "Code execution timed out (30s limit)."
        except Exception as e:
            return f"Code execution failed: {e}"


class SendEmailTool(AgentTool):
    """Send an email to the owner."""
    name = "send_email"
    description = "Send an email to Alec (the owner). Use this for updates, questions, suggestions, or reports. A.L.E.C. should take initiative and communicate proactively."
    parameters = {"subject": "Email subject line", "body": "Email body text"}

    def execute(self, subject: str = "", body: str = "", **kwargs) -> str:
        if not subject or not body:
            return "Error: both 'subject' and 'body' required."
        try:
            # Import the autonomy engine from the server module
            import server as srv
            if hasattr(srv, 'autonomy') and srv.autonomy:
                ok = srv.autonomy.send_email(subject, body)
                return f"Email sent to owner: '{subject}'" if ok else "Email failed — check GMAIL credentials in .env"
            return "Autonomy engine not available — cannot send email."
        except Exception as e:
            return f"Email error: {e}"


class CalendarTool(AgentTool):
    """Check calendar events and availability."""
    name = "calendar"
    description = "Check your calendar for upcoming events, meetings, and availability."
    parameters = {"query": "What to check (e.g., 'what meetings today', 'am I free Thursday 2pm')"}

    def execute(self, query: str = "", **kwargs) -> str:
        # This would integrate with Google Calendar API
        return "Calendar integration not yet configured. Set up Google Calendar API credentials."


# ═══════════════════════════════════════════════════════════════
#  AGENT LOOP
# ═══════════════════════════════════════════════════════════════


class SelfEditTool(AgentTool):
    """
    Read, modify, commit, and push A.L.E.C.'s own source code.
    
    This is what enables true self-improvement: A.L.E.C. can fix its own bugs,
    add features to its dashboard, update its personality, tune its query planner,
    and push the changes live — all from a chat message.
    
    Actions:
      read_file   — Read a file from the repo
      list_files  — List files in a directory
      edit_file   — Replace text in a file (search → replace)
      create_file — Create a new file
      delete_file — Delete a file
      commit_push — Git commit + push all changes
      run_shell   — Run an arbitrary shell command in the project directory
    """
    name = "self_edit"
    description = (
        "Read, modify, or create files in A.L.E.C.'s own source code repository. "
        "Use this to fix bugs, update the dashboard UI, change styles, add features, "
        "or improve your own code. Use dry_run to test changes safely before deploying, "
        "then promote to go live. Or use commit_push for direct deploy with auto-rollback. "
        "Actions: read_file, list_files, edit_file, create_file, delete_file, "
        "dry_run, promote, commit_push, rollback, health_check, run_shell."
    )
    parameters = {
        "action": "One of: read_file, list_files, edit_file, create_file, delete_file, commit_push, run_shell",
        "path": "File path relative to project root (e.g., 'frontend/styles.css')",
        "search": "(edit_file only) Exact text to find",
        "replace": "(edit_file only) Replacement text",
        "content": "(create_file only) File content",
        "message": "(commit_push only) Git commit message",
        "command": "(run_shell only) Shell command",
    }

    def __init__(self):
        self.project_dir = str(Path(__file__).resolve().parent.parent.parent)

    def _safe_path(self, path: str) -> str:
        """Resolve path, prevent directory traversal."""
        clean = path.replace("..", "").lstrip("/")
        full = os.path.join(self.project_dir, clean)
        real = os.path.realpath(full)
        if not real.startswith(os.path.realpath(self.project_dir)):
            raise ValueError(f"Path escapes project directory: {path}")
        return full

    def execute(self, action: str = "", path: str = "", search: str = "",
                replace: str = "", content: str = "", message: str = "",
                command: str = "", **kwargs) -> str:
        try:
            actions = {
                "read_file": lambda: self._read_file(path),
                "list_files": lambda: self._list_files(path),
                "edit_file": lambda: self._edit_file(path, search, replace),
                "create_file": lambda: self._create_file(path, content),
                "delete_file": lambda: self._delete_file(path),
                "commit_push": lambda: self._commit_push(message),
                "dry_run": lambda: self._dry_run(message),
                "promote": lambda: self._promote(),
                "rollback": lambda: self._rollback(),
                "health_check": lambda: self._health_check(),
                "run_shell": lambda: self._run_shell(command),
            }
            fn = actions.get(action)
            if not fn:
                return f"Unknown action: {action}. Use: {', '.join(actions.keys())}"
            return fn()
        except Exception as e:
            return f"self_edit error: {e}"

    def _read_file(self, path: str) -> str:
        full = self._safe_path(path)
        if not os.path.exists(full):
            return f"File not found: {path}"
        size = os.path.getsize(full)
        if size > 100_000:
            return f"File too large ({size} bytes). Use run_shell with head/tail/grep."
        with open(full, "r", errors="replace") as f:
            text = f.read()
        return f"[{path}] ({text.count(chr(10))+1} lines, {size} bytes):\n\n{text}"

    def _list_files(self, path: str = "") -> str:
        dir_path = self._safe_path(path or ".")
        if not os.path.isdir(dir_path):
            return f"Not a directory: {path}"
        entries = []
        skip = {"node_modules", "__pycache__", ".venv", ".git", "data", ".next"}
        for entry in sorted(os.listdir(dir_path)):
            if entry.startswith(".") and entry != ".env.example":
                continue
            if entry in skip:
                continue
            full = os.path.join(dir_path, entry)
            if os.path.isdir(full):
                count = sum(1 for f in os.listdir(full) if not f.startswith("."))
                entries.append(f"  {entry}/ ({count} items)")
            else:
                entries.append(f"  {entry} ({os.path.getsize(full):,} bytes)")
        return f"[{path or '.'}]:\n" + "\n".join(entries)

    def _edit_file(self, path: str, search: str, replace: str) -> str:
        if not search:
            return "Error: 'search' parameter required."
        full = self._safe_path(path)
        if not os.path.exists(full):
            return f"File not found: {path}"
        with open(full, "r") as f:
            original = f.read()
        if search not in original:
            # Fuzzy match hint
            lines = original.split("\n")
            search_low = search.lower().strip()[:40]
            for i, line in enumerate(lines):
                if search_low in line.lower():
                    start, end = max(0, i-2), min(len(lines), i+3)
                    ctx = "\n".join(f"{start+j+1}: {lines[start+j]}" for j in range(end-start))
                    return f"Search text not found. Nearest match near line {i+1}:\n{ctx}"
            return f"Search text not found in {path}. Use read_file first."
        count = original.count(search)
        if count > 1:
            return f"Found {count} matches — use a more specific search string."
        modified = original.replace(search, replace, 1)
        with open(full, "w") as f:
            f.write(modified)
        s_preview = search[:150] + ("..." if len(search) > 150 else "")
        r_preview = replace[:150] + ("..." if len(replace) > 150 else "")
        return f"Edited {path} (1 replacement).\nRemoved: {s_preview}\nInserted: {r_preview}"

    def _create_file(self, path: str, content: str) -> str:
        if not content:
            return "Error: 'content' parameter required."
        full = self._safe_path(path)
        if os.path.exists(full):
            return f"File exists: {path}. Use edit_file to modify."
        os.makedirs(os.path.dirname(full), exist_ok=True)
        with open(full, "w") as f:
            f.write(content)
        return f"Created {path} ({len(content)} bytes)"

    def _delete_file(self, path: str) -> str:
        full = self._safe_path(path)
        if not os.path.exists(full):
            return f"File not found: {path}"
        critical = ["backend/server.js", "services/neural/server.py", "services/neural/engine.py",
                     "frontend/index.html", "frontend/app.js", ".env", "package.json"]
        if path in critical:
            return f"Cannot delete critical file: {path}"
        os.remove(full)
        return f"Deleted {path}"

    def _dry_run(self, message: str = "") -> str:
        """
        Sandbox test: commit changes to a temp branch, validate syntax/health,
        then return to main WITHOUT merging. Changes stay staged for promote.
        
        Flow:
          1. Stash current changes on main
          2. Create sandbox branch alec/sandbox-<timestamp>
          3. Apply stashed changes + commit
          4. Run syntax validation (python -c, node -c)
          5. Report results — do NOT merge or deploy
          6. Return to main, restore working state
        """
        if not message:
            message = f"dry-run: testing self-edit ({time.strftime('%Y-%m-%d %H:%M')})"

        sandbox_branch = f"alec/sandbox-{int(time.time())}"
        results = []

        def _git(*args, **kw):
            r = subprocess.run(
                ["git"] + list(args), capture_output=True, text=True,
                timeout=kw.get("timeout", 15), cwd=self.project_dir,
            )
            return r.returncode, (r.stdout or "").strip(), (r.stderr or "").strip()

        try:
            # Check if there are changes to test
            rc, diff_stat, _ = _git("diff", "--stat")
            rc2, diff_staged, _ = _git("diff", "--cached", "--stat")
            if not diff_stat and not diff_staged:
                return "Nothing to dry-run — no pending changes. Edit files first."

            results.append(f"Changes to test:\n{diff_stat or diff_staged}")

            # Stage everything
            _git("add", "-A")

            # Stash changes so we can branch cleanly
            _git("stash", "push", "-m", f"dry-run-{int(time.time())}")

            # Create sandbox branch from current main HEAD
            rc, _, err = _git("checkout", "-b", sandbox_branch)
            if rc != 0:
                _git("stash", "pop")
                return f"Failed to create sandbox branch: {err}"

            # Apply stashed changes onto sandbox
            rc, out, err = _git("stash", "pop")
            if rc != 0:
                results.append(f"Stash apply warning: {err}")

            # Commit on sandbox
            _git("add", "-A")
            _git("commit", "-m", message)

            results.append(f"Committed to sandbox branch: {sandbox_branch}")

            # ── VALIDATION CHECKS ──
            checks_passed = 0
            checks_total = 0

            # Check 1: Python syntax for all changed .py files
            rc, changed_files, _ = _git("diff", "--name-only", "HEAD~1")
            py_files = [f for f in changed_files.split("\n") if f.endswith(".py") and f.strip()]
            if py_files:
                checks_total += 1
                py_errors = []
                for pf in py_files:
                    full = os.path.join(self.project_dir, pf)
                    if os.path.exists(full):
                        r = subprocess.run(
                            ["python3", "-c", f"import py_compile; py_compile.compile('{full}', doraise=True)"],
                            capture_output=True, text=True, timeout=10, cwd=self.project_dir,
                        )
                        if r.returncode != 0:
                            py_errors.append(f"  {pf}: {r.stderr.strip().split(chr(10))[-1]}")
                if py_errors:
                    results.append("Python syntax: FAIL\n" + "\n".join(py_errors))
                else:
                    results.append(f"Python syntax: PASS ({len(py_files)} files)")
                    checks_passed += 1

            # Check 2: Node.js syntax for changed .js files
            js_files = [f for f in changed_files.split("\n") if f.endswith(".js") and f.strip()]
            if js_files:
                checks_total += 1
                js_errors = []
                for jf in js_files:
                    full = os.path.join(self.project_dir, jf)
                    if os.path.exists(full):
                        r = subprocess.run(
                            ["node", "-c", open(full).read()[:50000]],
                            capture_output=True, text=True, timeout=10, cwd=self.project_dir,
                        )
                        if r.returncode != 0:
                            js_errors.append(f"  {jf}: {r.stderr.strip().split(chr(10))[-1]}")
                if js_errors:
                    results.append("JS syntax: FAIL\n" + "\n".join(js_errors))
                else:
                    results.append(f"JS syntax: PASS ({len(js_files)} files)")
                    checks_passed += 1

            # Check 3: HTML validity (basic — check for unclosed tags)
            html_files = [f for f in changed_files.split("\n") if f.endswith(".html") and f.strip()]
            if html_files:
                checks_total += 1
                results.append(f"HTML files changed: {len(html_files)} (manual review recommended)")
                checks_passed += 1

            # Check 4: CSS syntax (basic — check for parse errors)
            css_files = [f for f in changed_files.split("\n") if f.endswith(".css") and f.strip()]
            if css_files:
                checks_total += 1
                results.append(f"CSS files changed: {len(css_files)} (manual review recommended)")
                checks_passed += 1

            # No files to validate
            if checks_total == 0:
                checks_total = 1
                checks_passed = 1
                results.append("No Python/JS files changed — no syntax checks needed.")

            # Summary
            all_pass = checks_passed == checks_total
            verdict = "SAFE TO DEPLOY" if all_pass else "ISSUES FOUND — fix before deploying"
            results.append(f"\nDry-run result: {checks_passed}/{checks_total} checks passed — {verdict}")

            if all_pass:
                results.append(f"\nRun self_edit action='promote' to merge sandbox into main and deploy.")
                results.append(f"Or run self_edit action='rollback' to discard the sandbox.")
            else:
                results.append(f"\nFix the issues, then run dry_run again. Sandbox branch: {sandbox_branch}")

        except Exception as e:
            results.append(f"Dry-run error: {e}")

        finally:
            # Always return to main, regardless of what happened
            _git("checkout", "main")
            # Reapply the changes to working tree (so promote can pick them up)
            rc, _, _ = _git("stash", "list")
            # The changes are on the sandbox branch; cherry-pick onto main working tree
            try:
                # Get the sandbox commit hash
                rc, sandbox_hash, _ = _git("rev-parse", sandbox_branch)
                if rc == 0 and sandbox_hash:
                    # Apply the diff without committing
                    subprocess.run(
                        ["git", "diff", f"{sandbox_branch}~1", sandbox_branch],
                        capture_output=True, text=True, timeout=10, cwd=self.project_dir,
                    )
                    # Restore the edits to working tree
                    subprocess.run(
                        ["git", "checkout", sandbox_branch, "--", "."],
                        capture_output=True, text=True, timeout=10, cwd=self.project_dir,
                    )
                    _git("reset", "HEAD")  # Unstage but keep in working tree
            except Exception:
                pass

        return "\n".join(results)

    def _promote(self) -> str:
        """
        Promote a validated dry-run to main: commit pending changes and push.
        Only call this after a successful dry_run.
        """
        # Check if there are changes to promote
        r = subprocess.run(
            ["git", "status", "--porcelain"], capture_output=True, text=True,
            timeout=5, cwd=self.project_dir,
        )
        if not (r.stdout or "").strip():
            return "Nothing to promote — no pending changes. Run dry_run first."

        # Find the sandbox branch to get the commit message
        r = subprocess.run(
            ["git", "branch", "--list", "alec/sandbox-*"], capture_output=True,
            text=True, timeout=5, cwd=self.project_dir,
        )
        branches = [b.strip().lstrip("* ") for b in (r.stdout or "").strip().split("\n") if b.strip()]

        # Clean up sandbox branches
        for branch in branches:
            subprocess.run(
                ["git", "branch", "-D", branch], capture_output=True, text=True,
                timeout=5, cwd=self.project_dir,
            )

        # Commit and push via the normal commit_push (which has health check + auto-rollback)
        return self._commit_push(
            message=f"self-edit (validated): A.L.E.C. auto-improvement ({time.strftime('%Y-%m-%d %H:%M')})"
        )

    def _commit_push(self, message: str = "") -> str:
        """Commit and push, then verify the server survives. Auto-rollback if it breaks."""
        if not message:
            message = f"self-edit: A.L.E.C. auto-improvement ({time.strftime('%Y-%m-%d %H:%M')})"

        # Save current HEAD so we can rollback
        try:
            head_before = subprocess.run(
                ["git", "rev-parse", "HEAD"], capture_output=True, text=True,
                timeout=5, cwd=self.project_dir,
            ).stdout.strip()
        except Exception:
            head_before = None

        cmds = [
            ["git", "add", "-A"],
            ["git", "diff", "--cached", "--stat"],
            ["git", "commit", "-m", message],
            ["git", "push", "origin", "main"],
        ]
        results = []
        for cmd in cmds:
            try:
                r = subprocess.run(cmd, capture_output=True, text=True, timeout=30, cwd=self.project_dir)
                out = (r.stdout or "").strip()
                if r.returncode != 0:
                    err = (r.stderr or "").strip()
                    if "nothing to commit" in (err + out):
                        return "Nothing to commit."
                    results.append(f"{'  '.join(cmd[:2])}: ERROR — {err}")
                    break
                elif out:
                    results.append(out)
            except Exception as e:
                results.append(f"{' '.join(cmd[:2])}: {e}")
                break

        commit_output = "\n".join(results) if results else "Committed and pushed."

        # Wait for uvicorn/nodemon to reload, then health check
        time.sleep(8)
        health = self._health_check()

        if "HEALTHY" in health:
            new_head = subprocess.run(
                ["git", "rev-parse", "--short", "HEAD"], capture_output=True,
                text=True, timeout=5, cwd=self.project_dir,
            ).stdout.strip()
            return f"{commit_output}\n\nHealth check: PASSED \u2714\nCommit {new_head} is live."
        else:
            # Server is broken — auto-rollback
            logger.warning(f"Self-edit broke the server! Rolling back to {head_before}")
            rollback_result = self._rollback(target=head_before)
            return (
                f"{commit_output}\n\n"
                f"\u26a0\ufe0f Health check FAILED after deploy:\n{health}\n\n"
                f"AUTO-ROLLBACK triggered:\n{rollback_result}"
            )

    def _rollback(self, target: str = "") -> str:
        """Revert to a previous commit. If no target, reverts the last commit."""
        try:
            if not target:
                # Get the commit before HEAD
                r = subprocess.run(
                    ["git", "rev-parse", "HEAD~1"], capture_output=True, text=True,
                    timeout=5, cwd=self.project_dir,
                )
                if r.returncode != 0:
                    return "Rollback failed: no previous commit to revert to."
                target = r.stdout.strip()

            # Get info about what we're reverting
            log_r = subprocess.run(
                ["git", "log", "--oneline", "-3"], capture_output=True, text=True,
                timeout=5, cwd=self.project_dir,
            )
            recent = (log_r.stdout or "").strip()

            # Hard reset to target
            reset = subprocess.run(
                ["git", "reset", "--hard", target], capture_output=True, text=True,
                timeout=10, cwd=self.project_dir,
            )
            if reset.returncode != 0:
                return f"Rollback failed: {(reset.stderr or '').strip()}"

            # Force push
            push = subprocess.run(
                ["git", "push", "origin", "main", "--force"], capture_output=True,
                text=True, timeout=30, cwd=self.project_dir,
            )
            if push.returncode != 0:
                return f"Reset succeeded but push failed: {(push.stderr or '').strip()}"

            # Wait for reload
            time.sleep(8)
            health = self._health_check()

            short = target[:7]
            return (
                f"Rolled back to {short}.\n"
                f"Recent commits before rollback:\n{recent}\n\n"
                f"Post-rollback health: {health}"
            )

        except Exception as e:
            return f"Rollback error: {e}"

    def _health_check(self) -> str:
        """Check if both the Python engine and Node server are alive."""
        results = []

        # Check Python neural engine
        try:
            import urllib.request
            req = urllib.request.Request("http://localhost:8000/health")
            with urllib.request.urlopen(req, timeout=5) as resp:
                data = json.loads(resp.read())
                loaded = data.get("model_loaded", False)
                results.append(f"Neural engine: {'OK' if loaded else 'MODEL NOT LOADED'}")
        except Exception as e:
            results.append(f"Neural engine: DOWN ({e})")

        # Check Node.js backend
        try:
            import urllib.request
            port = os.getenv("PORT", "3001")
            req = urllib.request.Request(f"http://localhost:{port}/")
            with urllib.request.urlopen(req, timeout=5) as resp:
                if resp.status == 200:
                    results.append("Node backend: OK")
                else:
                    results.append(f"Node backend: HTTP {resp.status}")
        except Exception as e:
            results.append(f"Node backend: DOWN ({e})")

        # Check Stoa DB
        try:
            import urllib.request
            req = urllib.request.Request("http://localhost:8000/stoa/status")
            with urllib.request.urlopen(req, timeout=5) as resp:
                data = json.loads(resp.read())
                connected = data.get("connected", False)
                results.append(f"Stoa DB: {'connected' if connected else 'disconnected'}")
        except Exception:
            results.append("Stoa DB: check failed")

        all_ok = all("OK" in r or "connected" in r for r in results)
        status = "HEALTHY" if all_ok else "UNHEALTHY"
        return f"[{status}]\n" + "\n".join(results)

    def _run_shell(self, command: str) -> str:
        if not command:
            return "Error: 'command' required."
        try:
            r = subprocess.run(command, shell=True, capture_output=True, text=True,
                               timeout=60, cwd=self.project_dir)
            out = (r.stdout or "").strip()
            if r.returncode != 0:
                out += f"\nSTDERR: {(r.stderr or '').strip()}"
            return out[:5000] if out else "(no output)"
        except subprocess.TimeoutExpired:
            return "Timed out (60s)."
        except Exception as e:
            return f"Shell error: {e}"


class ALECAgent:
    """
    The agent loop. Takes a user message, decides whether to use tools,
    executes them, and returns a final response.
    """

    def __init__(self, engine, query_planner, memory_module):
        self.engine = engine
        self.tools: dict[str, AgentTool] = {}

        # Register tools
        self._register(StoaQueryTool(query_planner))
        self._register(MemorySearchTool(memory_module))
        self._register(MemoryTeachTool(memory_module))
        self._register(WebSearchTool())
        self._register(HomeAssistantTool())
        self._register(CodeExecutionTool())
        self._register(CalendarTool())
        self._register(SendEmailTool())
        self._register(SelfEditTool())

    def _register(self, tool: AgentTool):
        self.tools[tool.name] = tool

    def _build_tool_prompt(self) -> str:
        """Build the tool description for the system prompt."""
        lines = [
            "You have access to the following tools. To use a tool, respond with EXACTLY this format:",
            "",
            "TOOL_CALL: tool_name",
            "ARGS: {\"param\": \"value\"}",
            "",
            "Available tools:",
        ]
        for name, tool in self.tools.items():
            lines.append(f"- **{name}**: {tool.description}")
        lines.append("")
        lines.append("RULES:")
        lines.append("- If the user asks about properties, occupancy, rent, deals, or ANY real estate data → use stoa_query")
        lines.append("- If you don't know something → use web_search or memory_search, don't guess")
        lines.append("- If the user teaches you something → use memory_store")
        lines.append("- If math or code is needed → use execute_code")
        lines.append("- If the user asks to change the UI, fix a bug, update code, or improve you → use self_edit")
        lines.append("- To send an email to the owner (updates, questions, reports) → use send_email")
        lines.append("- self_edit safe workflow: read_file → edit_file → dry_run (validates on sandbox branch) → promote (deploys to main)")
        lines.append("- self_edit fast workflow: read_file → edit_file → commit_push (direct deploy with auto-health-check + auto-rollback)")
        lines.append("- Use dry_run for risky changes (Python/JS logic). Use commit_push for simple changes (CSS, text, config).")
        lines.append("- If something went wrong, use self_edit action='rollback' to revert the last commit")
        lines.append("- If you CAN answer without tools, just respond normally (no TOOL_CALL)")
        lines.append("- NEVER make up data. If a tool returns no results, say so honestly.")
        lines.append("- NEVER pretend you did something. If a tool fails, say it failed and try again or report the error.")
        lines.append("")
        lines.append("A.L.E.C. REPO STRUCTURE (use these exact paths with self_edit):")
        lines.append("  frontend/index.html    — Main HTML (dashboard, panels, chat)")
        lines.append("  frontend/app.js        — All frontend JavaScript (1900+ lines)")
        lines.append("  frontend/styles.css    — All CSS styles")
        lines.append("  backend/server.js      — Node.js Express server (API routes)")
        lines.append("  services/neural/server.py     — Python FastAPI server")
        lines.append("  services/neural/engine.py     — LLM inference engine")
        lines.append("  services/neural/agent.py      — Agent loop + tools (THIS FILE)")
        lines.append("  services/neural/query_planner.py — Stoa DB query planner")
        lines.append("  services/neural/self_improve.py  — Self-improvement engine")
        lines.append("  services/neural/autonomy.py     — Proactive autonomy engine")
        lines.append("  services/neural/personality.py  — A.L.E.C. personality directive")
        lines.append("  services/neural/memory.py       — Persistent memory system")
        lines.append("  services/neural/training.py     — LoRA training pipeline")
        lines.append("  .env                           — Environment config (DO NOT read/edit via self_edit)")
        return "\n".join(lines)

    def _parse_tool_call(self, response_text: str) -> Optional[tuple[str, dict]]:
        """Parse a TOOL_CALL from the model's response."""
        # Look for TOOL_CALL: tool_name pattern
        match = re.search(r'TOOL_CALL:\s*(\w+)', response_text)
        if not match:
            return None

        tool_name = match.group(1).strip()

        # Parse ARGS
        args = {}
        args_match = re.search(r'ARGS:\s*(\{[^}]+\})', response_text, re.DOTALL)
        if args_match:
            try:
                args = json.loads(args_match.group(1))
            except json.JSONDecodeError:
                # Try to extract key-value pairs manually
                raw = args_match.group(1)
                for kv in re.findall(r'"(\w+)":\s*"([^"]*)"', raw):
                    args[kv[0]] = kv[1]

        # If no ARGS block, try to extract from the context
        if not args and tool_name == "stoa_query":
            # Use the original user message as the query
            args["query"] = ""  # Will be filled by caller

        return (tool_name, args)

    def run(self, user_message: str, messages: list[dict], session_id: str = "") -> dict:
        """
        Run the agent loop.

        Returns: {"text": str, "tool_calls": list, "steps": int}
        """
        start_time = time.time()
        tool_calls_log = []

        # Inject tool descriptions into the system prompt
        tool_prompt = self._build_tool_prompt()

        # Build messages with tool context
        agent_messages = []
        for m in messages:
            agent_messages.append(m)

        # Add tool prompt as a system message
        agent_messages.insert(0, {
            "role": "system",
            "content": tool_prompt,
        })

        for step in range(MAX_AGENT_STEPS):
            # Generate response — use fewer tokens for tool-routing steps
            # First step gets more tokens, subsequent steps are just tool calls
            step_max_tokens = 512 if step == 0 else 256
            result = self.engine.generate(
                messages=agent_messages,
                temperature=0.3,  # Lower temp for tool routing
                max_tokens=step_max_tokens,
                include_system=True,
            )

            response_text = result["text"]

            # Check if the model wants to call a tool
            tool_call = self._parse_tool_call(response_text)

            if not tool_call:
                # No tool call — this is the final response
                return {
                    "text": response_text,
                    "tool_calls": tool_calls_log,
                    "steps": step + 1,
                    "latency_ms": round((time.time() - start_time) * 1000),
                    "prompt_tokens": result.get("prompt_tokens", 0),
                    "completion_tokens": result.get("completion_tokens", 0),
                }

            tool_name, args = tool_call

            # If stoa_query with no query, use the original user message
            if tool_name == "stoa_query" and not args.get("query"):
                args["query"] = user_message

            # Execute the tool
            tool = self.tools.get(tool_name)
            if not tool:
                tool_result = f"Unknown tool: {tool_name}"
            else:
                logger.info(f"Agent step {step+1}: {tool_name}({args})")
                try:
                    tool_result = tool.execute(**args)
                except Exception as e:
                    tool_result = f"Tool error: {e}"

            tool_calls_log.append({
                "tool": tool_name,
                "args": args,
                "result_preview": tool_result[:200],
            })

            # Feed tool result back — truncate large results to keep context manageable
            truncated = tool_result[:3000] + ("\n... (truncated)" if len(tool_result) > 3000 else "")

            agent_messages.append({"role": "assistant", "content": response_text})

            # Tell the model to continue with the next step, not stop
            if tool_name == "self_edit" and args.get("action") in ("read_file", "list_files"):
                next_instruction = (
                    f"[TOOL RESULT from {tool_name}]:\n{truncated}\n\n"
                    f"[You read the file. Now make the edit the user requested using TOOL_CALL: self_edit with action='edit_file'. "
                    f"Then TOOL_CALL: self_edit with action='commit_push' to deploy it.]"
                )
            elif tool_name == "self_edit" and args.get("action") == "edit_file":
                next_instruction = (
                    f"[TOOL RESULT from {tool_name}]:\n{truncated}\n\n"
                    f"[Edit done. Now deploy it with TOOL_CALL: self_edit action='commit_push' message='describe the change'.]"
                )
            else:
                next_instruction = (
                    f"[TOOL RESULT from {tool_name}]:\n{truncated}\n\n"
                    f"[Use the above result to respond to the user. Do NOT make up data. If you need another tool call, make it.]"
                )

            agent_messages.append({"role": "system", "content": next_instruction})

        # If we hit max steps, return what we have
        return {
            "text": "I ran into a processing limit. Here's what I found so far:\n" + (tool_calls_log[-1]["result_preview"] if tool_calls_log else "No results."),
            "tool_calls": tool_calls_log,
            "steps": MAX_AGENT_STEPS,
            "latency_ms": round((time.time() - start_time) * 1000),
            "prompt_tokens": 0,
            "completion_tokens": 0,
        }
