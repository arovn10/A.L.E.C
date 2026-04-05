"""
A.L.E.C. Self-Improvement Loop — Autonomous learning from every interaction.

This is what makes A.L.E.C. fundamentally different from a chatbot.
It doesn't just respond — it LEARNS from every conversation, correction,
and database query, then uses that knowledge to retrain itself.

The Loop:
  1. COLLECT  — Every conversation is logged with quality signals
  2. CURATE   — Auto-rate conversations using heuristics + explicit feedback
  3. GENERATE — Build SFT training batches from curated data
  4. TRAIN    — LoRA fine-tune on the curated batch
  5. EVALUATE — Compare new adapter vs baseline on held-out set
  6. MERGE    — If improved, merge LoRA into base weights
  7. REPEAT   — Loop runs continuously in the background

Data Sources:
  - Chat conversations (user ratings, corrections, engagement)
  - Stoa database queries (successful SQL → Q&A pairs)
  - Memory teaches (facts the user explicitly taught)
  - Learned queries (corrections A.L.E.C. received)
  - iMessage style data (communication patterns)
  - File scans (documents, spreadsheets processed)
"""

import json
import logging
import time
import hashlib
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

logger = logging.getLogger("alec.self_improve")

SFT_DIR = Path(__file__).resolve().parent.parent.parent / "data" / "sft"
METRICS_FILE = SFT_DIR / "improvement_log.jsonl"


class SelfImprovementEngine:
    """
    Autonomous self-improvement loop.
    
    Runs in the background, continuously curating training data
    and triggering LoRA fine-tuning when enough quality data accumulates.
    """

    def __init__(self, db, trainer, memory, query_planner, stoa=None):
        self.db = db
        self.trainer = trainer
        self.memory = memory
        self.query_planner = query_planner
        self.stoa = stoa
        
        # Thresholds (start low, A.L.E.C. can tune these itself)
        self.min_examples_to_train = 20      # Start training with just 20 good examples
        self.retrain_interval_hours = 24     # Retrain at most once per day
        self.quality_threshold = 0.6         # Min quality score to include in training
        
        # State
        self.last_train_time = 0
        self.total_batches_generated = 0
        self.total_examples_curated = 0
        
        SFT_DIR.mkdir(parents=True, exist_ok=True)

    # ═══════════════════════════════════════════════════════════
    #  STEP 1: COLLECT — already handled by database.log_conversation()
    # ═══════════════════════════════════════════════════════════

    # ═══════════════════════════════════════════════════════════
    #  STEP 2: CURATE — auto-score conversations for quality
    # ═══════════════════════════════════════════════════════════

    def score_conversation(self, conv: dict) -> float:
        """
        Score a conversation 0.0-1.0 for training quality.
        
        High-quality signals:
        - User gave explicit thumbs up (rating > 0)
        - Response used real data (Stoa query, memory, tool call)
        - Response was concise (not padding with filler)
        - User continued the conversation (engagement)
        - No correction followed (no "that's wrong", "no", "actually")
        
        Low-quality signals:
        - User gave thumbs down (rating < 0)
        - Response said "I don't know" or "I can't"
        - Response hallucinated (fake data, [Property Name], etc.)
        - Response was very long generic filler
        - User corrected A.L.E.C. in next message
        """
        score = 0.5  # Neutral baseline
        
        user_msg = (conv.get("user_message") or "").lower()
        alec_resp = (conv.get("alec_response") or "").lower()
        rating = conv.get("user_rating")
        model = conv.get("model_used", "")
        
        # Explicit user feedback (strongest signal)
        if rating is not None:
            if rating > 0:
                score += 0.3
            elif rating < 0:
                score -= 0.4  # Strong negative
        
        # Real data usage (very high quality)
        if model == "stoa-query-planner":
            score += 0.2  # Direct database answer, no hallucination
        if "from the stoa database" in alec_resp:
            score += 0.15
        if "from memory:" in alec_resp:
            score += 0.1
            
        # Hallucination markers (kill it)
        hallucination_markers = [
            "[property name", "property a", "property b", "[location]",
            "[occupancy rate]", "i don't have", "i can't access",
            "i'm sorry, but i", "as an ai", "i don't have access to",
        ]
        for marker in hallucination_markers:
            if marker in alec_resp:
                score -= 0.3
                break
        
        # Filler detection (generic padding)
        filler_phrases = [
            "let me know if you", "feel free to ask",
            "would you like me to", "if you need any",
            "i'd be happy to help", "is there anything else",
        ]
        filler_count = sum(1 for f in filler_phrases if f in alec_resp)
        if filler_count >= 2:
            score -= 0.15
        
        # Conciseness bonus (short, factual responses are better training data)
        resp_len = len(alec_resp)
        if 20 < resp_len < 500:
            score += 0.05  # Good length
        elif resp_len > 2000:
            score -= 0.1   # Too verbose
            
        # Technical/data responses are valuable
        if any(w in alec_resp for w in ["$", "%", "occupancy", "rent", "units", "sql"]):
            score += 0.05
        
        return max(0.0, min(1.0, score))

    def curate_conversations(self) -> list[dict]:
        """Pull all conversations and score them for training quality."""
        all_convos = self.db.get_conversations(limit=10000)
        curated = []
        
        for conv in all_convos:
            quality = self.score_conversation(conv)
            if quality >= self.quality_threshold:
                conv["_quality_score"] = quality
                curated.append(conv)
        
        # Sort by quality (best first)
        curated.sort(key=lambda c: c["_quality_score"], reverse=True)
        
        logger.info(
            f"Curated {len(curated)}/{len(all_convos)} conversations "
            f"(quality >= {self.quality_threshold})"
        )
        return curated

    # ═══════════════════════════════════════════════════════════
    #  STEP 3: GENERATE — build SFT training batches
    # ═══════════════════════════════════════════════════════════

    def generate_training_batch(self) -> tuple[str, int]:
        """
        Generate a comprehensive training batch from all data sources.
        Returns (file_path, num_examples).
        """
        examples = []
        seen_hashes = set()  # Deduplicate
        
        def add_example(system: str, user: str, assistant: str, source: str = ""):
            """Add a training example, deduplicating by content hash."""
            h = hashlib.md5(f"{user}||{assistant}".encode()).hexdigest()
            if h in seen_hashes:
                return
            seen_hashes.add(h)
            examples.append({
                "messages": [
                    {"role": "system", "content": system},
                    {"role": "user", "content": user},
                    {"role": "assistant", "content": assistant},
                ],
                "_source": source,
            })

        system_prompt = (
            "You are A.L.E.C. (Adaptive Learning Executive Coordinator), "
            "a proprietary AI agent created by Alec Rovner. You are concise, "
            "factual, and direct. You query databases for real data instead of "
            "guessing. You never hallucinate."
        )

        # Source 1: Curated conversations
        curated = self.curate_conversations()
        for conv in curated:
            add_example(
                system_prompt,
                conv["user_message"],
                conv["alec_response"],
                source="conversation",
            )

        # Source 2: Stoa database Q&A pairs (real data, zero hallucination)
        stoa_examples = self._generate_stoa_training_data()
        for ex in stoa_examples:
            add_example(
                system_prompt,
                ex["question"],
                ex["answer"],
                source="stoa_db",
            )

        # Source 3: Memory teaches (facts the owner taught)
        memory_examples = self._generate_memory_training_data()
        for ex in memory_examples:
            add_example(
                system_prompt,
                ex["question"],
                ex["answer"],
                source="memory",
            )

        # Source 4: Correction pairs (things A.L.E.C. got wrong, then learned)
        correction_examples = self._generate_correction_training_data()
        for ex in correction_examples:
            add_example(
                system_prompt,
                ex["question"],
                ex["answer"],
                source="correction",
            )

        # Source 5: Anti-hallucination examples (teach A.L.E.C. to say "I don't know")
        anti_hallucination = [
            ("What's the weather in New York right now?",
             "I don't have real-time weather data. I'd need web search access to check that for you."),
            ("Who won the Super Bowl last year?",
             "I don't have that information in my database. Want me to search the web for it?"),
            ("What's the stock price of Apple?",
             "I don't have real-time stock data. I can search the web if you'd like."),
            ("Tell me about the property at 123 Fake Street",
             "I don't see a property matching '123 Fake Street' in the Stoa database. Could you double-check the name?"),
        ]
        for q, a in anti_hallucination:
            add_example(system_prompt, q, a, source="anti_hallucination")

        # Source 6: Tool-use examples (teach A.L.E.C. when to use tools)
        tool_examples = [
            ("What's the occupancy at Heights at Picardy?",
             "TOOL_CALL: stoa_query\nARGS: {\"query\": \"occupancy at Heights at Picardy\"}"),
            ("Remember that my favorite color is blue",
             "TOOL_CALL: memory_store\nARGS: {\"category\": \"preference\", \"key\": \"favorite_color\", \"value\": \"Alec's favorite color is blue\"}"),
            ("What did I tell you about the Johnson deal?",
             "TOOL_CALL: memory_search\nARGS: {\"query\": \"Johnson deal\"}"),
            ("What's the latest news about interest rates?",
             "TOOL_CALL: web_search\nARGS: {\"query\": \"latest interest rate news 2026\"}"),
            ("Turn on the living room lights",
             "TOOL_CALL: smart_home\nARGS: {\"action\": \"turn on living room lights\"}"),
        ]
        for q, a in tool_examples:
            add_example(system_prompt, q, a, source="tool_use")

        # Write the batch
        timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
        batch_file = SFT_DIR / f"batch_{timestamp}.jsonl"
        
        with open(batch_file, "w") as f:
            for ex in examples:
                # Remove internal metadata before writing
                clean = {k: v for k, v in ex.items() if not k.startswith("_")}
                f.write(json.dumps(clean) + "\n")
        
        # Also write the canonical training file
        canonical = SFT_DIR / "conversations.jsonl"
        with open(canonical, "w") as f:
            for ex in examples:
                clean = {k: v for k, v in ex.items() if not k.startswith("_")}
                f.write(json.dumps(clean) + "\n")

        self.total_batches_generated += 1
        self.total_examples_curated = len(examples)

        # Log the batch
        self._log_improvement({
            "event": "batch_generated",
            "batch_file": str(batch_file),
            "total_examples": len(examples),
            "sources": {
                "conversations": len(curated),
                "stoa_db": len(stoa_examples),
                "memory": len(memory_examples),
                "corrections": len(correction_examples),
                "anti_hallucination": len(anti_hallucination),
                "tool_use": len(tool_examples),
            },
        })

        logger.info(
            f"Training batch generated: {len(examples)} examples → {batch_file}"
        )
        return str(batch_file), len(examples)

    def _generate_stoa_training_data(self) -> list[dict]:
        """Generate Q&A pairs from Stoa database for domain expertise."""
        if not self.stoa or not self.stoa.connected:
            return []
        
        examples = []
        
        # Use the query planner's cached successful queries
        for cache_key, sql in self.query_planner.query_cache.items():
            try:
                rows = self.stoa.query(sql)
                if not rows:
                    continue
                
                # Generate a natural question from the cache key
                question = cache_key.replace("  ", " ").strip()
                if not question:
                    continue
                    
                # Generate the answer using the direct response formatter
                answer = self.query_planner._format_direct_response(question, rows, "stoa")
                if answer:
                    examples.append({"question": question, "answer": answer})
            except Exception:
                continue
        
        # Generate schema-awareness examples
        if self.query_planner.schema:
            for table, cols in list(self.query_planner.schema.items())[:20]:
                col_list = ", ".join(cols[:10])
                examples.append({
                    "question": f"What data is in the {table} table?",
                    "answer": f"The {table} table contains these columns: {col_list}. "
                              f"I can query this table for you — just ask about the data you need.",
                })
        
        return examples

    def _generate_memory_training_data(self) -> list[dict]:
        """Generate Q&A pairs from stored memories."""
        examples = []
        try:
            all_memories = self.memory.get_all(limit=500)
            for mem in all_memories:
                cat = mem.get("category", "fact")
                key = mem.get("key", "")
                val = mem.get("value", mem.get("content", ""))
                if not val:
                    continue
                    
                # Generate natural question-answer pairs
                if cat == "preference":
                    examples.append({
                        "question": f"What do you know about my preferences regarding {key}?",
                        "answer": f"From what you've told me: {val}",
                    })
                elif cat == "correction":
                    examples.append({
                        "question": f"What's the correct information about {key}?",
                        "answer": f"You corrected me on this: {val}",
                    })
                elif cat == "person":
                    examples.append({
                        "question": f"What do you know about {key}?",
                        "answer": f"From what I've learned: {val}",
                    })
                else:
                    examples.append({
                        "question": f"What do you know about {key}?",
                        "answer": val,
                    })
        except Exception as e:
            logger.debug(f"Memory training data generation failed: {e}")
        
        return examples

    def _generate_correction_training_data(self) -> list[dict]:
        """Generate training data from corrections (teach A.L.E.C. the right answer)."""
        examples = []
        try:
            # Look for conversations where thumbs down was followed by a correction
            all_convos = self.db.get_conversations(limit=5000)
            for i in range(len(all_convos) - 1):
                conv = all_convos[i]
                next_conv = all_convos[i + 1]
                
                # If current was thumbs down and next message looks like a correction
                if conv.get("user_rating") is not None and conv["user_rating"] < 0:
                    next_user_msg = (next_conv.get("user_message") or "").lower()
                    correction_words = ["actually", "no", "wrong", "correct", "it's", "should be"]
                    if any(w in next_user_msg for w in correction_words):
                        # The original question + the corrected answer
                        examples.append({
                            "question": conv["user_message"],
                            "answer": next_conv.get("alec_response", next_conv.get("user_message", "")),
                        })
        except Exception as e:
            logger.debug(f"Correction training data generation failed: {e}")
        
        return examples

    # ═══════════════════════════════════════════════════════════
    #  STEP 4-7: TRAIN → EVALUATE → MERGE → REPEAT
    # ═══════════════════════════════════════════════════════════

    def should_retrain(self) -> tuple[bool, str]:
        """Check if it's time to retrain."""
        # Not if already training
        if self.trainer.status.is_training:
            return False, "Training already in progress"
        
        # Time-gating: don't retrain more than once per interval
        elapsed = time.time() - self.last_train_time
        if elapsed < self.retrain_interval_hours * 3600:
            hours_left = (self.retrain_interval_hours * 3600 - elapsed) / 3600
            return False, f"Last trained {elapsed/3600:.1f}h ago, next in {hours_left:.1f}h"
        
        # Check if we have enough data
        curated = self.curate_conversations()
        if len(curated) < self.min_examples_to_train:
            return False, f"Only {len(curated)} quality examples (need {self.min_examples_to_train})"
        
        return True, f"{len(curated)} quality examples ready"

    def run_improvement_cycle(self) -> dict:
        """
        Run one full self-improvement cycle.
        Called by the background scheduler or on-demand via API.
        """
        logger.info("═══ Self-Improvement Cycle Starting ═══")
        result = {"timestamp": datetime.now(timezone.utc).isoformat()}
        
        # Check if we should train
        should_train, reason = self.should_retrain()
        result["should_train"] = should_train
        result["reason"] = reason
        
        if not should_train:
            logger.info(f"Skipping training: {reason}")
            return result
        
        # Generate training batch
        try:
            batch_file, num_examples = self.generate_training_batch()
            result["batch_file"] = batch_file
            result["num_examples"] = num_examples
        except Exception as e:
            result["error"] = f"Batch generation failed: {e}"
            logger.error(result["error"])
            return result
        
        if num_examples < self.min_examples_to_train:
            result["skipped"] = True
            result["reason"] = f"Only {num_examples} examples after curation"
            return result
        
        # Start training
        try:
            run_id = self.trainer.start_training(data_path=batch_file)
            result["training_run_id"] = run_id
            self.last_train_time = time.time()
            logger.info(f"Training started: {run_id} with {num_examples} examples")
        except Exception as e:
            result["error"] = f"Training start failed: {e}"
            logger.error(result["error"])
        
        self._log_improvement(result)
        return result

    def get_status(self) -> dict:
        """Get the current self-improvement status."""
        should_train, reason = self.should_retrain()
        
        # Count available training data
        curated_count = 0
        total_count = 0
        try:
            all_convos = self.db.get_conversations(limit=10000)
            total_count = len(all_convos)
            curated_count = sum(
                1 for c in all_convos 
                if self.score_conversation(c) >= self.quality_threshold
            )
        except Exception:
            pass

        return {
            "enabled": True,
            "total_conversations": total_count,
            "curated_conversations": curated_count,
            "quality_threshold": self.quality_threshold,
            "min_examples_to_train": self.min_examples_to_train,
            "retrain_interval_hours": self.retrain_interval_hours,
            "last_train_time": self.last_train_time,
            "total_batches_generated": self.total_batches_generated,
            "should_train_now": should_train,
            "train_reason": reason,
            "training_in_progress": self.trainer.status.is_training,
            "available_adapters": len(self.trainer.get_available_adapters()),
        }

    def _log_improvement(self, event: dict):
        """Append to the improvement log."""
        event["timestamp"] = datetime.now(timezone.utc).isoformat()
        try:
            with open(METRICS_FILE, "a") as f:
                f.write(json.dumps(event) + "\n")
        except Exception:
            pass
