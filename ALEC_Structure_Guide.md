# A.L.E.C — Self-Improving LLM Structure Guide

**A**utonomous **L**anguage **E**mbedded **C**ognition  
**Repo:** [https://github.com/arovn10/A.L.E.C](https://github.com/arovn10/A.L.E.C)  
**Reference Implementation:** [ImadSaddik/Train_Your_Language_Model_Course](https://github.com/ImadSaddik/Train_Your_Language_Model_Course)

---

## Overview

A.L.E.C is a proprietary, self-improving language model trained on Alec Rovner's personal messaging data (iMessage + WhatsApp). The goal is to produce a model that authentically captures Alec's voice, vocabulary, communication patterns, and personality — then enables iterative self-improvement through continuous fine-tuning loops on new personal data.

This document is the authoritative structure guide for any AI agent or developer working on A.L.E.C. Follow this spec in order when building, extending, or retraining.

---

## Repository Structure

```
A.L.E.C/
├── data/
│   ├── raw/
│   │   ├── imessage/         # Raw iMessage exports (.csv or SQLite)
│   │   └── whatsapp/         # Raw WhatsApp exports (.txt)
│   ├── cleaned/              # Processed, deduplicated chat logs
│   ├── tokenized/            # BPE-encoded training corpus
│   └── sft/                  # Supervised Fine-Tuning (SFT) dataset (JSONL)
├── tokenizer/
│   ├── train_tokenizer.py    # BPE tokenizer training script
│   └── vocab/                # Saved tokenizer vocab + merges
├── model/
│   ├── transformer.py        # Transformer architecture (with modern improvements)
│   ├── config.py             # Hyperparameter config dataclass
│   └── checkpoints/          # Saved model weights (.pt files)
├── training/
│   ├── pretrain.py           # Pre-training loop on cleaned chat corpus
│   ├── finetune.py           # SFT fine-tuning (instruction + context masking)
│   └── lora.py               # LoRA parameter-efficient fine-tuning module
├── self_improvement/
│   ├── collect.py            # New data ingestion pipeline (iMessage + WhatsApp)
│   ├── evaluate.py           # Validation loss + perplexity tracker
│   ├── retrain_trigger.py    # Auto-trigger retraining when new data threshold hit
│   └── feedback_loop.py      # Capture user-rated outputs → feed into SFT dataset
├── inference/
│   ├── chat.py               # Terminal chat interface
│   └── api.py                # Optional REST API wrapper
├── notebooks/
│   ├── 1_DataCleaning.ipynb
│   ├── 2_Tokenization.ipynb
│   ├── 3_ModelArchitecture.ipynb
│   ├── 4_PreTraining.ipynb
│   ├── 5_SFTDataset.ipynb
│   ├── 6_FineTuning.ipynb
│   ├── 7_LoRA.ipynb
│   └── 8_SelfImprovementLoop.ipynb
├── scripts/
│   ├── export_imessage.py    # Extract iMessage chat from macOS SQLite DB
│   ├── export_whatsapp.py    # Parse WhatsApp .txt export into structured format
│   └── data_distribution.py # Visualize message volume, length distributions
├── requirements.txt
├── config.yaml               # Master config file (model size, paths, thresholds)
└── README.md
```

---

## Phase 1: Data Extraction & Cleaning

### 1.1 iMessage Extraction

iMessage stores messages in a SQLite database on macOS at `~/Library/Messages/chat.db`. Use direct SQL queries to extract conversations.

**Script: `scripts/export_imessage.py`**

```python
import sqlite3
import pandas as pd
from pathlib import Path

DB_PATH = Path.home() / "Library" / "Messages" / "chat.db"

def extract_imessage(output_path: str = "data/raw/imessage/messages.csv"):
    conn = sqlite3.connect(DB_PATH)
    query = """
    SELECT
        m.rowid,
        datetime(m.date / 1000000000 + strftime('%s', '2001-01-01'), 'unixepoch', 'localtime') AS date,
        CASE WHEN m.is_from_me = 1 THEN 'Alec' ELSE h.id END AS sender,
        m.text
    FROM message m
    LEFT JOIN handle h ON m.handle_id = h.rowid
    WHERE m.text IS NOT NULL AND m.text != ''
    ORDER BY m.date ASC
    """
    df = pd.read_sql_query(query, conn)
    conn.close()
    df.to_csv(output_path, index=False)
    print(f"Exported {len(df)} messages to {output_path}")
```

### 1.2 WhatsApp Extraction

WhatsApp exports via **Settings → Chats → Export Chat (Without Media)**. The exported `.txt` follows this format:

```
[MM/DD/YY, HH:MM:SS AM] Contact Name: Message text here
```

**Script: `scripts/export_whatsapp.py`**

```python
import re
import pandas as pd

PATTERN = r'\[(\d{1,2}/\d{1,2}/\d{2,4}),\s*(\d{1,2}:\d{2}:\d{2}\s*[AP]M)\]\s*([^:]+):\s*(.+)'

def parse_whatsapp(file_path: str, output_path: str):
    rows = []
    with open(file_path, 'r', encoding='utf-8') as f:
        for line in f:
            match = re.match(PATTERN, line.strip())
            if match:
                date, time, sender, text = match.groups()
                rows.append({"date": f"{date} {time}", "sender": sender.strip(), "text": text.strip()})
    df = pd.DataFrame(rows)
    df.to_csv(output_path, index=False)
    print(f"Parsed {len(df)} WhatsApp messages to {output_path}")
```

### 1.3 Data Cleaning Rules

Apply these cleaning steps in `data/cleaned/` before any tokenization:

- **Remove system messages:** "Messages and calls are end-to-end encrypted", "<Media omitted>", "This message was deleted"
- **Remove URLs** using regex: `re.sub(r'http\S+', '', text)`
- **Remove emoji-only messages** (messages where `text.strip()` is entirely emoji characters)
- **Normalize whitespace:** collapse multiple spaces, strip leading/trailing whitespace
- **Deduplicate:** drop exact duplicate `(sender, text)` pairs within the same conversation window (copy-paste artifacts)
- **Minimum length filter:** discard messages with fewer than 3 characters
- **Merge multi-line messages** that belong to the same "bubble" event
- **Retain platform metadata** as a column (`source: imessage | whatsapp`) for later analysis

---

## Phase 2: Tokenizer Training

A.L.E.C uses **Byte Pair Encoding (BPE)** trained from scratch on the personal corpus. This ensures the vocabulary reflects Alec's actual vocabulary — abbreviations, slang, names, and domain-specific terms (real estate, SQL, etc.) will be tokenized efficiently rather than split awkwardly.

### 2.1 BPE Tokenizer Config

```python
# tokenizer/train_tokenizer.py
from minbpe import RegexTokenizer  # from karpathy/minbpe

VOCAB_SIZE = 8192        # Start here; scale to 16384 if corpus > 5M tokens
SPECIAL_TOKENS = {
    "<|endoftext|>": 0,
    "<|user|>": 1,
    "<|alec|>": 2,       # Marks Alec's responses during fine-tuning
    "<|pad|>": 3,
}

def train_tokenizer(corpus_path: str, vocab_size: int = VOCAB_SIZE):
    tokenizer = RegexTokenizer()
    with open(corpus_path, 'r', encoding='utf-8') as f:
        text = f.read()
    tokenizer.train(text, vocab_size, verbose=True)
    tokenizer.save("tokenizer/vocab/alec_bpe")
```

> **Key insight:** Train the tokenizer ONLY on Alec's side of conversations first, then on the full corpus. This biases the vocabulary toward his patterns, which is what the model ultimately needs to produce.

---

## Phase 3: Transformer Architecture

A.L.E.C's base model is a **decoder-only Transformer** incorporating modern improvements validated in the reference course's Phase 9 experiments.

### 3.1 Recommended Architecture Config

```python
# model/config.py
from dataclasses import dataclass

@dataclass
class ALECConfig:
    # Model dimensions
    vocab_size: int = 8192
    context_length: int = 512      # iMessage/WhatsApp messages are short; 512 is sufficient
    n_embd: int = 512              # Embedding dimension
    n_heads: int = 8               # Attention heads
    n_layers: int = 8              # Transformer blocks
    dropout: float = 0.0           # Set to 0.0 per modern best practices (no dropout at scale)

    # Modern improvements (validated by reference course Phase 9)
    positional_encoding: str = "rotary"     # RoPE > sinusoidal > absolute > none
    attention_type: str = "grouped_query"   # GQA: best memory/performance tradeoff
    activation: str = "swiglu"             # SwiGLU outperforms GeLU and ReLU
    normalization: str = "rmsnorm"         # RMSNorm + pre-normalization placement
    use_pre_norm: bool = True              # Pre-norm (norm before attention) > post-norm

    # Training
    batch_size: int = 64
    learning_rate: float = 3e-4
    weight_decay: float = 0.1
    grad_clip: float = 1.0
```

### 3.2 Architecture Layer Stack (Per Block)

Each Transformer decoder block follows this order with **pre-normalization**:

```
Input
  └── RMSNorm
  └── Grouped Query Attention (with RoPE)
  └── Residual connection
  └── RMSNorm
  └── SwiGLU Feed-Forward Network
  └── Residual connection
Output
```

> **Why these choices:** The reference course's Phase 9 comparison graph showed that applying RMSNorm, SwiGLU, GQA, and RoPE together — without dropout — produced the lowest validation loss across all experiments. These are also the same patterns used in LLaMA and Mistral architectures.

---

## Phase 4: Pre-Training

Pre-training teaches the model the statistical patterns of Alec's language: his vocabulary, sentence structure, topic domains, and communication rhythm.

### 4.1 Data Preparation

Concatenate all cleaned messages into a single corpus file with conversation separators:

```
<|endoftext|>
[2024-01-15 iMessage - Group: Fam]
Alec: yo can someone grab dinner tonight
Mom: what time are you thinking
Alec: like 7?
<|endoftext|>
[2024-01-16 WhatsApp - Contact: Kyle]
Kyle: bro did you see the game
Alec: lol yeah insane
...
```

### 4.2 Training Loop

```python
# training/pretrain.py — key hyperparameter decisions

optimizer = torch.optim.AdamW(
    model.parameters(),
    lr=config.learning_rate,
    weight_decay=config.weight_decay,
    betas=(0.9, 0.95)          # Standard for LLMs
)

# Cosine LR schedule with warmup
scheduler = CosineAnnealingWithWarmup(
    optimizer,
    warmup_steps=100,
    max_steps=total_steps
)

# Use random batch sampling (not sequential) — validated as better in reference course
```

### 4.3 Training Checkpoints

Save checkpoints at these milestones and log validation loss at each:

| Checkpoint | Trigger |
|---|---|
| `ckpt_step_{N}.pt` | Every 500 training steps |
| `ckpt_best.pt` | When validation loss is lowest |
| `ckpt_pretrain_final.pt` | End of pre-training |

---

## Phase 5: Supervised Fine-Tuning (SFT) Dataset

SFT is what turns a language predictor into a conversational model that responds like Alec.

### 5.1 SFT Dataset Format

Structure conversations as instruction-response pairs in JSONL:

```jsonl
{"prompt": "<|user|>what do you think about the deal", "<|alec|>honestly looks solid, cap rate is fine but I'd want to see the T12 before I commit", "source": "imessage"}
{"prompt": "<|user|>you free Saturday", "<|alec|>yeah should be, what's the plan", "source": "whatsapp"}
{"prompt": "<|user|>did you run the numbers on that Baton Rouge property", "<|alec|>ran it in the model, cash flow's tight at current asking but if we get it under contract at 5.2 it pencils", "source": "imessage"}
```

### 5.2 Dataset Construction Rules

- **Alec's messages are always the target** — the model learns to predict Alec's response given any input
- **Use conversation masking during training** — mask the loss on the `<|user|>` tokens; only backpropagate on `<|alec|>` tokens (validated superior in reference course notebooks 8_5_2)
- **Context window:** include up to 3 prior exchanges for context, not just single Q/A pairs
- **Minimum response length:** 4 words — very short "ok" or "👍" responses add noise
- **Diversity check:** ensure the SFT set covers multiple domains: real estate, casual banter, logistics, technical (SQL/code), family/friends

### 5.3 Augmentation

For a small personal corpus, use these augmentation techniques to expand the SFT set:

- **Paraphrase prompts** — keep Alec's response the same, rephrase the incoming message 2-3 ways
- **Topic-shift prompts** — create synthetic prompts matching Alec's domain expertise (real estate analysis questions, SQL questions) using GPT-4 to generate the prompt, then use Alec's real historical responses
- **Temporal diversity** — sample from different time periods so early/late message styles are both represented

---

## Phase 6: Fine-Tuning Methods

### 6.1 Full SFT (Instruction Tuning)

Fine-tune the entire model on the SFT dataset for initial personality alignment. Use a lower learning rate than pre-training:

```python
# training/finetune.py
FINETUNE_LR = 1e-4      # 3x lower than pretraining LR
FINETUNE_EPOCHS = 3     # Stop early if val loss plateaus
```

### 6.2 LoRA Fine-Tuning (Parameter-Efficient)

For the **self-improvement loop** (frequent retraining on small new data batches), use LoRA to avoid catastrophic forgetting and reduce compute cost:

```python
# training/lora.py
LORA_RANK = 16          # Higher rank = more expressiveness; 16 is a good default
LORA_ALPHA = 32         # Scale factor: alpha/rank = effective learning rate multiplier
LORA_TARGET = ["q_proj", "v_proj"]   # Apply LoRA to query and value projections only
```

**When to use LoRA vs. full fine-tuning:**

| Scenario | Method |
|---|---|
| Initial personality alignment from scratch | Full SFT |
| Monthly update with 500–2,000 new messages | LoRA |
| Major domain expansion (e.g., new job context) | Full SFT |
| Correcting a specific bad behavior pattern | LoRA on targeted SFT examples |

---

## Phase 7: Self-Improvement Loop

This is the distinguishing feature of A.L.E.C — an automated pipeline that continuously ingests new personal data and retrains the model to keep it current.

### 7.1 Self-Improvement Architecture

```
                     ┌─────────────────────────────────┐
                     │         New Data Source          │
                     │  iMessage SQLite / WhatsApp .txt │
                     └────────────┬────────────────────┘
                                  │
                     ┌────────────▼────────────────────┐
                     │        collect.py               │
                     │   Delta extraction (new msgs     │
                     │   since last checkpoint date)    │
                     └────────────┬────────────────────┘
                                  │
                     ┌────────────▼────────────────────┐
                     │    Data cleaning pipeline       │
                     │    (same rules as Phase 1)      │
                     └────────────┬────────────────────┘
                                  │
                     ┌────────────▼────────────────────┐
                     │    retrain_trigger.py           │
                     │    Threshold: 500 new msgs OR    │
                     │    30 days since last retrain    │
                     └────────────┬────────────────────┘
                                  │
                     ┌────────────▼────────────────────┐
                     │    LoRA fine-tuning             │
                     │    on merged old+new SFT data   │
                     └────────────┬────────────────────┘
                                  │
                     ┌────────────▼────────────────────┐
                     │    evaluate.py                  │
                     │    Val loss + perplexity check  │
                     │    Reject update if regression  │
                     └────────────┬────────────────────┘
                                  │
                     ┌────────────▼────────────────────┐
                     │    Merge LoRA → base model      │
                     │    Save new ckpt_best.pt        │
                     └─────────────────────────────────┘
```

### 7.2 Retrain Trigger Config (`config.yaml`)

```yaml
self_improvement:
  new_message_threshold: 500        # Retrain after this many new messages
  max_days_between_retrain: 30      # Force retrain even if threshold not hit
  val_loss_regression_guard: 0.05   # Reject new model if val loss increases > 5%
  keep_last_n_checkpoints: 5        # Rolling checkpoint retention
  lora_merge_strategy: "weighted"   # "weighted" or "replace"
```

### 7.3 Feedback Loop Integration

Capture quality signal during inference to strengthen future retraining:

```python
# self_improvement/feedback_loop.py

def log_response(prompt: str, response: str, rating: int):
    """
    rating: 1 = good (Alec would say this), 0 = bad (Alec would not say this)
    Positive examples go into SFT dataset.
    Negative examples go into a DPO (Direct Preference Optimization) rejection set.
    """
    entry = {
        "prompt": prompt,
        "response": response,
        "rating": rating,
        "timestamp": datetime.now().isoformat()
    }
    with open("data/sft/feedback.jsonl", "a") as f:
        f.write(json.dumps(entry) + "\n")
```

> **Future roadmap:** Once enough preference pairs accumulate (positive vs. negative ratings on the same prompt), implement **RLHF / DPO** to directly optimize for Alec's communication preferences without manual labeling.

---

## Phase 8: Model Evaluation

### 8.1 Quantitative Metrics

Track these metrics after every training run and log to a `training_log.json`:

| Metric | Description | Target |
|---|---|---|
| Training loss | Cross-entropy on training set | Decreasing |
| Validation loss | Cross-entropy on held-out conversations | < Training loss |
| Perplexity | `exp(val_loss)` — lower = more confident | Decreasing over versions |
| Tokens per second | Inference speed | > 50 tok/s on M-series Mac |

### 8.2 Qualitative Evaluation

After each retraining cycle, manually evaluate 10 held-out prompts across these categories:

- **Casual texting** — Does it sound like Alec talking to friends?
- **Real estate domain** — Does it use the right vocabulary (cap rate, T12, basis, NOI)?
- **Technical language** — Does it handle SQL/Python references naturally?
- **Tone consistency** — Is it appropriately terse/casual vs. detailed depending on context?
- **Refusal behavior** — Does it stay in character rather than breaking into generic LLM responses?

---

## Phase 9: Inference

### 9.1 Terminal Chat Interface

```python
# inference/chat.py
import torch
from model.transformer import ALEC
from tokenizer.train_tokenizer import load_tokenizer

def generate(model, tokenizer, prompt: str, max_new_tokens: int = 128, temperature: float = 0.8, top_k: int = 50):
    model.eval()
    tokens = tokenizer.encode(f"<|user|>{prompt}<|alec|>")
    input_ids = torch.tensor([tokens])

    with torch.no_grad():
        for _ in range(max_new_tokens):
            logits = model(input_ids)
            logits = logits[:, -1, :] / temperature
            # Top-k sampling
            top_k_logits, top_k_indices = torch.topk(logits, top_k)
            probs = torch.softmax(top_k_logits, dim=-1)
            next_token = top_k_indices[0, torch.multinomial(probs, 1)]
            input_ids = torch.cat([input_ids, next_token.unsqueeze(0).unsqueeze(0)], dim=1)
            if next_token.item() == tokenizer.special_tokens["<|endoftext|>"]:
                break

    return tokenizer.decode(input_ids[0].tolist())
```

### 9.2 Inference Hyperparameter Guide

| Parameter | Casual texting | Technical Q&A |
|---|---|---|
| Temperature | 0.8–1.0 | 0.5–0.7 |
| Top-k | 40–60 | 20–40 |
| Max new tokens | 64–128 | 128–256 |

---

## Development Phases & Milestones

| Phase | Deliverable | Success Criteria |
|---|---|---|
| 0 | Repo scaffolded, data exported | Clean CSVs from iMessage + WhatsApp exist |
| 1 | Tokenizer trained | Vocab encodes 95%+ of corpus without UNK |
| 2 | Pre-training complete | Val loss < 3.0, model generates coherent text |
| 3 | SFT dataset built | > 2,000 high-quality (prompt, Alec response) pairs |
| 4 | Fine-tuning complete | Model consistently uses Alec's vocabulary and tone |
| 5 | Self-improvement loop active | Auto-retrains on new data, val loss stable or improving |
| 6 | Feedback loop live | Ratings captured, DPO dataset growing |

---

## Privacy & Data Handling

- **All data stays local** — no message data leaves the local machine during training
- **`.gitignore` must include:** `data/raw/`, `data/cleaned/`, `data/sft/`, `model/checkpoints/`
- **Anonymize contacts** in any exported dataset: replace contact names with `Contact_A`, `Contact_B`, etc., before sharing any code examples publicly
- **Never commit model weights** — use Git LFS or store separately if sharing the model

```gitignore
# .gitignore — required entries
data/raw/
data/cleaned/
data/sft/
model/checkpoints/
tokenizer/vocab/
*.pt
*.db
```

---

## Technology Stack

| Component | Tool | Notes |
|---|---|---|
| Core ML framework | PyTorch | Required for custom Transformer implementation |
| Tokenizer | minbpe (Karpathy) | BPE from scratch; not a HuggingFace tokenizer |
| LoRA implementation | Custom or peft library | `pip install peft` for production |
| Experiment tracking | (Optional) W&B or local JSON logs | Log val loss per run |
| Local inference | Ollama-compatible export | Convert to GGUF for use with Ollama on M-series Mac |
| Data processing | pandas + sqlite3 | For iMessage SQLite extraction |
| Dependencies | `requirements.txt` | `torch`, `numpy`, `pandas`, `tqdm`, `peft` |

---

## Agent Instructions

When an agent reads this document and takes action on the [A.L.E.C repo](https://github.com/arovn10/A.L.E.C), follow these priorities:

1. **Build Phase 0 first** — scaffold the directory structure exactly as shown above before writing any model code
2. **Never skip the tokenizer** — the model cannot be trained until the BPE tokenizer is trained on Alec's corpus; do not use a pretrained HuggingFace tokenizer as a substitute
3. **Always use conversation masking** during SFT — loss should only be computed on `<|alec|>` tokens, not on the input prompt tokens
4. **Use the modern architecture stack** (RoPE + GQA + SwiGLU + RMSNorm + pre-norm + no dropout) — these were validated experimentally and should not be reverted to vanilla Transformer
5. **The self-improvement loop is the north star** — every architectural decision should make it easier to run continuous LoRA fine-tuning on new delta data without full retraining
6. **Privacy first** — no raw message data should ever be written to any file that is not in `.gitignore`
