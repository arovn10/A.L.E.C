"""
Smoke-test for fineTuneWorker and evalRunner.
Run from services/neural/: python test_fineTuneWorker.py
No GPU, no model download required — all heavy deps are stubbed.
"""
import sys
import os
import json
import types
import tempfile
import pathlib

# ─── Stub heavy dependencies ──────────────────────────────────────────────────
# Stub torch
torch_mod = types.ModuleType("torch")
torch_mod.backends = types.SimpleNamespace(mps=types.SimpleNamespace(is_available=lambda: False))
torch_mod.cuda = types.SimpleNamespace(is_available=lambda: False)
sys.modules["torch"] = torch_mod

# Stub transformers
trans_mod = types.ModuleType("transformers")
trans_mod.AutoModelForCausalLM = object
trans_mod.AutoTokenizer = object
trans_mod.TrainingArguments = object
trans_mod.Trainer = object
trans_mod.TrainerCallback = object
trans_mod.BitsAndBytesConfig = object
sys.modules["transformers"] = trans_mod

# Stub peft
peft_mod = types.ModuleType("peft")
peft_mod.LoraConfig = object
peft_mod.get_peft_model = lambda m, c: m
peft_mod.TaskType = types.SimpleNamespace(CAUSAL_LM="CAUSAL_LM")
sys.modules["peft"] = peft_mod

# Stub datasets
datasets_mod = types.ModuleType("datasets")
datasets_mod.load_dataset = lambda **kw: []
sys.modules["datasets"] = datasets_mod

# Stub llama_cpp
llama_mod = types.ModuleType("llama_cpp")
llama_mod.Llama = object
sys.modules["llama_cpp"] = llama_mod

# ─── Test 1: fineTuneWorker status file written on dry run ────────────────────
# We import fineTuneWorker but override the actual training call
import importlib
import unittest.mock as mock

# We need sys.path to include current dir
sys.path.insert(0, str(pathlib.Path(__file__).parent))

# Stub the training module so reload won't import the real ALECTrainer
MockALECTrainerClass = mock.MagicMock()
mock_trainer_instance = MockALECTrainerClass.return_value
mock_trainer_instance.start_training = mock.MagicMock(return_value="run_test123")
mock_trainer_instance.get_status = mock.MagicMock(return_value={"is_training": False, "phase": "idle", "error": None})

training_stub = types.ModuleType("training")
training_stub.ALECTrainer = MockALECTrainerClass
sys.modules["training"] = training_stub

with tempfile.TemporaryDirectory() as tmpdir:
    import fineTuneWorker
    importlib.reload(fineTuneWorker)

    # Now patch JOBS_DIR after reload so the path is correct
    fineTuneWorker.JOBS_DIR = pathlib.Path(tmpdir)

    job_id = "test-job-001"
    batch  = "data/sft/batch_2026-04-14.jsonl"

    # Simulate the worker's run() with a known job_id
    fineTuneWorker.run(job_id=job_id, batch_file=batch)

    status_path = pathlib.Path(tmpdir) / f"{job_id}.json"
    assert status_path.exists(), f"Status file not created at {status_path}"
    status = json.loads(status_path.read_text())
    assert status["job_id"] == job_id, f"Wrong job_id: {status}"
    print(f"PASS: status file written for job {job_id}, status={status['status']}")

# ─── Test 2: evalRunner returns score dict with 'passed' key ─────────────────
with tempfile.TemporaryDirectory() as tmpdir:
    # Write a minimal eval JSONL
    eval_file = pathlib.Path(tmpdir) / "eval.jsonl"
    eval_file.write_text(json.dumps({
        "messages": [
            {"role": "system",    "content": "You are ALEC."},
            {"role": "user",      "content": "What is the occupancy?"},
            {"role": "assistant", "content": "From Azure SQL: 94.2%."},
        ]
    }) + "\n")

    with mock.patch("evalRunner.ALECEngine") as MockEngine:
        instance = MockEngine.return_value
        instance.model_loaded = False  # skip actual inference
        instance.generate = mock.MagicMock(return_value="From Azure SQL: 94.2%.")

        import evalRunner
        importlib.reload(evalRunner)

        result = evalRunner.evaluate(
            model_path=None,
            eval_file=str(eval_file),
            stub_score=0.85,  # force a known score in stub mode
        )
        assert "score" in result,  f"Missing 'score' key in result: {result}"
        assert "passed" in result, f"Missing 'passed' key in result: {result}"
        assert result["passed"] is True, f"Expected passed=True for score 0.85, got {result}"
        print(f"PASS: evalRunner returned score={result['score']}, passed={result['passed']}")

print("\nAll Python smoke tests passed.")
