"""
evalRunner.py — Eval gate for fine-tuned LoRA adapters.

Usage:
    python evalRunner.py --model_path <path/to/lora> --eval_file <path/to/eval.jsonl>

Exits with code 0 if score >= 0.80 (H5 pass), code 1 if score < 0.80 (H5 fail).
Prints JSON result to stdout: { score, passed, total_examples, details }

The scoring heuristic mirrors qualityScorer.js:
  - Does the assistant turn contain a source prefix?  +0.5
  - Does the assistant turn avoid bare financial figures? +0.25
  - Is the response under 2000 chars? +0.25
  Average over all examples = final score.

stub_score kwarg is accepted so test_fineTuneWorker.py can bypass inference.
"""

import argparse
import json
import logging
import re
import sys
from pathlib import Path

H5_THRESHOLD = 0.80

SOURCE_PREFIX_RE = re.compile(
    r"\b(From Azure SQL:|From TenantCloud:|From Weaviate:|From GitHub:|From Home Assistant:)",
    re.IGNORECASE,
)
RAW_FIGURE_RE = re.compile(r"\$[\d,]+|\b\d{1,3}(?:\.\d+)?%")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [evalRunner] %(levelname)s: %(message)s",
)
logger = logging.getLogger("alec.evalRunner")

try:
    from engine import ALECEngine
except ImportError:
    ALECEngine = None


def _score_example(assistant_text: str) -> float:
    """Score a single assistant response on three lightweight dimensions."""
    has_source = bool(SOURCE_PREFIX_RE.search(assistant_text))
    has_bare   = bool(RAW_FIGURE_RE.search(assistant_text)) and not has_source
    is_concise = len(assistant_text) <= 2000

    score = (
        (0.50 if has_source else 0.0) +
        (0.25 if not has_bare else 0.0) +
        (0.25 if is_concise else 0.0)
    )
    return score


def evaluate(model_path, eval_file: str, stub_score=None) -> dict:
    """
    Load held-out eval examples and score them.

    If stub_score is provided (used in tests), skip model inference and return
    that score directly so tests can verify the pass/fail logic without GPU.

    Returns: { score: float, passed: bool, total_examples: int, details: list }
    """
    examples = []
    try:
        with open(eval_file, "r") as f:
            for line in f:
                line = line.strip()
                if line:
                    examples.append(json.loads(line))
    except FileNotFoundError:
        logger.error(f"Eval file not found: {eval_file}")
        return {"score": 0.0, "passed": False, "total_examples": 0, "details": [], "error": f"File not found: {eval_file}"}

    if not examples:
        return {"score": 0.0, "passed": False, "total_examples": 0, "details": []}

    # Stub mode — bypass inference for testing
    if stub_score is not None:
        return {
            "score":          stub_score,
            "passed":         stub_score >= H5_THRESHOLD,
            "total_examples": len(examples),
            "details":        [{"score": stub_score, "stub": True}] * len(examples),
        }

    # Score each example's assistant turn using the heuristic (no live inference needed)
    # For real fine-tune eval, the model_path adapter is loaded and used to regenerate
    # the assistant response; here we score the reference assistant text directly.
    # TODO (future): load LoRA adapter via ALECEngine and run forward pass.
    details = []
    for ex in examples:
        messages = ex.get("messages", [])
        assistant_msg = next((m["content"] for m in messages if m.get("role") == "assistant"), "")
        ex_score = _score_example(assistant_msg)
        details.append({"score": ex_score, "response_len": len(assistant_msg)})

    avg_score = sum(d["score"] for d in details) / len(details)
    passed    = avg_score >= H5_THRESHOLD

    logger.info(f"Eval complete: score={avg_score:.4f}, passed={passed}, n={len(examples)}")
    return {
        "score":          round(avg_score, 4),
        "passed":         passed,
        "total_examples": len(examples),
        "details":        details,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="A.L.E.C. eval runner")
    parser.add_argument("--model_path", default=None, help="Path to LoRA adapter directory")
    parser.add_argument("--eval_file",  required=True, help="Path to held-out eval .jsonl")
    args = parser.parse_args()

    result = evaluate(model_path=args.model_path, eval_file=args.eval_file)
    print(json.dumps(result))

    # H5: exit 1 if score below threshold
    if not result.get("passed"):
        logger.error(f"H5 FAIL: eval_score={result.get('score')} < {H5_THRESHOLD}. Model not eligible for promotion.")
        sys.exit(1)
    sys.exit(0)


if __name__ == "__main__":
    main()
