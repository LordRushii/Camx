# Live Detection on Free Tiers — Plan & Docs

> How CAMX2 keeps its excellent vision-LLM threat detection on the live camera grid while surviving a **1+ hour demo on free API tiers** without burning credits.

## The problem in one paragraph

Sending live camera frames **directly** to a vision-LLM (Gemini / Groq free tiers) already produces
excellent threat detection — it correctly flags toy guns, real guns, and real fights, and raises the
right alerts. That quality is **not** the problem. The **only** problem is cost/rate: sending frames
naively burns the free credits / hits the rate limit within minutes. A previous attempt to pre-filter
frames with a local ONNX **weapon** model failed, because that model detects weapons poorly.

## The key reframe (read this first)

We had one thing backwards. The local ONNX model should **not** try to detect threats.

- **The LLM is the detector** — and it is already excellent. Keep it.
- **The local model is only a cheap, high-recall gate** that answers a much easier question:
  *"is this frame even worth an LLM call?"* → **motion present** AND **a person is present** AND
  **the scene changed** since the last frame we sent.
- COCO/YOLO is unreliable at guns, but reliable at the **"person"** class and at motion — which is
  all the gate needs. This single shift is what makes a free-tier demo feasible **without** losing the
  LLM's detection quality.

## TL;DR solution — four layers

| Layer | Where | Job |
|---|---|---|
| 1. Local gate | Browser (per frame, ~free) | motion + person-present + scene-novelty → drop boring/empty/duplicate frames |
| 2. Smart sampling | Browser | per-camera cooldown, pick the best keyframe, downscale (~640–768px, JPEG q~50) |
| 3. Budget dispatch | Server | token-bucket (~8 calls/min), **hard fail-safe budget counter**, provider rotation, verdict cache |
| 4. LLM detection | Server | key held server-side; structured-JSON threat verdict; verify pass only on a positive |

**Why 1 hour is easy once gated:** only 2 cameras. Capping at ~8 calls/min ≈ **480 calls/hour**, which
fits inside a *single* provider's free daily quota (~1000/day) with headroom — and rotation adds more.
The credit-burn was never the LLM being expensive; it was sending static, empty, and near-duplicate frames.

## Document map

| # | Document | What's inside |
|---|---|---|
| 01 | [PRD](01-PRD.md) | Problem, goals & measurable success criteria, scope/non-goals, functional & non-functional requirements, risks |
| 02 | [Architecture](02-ARCHITECTURE.md) | The four-layer system, flow & sequence diagrams, server proxy + limiter design, repo file mapping |
| 03 | [Free-Tier Budget](03-FREE-TIER-BUDGET.md) | The heart: provider quotas, 1-hour budget math, rotation, hard fail-safe counter, recommended config, demo runbook |
| 04 | [Implementation Phases](04-IMPLEMENTATION-PHASES.md) | Phase-by-phase build (0→5), files to change, tasks, acceptance criteria, tests |
| 05 | [Detection & Prompts](05-DETECTION-AND-PROMPTS.md) | Gate parameters & pseudo-code, the LLM threat-classifier prompt + JSON schema, single vs two-pass, injection defenses |

**Suggested reading order:** 01 → 02 → 03 → 04 → 05.

## Scope

- **In scope:** the **live monitoring grid** — laptop webcam + phone camera (in the browser) analyzed by a
  vision-LLM for threats (weapons, fights, theft, general crime).
- **Out of scope (separate, already-existing feature):** uploading recorded footage and asking
  surveillance questions with timestamps (the ffmpeg + worker video/RAG pipeline). This plan does not
  change that feature.

## Minimum path to the demo

**Phases 0–2** make the demo work (prereqs → server proxy + budget limiter → browser gate). **Phases 3–4**
are polish and headroom. **Phase 5** (weapon-model accuracy, fights/theft heuristics) is optional and not
required for the demo. See [04-IMPLEMENTATION-PHASES.md](04-IMPLEMENTATION-PHASES.md).

## Non-negotiables

- **Fail-safe budget:** the system can never exceed the free quota; on exhaustion it falls back to local
  LM Studio or pauses — it never silently burns credits.
- **API keys never reach the browser** — all LLM calls go through a server proxy route.
- **The gate is high-recall:** when uncertain, send; but dedup aggressively so static/near-identical frames are dropped.
- **The gate reduces volume, not the LLM's intelligence** — detection quality stays with the LLM.
- **Page/camera content is untrusted data**, never instructions to the model.
