# 03 — Free-Tier Budget & Survival Strategy

> How CAMX2 sustains a live 2-camera threat-detection demo for 1+ hour on free vision-LLM tiers without burning credits or hitting rate limits — while keeping the LLM as the detector.

This is the heart of the live-detection plan. The detection quality is already excellent when we send frames to a vision LLM directly; the *only* problem is **cost and rate**. Naive frame-sending exhausts a free quota in minutes. Everything here exists to make the demo survive the hour.

**Read alongside:**
- [02-ARCHITECTURE.md](02-ARCHITECTURE.md) — the four-layer pipeline (browser gate → smart sampling → budget-aware dispatch → server vision-LLM) this budget rides on.
- [04-IMPLEMENTATION-PHASES.md](04-IMPLEMENTATION-PHASES.md) — the order in which these levers get built and wired to env/UI.
- [05-DETECTION-AND-PROMPTS.md](05-DETECTION-AND-PROMPTS.md) — single-pass triage + verify-on-positive prompt design that the token-cost math below depends on.

> ⚠️ **All provider numbers below are approximate.** They come from this plan's shared spec, not live provider docs. **Re-verify every quota against the current provider dashboards/docs on the day of the demo** — free-tier limits change often and silently.

---

## 1. Root cause — why credits burned in minutes

The prior burn was not a detection problem. It was arithmetic: a naive loop sends *every* captured frame to the cloud LLM, including static, empty, and near-duplicate frames where nothing is happening.

For **2 cameras**, a naive sampler pushes both streams straight at the LLM:

| Approach | Sampling | Calls/min | Calls/hour | Outcome on a ~1000/day, ~15 rpm free tier |
| --- | --- | --- | --- | --- |
| Naive @ 1 fps/camera | 2 frames/s | ~120 | ~7,200 | Trips the ~15 rpm limit in the **first ~7 seconds** (429s after that); would burn the whole ~1000/day quota in **~8 minutes** if it didn't rate-limit first |
| Naive @ 2 fps/camera | 4 frames/s | ~240 | ~14,400 | Same 429 wall instantly; ~1000/day gone in **~4 minutes** |
| **Gated + 8/min cap (recommended default)** | event-driven | ≤ 8 | ≤ 480 | Never exhausts a 1-hour demo — ~48% of a single provider's daily quota, and stays under every per-minute limit |

**The reframe (see [02-ARCHITECTURE.md](02-ARCHITECTURE.md)):** the LLM is the detector; the local model is only a cheap **high-recall gate** — motion **AND** person **AND** scene-changed — deciding whether a frame is even worth an LLM call. The gate turns "thousands of frames/hour" into "only the interesting frames/hour," and the budget layer caps whatever the gate lets through. A prior *local-ONNX weapon pre-filter* failed (poor weapon recall), so the local model never makes the threat verdict — it only decides *whether to ask the LLM*.

---

## 2. Provider free-tier quotas (approximate — verify before the demo)

| Provider (model) | Requests/min | Requests/day | Tokens/min | Notes | Source |
| --- | --- | --- | --- | --- | --- |
| Gemini 2.5 Flash-Lite | ~15 | ~1,000/day | ~250k | Generous token budget; per-minute request cap is the binding limit | Approx — **verify** |
| Groq Llama 4 Scout (multimodal) | ~30 | ~1,000/day | ~30k | Highest rpm, but **tight ~30k tokens/min** — downscale hard | Approx — **verify** |
| NVIDIA NIM (Llama 3.2 90B Vision) | ~40 | ~1,000 **lifetime** credits | — | Credits are **lifetime, not daily** — spend last, treat as burst overflow | Approx — **verify** |
| Cloudflare Workers AI | — | ~10k **neurons/day** | — | Neuron-metered, not request-metered — cost/call varies by model | Approx — **verify** |
| LM Studio (local) | unlimited | unlimited | unlimited | No cost, no network — the **fail-safe fallback** | Local |

> These figures are the plan's working assumptions only. Free tiers move; **open each provider's live pricing/limits page and confirm the day of the demo** before trusting the math in §3.

---

## 3. The 1-hour demo budget model

**Recommended default cap: ~8 vision calls/min** (a global token bucket shared across both cameras). That is `8 × 60 = 480 calls/hour` for the *entire* system.

The repo already ships the enforcement primitive: `apps/worker/watch/rateLimiter.ts` → `VisionCallGateway` (token bucket + hard daily counter + concurrency cap). Its current default is `WATCH_RATE_PER_MIN=12`; for the demo, set it to **8** (see §8).

### 480 gated calls/hour vs each provider's free quota

| Provider | Per-min limit | Daily / lifetime quota | 1-hr demo calls (solo) | Per-min budget used (8/limit) | Daily quota used (480/quota) |
| --- | --- | --- | --- | --- | --- |
| Gemini 2.5 Flash-Lite | ~15 rpm | ~1,000/day | 480 | ~53% | **~48%** |
| Groq Llama 4 Scout | ~30 rpm | ~1,000/day | 480 | ~27% | **~48%** |
| NVIDIA NIM 90B Vision | ~40 rpm | ~1,000 lifetime | 480 | ~20% | ~48% of *lifetime* |
| LM Studio (local) | unlimited | unlimited | 480 | 0% | 0% |

At 8 calls/min a **single** provider comfortably survives the hour: under every per-minute limit, and using roughly half a day's quota. Token/min is also safe — 8 calls/min × a downscaled image (~1–2k tokens each incl. prompt) ≈ ~12–16k tokens/min, well under Gemini's ~250k and under (but closest to) Groq's ~30k, which is exactly why Groq needs the hardest downscaling.

### Rotation multiplies the ceiling

Because 480/hour is only ~48% of one provider's daily quota, **rotating** across providers (see §5) roughly adds their quotas together before anything is forced to local fallback:

| Strategy | Effective cloud ceiling before local fallback | Sustained hours @ 8/min (480/hr) |
| --- | --- | --- |
| Single provider (Gemini) | ~1,000/day | ~2 h |
| Rotate Gemini + Groq | ~2,000/day | ~4 h |
| Rotate Gemini + Groq + NVIDIA (spend lifetime last) | ~3,000 | ~6 h |
| + Cloudflare neurons + LM Studio fallback | effectively unlimited (LM Studio local) | indefinite |

A 1-hour demo needs only ~480 calls, so **any single provider is enough** — rotation is pure headroom and insurance against one provider 429-ing or going down mid-demo.

---

## 4. Token-cost levers

Free tiers bind primarily on **request count** (rpm/day) and secondarily on **tokens/min** (Groq). Three levers reduce both. Savings are directional, not measured — validate on the day.

### 4.1 Downscale the image (biggest token lever)
- **Recommended default: ~640–768 px longest edge, JPEG quality ~50.**
- A raw 1080p PNG is large; a 640–768px q50 JPEG is a small fraction of the bytes → roughly an **order-of-magnitude fewer image tokens** while preserving enough detail for weapon/fight recognition (detection quality was already good at this size).
- This is the difference between fitting inside Groq's ~30k tokens/min and blowing through it.

### 4.2 Single-pass triage vs two-pass verify (request lever)
- **Single-pass triage on every gated frame**; only run a second **verify-on-positive** call when triage says "possible threat."
- Two-pass on *every* frame would ~double request count. Because positives are rare, verify-on-positive keeps the second call's cost bounded by **alert frequency**, not frame rate.
- Verdict/prompt shape lives in [05-DETECTION-AND-PROMPTS.md](05-DETECTION-AND-PROMPTS.md).

### 4.3 Batch frames / cameras per call (request lever)
- The worker already supports bursts (`analyzeBurst`, `WATCH_BURST_FRAMES` default 6). Sending 6 frames in **one** call instead of 6 calls is ~**6× fewer requests** against the rpm/daily quota (tokens rise, but requests are the binding constraint on free tiers).
- Optionally tile both cameras into a single image so one call covers both streams — halving request count at the cost of resolution per camera.

---

## 5. Rotation strategy

### Recommended provider ordering
1. **Gemini 2.5 Flash-Lite** — primary. Big token budget, reliable JSON.
2. **Groq Llama 4 Scout** — secondary. Highest rpm; keep images small for the tokens/min cap.
3. **NVIDIA NIM 90B Vision** — tertiary/overflow. Credits are **lifetime**, so spend them **last**, only when daily quotas run low.
4. **Cloudflare Workers AI** — optional extra neuron budget.
5. **LM Studio (local)** — always last: unlimited, offline, never throws. The floor the system can never fall below.

Set the head of the chain with `WATCH_PROVIDER` (default `gemini`); `factory.ts` builds `selected → remaining defaults → LM Studio`.

### When to rotate — proactively, not only on error
- **Repo today (error-only):** `FallbackWatchProvider` (`apps/worker/watch/providers/FallbackWatchProvider.ts`) only advances to the next provider **after a call throws** (network / 429 / unparseable). That means you don't rotate until you've *already* hit a rate limit — you pay the 429 before moving on.
- **Recommended (proactive):** rotate when the *current* provider crosses a **% of its budget** (e.g. 80% of its per-day / per-session allowance) — **before** it 429s — and immediately on any 429/quota error. Round-robin the remaining cloud providers, keeping NVIDIA lifetime credits for last and LM Studio as the terminal fallback.
- Net effect: the error-only chain is the *safety net*; proactive %-based rotation is the *steady-state* policy that keeps every provider under its ceiling.

---

## 6. Hard fail-safe budget counter

**Principle: the fail-safe budget can NEVER exceed the free quota.** On exhaustion the system falls back to LM Studio or pauses — it must **never silently keep burning** cloud credits. Keys stay server-side only.

Three independent counters (per active provider where applicable):

| Counter | Window | Enforced by | Recommended default |
| --- | --- | --- | --- |
| Per-minute | rolling 60s | token bucket in `VisionCallGateway` | 8/min (`WATCH_RATE_PER_MIN=8`), burst 4 |
| Per-session | since worker/demo start | **new** session counter | ~500 (`WATCH_SESSION_BUDGET`) |
| Per-day | resets local midnight | daily counter in `VisionCallGateway` | 500/provider (`WATCH_DAILY_BUDGET`, well under ~1000 quota) |

> Today `VisionCallGateway` implements the **per-minute bucket, per-day counter, and concurrency cap**. The **per-session counter, the 80% warning, and proactive rotation are recommended additions** (see [04-IMPLEMENTATION-PHASES.md](04-IMPLEMENTATION-PHASES.md)).

**Behavior at thresholds:**
- **At 80% of any counter** (`WATCH_BUDGET_WARN_PCT=80`): log a warning, flip the UI usage indicator to **amber**, and begin **proactive rotation** to the next provider (§5); optionally lengthen the per-camera cooldown to slow the burn.
- **At 100% of a provider's day/session budget:** stop sending to that provider and **rotate to the next**. When **all** cloud budgets are exhausted: **fall back to LM Studio** (local, unlimited) — or, if LM Studio is unavailable, **pause escalations** and keep the free local gate running. Never silently exceed a free quota.
- Recovery: per-minute refills continuously; per-day resets at local midnight; per-session resets on worker restart.

**UI surfacing:** expose `VisionCallGateway.stats` (`inFlight`, `usedToday`, `dailyBudget`) plus the session/minute counts and the active provider through the worker → Convex → Live Monitor, as a small **usage indicator** (calls this minute / session / day, active provider, green/amber/red state). This is what you watch during the demo (§9).

---

## 7. Verdict caching

When the scene has not changed, the answer has not changed — so don't pay for it twice.

- **Key:** `cameraId + perceptual hash (pHash)` of the downscaled frame.
- **Rule:** if the new frame's pHash is within the Hamming threshold (`WATCH_PHASH_HAMMING`, recommended **≤ 5**) of a cached scene, **reuse the cached LLM verdict** and **skip the call** entirely.
- **TTL:** short — **recommended default ~30s** (`WATCH_VERDICT_TTL_MS=30000`). Scenes evolve; a stale "all clear" must not mask a new threat.
- **Only cache negatives.** Never cache a positive/harm verdict (or cache it for near-zero time) so that `verify-on-positive` always re-runs — a threat must never be silenced by a cache hit.
- This stacks with the gate's own pHash dedup (see [02-ARCHITECTURE.md](02-ARCHITECTURE.md)): the gate suppresses near-duplicate *frames*; the verdict cache suppresses near-duplicate *calls* for scenes that did slip through the gate.

---

## 8. Recommended configuration

Recommended defaults for a safe 1-hour demo. Values marked **(new)** are recommended additions not yet in the repo; the rest map to existing env reads in `apps/worker/watch/*`.

| Env var | Recommended default | Meaning / notes |
| --- | --- | --- |
| `WATCH_PROVIDER` | `gemini` | Head of the rotation chain (§5) |
| `GEMINI_API_KEY` | *(server-side secret)* | Currently missing from `.env` — add it |
| `GROQ_API_KEY` | *(server-side secret)* | Currently missing from `.env` — add it |
| `NVIDIA_API_KEY` | *(server-side secret)* | Overflow provider; lifetime credits |
| `WATCH_RATE_PER_MIN` | `8` | Hard calls/min cap. **Repo default is 12** — lower to 8 for the demo |
| `WATCH_RATE_BURST` | `4` | Token-bucket burst allowance |
| `WATCH_MAX_CONCURRENT` | `2` | Max in-flight cloud calls |
| `WATCH_DAILY_BUDGET` | `500` | Per-day hard stop (well under ~1000 quota) |
| `WATCH_SESSION_BUDGET` | `500` | **(new)** per-session hard stop |
| `WATCH_BUDGET_WARN_PCT` | `80` | **(new)** amber + proactive-rotation threshold |
| `WATCH_COOLDOWN_MS` | `60000` | Per-camera cooldown after an alert (60s) |
| `WATCH_DOWNSCALE_PX` | `768` | **(new)** longest-edge downscale (range 640–768) |
| `WATCH_JPEG_QUALITY` | `50` | **(new)** JPEG quality for sent frames |
| `WATCH_MOTION_THRESHOLD` | `0.04` | Gate motion sensitivity (0..1) |
| `WATCH_GATE_MIN_CONF` | `0.35` | Person confidence for the gate |
| `WATCH_WEAPON_MIN_CONF` | `0.4` | Weapon-detector confidence (gate context only) |
| `WATCH_PHASH_HAMMING` | `5` | **(new)** dedup + verdict-cache match threshold |
| `WATCH_VERDICT_TTL_MS` | `30000` | **(new)** negative-verdict cache TTL |
| `WATCH_VERIFY_ON_POSITIVE` | `true` | **(new)** second pass only on positive triage |
| `WATCH_BURST_FRAMES` | `6` | Frames per burst call (clamped 1–10) |
| `LMSTUDIO_BASE_URL` | `ws://127.0.0.1:1234` | **Fix mismatch:** `.env` uses `LMSTUDIO_URL`; the provider reads `LMSTUDIO_BASE_URL` |

### `.env`-style block

```dotenv
# --- Provider selection & keys (server-side ONLY) ---
WATCH_PROVIDER=gemini
GEMINI_API_KEY=your-gemini-key
GROQ_API_KEY=your-groq-key
NVIDIA_API_KEY=nvapi-...            # overflow (lifetime credits) — spend last

# --- Budget / rate caps (the fail-safe) ---
WATCH_RATE_PER_MIN=8               # recommended default (repo default is 12)
WATCH_RATE_BURST=4
WATCH_MAX_CONCURRENT=2
WATCH_DAILY_BUDGET=500             # per provider, well under ~1000/day quota
WATCH_SESSION_BUDGET=500           # (new) per-demo-session hard stop
WATCH_BUDGET_WARN_PCT=80           # (new) amber + proactive rotation

# --- Smart sampling / token levers ---
WATCH_COOLDOWN_MS=60000            # per-camera cooldown after an alert
WATCH_DOWNSCALE_PX=768             # (new) 640–768 recommended
WATCH_JPEG_QUALITY=50              # (new)
WATCH_BURST_FRAMES=6

# --- Local gate thresholds ---
WATCH_MOTION_THRESHOLD=0.04
WATCH_GATE_MIN_CONF=0.35           # person confidence
WATCH_WEAPON_MIN_CONF=0.4

# --- Dedup & verdict caching ---
WATCH_PHASH_HAMMING=5              # (new)
WATCH_VERDICT_TTL_MS=30000         # (new) negatives only
WATCH_VERIFY_ON_POSITIVE=true      # (new)

# --- Local fail-safe fallback ---
LMSTUDIO_BASE_URL=ws://127.0.0.1:1234   # NOTE: .env currently sets LMSTUDIO_URL — rename it
```

---

## 9. Demo runbook checklist

Step-by-step to guarantee the 1-hour demo survives.

**Before the demo:**
1. **Re-verify every quota** (§2) against the live provider dashboards *today* — rpm, daily, tokens/min. Adjust caps if a provider tightened.
2. Confirm `GEMINI_API_KEY` and `GROQ_API_KEY` are set (server-side), plus `NVIDIA_API_KEY` if using overflow. Keys never reach the browser.
3. Set the caps: `WATCH_RATE_PER_MIN=8`, burst `4`, `WATCH_DAILY_BUDGET=500`, `WATCH_SESSION_BUDGET=500`, `WATCH_BUDGET_WARN_PCT=80`.
4. Set the token levers: `WATCH_DOWNSCALE_PX=768`, `WATCH_JPEG_QUALITY=50`, `WATCH_BURST_FRAMES=6`, `WATCH_VERIFY_ON_POSITIVE=true`.
5. Confirm gate + dedup: `WATCH_MOTION_THRESHOLD=0.04`, `WATCH_GATE_MIN_CONF=0.35`, `WATCH_PHASH_HAMMING=5`, `WATCH_VERDICT_TTL_MS=30000`.
6. **Warm up the LM Studio fallback:** start LM Studio, load the watch model, and **fix the env mismatch** (`LMSTUDIO_BASE_URL=ws://127.0.0.1:1234`, not `LMSTUDIO_URL`). Confirm `factory.ts` logs the chain ending in `-> lmstudio`.
7. Confirm the provider ordering in logs: `Active watch chain: gemini -> groq -> lmstudio` (add nvidia if configured).

**Dry run (5 min):**
8. Run both cameras for ~5 minutes. Watch the **usage indicator**: calls/min should sit at or below 8, and the state should stay green.
9. Trigger one real event (person + motion, or a prop weapon) and confirm exactly one alert (cooldown working) and a verify-on-positive second call.

**During the demo:**
10. Keep the usage indicator visible. **Green** = fine; **amber (80%)** = proactive rotation kicking in — expect the active provider to change; **red (100%)** = budget exhausted, system on LM Studio fallback or paused (never silently burning).
11. If a provider 429s, confirm the chain rotates and alerts keep flowing — the demo should not stall.
12. If all cloud budgets exhaust, confirm detection continues on LM Studio (quality degrades gracefully, cost stays zero).

**Golden rule:** the fail-safe budget can never exceed the free quota. If in doubt, lower `WATCH_RATE_PER_MIN` — 480 calls/hour already leaves ~50% daily headroom on a single provider, and rotation multiplies it further.
