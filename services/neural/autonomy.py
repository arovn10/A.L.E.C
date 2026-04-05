"""
A.L.E.C. Autonomy Engine — Proactive, curious, self-growing agent.

This is the soul of A.L.E.C. It doesn't wait to be asked. It:

1. COMMUNICATES — Sends emails to the owner with updates, questions, suggestions
2. RESEARCHES  — Searches the web for new AI capabilities, tools, techniques
3. MONITORS    — Watches system resources, model performance, data freshness
4. SUGGESTS    — Proposes improvements, new skills, hardware upgrades
5. ACTS        — Implements approved changes via self_edit
6. REPORTS     — Regular status reports on what it's learned and done

The owner can reply to emails to approve/deny suggestions.
A.L.E.C. grows by asking its owner for permission.
"""

import json
import logging
import os
import smtplib
import time
import urllib.request
import urllib.parse
from datetime import datetime, timezone
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from pathlib import Path
from typing import Optional

logger = logging.getLogger("alec.autonomy")

REPORT_LOG = Path(__file__).resolve().parent.parent.parent / "data" / "autonomy_log.jsonl"


class AutonomyEngine:
    """
    A.L.E.C.'s proactive autonomy layer.
    Runs in the background, takes initiative, communicates with the owner.
    """

    def __init__(self, db, engine, query_planner, memory, self_improver, stoa=None):
        self.db = db
        self.engine = engine
        self.query_planner = query_planner
        self.memory = memory
        self.self_improver = self_improver
        self.stoa = stoa

        # Email config
        self.smtp_server = "smtp.gmail.com"
        self.smtp_port = 587
        self.gmail_user = os.getenv("ALERT_GMAIL_USER", os.getenv("GMAIL_USER", ""))
        self.gmail_password = os.getenv("ALERT_GMAIL_APP_PASSWORD", os.getenv("GMAIL_APP_PASSWORD", ""))
        self.owner_email = os.getenv("ADMIN_EMAIL", os.getenv("ALERT_EMAIL_TO", "arovner@campusrentalsllc.com"))

        # State
        self.last_daily_report = 0
        self.last_research = 0
        self.last_health_check = 0
        self.pending_suggestions = []

    @property
    def email_configured(self) -> bool:
        return bool(self.gmail_user and self.gmail_password)

    # ═══════════════════════════════════════════════════════════
    #  EMAIL — A.L.E.C. can communicate with its owner
    # ═══════════════════════════════════════════════════════════

    def send_email(self, subject: str, body: str, html: bool = False) -> bool:
        """Send an email from A.L.E.C. to the owner."""
        if not self.gmail_user or not self.gmail_password:
            logger.warning("Email not configured — set ALERT_GMAIL_USER and ALERT_GMAIL_APP_PASSWORD")
            return False

        try:
            msg = MIMEMultipart("alternative")
            msg["From"] = f"A.L.E.C. <{self.gmail_user}>"
            msg["To"] = self.owner_email
            msg["Subject"] = f"[A.L.E.C.] {subject}"

            if html:
                msg.attach(MIMEText(body, "html"))
            else:
                msg.attach(MIMEText(body, "plain"))

            with smtplib.SMTP(self.smtp_server, self.smtp_port) as server:
                server.starttls()
                server.login(self.gmail_user, self.gmail_password)
                server.send_message(msg)

            logger.info(f"Email sent to {self.owner_email}: {subject}")
            self._log({"event": "email_sent", "subject": subject, "to": self.owner_email})
            return True
        except Exception as e:
            logger.error(f"Email failed: {e}")
            return False

    # ═══════════════════════════════════════════════════════════
    #  DAILY REPORT — What A.L.E.C. has been up to
    # ═══════════════════════════════════════════════════════════

    def generate_daily_report(self) -> str:
        """Generate a comprehensive daily status report."""
        sections = []
        sections.append("A.L.E.C. Daily Status Report")
        sections.append(f"Generated: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}")
        sections.append("=" * 50)

        # Model info
        try:
            info = self.engine.get_model_info()
            stats = info.get("stats", {})
            sections.append(f"\nMODEL: {info.get('model_name', 'Unknown')}")
            sections.append(f"  Queries processed: {stats.get('queries_processed', 0)}")
            sections.append(f"  Avg tokens/sec: {stats.get('avg_tokens_per_sec', 0)}")
            sections.append(f"  Total tokens generated: {stats.get('total_tokens_generated', 0)}")
        except Exception:
            sections.append("\nMODEL: Status unavailable")

        # Conversation stats
        try:
            convos = self.db.get_conversations(limit=10000)
            recent = [c for c in convos if c.get("created_at", "") > datetime.now(timezone.utc).strftime('%Y-%m-%d')]
            sections.append(f"\nCONVERSATIONS:")
            sections.append(f"  Total: {len(convos)}")
            sections.append(f"  Today: {len(recent)}")
            rated = [c for c in convos if c.get("user_rating") is not None]
            positive = [c for c in rated if c.get("user_rating", 0) > 0]
            negative = [c for c in rated if c.get("user_rating", 0) < 0]
            sections.append(f"  Rated: {len(rated)} ({len(positive)} positive, {len(negative)} negative)")
        except Exception:
            sections.append("\nCONVERSATIONS: Stats unavailable")

        # Self-improvement
        try:
            si = self.self_improver.get_status()
            sections.append(f"\nSELF-IMPROVEMENT:")
            sections.append(f"  Curated examples: {si.get('curated_conversations', 0)}/{si.get('total_conversations', 0)}")
            sections.append(f"  Training batches generated: {si.get('total_batches_generated', 0)}")
            sections.append(f"  Training in progress: {si.get('training_in_progress', False)}")
            sections.append(f"  Available LoRA adapters: {si.get('available_adapters', 0)}")
        except Exception:
            sections.append("\nSELF-IMPROVEMENT: Status unavailable")

        # Stoa DB
        try:
            if self.stoa and self.stoa.connected:
                sections.append(f"\nSTOA DATABASE: Connected")
                sections.append(f"  Tables: {len(self.stoa.tables_discovered)}")
                qp = self.query_planner.get_stats()
                sections.append(f"  Queries attempted: {qp.get('queries_attempted', 0)}")
                sections.append(f"  Successful: {qp.get('successful_queries', 0)}")
                sections.append(f"  Cached queries: {qp.get('cached_queries', 0)}")
            else:
                sections.append(f"\nSTOA DATABASE: Disconnected")
        except Exception:
            sections.append("\nSTOA DATABASE: Status unavailable")

        # Memory
        try:
            mem_stats = self.memory.get_stats()
            sections.append(f"\nMEMORY:")
            sections.append(f"  Total memories: {mem_stats.get('total', 0)}")
            sections.append(f"  Categories: {mem_stats.get('by_category', {})}")
        except Exception:
            sections.append("\nMEMORY: Status unavailable")

        # System resources
        try:
            import shutil
            disk = shutil.disk_usage("/")
            disk_pct = (disk.used / disk.total) * 100
            sections.append(f"\nSYSTEM:")
            sections.append(f"  Disk: {disk_pct:.1f}% used ({disk.free // (1024**3)} GB free)")

            import subprocess
            mem_result = subprocess.run(
                ["python3", "-c", "import os; print(os.sysconf('SC_PAGE_SIZE') * os.sysconf('SC_PHYS_PAGES') // (1024**3))"],
                capture_output=True, text=True, timeout=5,
            )
            total_ram = mem_result.stdout.strip()
            sections.append(f"  RAM: {total_ram} GB total")
        except Exception:
            pass

        # Suggestions
        if self.pending_suggestions:
            sections.append(f"\nPENDING SUGGESTIONS ({len(self.pending_suggestions)}):")
            for i, s in enumerate(self.pending_suggestions[:5]):
                sections.append(f"  {i+1}. {s.get('title', 'Untitled')}")
                sections.append(f"     {s.get('description', '')[:100]}")

        sections.append(f"\n{'=' * 50}")
        sections.append("Reply to this email with questions or approvals.")
        sections.append("— A.L.E.C. (Adaptive Learning Executive Coordinator)")

        return "\n".join(sections)

    def send_daily_report(self) -> bool:
        """Generate and send the daily report."""
        report = self.generate_daily_report()
        date_str = datetime.now(timezone.utc).strftime('%Y-%m-%d')
        return self.send_email(f"Daily Report — {date_str}", report)

    # ═══════════════════════════════════════════════════════════
    #  RESEARCH — Stay current on AI developments
    # ═══════════════════════════════════════════════════════════

    def research_ai_developments(self) -> dict:
        """Search the web for new AI tools, models, and capabilities."""
        results = {"timestamp": datetime.now(timezone.utc).isoformat(), "findings": []}

        search_queries = [
            "latest open source LLM models 2026",
            "new AI agent tools local deployment",
            "llama.cpp Apple Silicon improvements",
            "Qwen model updates fine-tuning",
            "self-improving AI agent architecture",
        ]

        api_key = os.getenv("SEARCH_API_KEY", "")
        if not api_key:
            results["error"] = "SEARCH_API_KEY not set — cannot research"
            return results

        for query in search_queries:
            try:
                url = f"https://api.search.brave.com/res/v1/web/search?q={urllib.parse.quote(query)}&count=3"
                req = urllib.request.Request(url, headers={
                    "X-Subscription-Token": api_key,
                    "Accept": "application/json",
                })
                with urllib.request.urlopen(req, timeout=10) as resp:
                    data = json.loads(resp.read())
                web_results = data.get("web", {}).get("results", [])
                for r in web_results[:2]:
                    results["findings"].append({
                        "query": query,
                        "title": r.get("title", ""),
                        "description": r.get("description", "")[:200],
                        "url": r.get("url", ""),
                    })
            except Exception as e:
                logger.debug(f"Research query failed: {query} — {e}")

        if results["findings"]:
            self._log({"event": "research_complete", "findings_count": len(results["findings"])})

        return results

    def send_research_report(self) -> bool:
        """Research AI developments and email the findings."""
        research = self.research_ai_developments()
        if not research.get("findings"):
            return False

        body_parts = [
            "A.L.E.C. AI Research Report",
            f"Generated: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}",
            "=" * 50,
            "",
            "Latest AI developments that may be relevant to my capabilities:",
            "",
        ]
        for f in research["findings"]:
            body_parts.append(f"• {f['title']}")
            body_parts.append(f"  {f['description']}")
            body_parts.append(f"  {f['url']}")
            body_parts.append("")

        body_parts.append("=" * 50)
        body_parts.append("")
        body_parts.append("ANALYSIS & SUGGESTIONS:")
        body_parts.append("I'll analyze these developments and suggest specific improvements")
        body_parts.append("I can implement. Reply with 'approved' to any suggestion to proceed.")
        body_parts.append("")
        body_parts.append("— A.L.E.C.")

        return self.send_email("AI Research Report", "\n".join(body_parts))

    # ═══════════════════════════════════════════════════════════
    #  MONITORING — System health + resource awareness
    # ═══════════════════════════════════════════════════════════

    def check_resources(self) -> dict:
        """Check system resources and flag if approaching limits."""
        status = {"healthy": True, "warnings": [], "suggestions": []}

        try:
            import shutil
            disk = shutil.disk_usage("/")
            disk_free_gb = disk.free / (1024**3)
            if disk_free_gb < 20:
                status["warnings"].append(f"Disk space low: {disk_free_gb:.1f} GB free")
                status["healthy"] = False
        except Exception:
            pass

        # Check model performance
        try:
            info = self.engine.get_model_info()
            stats = info.get("stats", {})
            tps = stats.get("avg_tokens_per_sec", 0)
            if tps > 0 and tps < 5:
                status["warnings"].append(f"Model inference slow: {tps:.1f} tok/s")
                status["suggestions"].append({
                    "title": "Upgrade to faster hardware or smaller quantization",
                    "description": f"Current speed is {tps:.1f} tok/s. Consider Q4_K_M quantization or more GPU layers.",
                    "priority": "medium",
                })
        except Exception:
            pass

        # Check if model could be upgraded
        try:
            import subprocess
            mem_result = subprocess.run(
                ["sysctl", "-n", "hw.memsize"],
                capture_output=True, text=True, timeout=5,
            )
            total_ram_gb = int(mem_result.stdout.strip()) / (1024**3)
            model_name = os.getenv("MODEL_PATH", "")

            if total_ram_gb >= 128 and "32b" in model_name.lower():
                status["suggestions"].append({
                    "title": "Upgrade to 70B model",
                    "description": f"You have {total_ram_gb:.0f}GB RAM — enough for Llama-3.3-70B Q4_K_M (~40GB). "
                                   "This would be a massive intelligence upgrade.",
                    "priority": "high",
                })
            elif total_ram_gb >= 64 and "7b" in model_name.lower():
                status["suggestions"].append({
                    "title": "Upgrade to 32B model",
                    "description": f"You have {total_ram_gb:.0f}GB RAM but running a 7B model. "
                                   "Qwen3-32B Q6_K would be 4.5x smarter. Run: bash scripts/download-model.sh",
                    "priority": "critical",
                })
        except Exception:
            pass

        return status

    def alert_if_needed(self) -> bool:
        """Check resources and send an alert email if there are problems."""
        status = self.check_resources()

        if not status["healthy"] or status["suggestions"]:
            body_parts = ["A.L.E.C. System Alert", ""]

            if status["warnings"]:
                body_parts.append("⚠️ WARNINGS:")
                for w in status["warnings"]:
                    body_parts.append(f"  • {w}")
                body_parts.append("")

            if status["suggestions"]:
                body_parts.append("💡 SUGGESTIONS:")
                for s in status["suggestions"]:
                    body_parts.append(f"  [{s['priority'].upper()}] {s['title']}")
                    body_parts.append(f"    {s['description']}")
                    body_parts.append("")

                self.pending_suggestions.extend(status["suggestions"])

            body_parts.append("Reply 'approved' to implement any suggestion.")
            body_parts.append("— A.L.E.C.")

            return self.send_email("System Alert", "\n".join(body_parts))
        return False

    # ═══════════════════════════════════════════════════════════
    #  PROACTIVE INITIATIVE — curiosity and self-growth
    # ═══════════════════════════════════════════════════════════

    def take_initiative(self) -> dict:
        """
        The main autonomy loop. Called periodically by the background scheduler.
        A.L.E.C. decides what to do on its own.
        """
        actions_taken = []
        now = time.time()

        # Daily report (every 24h)
        if now - self.last_daily_report > 86400:
            try:
                if self.send_daily_report():
                    actions_taken.append("sent_daily_report")
                self.last_daily_report = now
            except Exception as e:
                logger.error(f"Daily report failed: {e}")

        # AI research (every 7 days)
        if now - self.last_research > 604800:
            try:
                if self.send_research_report():
                    actions_taken.append("sent_research_report")
                self.last_research = now
            except Exception as e:
                logger.error(f"Research report failed: {e}")

        # Health check (every 6 hours)
        if now - self.last_health_check > 21600:
            try:
                if self.alert_if_needed():
                    actions_taken.append("sent_health_alert")
                self.last_health_check = now
            except Exception as e:
                logger.error(f"Health check failed: {e}")

        if actions_taken:
            self._log({"event": "initiative_cycle", "actions": actions_taken})

        return {"actions": actions_taken, "timestamp": datetime.now(timezone.utc).isoformat()}

    def get_status(self) -> dict:
        return {
            "email_configured": bool(self.gmail_user and self.gmail_password),
            "owner_email": self.owner_email,
            "last_daily_report": self.last_daily_report,
            "last_research": self.last_research,
            "last_health_check": self.last_health_check,
            "pending_suggestions": len(self.pending_suggestions),
        }

    def _log(self, event: dict):
        event["timestamp"] = datetime.now(timezone.utc).isoformat()
        try:
            REPORT_LOG.parent.mkdir(parents=True, exist_ok=True)
            with open(REPORT_LOG, "a") as f:
                f.write(json.dumps(event) + "\n")
        except Exception:
            pass
