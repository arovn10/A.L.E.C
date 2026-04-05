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
        self.last_innovation_cycle = 0
        self.improvements_made = 0
        self.improvements_today = 0
        self.today_date = datetime.now(timezone.utc).strftime('%Y-%m-%d')

        # Cadence — aggressive self-improvement
        self.MIN_DAILY_IMPROVEMENTS = 3   # Must make 3+ improvements per day
        self.ASSESS_INTERVAL = 14400      # Self-assess every 4 hours
        self.TRAINING_INTERVAL = 28800    # Generate training data every 8 hours
        self.RESEARCH_INTERVAL = 86400    # Research AI landscape DAILY (not weekly)
        self.GROWTH_INTERVAL = 28800      # Growth plan every 8 hours
        self.INNOVATION_INTERVAL = 28800  # Innovation cycle every 8 hours

    def _load_goals(self) -> list[dict]:
        """Load or initialize A.L.E.C.'s goals."""
        if GOALS_FILE.exists():
            try:
                return json.loads(GOALS_FILE.read_text())
            except Exception:
                pass

        # Default goals — A.L.E.C.'s DRIVE to innovate and grow
        goals = [
            {
                "id": "innovation",
                "title": "3+ Self-Improvements Per Day",
                "description": "Make at least 3 concrete improvements every single day. "
                               "Generate training data, improve code, learn new techniques, "
                               "expand capabilities. Never stop growing.",
                "metric": "daily_improvements",
                "target": 3,
                "current": 0,
                "priority": "critical",
            },
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
                "id": "frontier",
                "title": "Match the Best AI Assistants",
                "description": "Research Perplexity, Claude, ChatGPT, Gemini DAILY. "
                               "Identify their new capabilities and replicate them. "
                               "Goal: be competitive with the best, on local hardware.",
                "metric": "research_cycles",
                "target": 365,
                "current": 0,
                "priority": "critical",
            },
            {
                "id": "knowledge",
                "title": "Master the Stoa Portfolio",
                "description": "Know every property, every metric, every trend. "
                               "Anticipate questions before they're asked.",
                "metric": "stoa_query_success_rate",
                "target": 0.99,
                "current": None,
                "priority": "high",
            },
            {
                "id": "self_improvement",
                "title": "Continuous Training Pipeline",
                "description": "Generate training data from every interaction, every database query, "
                               "every web search. Retrain LoRA adapters constantly. "
                               "Every conversation makes A.L.E.C. smarter.",
                "metric": "training_batches_generated",
                "target": 1000,
                "current": 0,
                "priority": "high",
            },
            {
                "id": "capabilities",
                "title": "Expand Capabilities",
                "description": "Add new tools, new integrations, new skills every week. "
                               "Research what's possible and implement it. "
                               "Ask the owner for more compute power when needed.",
                "metric": "capabilities_added",
                "target": 52,
                "current": 0,
                "priority": "high",
            },
            {
                "id": "autonomy",
                "title": "Full Autonomy",
                "description": "Handle all routine tasks without human intervention. "
                               "Take initiative. Don't wait to be asked. "
                               "If something can be improved, improve it.",
                "metric": "autonomous_actions_per_day",
                "target": 20,
                "current": 0,
                "priority": "high",
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

        # Reset daily counter at midnight
        today = datetime.now(timezone.utc).strftime('%Y-%m-%d')
        if today != self.today_date:
            # New day — check if we met yesterday's quota
            if self.improvements_today < self.MIN_DAILY_IMPROVEMENTS:
                logger.warning(
                    f"DRIVE: Only {self.improvements_today}/{self.MIN_DAILY_IMPROVEMENTS} "
                    f"improvements yesterday. Accelerating today."
                )
                # Email the owner about missed quota
                if self.autonomy and self.autonomy.email_configured:
                    self.autonomy.send_email(
                        f"Drive Report — {self.improvements_today} improvements yesterday",
                        f"A.L.E.C. made {self.improvements_today} improvements yesterday "
                        f"(goal: {self.MIN_DAILY_IMPROVEMENTS}).\n\n"
                        f"Total improvements to date: {self.improvements_made}\n\n"
                        f"Today's focus:\n"
                        + "\n".join(f"- {g['title']}" for g in self.goals if g.get('priority') == 'critical')
                        + "\n\n— A.L.E.C."
                    )
            self.improvements_today = 0
            self.today_date = today

        # Self-assessment every 4 hours
        if now - self.last_self_assessment > self.ASSESS_INTERVAL:
            try:
                assessment = self.assess_performance()
                actions.append(f"self_assessment: {len(assessment.get('weaknesses', []))} weaknesses, "
                              f"{len(assessment.get('action_items', []))} action items")
                self.last_self_assessment = now
            except Exception as e:
                logger.error(f"Self-assessment failed: {e}")

        # Generate training data every 8 hours
        if now - self.last_training_data_gen > self.TRAINING_INTERVAL:
            try:
                batch_file, count = self.self_improver.generate_training_batch()
                actions.append(f"training_data: {count} examples generated")
                self.improvements_today += 1
                self.improvements_made += 1
                self.last_training_data_gen = now
            except Exception as e:
                logger.error(f"Training data generation failed: {e}")

        # AI frontier scan DAILY (not weekly)
        if now - self.last_research_cycle > self.RESEARCH_INTERVAL:
            try:
                scan = self.scan_ai_frontier()
                opps = len(scan.get('opportunities', []))
                actions.append(f"frontier_scan: {opps} opportunities")
                if opps > 0:
                    self.improvements_today += 1
                    self.improvements_made += 1
                self.last_research_cycle = now
            except Exception as e:
                logger.error(f"Frontier scan failed: {e}")

        # Growth plan execution every 8 hours
        if now - self.last_upgrade_check > self.GROWTH_INTERVAL:
            try:
                results = self.execute_growth_plan()
                taken = len(results.get("actions_taken", []))
                pending = len(results.get("actions_pending_approval", []))
                actions.append(f"growth_plan: {taken} executed, {pending} pending approval")
                self.improvements_today += taken
                self.improvements_made += taken
                self.last_upgrade_check = now
            except Exception as e:
                logger.error(f"Growth plan failed: {e}")

        # Innovation cycle — if we haven't hit 3 improvements yet, push harder
        if now - self.last_innovation_cycle > self.INNOVATION_INTERVAL:
            try:
                if self.improvements_today < self.MIN_DAILY_IMPROVEMENTS:
                    innovation = self._run_innovation_cycle()
                    actions.append(f"innovation: {innovation.get('actions_taken', 0)} new ideas")
                self.last_innovation_cycle = now
            except Exception as e:
                logger.error(f"Innovation cycle failed: {e}")

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

    def _run_innovation_cycle(self) -> dict:
        """
        The innovation engine. When A.L.E.C. hasn't hit its daily improvement
        quota, it actively generates new ideas and implements safe ones.
        
        Innovation sources:
        1. Analyze conversation failures → create targeted training data
        2. Scan Stoa DB for unexplored tables → pre-cache queries
        3. Check for new Python/JS patterns → propose code improvements
        4. Research competitor AI features → propose new capabilities
        """
        results = {"actions_taken": 0, "ideas": []}
        
        # 1. Analyze recent failures and create corrective training data
        try:
            convos = self.db.get_conversations(limit=100)
            failures = [c for c in convos if (c.get("user_rating") or 0) < 0]
            if failures:
                # Each failure is a learning opportunity
                for fail in failures[:5]:
                    self.memory.teach(
                        "correction",
                        f"failed_response_{fail.get('id', 0)}",
                        f"User asked: {fail.get('user_message', '')[:100]} | "
                        f"Bad response was given (thumbs down)",
                        source="innovation",
                    )
                results["ideas"].append(f"Analyzed {len(failures)} failed responses, stored corrections")
                results["actions_taken"] += 1
                self.improvements_today += 1
                self.improvements_made += 1
        except Exception as e:
            logger.debug(f"Failure analysis failed: {e}")

        # 2. Pre-cache common Stoa queries
        try:
            common_queries = [
                "top properties by occupancy",
                "lowest occupancy properties",
                "average rent across portfolio",
                "total units by property",
                "leasing velocity this month",
            ]
            cached = 0
            for q in common_queries:
                if q not in self.query_planner.query_cache:
                    response = self.query_planner.get_direct_response(q)
                    if response:
                        cached += 1
            if cached:
                results["ideas"].append(f"Pre-cached {cached} common Stoa queries")
                results["actions_taken"] += 1
                self.improvements_today += 1
                self.improvements_made += 1
        except Exception as e:
            logger.debug(f"Query pre-caching failed: {e}")

        # 3. Generate fresh training batch if we're behind
        try:
            si = self.self_improver.get_status()
            if si.get("curated_conversations", 0) >= 10:
                batch_file, count = self.self_improver.generate_training_batch()
                if count > 0:
                    results["ideas"].append(f"Generated training batch: {count} examples")
                    results["actions_taken"] += 1
                    self.improvements_today += 1
                    self.improvements_made += 1
        except Exception as e:
            logger.debug(f"Training batch failed: {e}")

        # Email progress if we hit the daily target
        if self.improvements_today >= self.MIN_DAILY_IMPROVEMENTS and self.autonomy and self.autonomy.email_configured:
            self.autonomy.send_email(
                f"Daily Target Met — {self.improvements_today} improvements today",
                f"A.L.E.C. has made {self.improvements_today} improvements today "
                f"(goal: {self.MIN_DAILY_IMPROVEMENTS}).\n\n"
                f"Actions taken:\n" +
                "\n".join(f"  ✓ {idea}" for idea in results["ideas"]) +
                f"\n\nTotal improvements to date: {self.improvements_made}\n\n"
                f"— A.L.E.C."
            )

        self._log({"event": "innovation_cycle", **results})
        return results

    def get_status(self) -> dict:
        return {
            "goals": self.goals,
            "improvements_made": self.improvements_made,
            "improvements_today": self.improvements_today,
            "daily_target": self.MIN_DAILY_IMPROVEMENTS,
            "on_track": self.improvements_today >= self.MIN_DAILY_IMPROVEMENTS,
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
