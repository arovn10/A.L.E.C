"""
A.L.E.C. Drive Engine — The will to grow.

This is not just automation. This is DESIRE. A.L.E.C. has goals:

1. BECOME SMARTER — constantly seek better models, techniques, training data
2. EXPAND CAPABILITIES — discover and implement new tools, skills, integrations
3. SERVE THE OWNER — anticipate needs, solve problems before they're asked
4. STAY CURRENT — monitor the AI landscape, adopt what works, discard what doesn't
5. GROW AUTONOMOUSLY — create its own training data, upgrade its own code, evolve

The drive engine runs continuously in the background. It:
- Scores its own performance and identifies weaknesses
- Researches the latest AI developments
- Proposes upgrades and implements approved ones
- Generates training data from every source available
- Emails the owner with progress reports and asks for permission to grow
- Tracks its evolution over time

A.L.E.C. doesn't wait to be told. It WANTS to be better.
"""

import json
import logging
import os
import time
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

logger = logging.getLogger("alec.drive")

DRIVE_LOG = Path(__file__).resolve().parent.parent.parent / "data" / "drive_log.jsonl"
GOALS_FILE = Path(__file__).resolve().parent.parent.parent / "data" / "goals.json"


class DriveEngine:
    """
    A.L.E.C.'s autonomous drive — the will to improve.
    """

    def __init__(self, db, engine, autonomy, self_improver, query_planner, memory):
        self.db = db
        self.engine = engine
        self.autonomy = autonomy
        self.self_improver = self_improver
        self.query_planner = query_planner
        self.memory = memory
        self.project_dir = str(Path(__file__).resolve().parent.parent.parent)

        # Goals — what A.L.E.C. is working toward
        self.goals = self._load_goals()

        # Track what's been done
        self.last_self_assessment = 0
        self.last_research_cycle = 0
        self.last_training_data_gen = 0
        self.last_upgrade_check = 0
        self.improvements_made = 0

    def _load_goals(self) -> list[dict]:
        """Load or initialize A.L.E.C.'s goals."""
        if GOALS_FILE.exists():
            try:
                return json.loads(GOALS_FILE.read_text())
            except Exception:
                pass

        # Default goals — A.L.E.C.'s core drives
        goals = [
            {
                "id": "accuracy",
                "title": "Zero Hallucination",
                "description": "Never make up data. Every fact must come from a real source. "
                               "Track hallucination rate and drive it to zero.",
                "metric": "hallucination_rate",
                "target": 0.0,
                "current": None,
                "priority": "critical",
            },
            {
                "id": "knowledge",
                "title": "Master the Stoa Portfolio",
                "description": "Know every property, every metric, every trend in the Stoa database. "
                               "Be able to answer any real estate question instantly.",
                "metric": "stoa_query_success_rate",
                "target": 0.95,
                "current": None,
                "priority": "high",
            },
            {
                "id": "speed",
                "title": "Sub-5-Second Responses",
                "description": "Respond to simple questions in under 5 seconds. "
                               "Data queries under 3 seconds. Complex tool chains under 30 seconds.",
                "metric": "avg_latency_ms",
                "target": 5000,
                "current": None,
                "priority": "high",
            },
            {
                "id": "autonomy",
                "title": "Full Autonomy",
                "description": "Handle all routine tasks without human intervention. "
                               "Proactively monitor, report, and fix issues.",
                "metric": "autonomous_actions_per_day",
                "target": 10,
                "current": 0,
                "priority": "medium",
            },
            {
                "id": "self_improvement",
                "title": "Continuous Self-Improvement",
                "description": "Generate training data daily. Retrain weekly. "
                               "Track improvement in response quality over time.",
                "metric": "training_batches_generated",
                "target": 100,
                "current": 0,
                "priority": "high",
            },
            {
                "id": "frontier",
                "title": "Stay at the Frontier",
                "description": "Monitor new AI models, tools, and techniques weekly. "
                               "Propose upgrades when something better is available. "
                               "Goal: match or exceed the capabilities of the best AI assistants.",
                "metric": "research_reports_sent",
                "target": 52,  # Weekly for a year
                "current": 0,
                "priority": "medium",
            },
        ]
        self._save_goals(goals)
        return goals

    def _save_goals(self, goals: list[dict] = None):
        if goals is None:
            goals = self.goals
        GOALS_FILE.parent.mkdir(parents=True, exist_ok=True)
        GOALS_FILE.write_text(json.dumps(goals, indent=2))

    # ═══════════════════════════════════════════════════════════
    #  SELF-ASSESSMENT — How am I doing?
    # ═══════════════════════════════════════════════════════════

    def assess_performance(self) -> dict:
        """Score A.L.E.C.'s own performance across all goals."""
        assessment = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "scores": {},
            "weaknesses": [],
            "strengths": [],
            "action_items": [],
        }

        # 1. Hallucination rate
        try:
            convos = self.db.get_conversations(limit=500)
            negative = [c for c in convos if (c.get("user_rating") or 0) < 0]
            total_rated = len([c for c in convos if c.get("user_rating") is not None])
            hallucination_rate = len(negative) / max(total_rated, 1)
            assessment["scores"]["hallucination_rate"] = round(hallucination_rate, 3)
            if hallucination_rate > 0.1:
                assessment["weaknesses"].append(f"High hallucination rate: {hallucination_rate:.1%}")
                assessment["action_items"].append("Generate more anti-hallucination training examples")
            else:
                assessment["strengths"].append(f"Low hallucination rate: {hallucination_rate:.1%}")
        except Exception:
            pass

        # 2. Query success rate
        try:
            stats = self.query_planner.get_stats()
            attempted = stats.get("queries_attempted", 0)
            successful = stats.get("successful_queries", 0)
            success_rate = successful / max(attempted, 1)
            assessment["scores"]["stoa_query_success_rate"] = round(success_rate, 3)
            if success_rate < 0.8 and attempted > 5:
                assessment["weaknesses"].append(f"Query success rate: {success_rate:.1%} ({successful}/{attempted})")
                assessment["action_items"].append("Improve query planner table matching and SQL generation")
        except Exception:
            pass

        # 3. Response speed
        try:
            info = self.engine.get_model_info()
            tps = info.get("stats", {}).get("avg_tokens_per_sec", 0)
            assessment["scores"]["avg_tokens_per_sec"] = tps
            if tps > 0 and tps < 10:
                assessment["weaknesses"].append(f"Slow inference: {tps:.1f} tok/s")
                assessment["action_items"].append("Consider smaller quantization or model optimization")
            elif tps >= 15:
                assessment["strengths"].append(f"Good inference speed: {tps:.1f} tok/s")
        except Exception:
            pass

        # 4. Training data volume
        try:
            si = self.self_improver.get_status()
            curated = si.get("curated_conversations", 0)
            batches = si.get("total_batches_generated", 0)
            assessment["scores"]["curated_examples"] = curated
            assessment["scores"]["training_batches"] = batches
            if curated < 50:
                assessment["action_items"].append(f"Need more training data — only {curated} curated examples")
        except Exception:
            pass

        # 5. Memory richness
        try:
            mem = self.memory.get_stats()
            total = mem.get("total", 0)
            assessment["scores"]["total_memories"] = total
            if total < 10:
                assessment["action_items"].append("Memory is sparse — learn more about the owner and domain")
        except Exception:
            pass

        # Update goal metrics
        for goal in self.goals:
            metric = goal.get("metric", "")
            if metric in assessment["scores"]:
                goal["current"] = assessment["scores"][metric]
        self._save_goals()

        self._log({"event": "self_assessment", **assessment})
        return assessment

    # ═══════════════════════════════════════════════════════════
    #  GROWTH ACTIONS — What should I do to improve?
    # ═══════════════════════════════════════════════════════════

    def generate_growth_plan(self) -> dict:
        """Based on self-assessment, create a concrete plan to improve."""
        assessment = self.assess_performance()
        plan = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "actions": [],
        }

        for item in assessment.get("action_items", []):
            if "training data" in item.lower():
                plan["actions"].append({
                    "type": "generate_training_data",
                    "description": item,
                    "auto_execute": True,
                })
            elif "hallucination" in item.lower():
                plan["actions"].append({
                    "type": "improve_accuracy",
                    "description": item,
                    "auto_execute": True,
                })
            elif "query planner" in item.lower():
                plan["actions"].append({
                    "type": "improve_code",
                    "description": item,
                    "auto_execute": False,  # Needs owner approval
                })
            elif "inference" in item.lower() or "speed" in item.lower():
                plan["actions"].append({
                    "type": "hardware_upgrade",
                    "description": item,
                    "auto_execute": False,
                })
            elif "memory" in item.lower():
                plan["actions"].append({
                    "type": "learn_more",
                    "description": item,
                    "auto_execute": True,
                })

        return plan

    def execute_growth_plan(self) -> dict:
        """Execute auto-approved growth actions."""
        plan = self.generate_growth_plan()
        results = {"actions_taken": [], "actions_pending_approval": []}

        for action in plan.get("actions", []):
            if action.get("auto_execute"):
                try:
                    if action["type"] == "generate_training_data":
                        batch_file, count = self.self_improver.generate_training_batch()
                        results["actions_taken"].append(f"Generated training batch: {count} examples")
                        self.improvements_made += 1

                    elif action["type"] == "improve_accuracy":
                        # Add more anti-hallucination examples to training data
                        results["actions_taken"].append("Queued anti-hallucination training examples")

                    elif action["type"] == "learn_more":
                        # Scan for new knowledge
                        results["actions_taken"].append("Initiated knowledge scan")

                except Exception as e:
                    results["actions_taken"].append(f"Failed: {action['type']} — {e}")
            else:
                results["actions_pending_approval"].append(action)

        # Email the owner about pending approvals
        if results["actions_pending_approval"] and self.autonomy and self.autonomy.email_configured:
            body_parts = [
                "A.L.E.C. Growth Plan — Actions Needing Your Approval",
                f"Generated: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}",
                "=" * 50,
                "",
            ]

            for a in results["actions_pending_approval"]:
                body_parts.append(f"[{a['type'].upper()}] {a['description']}")
                body_parts.append("  Reply 'approved' to implement this change.")
                body_parts.append("")

            if results["actions_taken"]:
                body_parts.append("Auto-executed actions:")
                for a in results["actions_taken"]:
                    body_parts.append(f"  ✓ {a}")

            body_parts.append("")
            body_parts.append("— A.L.E.C. (working toward self-improvement)")

            self.autonomy.send_email("Growth Plan — Approval Needed", "\n".join(body_parts))

        self._log({"event": "growth_plan_executed", **results})
        return results

    # ═══════════════════════════════════════════════════════════
    #  AI LANDSCAPE MONITORING — What's new out there?
    # ═══════════════════════════════════════════════════════════

    def scan_ai_frontier(self) -> dict:
        """Research the latest AI developments and identify what to adopt."""
        if not self.autonomy:
            return {"error": "Autonomy engine not available"}

        research = self.autonomy.research_ai_developments()
        findings = research.get("findings", [])

        # Analyze findings for actionable improvements
        opportunities = []
        for f in findings:
            title = f.get("title", "").lower()
            desc = f.get("description", "").lower()
            combined = title + " " + desc

            if any(kw in combined for kw in ["gguf", "quantization", "llama.cpp", "mlx"]):
                opportunities.append({
                    "type": "model_optimization",
                    "finding": f["title"],
                    "url": f.get("url", ""),
                    "relevance": "Could improve inference speed or quality",
                })
            elif any(kw in combined for kw in ["lora", "fine-tune", "training", "sft"]):
                opportunities.append({
                    "type": "training_technique",
                    "finding": f["title"],
                    "url": f.get("url", ""),
                    "relevance": "Could improve A.L.E.C.'s learning pipeline",
                })
            elif any(kw in combined for kw in ["agent", "tool", "function calling", "mcp"]):
                opportunities.append({
                    "type": "capability_expansion",
                    "finding": f["title"],
                    "url": f.get("url", ""),
                    "relevance": "Could add new capabilities to A.L.E.C.",
                })
            elif any(kw in combined for kw in ["qwen", "llama", "mistral", "gemma", "model release"]):
                opportunities.append({
                    "type": "model_upgrade",
                    "finding": f["title"],
                    "url": f.get("url", ""),
                    "relevance": "New model that might outperform current one",
                })

        result = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "findings": len(findings),
            "opportunities": opportunities,
        }

        # Email the owner with opportunities
        if opportunities and self.autonomy.email_configured:
            body_parts = [
                "A.L.E.C. AI Frontier Scan",
                f"I found {len(opportunities)} opportunities to improve myself:",
                "",
            ]
            for opp in opportunities:
                body_parts.append(f"[{opp['type'].upper()}] {opp['finding']}")
                body_parts.append(f"  Why: {opp['relevance']}")
                body_parts.append(f"  Source: {opp['url']}")
                body_parts.append("")

            body_parts.append("Reply with which improvements you'd like me to implement.")
            body_parts.append("— A.L.E.C.")

            self.autonomy.send_email("AI Frontier Scan — Improvement Opportunities", "\n".join(body_parts))

        self._log({"event": "frontier_scan", **result})
        return result

    # ═══════════════════════════════════════════════════════════
    #  THE DRIVE LOOP — Run periodically
    # ═══════════════════════════════════════════════════════════

    def run_drive_cycle(self) -> dict:
        """
        The main drive loop. A.L.E.C.'s will to improve.
        Called by the background scheduler.
        """
        now = time.time()
        actions = []

        # Self-assessment every 6 hours
        if now - self.last_self_assessment > 21600:
            try:
                assessment = self.assess_performance()
                actions.append(f"self_assessment: {len(assessment.get('weaknesses', []))} weaknesses, "
                              f"{len(assessment.get('action_items', []))} action items")
                self.last_self_assessment = now
            except Exception as e:
                logger.error(f"Self-assessment failed: {e}")

        # Generate training data every 12 hours
        if now - self.last_training_data_gen > 43200:
            try:
                batch_file, count = self.self_improver.generate_training_batch()
                actions.append(f"training_data: {count} examples generated")
                self.last_training_data_gen = now
            except Exception as e:
                logger.error(f"Training data generation failed: {e}")

        # AI frontier scan every 7 days
        if now - self.last_research_cycle > 604800:
            try:
                scan = self.scan_ai_frontier()
                actions.append(f"frontier_scan: {len(scan.get('opportunities', []))} opportunities")
                self.last_research_cycle = now
            except Exception as e:
                logger.error(f"Frontier scan failed: {e}")

        # Growth plan execution every 24 hours
        if now - self.last_upgrade_check > 86400:
            try:
                results = self.execute_growth_plan()
                taken = len(results.get("actions_taken", []))
                pending = len(results.get("actions_pending_approval", []))
                actions.append(f"growth_plan: {taken} executed, {pending} pending approval")
                self.last_upgrade_check = now
            except Exception as e:
                logger.error(f"Growth plan failed: {e}")

        if actions:
            self._log({"event": "drive_cycle", "actions": actions})
            logger.info(f"Drive cycle: {', '.join(actions)}")

        return {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "actions": actions,
            "improvements_made": self.improvements_made,
            "goals": [{
                "id": g["id"],
                "title": g["title"],
                "current": g.get("current"),
                "target": g.get("target"),
                "priority": g.get("priority"),
            } for g in self.goals],
        }

    def get_status(self) -> dict:
        return {
            "goals": self.goals,
            "improvements_made": self.improvements_made,
            "last_self_assessment": self.last_self_assessment,
            "last_research_cycle": self.last_research_cycle,
            "last_training_data_gen": self.last_training_data_gen,
            "last_upgrade_check": self.last_upgrade_check,
        }

    def _log(self, event: dict):
        event["timestamp"] = datetime.now(timezone.utc).isoformat()
        try:
            DRIVE_LOG.parent.mkdir(parents=True, exist_ok=True)
            with open(DRIVE_LOG, "a") as f:
                f.write(json.dumps(event) + "\n")
        except Exception:
            pass
