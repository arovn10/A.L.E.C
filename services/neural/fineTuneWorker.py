"""
fineTuneWorker.py — CLI wrapper around ALECTrainer for queue-triggered fine-tuning.

Usage:
    python fineTuneWorker.py --job_id <job_id> --batch_file <path/to/batch.jsonl>

Writes status to: data/sft/jobs/<job_id>.json
Status keys: { job_id, status, batch_file, run_id, error, started_at, completed_at }

This worker is intentionally thin. All training logic lives in training.py (ALECTrainer).
H4 compliance is enforced upstream in fineTuneQueue.js (never auto-promotes).
"""

import argparse
import json
import logging
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

# Resolve project root (two levels up from services/neural/)
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
JOBS_DIR     = PROJECT_ROOT / "data" / "sft" / "jobs"

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [fineTuneWorker] %(levelname)s: %(message)s",
)
logger = logging.getLogger("alec.fineTuneWorker")

try:
    from training import ALECTrainer
except ImportError as e:
    logger.error(f"Failed to import ALECTrainer from training.py: {e}")
    ALECTrainer = None


def _write_status(job_id: str, status: dict) -> None:
    """Persist status dict to JSON sidecar file."""
    JOBS_DIR.mkdir(parents=True, exist_ok=True)
    path = JOBS_DIR / f"{job_id}.json"
    path.write_text(json.dumps(status, indent=2))


def run(job_id: str, batch_file: str) -> dict:
    """
    Run a single fine-tune job synchronously (called from background thread by Node.js).

    Returns the final status dict.
    """
    started_at = datetime.now(timezone.utc).isoformat()
    status = {
        "job_id":       job_id,
        "status":       "running",
        "batch_file":   batch_file,
        "run_id":       None,
        "error":        None,
        "started_at":   started_at,
        "completed_at": None,
    }
    _write_status(job_id, status)
    logger.info(f"Starting fine-tune job {job_id} from {batch_file}")

    if ALECTrainer is None:
        status["status"] = "failed"
        status["error"]  = "ALECTrainer could not be imported"
        _write_status(job_id, status)
        return status

    try:
        trainer = ALECTrainer()
        run_id = trainer.start_training(data_path=batch_file)
        status["run_id"] = run_id

        # Poll until training completes (ALECTrainer runs in a background thread)
        poll_interval = 10  # seconds
        max_wait      = 7200  # 2 hours hard timeout
        elapsed       = 0
        while elapsed < max_wait:
            s = trainer.get_status()
            if not s.get("is_training", True):
                break
            time.sleep(poll_interval)
            elapsed += poll_interval
            logger.info(f"[{job_id}] Training in progress — step {s.get('current_step')}/{s.get('total_steps')} loss={s.get('current_loss')}")

        final = trainer.get_status()
        if final.get("error"):
            raise RuntimeError(final["error"])

        status["status"]       = "completed"
        status["completed_at"] = datetime.now(timezone.utc).isoformat()
        logger.info(f"[{job_id}] Training complete. run_id={run_id}")

    except Exception as exc:
        logger.error(f"[{job_id}] Training failed: {exc}")
        status["status"]       = "failed"
        status["error"]        = str(exc)
        status["completed_at"] = datetime.now(timezone.utc).isoformat()

    _write_status(job_id, status)
    return status


def main() -> None:
    parser = argparse.ArgumentParser(description="A.L.E.C. fine-tune worker")
    parser.add_argument("--job_id",     required=True, help="Unique job identifier")
    parser.add_argument("--batch_file", required=True, help="Path to .jsonl training batch")
    args = parser.parse_args()

    result = run(job_id=args.job_id, batch_file=args.batch_file)
    print(json.dumps(result))
    sys.exit(0 if result["status"] == "completed" else 1)


if __name__ == "__main__":
    main()
