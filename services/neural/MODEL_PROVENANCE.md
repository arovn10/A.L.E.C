# A.L.E.C. Model Provenance

Authoritative record of which base models A.L.E.C. is built on, under what
license, and how proprietary adaptations are derived from them. Update this
file on every base-model change. Do not rely on code comments alone —
downstream distribution (DMG bundling, CDN hosting) depends on this ledger.

## Current base model (ALEC-1 line)

| Field           | Value                                                       |
| --------------- | ----------------------------------------------------------- |
| Name            | Qwen2.5-14B-Instruct                                        |
| Upstream        | https://huggingface.co/Qwen/Qwen2.5-14B-Instruct            |
| License         | Apache 2.0                                                  |
| Publisher       | Alibaba Cloud / Qwen Team                                   |
| Parameters      | 14.7B                                                       |
| Context window  | 131,072 tokens (native), practical 32K on Metal             |
| Quant (shipped) | Q4_K_M GGUF (~8.5 GB)                                       |
| Tool-calling    | Native function-calling format supported upstream           |
| Date selected   | 2026-04-24                                                  |

### Why Qwen2.5-14B-Instruct

1. **License lets us redistribute.** Apache 2.0 means we can bundle quantized
   weights inside the DMG (or serve from our CDN) with no user-side attribution
   gymnastics beyond the NOTICE file.
2. **Best open tool-use in its weight class.** Qwen2.5's function-calling
   template is the most reliable we tested for the MCP-heavy workloads we run
   (Stoa queries, Zapier actions, file operations).
3. **14B is the sweet spot for Apple Silicon.** Runs at 30-45 tok/s on M3/M4
   Metal with Q4_K_M. 30B+ models halve throughput; <8B models hallucinate
   tool calls (the exact failure mode we are fixing).
4. **Base for fine-tuning.** LoRA rank 64 on Qwen2.5-14B produces a ~200 MB
   adapter we can ship alongside the base or merge into a single GGUF.

### Alternatives considered

- **Llama-3.1-8B-Instruct** — Meta Community License is fine for <700M MAU but
  redistribution rules are messier. Tool-use weaker than Qwen2.5.
- **Mistral-Small-24B** — Apache 2.0, strong reasoning, but ~15 GB quantized
  pushes DMG size unacceptably for desktop distribution.
- **Qwen2.5-7B-Instruct** — Apache 2.0, half the weight, but tool-call
  fidelity drops sharply; hallucinates MCP output (see fix in `agent.py`).
- **Phi-4-14B** — MIT, comparable size, but newer and less-tested tool-use.

## Derivative artifacts

All fine-tuning uses **supervised fine-tuning (SFT) + LoRA** unless otherwise
noted. Training data sources are recorded in `data/sft/CORPUS_MANIFEST.md`
(to be created as data accrues).

| Artifact              | Base                    | Method          | Status    |
| --------------------- | ----------------------- | --------------- | --------- |
| alec-1.0.0 (planned)  | Qwen2.5-14B-Instruct    | LoRA r=64       | pending   |
| alec-1.0.0-tools-v1   | alec-1.0.0              | SFT tool-traces | pending   |

Target for `alec-1.0.0`: 5,000 high-quality SFT examples across:
- Stoa-domain Q&A grounded in the MSSQL schema
- Real tool-use traces (captured from production sessions with user approval)
- Personality / refusal / honesty examples (including "I can't do that from
  here" for MCP-requiring requests)

## License obligations (Apache 2.0)

When we redistribute derived weights, the DMG must ship:
- A copy of the Apache 2.0 license text
- A NOTICE file crediting the Qwen Team for the base model
- A link to the upstream model card

These are assembled automatically during `npm run build` via
`scripts/assemble-model-notices.sh` (to be added in the build pipeline).

## Change log

- 2026-04-24 — Initial selection: Qwen2.5-14B-Instruct @ Q4_K_M.
