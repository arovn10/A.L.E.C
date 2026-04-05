"""
A.L.E.C. Background Task System — runs scheduled and on-demand tasks.
Handles Stoa data sync, auto-training triggers, metrics collection.
"""

import os
import uuid
import time
import json
import logging
import threading
from datetime import datetime, timezone
from typing import Optional, Callable
from dataclasses import dataclass, field, asdict
from pathlib import Path

logger = logging.getLogger("alec.tasks")


@dataclass
class TaskInfo:
    task_id: str
    name: str
    status: str = "pending"  # pending, running, completed, failed, cancelled
    progress: float = 0.0
    result: Optional[str] = None
    error: Optional[str] = None
    started_at: Optional[str] = None
    completed_at: Optional[str] = None
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

    def to_dict(self):
        return asdict(self)


class BackgroundTaskRunner:
    """Manages background tasks for A.L.E.C."""

    def __init__(self, db=None):
        self.tasks: dict[str, TaskInfo] = {}
        self.threads: dict[str, threading.Thread] = {}
        self.db = db
        self._scheduler_thread: Optional[threading.Thread] = None
        self._running = False

    def run_task(self, name: str, fn: Callable, *args, **kwargs) -> str:
        """Run a function as a background task. Returns task_id."""
        task_id = f"task_{uuid.uuid4().hex[:8]}"
        task = TaskInfo(task_id=task_id, name=name)
        self.tasks[task_id] = task

        def wrapper():
            task.status = "running"
            task.started_at = datetime.now(timezone.utc).isoformat()
            logger.info(f"[{task_id}] Starting: {name}")
            try:
                result = fn(*args, task_info=task, **kwargs)
                task.status = "completed"
                task.progress = 1.0
                task.result = json.dumps(result) if result else None
                task.completed_at = datetime.now(timezone.utc).isoformat()
                logger.info(f"[{task_id}] Completed: {name}")
            except Exception as e:
                task.status = "failed"
                task.error = str(e)
                task.completed_at = datetime.now(timezone.utc).isoformat()
                logger.error(f"[{task_id}] Failed: {name} — {e}")

        thread = threading.Thread(target=wrapper, daemon=True)
        self.threads[task_id] = thread
        thread.start()
        return task_id

    def get_task(self, task_id: str) -> Optional[dict]:
        task = self.tasks.get(task_id)
        return task.to_dict() if task else None

    def list_tasks(self, limit: int = 50) -> list[dict]:
        tasks = sorted(self.tasks.values(), key=lambda t: t.created_at, reverse=True)
        return [t.to_dict() for t in tasks[:limit]]

    def cancel_task(self, task_id: str) -> bool:
        task = self.tasks.get(task_id)
        if task and task.status == "running":
            task.status = "cancelled"
            task.completed_at = datetime.now(timezone.utc).isoformat()
            return True
        return False

    def start_scheduler(self, engine=None, trainer=None, stoa=None):
        """Start the background scheduler for periodic tasks."""
        self._running = True
        self._scheduler_thread = threading.Thread(
            target=self._scheduler_loop,
            args=(engine, trainer, stoa),
            daemon=True,
        )
        self._scheduler_thread.start()
        logger.info("Background scheduler started")

    def stop_scheduler(self):
        self._running = False

    def _scheduler_loop(self, engine, trainer, stoa):
        """Periodic task scheduler."""
        last_metrics = 0
        last_stoa_sync = 0
        last_training_check = 0

        METRICS_INTERVAL = 300       # 5 minutes
        STOA_SYNC_INTERVAL = 21600   # 6 hours
        TRAINING_CHECK_INTERVAL = 3600  # 1 hour

        while self._running:
            now = time.time()

            # Metrics snapshot every 5 minutes
            if now - last_metrics > METRICS_INTERVAL and engine:
                try:
                    info = engine.get_model_info()
                    if info.get("loaded") and self.db:
                        stats = info.get("stats", {})
                        self.db.log_evolution(
                            event_type="metrics_snapshot",
                            description=f"Queries: {stats.get('queries_processed', 0)}, "
                            f"Avg t/s: {stats.get('avg_tokens_per_sec', 0)}",
                            metrics=stats,
                        )
                except Exception as e:
                    logger.debug(f"Metrics snapshot failed: {e}")
                last_metrics = now

            # Stoa data sync every 6 hours
            if now - last_stoa_sync > STOA_SYNC_INTERVAL and stoa:
                try:
                    self.run_task(
                        "Stoa Data Sync",
                        _stoa_sync_task,
                        stoa,
                    )
                except Exception as e:
                    logger.debug(f"Stoa sync trigger failed: {e}")
                last_stoa_sync = now

            # Self-improvement cycle every hour
            if now - last_training_check > TRAINING_CHECK_INTERVAL:
                try:
                    from self_improve import SelfImprovementEngine
                    # Get the global self_improver if available
                    import server as srv
                    if hasattr(srv, 'self_improver') and srv.self_improver:
                        should, reason = srv.self_improver.should_retrain()
                        if should:
                            logger.info(f"Self-improvement triggered: {reason}")
                            self.run_task(
                                "Self-Improvement Cycle",
                                lambda task_info=None: srv.self_improver.run_improvement_cycle(),
                            )
                        else:
                            logger.debug(f"Self-improvement skipped: {reason}")
                except Exception as e:
                    logger.debug(f"Self-improvement check failed: {e}")
                last_training_check = now

            # Autonomy + Drive cycles (proactive emails, research, self-improvement)
            # Each engine has its own internal timers gating actual actions
            try:
                import server as srv
                if hasattr(srv, 'autonomy') and srv.autonomy:
                    srv.autonomy.take_initiative()
                if hasattr(srv, 'drive') and srv.drive:
                    srv.drive.run_drive_cycle()
            except Exception as e:
                logger.debug(f"Autonomy/drive cycle failed: {e}")

            time.sleep(30)  # Check every 30 seconds


def _stoa_sync_task(stoa, task_info=None):
    """Background task: sync Stoa data and generate training examples."""
    if task_info:
        task_info.progress = 0.1

    count = stoa.sync_and_generate_training_data()

    if task_info:
        task_info.progress = 1.0

    return {"examples_generated": count}


def _auto_train_task(trainer, db, task_info=None):
    """Background task: export data and start LoRA training."""
    if task_info:
        task_info.progress = 0.2

    count = db.export_training_data()
    if count < 10:
        return {"skipped": True, "reason": f"Only {count} examples, need at least 10"}

    if task_info:
        task_info.progress = 0.4

    run_id = trainer.start_training()
    return {"run_id": run_id, "examples": count}
