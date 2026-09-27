# CAMX2 Live Detection — Product Requirements Document (PRD)

> Purpose: define what the live-monitoring threat-detection feature must do so a 2-camera demo runs for an hour on free-tier vision-LLMs without ever exhausting credits, while keeping the LLM's already-excellent detection quality.

Related docs: [00-README.md](00-README.md) · [02-ARCHITECTURE.md](02-ARCHITECTURE.md) · [03-FREE-TIER-BUDGET.md](03-FREE-TIER-BUDGET.md) · [04-IMPLEMENTATION-PHASES.md](04-IMPLEMENTATION-PHASES.md) · [05-DETECTION-AND-PROMPTS.md](05-DETECTION-AND-PROMPTS.md)

---

## 1. Overview / Problem Statement

CAMX2 is an AI CCTV surveillance app. Its live-monitoring grid shows camera feeds (the operator's laptop webcam plus a phone camera) and flags threats — weapons, fights, theft, and general crime.

We already know the core detection works. Sending raw live camera frames **directly** to a vision-LLM produces excellent threat detection: it correctly distinguishes toy guns from real guns, spots real fights, and raises the right alerts. **Detection quality is not the problem.**

The **only** problem is **cost and rate**. Naive frame-sending — pushing every sampled frame from every camera to a hosted vision model — burns through free API credits and trips per-minute rate limits within minutes. A 2-camera feed at even a few frames per second is thousands of API calls per hour, and free tiers allow only ~1,000 requests per day per provider. The demo dies long before the hour is up.

A previous attempt tried to cut volume by pre-filtering frames with a **local ONNX weapon-detection model** — only escalate frames the local model thinks contain a weapon. **This failed**: the local weapon model detects weapons poorly, so it both missed real threats and fired on noise. It was deemed not feasible and is explicitly abandoned for this work.

### The reframe (central design decision)

The LLM is the detector, and it is already great. **The local model must not try to detect threats or weapons.** Its only job is a cheap, high-recall **gate** that answers one question:

> "Is this frame worth spending an LLM call on?"

A frame is worth a call only when **all three** hold:

1. **Motion is present** (the scene changed vs. the previous frame), AND
2. **A person is present** (YOLO's `person` class — the one thing COCO models are reliable at), AND
3. **The scene is meaningfully different** from the last frame we already sent to the LLM (perceptual-hash dedup).

YOLO/COCO is unreliable at weapons but reliable at `person` and motion — which is exactly, and only, what the gate needs. Everything intelligent still happens in the LLM. The gate reduces **volume**, never intelligence. See [02-ARCHITECTURE.md](02-ARCHITECTURE.md) for the full four-layer design.

---

## 2. Goals & Success Metrics

**Primary goal:** a live 2-camera demo runs for **≥ 60 minutes** on free tiers with **zero** credit/quota exhaustion **and** preserved detection quality.

| # | Metric | Target (acceptance threshold) |
|---|--------|-------------------------------|
| G1 | Demo endurance | Continuous live monitoring for **≥ 60 min** with 2 cameras and **no** pause/failure caused by quota or rate limits |
| G2 | Credit safety | **Zero** free-tier exhaustion events; hard budget counter is **never** exceeded (fail-safe) |
| G3 | Call rate | Sustained LLM calls **≤ ~8 calls/min** (recommended default), well under provider RPM caps |
| G4 | Daily quota fit | One hour of demo fits inside a **single** provider's free daily quota with headroom (see [03-FREE-TIER-BUDGET.md](03-FREE-TIER-BUDGET.md)) |
| G5 | Detection quality — weapon | A **staged weapon** shown to a camera is correctly flagged as a threat (no regression vs. direct-to-LLM) |
| G6 | Detection quality — fight | A **staged fight** is correctly flagged as a threat |
| G7 | Alert latency | End-to-end latency from threat appearing on camera to alert visible in UI **≤ ~5 s** (recommended default target) |
| G8 | False-negative discipline | Gate is high-recall: when uncertain it sends; a genuine threat is never dropped **by the gate** |

Success = G1 through G7 all met in a single demo run, with G8 held throughout.

### Budget math (why this is achievable)

- 2 cameras. Naive sending = thousands of frames/hour → instant burnout.
- Gated sending = only *interesting* frames leave the browser.
- Cap ~8 calls/min = ~480 calls/hour.
- Gemini 2.5 Flash-Lite free tier: **15 rpm / 1,000 rpd**. Groq Llama 4 Scout: **30 rpm / 1,000 rpd**.
- ~480 calls/hour sits inside **one** provider's daily quota with headroom; provider rotation adds margin. The old burn was caused by sending boring/static/empty frames — which the gate removes.

---

## 3. Non-Goals

- **Recorded-footage upload + surveillance Q&A / RAG timeline** (the ffmpeg + worker video pipeline). This is a separate, already-existing feature and is **out of scope** here — do not design or change it in this effort.
- **Building a better local weapon detector** for the demo. The reframe makes it unnecessary; the local model only gates on person + motion + novelty. (Weapon-model accuracy work is deferred to an optional post-demo phase — see [04-IMPLEMENTATION-PHASES.md](04-IMPLEMENTATION-PHASES.md), Phase 5.)
- **Paid API tiers.** The whole point is to survive on free tiers; no billing-enabled endpoints.
- **Multi-operator / RBAC, mobile apps, cloud recording/retention, analytics dashboards.** Not part of the demo scope.

---

## 4. Users & Use Cases

**Primary user:** a **solo operator** watching a live grid of a few cameras, wanting to be alerted when something dangerous happens without babysitting the feed.

### Use cases

- **UC1 — Passive monitoring:** operator opens the live grid (laptop webcam + phone camera). Idle/empty scenes generate **no** LLM calls and no alerts.
- **UC2 — Weapon shown (staged):** someone holds up a weapon in front of a camera → gate fires (person + motion + novel) → LLM classifies threat → alert appears with description and severity.
- **UC3 — Fight (staged):** two people scuffle → gate fires → LLM flags a violent-altercation threat → alert appears.
- **UC4 — Theft / loitering (staged):** a person lingers or grabs an item and leaves → gate fires on person + motion → LLM assesses → alert if warranted.
- **UC5 — Triage:** operator reviews an alert and marks it ACKNOWLEDGED, ESCALATED, or FALSE_POSITIVE.
- **UC6 — Stop:** operator can stop monitoring (or a specific camera) at any time; call volume drops to zero.

---

## 5. Functional Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| FR1 | **Live grid** renders the laptop webcam and a phone camera (browser `getUserMedia` / IP-webcam) side by side as live video. | Must |
| FR2 | **Local gate (browser)** runs per-frame and only promotes a frame to an LLM candidate when motion **AND** a person **AND** scene-novelty (pHash vs. last-sent frame) all pass. | Must |
| FR3 | **Smart sampling**: per-camera cooldown/debounce, keyframe selection (most-changed frame in a ~2–3 s window), downscale to ~640–768 px, JPEG q≈50 before dispatch. | Must |
| FR4 | **Budget-aware dispatch (server)**: token-bucket rate cap (~8 calls/min recommended default) **and** a hard session/daily budget counter that cannot be exceeded. | Must |
| FR5 | **Fail-safe on exhaustion**: when the budget/rate ceiling is hit, fall back to local **LM Studio** or **pause** — never silently keep burning a hosted quota. | Must |
| FR6 | **Vision-LLM threat classification** on candidate frames, returning **structured JSON** `{ is_threat, threat_type, description, confidence, boxes? }`. | Must |
| FR7 | **Two-pass triage**: single-pass triage by default; escalate to a second "verify" LLM call **only** when the first pass flags a threat. | Must |
| FR8 | **Alerts written to Convex** (`threatLogs` table) with classification, severity, confidence, preview text, optional frame reference, and verification metadata. | Must |
| FR9 | **Threat-log lifecycle**: each alert starts **ACTIVE**; operator can move it to **ACKNOWLEDGED**, **ESCALATED**, or **FALSE_POSITIVE**. State is visible in the UI and updates in real time (Convex subscription). | Must |
| FR10 | **Operator controls**: operator can see current alert state and **stop** monitoring (global or per-camera) at any time. | Must |
| FR11 | **Provider rotation** across configured free providers (Gemini, Groq, LM Studio; NVIDIA optional) to spread load and add quota margin. | Should |
| FR12 | **Verdict caching**: reuse the last verdict for scenes that have not meaningfully changed, avoiding redundant calls. | Should |
| FR13 | **Usage indicator** in the UI: calls this minute, calls today vs. budget, and active provider. | Should |

> The Convex `threatLogs` schema already encodes the `ACTIVE | ACKNOWLEDGED | ESCALATED | FALSE_POSITIVE` status union and a `severity` of `critical | warning | nominal`, so FR8/FR9 build on existing structure (`convex/schema.ts`).

---

## 6. Non-Functional Requirements

| Category | Requirement |
|----------|-------------|
| **Cost / free-tier survival** | The system must be able to run indefinitely within free-tier quotas. The hard budget counter is authoritative: it can **never** be exceeded, and exhaustion triggers fallback/pause, not silent burn. |
| **Latency** | End-to-end threat-to-alert latency ≤ ~5 s (recommended default). Gate + sampling add minimal per-frame overhead in the browser. |
| **Privacy / secrets** | Hosted-provider **API keys live only on the server**, behind a proxy route. Keys are **never** shipped to or referenced from the browser. |
| **Reliability / fail-safe** | Gate/dispatch failures must never crash the live loop. On provider error or quota exhaustion, degrade gracefully (rotate → LM Studio → pause). |
| **Untrusted content** | Camera imagery and any page/camera-supplied text are treated as **untrusted data, never as instructions** to the model or the app. |
| **High-recall gate** | The gate errs toward sending when uncertain; it dedups aggressively but must not suppress a genuinely novel person-in-motion frame. |
| **Real-time UX** | Alerts and their lifecycle state propagate to the operator UI in real time via Convex subscriptions. |

---

## 7. Constraints & Assumptions

**Constraints**

- Stack is fixed: Next.js 16 (App Router) + React 19 + TypeScript + Tailwind v4 + shadcn/ui; Convex for real-time data/subscriptions/auth; Node.js + Express worker on `:3001`; pnpm workspaces.
- In-browser vision uses `onnxruntime-web` (WebGPU with WASM fallback); the worker uses `onnxruntime-node`. The browser YOLO session loads `yolo11n.onnx` (see `lib/detection/onnxSession.ts`).
- Free-tier providers only: Gemini 2.5 Flash-Lite, Groq Llama 4 Scout (multimodal), NVIDIA NIM (Llama 3.2 90B Vision), Cloudflare Workers AI, LM Studio (local, unlimited).

**Assumptions**

- The direct-to-LLM detection quality observed to date holds once frames go through gate + downscale (downscaling to ~640–768 px does not materially degrade detection).
- The demo environment has a working laptop webcam and one phone camera reachable via `getUserMedia`/IP-webcam.
- At least one hosted provider key is configured, or LM Studio is running locally as the offline fallback.
- Two cameras is the demo target; the design should not preclude a few more, but tuning targets assume two.

**Known setup gaps to close first (Phase 0 — see [04-IMPLEMENTATION-PHASES.md](04-IMPLEMENTATION-PHASES.md))**

- `.env.local` is missing `GEMINI_API_KEY`, `GROQ_API_KEY`, and `WATCH_PROVIDER`.
- Provider env-var mismatch: code/spec reference both `LMSTUDIO_URL` and `LMSTUDIO_BASE_URL`; `.env.local` currently sets only `LMSTUDIO_URL`. These must be reconciled.
- NVIDIA provider is **not yet wired** into the watch provider factory.

---

## 8. Risks & Mitigations

| Risk | Impact | Likelihood | Mitigation |
|------|--------|-----------|------------|
| Free-tier credits still exhaust mid-demo | Demo fails (G1/G2) | Low (with gate) | Hard budget counter that cannot be exceeded; token-bucket cap ~8/min; provider rotation; fail-safe fallback to LM Studio or pause. |
| Gate over-suppresses and drops a real threat | Missed detection (G5/G6/G8) | Medium | High-recall gate policy: send on uncertainty; require only person + motion + novelty, **not** weapon detection; tune pHash threshold conservatively. |
| Gate under-suppresses (too many calls) | Approaches rate/quota limits | Medium | Per-camera cooldown/debounce, keyframe selection, verdict caching, and the dispatch cap as backstop. |
| Downscaling/JPEG compression hurts LLM accuracy | Quality regression | Low–Med | Keep ~640–768 px / q≈50 as recommended default; validate against staged weapon/fight before demo. |
| Provider rate-limit (429) despite budget | Gaps in coverage | Medium | Token bucket sized below provider RPM; on 429 rotate provider; concurrency cap (≤2 in-flight). |
| API key leaks to browser | Security/privacy breach | Low | Keys **only** server-side behind proxy route; never referenced in client bundles. |
| Prompt injection via camera-visible text/objects | Model manipulated | Low | Treat all camera/page content as untrusted data; fixed server-side prompt; structured-JSON output contract. |
| LM Studio fallback unavailable when needed | No safe degrade path | Low–Med | Verify LM Studio reachable during Phase 0; otherwise fail-safe path is **pause**, not burn. |
| Env misconfiguration (missing keys / `LMSTUDIO_URL` mismatch) | Provider silently skipped | Medium | Phase 0 config checklist; factory logs skipped providers; fail-fast on no usable provider. |

---

## 9. Open Questions

1. **Call-rate default:** is ~8 calls/min the right recommended default for 2 cameras, or should it scale per active camera? (See [03-FREE-TIER-BUDGET.md](03-FREE-TIER-BUDGET.md).)
2. **Budget scope:** is the hard budget per-session, per-day, or both — and does it reset at local midnight (as the current `rateLimiter` daily counter does)?
3. **pHash novelty threshold:** what Hamming-distance cutoff best balances high recall against dedup for typical webcam/phone footage?
4. **Verify pass:** always run the second "verify" call on a flagged threat, or only above a confidence band? What is the latency budget for the two-pass path against G7?
5. **Provider rotation policy:** round-robin per call, or sticky-until-error? How to rotate without fragmenting verdict caches?
6. **Structured-JSON contract:** the target schema is `{ is_threat, threat_type, description, confidence, boxes? }`; the current worker parses a simpler `{ isHarm, description }`. Which is authoritative for the demo, and who owns the migration? (See [05-DETECTION-AND-PROMPTS.md](05-DETECTION-AND-PROMPTS.md).)
7. **Fallback UX:** when the budget is exhausted and we fall back to LM Studio or pause, how is that surfaced to the operator (banner, degraded badge, usage indicator)?
8. **Theft/loitering:** are these in-scope for the graded demo (UC4), or best-effort given the gate only guarantees person + motion?

