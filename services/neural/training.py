"""
A.L.E.C. Training Pipeline — LoRA fine-tuning for personalization.
The 25% that makes A.L.E.C. uniquely yours.
"""

import os
import json
import uuid
import time
import logging
import threading
from pathlib import Path
from typing import Optional
from dataclasses import dataclass, field, asdict

logger = logging.getLogger("alec.training")

SFT_DIR = Path(__file__).parent.parent.parent / "data" / "sft"
LORA_DIR = Path(__file__).parent.parent.parent / "data" / "models" / "lora"
CHECKPOINT_DIR = Path(__file__).parent.parent.parent / "data" / "models" / "checkpoints"


@dataclass
class TrainingConfig:
    """LoRA training configuration."""
    model_name: str = "Qwen/Qwen2.5-Coder-7B-Instruct"
    lora_rank: int = 16
    lora_alpha: int = 32
    lora_dropout: float = 0.0
    target_modules: list = field(default_factory=lambda: [
        "q_proj", "k_proj", "v_proj", "o_proj",
        "gate_proj", "up_proj", "down_proj"
    ])
    learning_rate: float = 2e-4
    batch_size: int = 2
    gradient_accumulation_steps: int = 4
    max_steps: int = 100
    warmup_steps: int = 10
    max_seq_length: int = 2048
    save_steps: int = 25
    logging_steps: int = 1
    output_dir: str = str(LORA_DIR)


@dataclass
class TrainingStatus:
    """Current training state."""
    is_training: bool = False
    run_id: Optional[str] = None
    current_step: int = 0
    total_steps: int = 0
    current_loss: float = 0.0
    best_loss: float = 999999.0  # Use large number instead of inf (inf breaks JSON)
    started_at: Optional[str] = None
    eta_seconds: Optional[int] = None
    error: Optional[str] = None

    def to_dict(self):
        d = asdict(self)
        # Replace inf/nan with None for JSON serialization
        for k, v in d.items():
            if isinstance(v, float) and (v == float('inf') or v == float('-inf') or v != v):
                d[k] = None
        return d


class ALECTrainer:
    """LoRA fine-tuning manager for A.L.E.C."""

    def __init__(self, db=None):
        self.status = TrainingStatus()
        self.config = TrainingConfig()
        self.db = db
        self._training_thread: Optional[threading.Thread] = None
        LORA_DIR.mkdir(parents=True, exist_ok=True)
        SFT_DIR.mkdir(parents=True, exist_ok=True)

    def get_status(self) -> dict:
        return self.status.to_dict()

    def start_training(self, data_path: Optional[str] = None, config: dict = None) -> str:
        """Start LoRA fine-tuning in a background thread."""
        if self.status.is_training:
            raise RuntimeError("Training already in progress")

        if config:
            for k, v in config.items():
                if hasattr(self.config, k):
                    setattr(self.config, k, v)

        run_id = f"run_{uuid.uuid4().hex[:8]}"
        data_file = data_path or str(SFT_DIR / "conversations.jsonl")

        if not Path(data_file).exists():
            raise FileNotFoundError(
                f"Training data not found at {data_file}. "
                "Rate some conversations first, then export training data."
            )

        self.status = TrainingStatus(
            is_training=True,
            run_id=run_id,
            total_steps=self.config.max_steps,
            started_at=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        )

        self._training_thread = threading.Thread(
            target=self._train, args=(run_id, data_file), daemon=True
        )
        self._training_thread.start()

        logger.info(f"Training started: {run_id}")
        return run_id

    def _train(self, run_id: str, data_file: str):
        """Background training loop using peft + transformers."""
        try:
            import torch
            from transformers import (
                AutoModelForCausalLM,
                AutoTokenizer,
                TrainingArguments,
            )
            from peft import LoraConfig, get_peft_model, TaskType
            from datasets import load_dataset

            logger.info(f"[{run_id}] Loading model: {self.config.model_name}")

            # Determine device
            if torch.backends.mps.is_available():
                device = "mps"
                dtype = torch.float16
            elif torch.cuda.is_available():
                device = "cuda"
                dtype = torch.float16
            else:
                device = "cpu"
                dtype = torch.float32

            logger.info(f"[{run_id}] Using device: {device}")

            # Load tokenizer
            tokenizer = AutoTokenizer.from_pretrained(
                self.config.model_name, trust_remote_code=True
            )
            if tokenizer.pad_token is None:
                tokenizer.pad_token = tokenizer.eos_token

            # Load model
            model = AutoModelForCausalLM.from_pretrained(
                self.config.model_name,
                torch_dtype=dtype,
                device_map="auto" if device != "mps" else None,
                trust_remote_code=True,
            )
            if device == "mps":
                model = model.to(device)

            # Apply LoRA
            lora_config = LoraConfig(
                r=self.config.lora_rank,
                lora_alpha=self.config.lora_alpha,
                target_modules=self.config.target_modules,
                lora_dropout=self.config.lora_dropout,
                bias="none",
                task_type=TaskType.CAUSAL_LM,
            )
            model = get_peft_model(model, lora_config)
            trainable = sum(p.numel() for p in model.parameters() if p.requires_grad)
            total = sum(p.numel() for p in model.parameters())
            logger.info(
                f"[{run_id}] LoRA applied: {trainable:,} trainable / {total:,} total "
                f"({100 * trainable / total:.2f}%)"
            )

            # Load dataset
            dataset = load_dataset("json", data_files=data_file, split="train")
            logger.info(f"[{run_id}] Dataset loaded: {len(dataset)} examples")

            # Tokenize
            def tokenize(example):
                msgs = example.get("messages", [])
                text = tokenizer.apply_chat_template(
                    msgs, tokenize=False, add_generation_prompt=False
                )
                tokens = tokenizer(
                    text, truncation=True, max_length=self.config.max_seq_length,
                    padding="max_length",
                )
                tokens["labels"] = tokens["input_ids"].copy()
                return tokens

            dataset = dataset.map(tokenize, remove_columns=dataset.column_names)

            # Training arguments
            output_dir = str(LORA_DIR / run_id)
            training_args = TrainingArguments(
                output_dir=output_dir,
                per_device_train_batch_size=self.config.batch_size,
                gradient_accumulation_steps=self.config.gradient_accumulation_steps,
                warmup_steps=self.config.warmup_steps,
                max_steps=self.config.max_steps,
                learning_rate=self.config.learning_rate,
                fp16=(device == "cuda"),
                logging_steps=self.config.logging_steps,
                save_steps=self.config.save_steps,
                save_total_limit=3,
                report_to="none",
                remove_unused_columns=False,
            )

            # Custom callback to update status
            from transformers import TrainerCallback

            trainer_ref = self

            class StatusCallback(TrainerCallback):
                def on_log(self, args, state, control, logs=None, **kwargs):
                    if logs and "loss" in logs:
                        trainer_ref.status.current_step = state.global_step
                        trainer_ref.status.current_loss = logs["loss"]
                        if logs["loss"] < trainer_ref.status.best_loss:
                            trainer_ref.status.best_loss = logs["loss"]

                        # Log to database
                        if trainer_ref.db:
                            try:
                                trainer_ref.db.log_training_metric(
                                    run_id=run_id,
                                    epoch=int(state.epoch or 0),
                                    step=state.global_step,
                                    train_loss=logs["loss"],
                                    learning_rate=logs.get("learning_rate", 0),
                                    lora_rank=trainer_ref.config.lora_rank,
                                    dataset_size=len(dataset),
                                    model_version="1.0.0",
                                )
                            except Exception as e:
                                logger.warning(f"Failed to log metric: {e}")

            from transformers import Trainer

            trainer = Trainer(
                model=model,
                args=training_args,
                train_dataset=dataset,
                callbacks=[StatusCallback()],
            )

            logger.info(f"[{run_id}] Starting training...")
            trainer.train()

            # Save final adapter
            model.save_pretrained(output_dir)
            tokenizer.save_pretrained(output_dir)
            logger.info(f"[{run_id}] LoRA adapter saved to {output_dir}")

            # Log evolution
            if self.db:
                self.db.log_evolution(
                    event_type="lora_training_complete",
                    description=f"LoRA training run {run_id} completed. "
                    f"Steps: {self.config.max_steps}, "
                    f"Best loss: {self.status.best_loss:.4f}",
                    version_before="base",
                    version_after=run_id,
                    metrics={
                        "best_loss": self.status.best_loss,
                        "total_steps": self.config.max_steps,
                        "dataset_size": len(dataset),
                        "lora_rank": self.config.lora_rank,
                    },
                )

            self.status.is_training = False
            logger.info(f"[{run_id}] Training complete!")

        except Exception as e:
            logger.error(f"[{run_id}] Training failed: {e}")
            self.status.is_training = False
            self.status.error = str(e)

    def get_available_adapters(self) -> list[dict]:
        """List all saved LoRA adapters."""
        adapters = []
        if LORA_DIR.exists():
            for d in sorted(LORA_DIR.iterdir()):
                if d.is_dir() and (d / "adapter_config.json").exists():
                    config = json.loads((d / "adapter_config.json").read_text())
                    adapters.append({
                        "name": d.name,
                        "path": str(d),
                        "rank": config.get("r", "unknown"),
                        "created": time.ctime(d.stat().st_mtime),
                    })
        return adapters
