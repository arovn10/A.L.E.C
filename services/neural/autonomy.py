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

    def generate_daily_digest(self) -> str:
        """Generate a rich HTML daily digest email."""
        now = datetime.now(timezone.utc)
        date_str = now.strftime('%B %d, %Y')

        # Gather all data
        drive_status = {}
        try:
            import server as srv
            if hasattr(srv, 'drive') and srv.drive:
                drive_status = srv.drive.get_status()
        except Exception:
            pass

        improvements_today = drive_status.get('improvements_today', 0)
        improvements_total = drive_status.get('improvements_made', 0)
        daily_target = drive_status.get('daily_target', 3)
        on_track = drive_status.get('on_track', False)
        goals = drive_status.get('goals', [])

        # Hallucination rate
        hallucination_rate = None
        total_convos = 0
        positive_count = 0
        negative_count = 0
        try:
            convos = self.db.get_conversations(limit=10000)
            total_convos = len(convos)
            rated = [c for c in convos if c.get('user_rating') is not None]
            positive_count = sum(1 for c in rated if (c.get('user_rating') or 0) > 0)
            negative_count = sum(1 for c in rated if (c.get('user_rating') or 0) < 0)
            if rated:
                hallucination_rate = negative_count / len(rated)
        except Exception:
            pass

        # Self-improvement stats
        si = {}
        try:
            si = self.self_improver.get_status()
        except Exception:
            pass

        # Query planner stats
        qp = {}
        try:
            qp = self.query_planner.get_stats()
        except Exception:
            pass

        # Model info
        model_name = 'Unknown'
        try:
            info = self.engine.get_model_info()
            model_name = info.get('model_name', 'Unknown')
        except Exception:
            pass

        # Memory stats
        mem_total = 0
        try:
            mem_total = self.memory.get_stats().get('total', 0)
        except Exception:
            pass

        # Disk
        disk_free_gb = 0
        try:
            import shutil
            disk = shutil.disk_usage('/')
            disk_free_gb = disk.free // (1024**3)
        except Exception:
            pass

        # Today's actions from drive log
        todays_actions = []
        try:
            drive_log = Path(__file__).resolve().parent.parent.parent / 'data' / 'drive_log.jsonl'
            if drive_log.exists():
                today_prefix = now.strftime('%Y-%m-%d')
                for line in drive_log.read_text().strip().split('\n')[-50:]:
                    try:
                        entry = json.loads(line)
                        if entry.get('timestamp', '').startswith(today_prefix):
                            if 'actions' in entry and isinstance(entry['actions'], list):
                                todays_actions.extend(entry['actions'])
                            if 'ideas' in entry and isinstance(entry['ideas'], list):
                                todays_actions.extend(entry['ideas'])
                    except Exception:
                        pass
        except Exception:
            pass

        # Build HTML
        hall_pct = f'{hallucination_rate:.0%}' if hallucination_rate is not None else 'N/A'
        hall_color = '#22c55e' if hallucination_rate is not None and hallucination_rate < 0.1 else '#ef4444' if hallucination_rate is not None and hallucination_rate > 0.3 else '#f59e0b'
        query_success = qp.get('successful_queries', 0)
        query_total = qp.get('queries_attempted', 0)
        query_pct = f'{query_success/query_total:.0%}' if query_total > 0 else 'N/A'

        # Goal rows
        goal_rows = ''
        for g in goals:
            curr = g.get('current')
            target = g.get('target')
            priority = g.get('priority', 'medium')
            p_color = '#ef4444' if priority == 'critical' else '#f59e0b' if priority == 'high' else '#6b7280'
            if isinstance(curr, float) and curr <= 1 and not (isinstance(target, (int, float)) and target > 1):
                curr_str = f'{curr:.1%}'
            else:
                curr_str = str(curr) if curr is not None else '—'
            if isinstance(target, float) and target <= 1:
                target_str = f'{target:.1%}'
            else:
                target_str = str(target)
            goal_rows += f'<tr><td style="padding:8px 12px;border-bottom:1px solid #1e293b;"><span style="color:{p_color};font-weight:600;">{priority.upper()}</span></td><td style="padding:8px 12px;border-bottom:1px solid #1e293b;">{g.get("title","?")}</td><td style="padding:8px 12px;border-bottom:1px solid #1e293b;text-align:center;">{curr_str}</td><td style="padding:8px 12px;border-bottom:1px solid #1e293b;text-align:center;">{target_str}</td></tr>'

        # Actions list (deduplicated)
        actions_html = ''
        seen = set()
        for a in todays_actions:
            a_str = str(a)
            if a_str not in seen:
                seen.add(a_str)
                actions_html += f'<li style="margin-bottom:4px;">{a_str}</li>'
        if not actions_html:
            actions_html = '<li style="color:#6b7280;">No actions logged yet today</li>'

        improve_color = '#22c55e' if on_track else '#ef4444'

        html = f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#0f172a;color:#e2e8f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<div style="max-width:600px;margin:0 auto;padding:24px;">
    <div style="text-align:center;padding:24px 0 16px;">
        <div style="display:inline-block;width:48px;height:48px;background:#6366f1;border-radius:12px;text-align:center;line-height:48px;font-size:24px;font-weight:700;color:white;">A</div>
        <h1 style="margin:12px 0 4px;font-size:22px;color:#f1f5f9;">A.L.E.C. Daily Digest</h1>
        <p style="margin:0;color:#94a3b8;font-size:14px;">{date_str}</p>
    </div>
    <div style="background:#1e293b;border-radius:12px;padding:20px;margin-bottom:16px;">
        <h2 style="margin:0 0 16px;font-size:16px;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;">Today's Scorecard</h2>
        <table style="width:100%;text-align:center;"><tr>
            <td style="width:33%;"><div style="font-size:32px;font-weight:700;color:{improve_color};">{improvements_today}</div><div style="font-size:12px;color:#94a3b8;">Improvements<br>(target: {daily_target})</div></td>
            <td style="width:33%;"><div style="font-size:32px;font-weight:700;color:{hall_color};">{hall_pct}</div><div style="font-size:12px;color:#94a3b8;">Hallucination<br>Rate</div></td>
            <td style="width:33%;"><div style="font-size:32px;font-weight:700;color:#6366f1;">{improvements_total}</div><div style="font-size:12px;color:#94a3b8;">Total<br>Improvements</div></td>
        </tr></table>
    </div>
    <div style="background:#1e293b;border-radius:12px;padding:20px;margin-bottom:16px;">
        <h2 style="margin:0 0 12px;font-size:16px;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;">System Status</h2>
        <table style="width:100%;font-size:14px;">
            <tr><td style="padding:4px 0;color:#94a3b8;">Model</td><td style="text-align:right;">{model_name}</td></tr>
            <tr><td style="padding:4px 0;color:#94a3b8;">Conversations</td><td style="text-align:right;">{total_convos} total ({positive_count} \U0001f44d {negative_count} \U0001f44e)</td></tr>
            <tr><td style="padding:4px 0;color:#94a3b8;">Stoa Queries</td><td style="text-align:right;">{query_success}/{query_total} ({query_pct})</td></tr>
            <tr><td style="padding:4px 0;color:#94a3b8;">Training Data</td><td style="text-align:right;">{si.get('curated_conversations', 0)} curated / {si.get('total_batches_generated', 0)} batches</td></tr>
            <tr><td style="padding:4px 0;color:#94a3b8;">Memories</td><td style="text-align:right;">{mem_total} stored</td></tr>
            <tr><td style="padding:4px 0;color:#94a3b8;">Disk Free</td><td style="text-align:right;">{disk_free_gb} GB</td></tr>
        </table>
    </div>
    <div style="background:#1e293b;border-radius:12px;padding:20px;margin-bottom:16px;">
        <h2 style="margin:0 0 12px;font-size:16px;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;">Goals Progress</h2>
        <table style="width:100%;font-size:13px;border-collapse:collapse;">
            <tr style="color:#64748b;text-align:left;"><th style="padding:6px 12px;">Priority</th><th style="padding:6px 12px;">Goal</th><th style="padding:6px 12px;text-align:center;">Current</th><th style="padding:6px 12px;text-align:center;">Target</th></tr>
            {goal_rows}
        </table>
    </div>
    <div style="background:#1e293b;border-radius:12px;padding:20px;margin-bottom:16px;">
        <h2 style="margin:0 0 12px;font-size:16px;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;">Today's Actions</h2>
        <ul style="margin:0;padding-left:20px;font-size:14px;line-height:1.6;">{actions_html}</ul>
    </div>
    <div style="text-align:center;padding:16px 0;color:#475569;font-size:12px;">
        <p>A.L.E.C. \u2014 Adaptive Learning Executive Coordinator</p>
        <p>Reply to this email to give feedback or approve suggestions.</p>
    </div>
</div></body></html>"""

        return html

    def send_daily_report(self) -> bool:
        """Generate and send the daily digest."""
        html = self.generate_daily_digest()
        date_str = datetime.now(timezone.utc).strftime('%Y-%m-%d')
        try:
            import server as srv
            today = srv.drive.improvements_today if hasattr(srv, 'drive') and srv.drive else 0
            target = srv.drive.MIN_DAILY_IMPROVEMENTS if hasattr(srv, 'drive') and srv.drive else 3
            emoji = '\u2705' if today >= target else '\u26a0\ufe0f'
            subject = f"{emoji} Daily Digest \u2014 {today} improvements \u2014 {date_str}"
        except Exception:
            subject = f"Daily Digest \u2014 {date_str}"
        return self.send_email(subject, html, html=True)


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
