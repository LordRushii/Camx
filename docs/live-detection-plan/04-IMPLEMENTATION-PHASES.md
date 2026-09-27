# 04 — Implementation Phases

One-line purpose: the ordered, phase-by-phase build plan that turns today's "detection is excellent but naive frame-sending exhausts free-tier quotas in minutes" into a sustained live 2-camera demo that runs for ≥ 1 hour on free tiers — without weakening the vision-LLM detection that already works.

Cross-links: [00-README.md](00-README.md) · [01-PRD.md](01-PRD.md) · [02-ARCHITECTURE.md](02-ARCHITECTURE.md) · [03-FREE-TIER-BUDGET.md](03-FREE-TIER-BUDGET.md) · [05-DETECTION-AND-PROMPTS.md](05-DETECTION-AND-PROMPTS.md)

---

## Minimum path to the 1-hour demo

> The LLM is the detector, and it is already excellent (toy/real guns, fights, correct alerts). Everything we build below only decides *whether a frame is worth an LLM call*. Do **not** add local weapon detection — a prior local-ONNX weapon pre-filter failed and is explicitly out of scope. The goal is to reduce call **volume**, never detection **intelligence**.

- **Phases 0–2 are the core** that makes the demo work end-to-end. Build only these and you get: real keys wired (0) → a server proxy that holds the key and enforces a hard budget/rate cap (1) → a browser gate (motion + YOLO person-only + perceptual-hash dedup) that stops idle/duplicate frames before they ever POST (2). That combination is what keeps the demo inside free-tier limits for an hour.
- **Phases 3–4 are polish / headroom.** Sampling refinement (3) and provider rotation + verdict cache + a live usage meter (4) widen the safety margin and make the budget visible, but the demo can survive without them if time is short.
- **Phase 5 is optional, post-demo.** Fights/theft heuristics and weapon-model accuracy work (temporal voting, pose) are explicitly **not required** for the 1-hour demo.

## Phase summary

| Phase | Goal | Value | Rough effort | Depends on |
|-------|------|-------|--------------|------------|
| **0 — Prereqs** | Real provider keys + env wired and reachable | Nothing else runs without this | ~0.5 day | — |
| **1 — Server proxy + budget/rate limiter** | A server route that holds the key and can never exceed the free quota | Keys off the browser + hard cost fail-safe | ~1 day | 0 |
| **2 — Browser local gate** | Motion + YOLO person-only + pHash dedup; only survivors POST | The core volume reducer — makes 1 hour feasible | ~1.5 days | 1 |
| **3 — Sampling polish** | Per-camera cooldown, keyframe pick, downscale + JPEG q | Fewer, cheaper, cleaner calls | ~0.5 day | 2 |
| **4 — Rotation + cache + usage UI** | Proactive rotation, verdict cache, live budget meter, NVIDIA wired | Extra headroom + operator visibility | ~1 day | 1, 2 |
| **5 — Heuristics + weapon accuracy (optional)** | Temporal N-of-M voting, pose-based hand↔object | Quality polish, post-demo | ~2+ days | 2 |

> Effort is rough and assumes reuse of the existing worker code under `apps/worker/watch/*` rather than a greenfield rewrite. Verify every phase with `pnpm typecheck && pnpm lint` (and `pnpm test` where tests are added) before opening a PR.

---

## Phase 0 — Prereqs (env + provider reachability)

### Goal / Outcome
Every provider the demo relies on is configured, named consistently, and verified reachable **before** any code is written. Missing or mis-named env is the most common cause of a silent demo failure (missing key → provider skipped → falls back to a slow or absent LM Studio).

### Scope
- **In:** add `GEMINI_API_KEY` and `GROQ_API_KEY`; fix the `LMSTUDIO_URL` vs `LMSTUDIO_BASE_URL` mismatch; choose `WATCH_PROVIDER`; confirm LM Studio reachable as the offline fallback.
- **Out:** any new detection code, UI, or budget logic (Phases 1+).

### Files to modify
- `.env.local` — today has `NEXT_PUBLIC_CONVEX_URL`, `LMSTUDIO_URL`, `PORT`, `CONVEX_DEPLOYMENT`, `NEXT_PUBLIC_CONVEX_SITE_URL`; **missing** `GEMINI_API_KEY`, `GROQ_API_KEY`, `WATCH_PROVIDER`.
- `.env.example` — mirror the new keys with placeholders. It currently advertises `LMSTUDIO_URL=http://localhost:1234`, which **no code reads**.
- `apps/worker/watch/providers/LmStudioProvider.ts` (~line 24) — reads `process.env.LMSTUDIO_BASE_URL` (default `ws://127.0.0.1:1234`), **not** `LMSTUDIO_URL`. Env and code must agree on one name.

### Step-by-step tasks
1. Pick the canonical LM Studio var. **Recommended default:** keep the code's `LMSTUDIO_BASE_URL` and update `.env.local`/`.env.example` to that name (websocket-style, e.g. `ws://127.0.0.1:1234`). Alternatively, make `LmStudioProvider` fall back to `LMSTUDIO_URL`. Do exactly one — never leave both half-wired.
2. Add to `.env.local`: `GEMINI_API_KEY=...`, `GROQ_API_KEY=...`, and `WATCH_PROVIDER=gemini` (**recommended default** primary; the chain falls back gemini→groq→lmstudio via `providers/factory.ts`).
3. Mirror the same keys in `.env.example` with placeholder values and a one-line comment each. Never commit real keys.
4. Confirm LM Studio: start the local server, load the vision model (`LMSTUDIO_WATCH_MODEL`, default `lfm-2.5-ucf-1.6b`), verify the base URL responds.
5. Boot the worker and confirm the log `[WATCH PROVIDER] Active watch chain: gemini -> groq -> lmstudio` (from `factory.ts`) lists the providers you expect — a skipped provider means its key is missing.

### Acceptance criteria / verify
- `pnpm typecheck && pnpm lint` clean.
- Worker boot log shows the intended provider chain (no unexpected "Skipping … not configured" warnings for keys you set).
- One manual round-trip through the primary provider returns structured JSON (see the Phase 1 contract).

### Tests to add
- None required (config-only). Optional: a small vitest asserting `createWatchProvider()` returns a non-null provider when keys are present (mock `process.env`).

### Risks & rollback
- **Risk:** committing a real key — only `.env.example` gets placeholders; `.env.local` stays git-ignored.
- **Risk:** LM Studio URL scheme (`http` vs `ws`) — `LmStudioProvider` already rewrites `http→ws`/`https→wss`, so `http://` is tolerated, but be explicit.
- **Rollback:** env-only; revert the file edits.

---

## Phase 1 — Server proxy + budget / rate limiter

### Goal / Outcome
A single server-side route that holds the API keys and is the **only** thing that ever talks to a vision-LLM for the live grid. It enforces a token bucket **and** a hard daily budget counter, so a misfiring browser (or a demo gone long) can never blow past a free-tier quota. The browser only ever POSTs a candidate frame and receives structured JSON back.

### Scope
- **In:** a Next.js route handler; a shared budget/rate limiter module reusing the `VisionCallGateway` pattern; the request/response contract; server-side provider invocation with fallback.
- **Out:** browser-side gating (Phase 2), sampling refinement (Phase 3), rotation/cache/UI (Phase 4). Keys stay server-side — never shipped to the browser.

### Files to create / modify
- **Create** `app/api/analyze/route.ts` — POST handler (App Router). Accepts a candidate frame + metadata, runs the budget gate, calls the provider, returns structured JSON. Mirror the existing `app/api/video-analysis/` route for conventions (that route is the separate upload/RAG feature — do not touch it).
- **Create** `lib/budget/visionGateway.ts` (shared) — a browser-agnostic port of `apps/worker/watch/rateLimiter.ts` (`TokenBucket` + `VisionCallGateway`: token bucket, hard daily counter with local-midnight roll, concurrency cap). Keep it a singleton on the server module (Next dev can re-instantiate on hot reload — accept that, or hang it off `globalThis`).
- **Reuse** `apps/worker/watch/providers/{factory,GeminiProvider,GroqProvider,LmStudioProvider}.ts` and `apps/worker/watch/prompts.ts` / `schema.ts` — the route should call the same provider abstraction so both the worker and the live route share one detection contract (see [05-DETECTION-AND-PROMPTS.md](05-DETECTION-AND-PROMPTS.md)).

### Request / response contract
```jsonc
// POST /api/analyze  (multipart or JSON base64)
{
  "cameraId": "cam-1",
  "phash": "9f1c…",            // perceptual hash from the browser gate
  "capturedAt": 1730000000000,
  "gateReasons": ["motion", "person"],
  "image": "data:image/jpeg;base64,…"  // downscaled ~640–768px, q~50
}

// 200 OK
{
  "is_threat": false,
  "threat_type": null,
  "description": "Two people talking, no weapons visible.",
  "confidence": 0.12,
  "boxes": [],                 // optional
  "verdictCacheHit": false,
  "budget": { "usedToday": 42, "dailyBudget": 500, "remaining": 458 }
}

// 429 (budget/rate) — browser must back off, NOT retry immediately
{ "skipped": true, "reason": "rate-limited" | "daily-budget-exhausted" | "max-concurrency" }
```

### Step-by-step tasks
1. Port `TokenBucket` + `VisionCallGateway` from `apps/worker/watch/rateLimiter.ts` into `lib/budget/visionGateway.ts`. Keep the knobs env-configurable (see the config table in [03-FREE-TIER-BUDGET.md](03-FREE-TIER-BUDGET.md)). **Recommended defaults:** ~8 calls/min, burst 4, daily cap sized to your provider quota, concurrency 2.
2. Instantiate the gateway once per server process — hang it off `globalThis` so Next.js hot-reload does not reset the counters mid-demo.
3. In `app/api/analyze/route.ts`: validate the body with zod, reject oversized images, then `await gateway.acquire()`. On denial, return `429` with a `reason` and **never** call the provider.
4. On acquire, call the shared provider via `providers/factory.ts`; on provider error, fall through the existing fallback chain; map the provider's `{isHarm, description}` onto the `{is_threat, …}` response superset (see [05](05-DETECTION-AND-PROMPTS.md)).
5. Never log the raw image or the API key. Return the `budget` block so the browser can display usage.

### Acceptance criteria / verify
- `pnpm typecheck && pnpm lint` clean.
- A scripted loop POSTing faster than the cap gets `200`s up to the burst, then `429`s — the cap holds.
- The daily counter persists across requests within a process and rolls at local midnight.
- No API key appears in any client response or browser network payload.

### Tests to add
- vitest for `VisionCallGateway`: allows `burst` immediate calls then denies; refills over time; daily cap denies past N; concurrency cap denies the (concurrency+1)-th in-flight call.
- A route test (provider mocked) asserting the `429` shape on denial and the `{is_threat,…}` shape on success.

### Risks & rollback
- **Risk:** Next.js dev hot-reload resets the singleton → counters drop. Mitigate with the `globalThis` singleton; note it in the runbook.
- **Risk:** a serverless/multi-instance deploy splits the counter per instance. Fine for the single-process demo; flag it as a scaling caveat.
- **Rollback:** feature-flag the route; if disabled the browser simply stops sending frames (no analysis) rather than bypassing the gate.

---

## Phase 2 — Browser local gate (motion + person + novelty)

### Goal / Outcome
The browser stops sending idle, empty, and near-duplicate frames. Only a frame that has **motion** AND a **person** AND a **changed scene** is POSTed to `/api/analyze`. This is the single biggest volume reducer and what actually makes an hour feasible — the LLM still does all the real detection.

### Scope
- **In:** a client gate wired into the live capture loop; motion frame-diff; YOLO **person-class-only** presence; perceptual-hash novelty; POST survivors to the Phase 1 route; render the returned verdict.
- **Out:** cooldown/keyframe tuning (Phase 3) and rotation/cache/UI (Phase 4). Do **not** add local weapon classification.

### Files to create / modify
- **Create** `lib/gate/motion.ts` — frame-diff (port the worker's 32×32 grayscale mean-abs-diff, threshold ~0.04 from `apps/worker/watch/motion.ts`) running on a downscaled canvas.
- **Create** `lib/gate/phash.ts` — dHash/pHash + Hamming distance for novelty vs the last **sent** frame per camera.
- **Create** `lib/gate/index.ts` — the AND-combiner: `motion && personPresent && isNovel`, returning the reasons.
- **Modify** `hooks/useLiveDetection.ts` (~line 33) — reuse the existing in-browser YOLO session for the **person** class only; stop treating `THREAT_CLASSES` as the threat decision (the LLM decides). Feed frames through the gate; POST survivors.
- **Modify** `components/camera/CameraCard.tsx` (~line 151) — surface the gate/verdict state (idle · watching · analyzing · threat) and the alert.
- **Fix** `lib/draw.ts` (~line 177) — the color bug (rf-detr class list applied to yolo ids) while you are in this file.

### Step-by-step tasks
1. In the capture loop, downscale each frame to a small work canvas; run `motion.ts`. No motion → stop (zero cost).
2. On motion, run the existing YOLO session and keep only `person` detections ≥ **0.35** (recommended default). No person → stop.
3. Compute the frame's perceptual hash; compare to the last **sent** hash for that camera. Hamming ≤ **10** ⇒ same scene ⇒ stop (recommended default; tune in Phase 3).
4. Survivor → downscale to ~640–768px, JPEG q~50, POST to `/api/analyze` with `{cameraId, phash, gateReasons, image}`.
5. On `200`, render the verdict and (if `is_threat`) raise the alert; on `429`, back off (do not retry immediately) and show the budget state.

### Acceptance criteria / verify
- `pnpm typecheck && pnpm lint` clean.
- Pointing a camera at a static empty scene produces **zero** POSTs; walking into frame produces POSTs; standing still then re-triggers only when the scene changes.
- A staged weapon and a staged fight both reach the LLM and raise an alert (detection quality preserved).

### Tests to add
- vitest for `motion.ts` (diff above/below threshold) and `phash.ts` (identical vs shifted frames, Hamming behavior) using fixture image data.
- A gate-combiner test: only `motion && person && novel` returns "send".

### Risks & rollback
- **Risk:** gate too aggressive → misses events. Mitigate: high-recall defaults, dedup is the only hard drop, and it is tunable in Phase 3.
- **Risk:** YOLO cost per frame. Mitigate: run YOLO only after motion fires, on a downscaled canvas.
- **Rollback:** a `gateEnabled` flag; off = send every sampled frame (old behavior), still behind the Phase 1 budget cap.

## Phase 3 — Sampling polish (cooldown · keyframe · downscale)

### Goal / Outcome
Turn a burst of survivor frames from one event into a small number of the *best* calls, and shrink each call's token cost — widening the budget margin without changing what the LLM sees qualitatively.

### Scope
- **In:** per-camera cooldown/debounce; keyframe selection within a short window; enforce downscale + JPEG quality at the send boundary.
- **Out:** provider rotation, caching, UI (Phase 4).

### Files to create / modify
- **Modify** `lib/gate/index.ts` — add a per-camera cooldown timer and a short collection window.
- **Create** `lib/gate/keyframe.ts` — pick the highest-motion / most-changed frame in a ~2–3s window.
- **Modify** the send path (`hooks/useLiveDetection.ts`) — apply the ~640–768px + JPEG q~50 downscale as the last step before POST.

### Step-by-step tasks
1. After a survivor fires, open a **2–3s** window (recommended default), buffer survivors, and send only the keyframe. 
2. Apply a per-camera **cooldown** (recommended default ~6–10s between events) so one incident is a couple of calls, not dozens.
3. Confirm every POSTed image is downscaled + q~50 (see token levers in [03-FREE-TIER-BUDGET.md](03-FREE-TIER-BUDGET.md)).

### Acceptance criteria / verify
- A single sustained event yields far fewer calls than in Phase 2 (measure calls/event before vs after).
- `pnpm typecheck && pnpm lint` clean; outbound image bytes are visibly smaller in the network panel.

### Tests to add
- vitest for keyframe selection (returns the max-change frame in a buffer) and cooldown (suppresses within-window re-triggers).

### Risks & rollback
- **Risk:** cooldown hides a *second* real event during the window. Mitigate: keep the window short and allow a high-confidence verdict to reset the cooldown.
- **Rollback:** set window/cooldown to 0 to revert to Phase 2 behavior.

---

## Phase 4 — Rotation + verdict cache + usage UI

### Goal / Outcome
Multiply the ceiling and make the budget visible: rotate providers proactively (not only on error), cache verdicts for unchanged scenes, wire NVIDIA as an extra provider, and show a live usage meter so the operator can see the demo will last.

### Scope
- **In:** proactive %-based rotation; a verdict cache keyed by `cameraId + phash`; a live budget/usage indicator in the UI; NVIDIA NIM wired as an additional provider.
- **Out:** heuristics/weapon accuracy (Phase 5).

### Files to create / modify
- **Modify** `apps/worker/watch/providers/factory.ts` — add proactive rotation (rotate at a % of a provider's budget) alongside the existing error-only `FallbackWatchProvider`.
- **Create** `apps/worker/watch/providers/NvidiaProvider.ts` — implement the `WatchProvider` interface for NVIDIA NIM (Llama 3.2 90B Vision).
- **Create** `lib/budget/verdictCache.ts` — cache negative verdicts keyed by `cameraId+phash` (Hamming ≤ 5, TTL ~30s; recommended default).
- **Modify** `app/api/analyze/route.ts` — check the cache before spending a call; return `verdictCacheHit: true` on hit.
- **Modify** a live-grid component — render the `budget` block (used/remaining, active provider) as a small meter.

### Step-by-step tasks
1. Add rotation ordering (recommended: Gemini → Groq → NVIDIA(lifetime, keep last) → Cloudflare → LM Studio) and rotate at ~80% of each provider's tracked budget.
2. Implement + register `NvidiaProvider`; confirm it appears in the boot chain log.
3. Add the verdict cache; on an unchanged scene serve the cached negative instead of calling.
4. Surface usage in the UI from the route's `budget` block.

### Acceptance criteria / verify
- With a static scene, repeated frames hit the cache (calls stay flat while frames arrive).
- Draining the primary provider's tracked budget rotates to the next **before** an error, visible in the meter.
- `pnpm typecheck && pnpm lint && pnpm test` clean.

### Tests to add
- vitest for the rotation selector (picks the next provider at the threshold) and the verdict cache (hit within TTL/Hamming, miss after).

### Risks & rollback
- **Risk:** cache masks a real change just under the Hamming threshold. Mitigate: conservative Hamming ≤5 and short TTL; never cache positive verdicts.
- **Rollback:** disable rotation (revert to error-only fallback) and cache independently via flags.

## Phase 5 — Heuristics + weapon accuracy (optional, post-demo)

### Goal / Outcome
Quality polish **after** the demo works. Reduce false positives and add cheap crime signals — without ever asking the local model to be the threat detector. Not required for the 1-hour demo.

### Scope
- **In:** temporal N-of-M voting on the LLM verdict; optional pose-based hand↔object proximity as an extra scalar hint; scalar crime hints (person count, dwell/loiter time, motion energy) attached as context for the LLM.
- **Out:** any local weapon *classification* as the decision — explicitly rejected (the prior local-ONNX weapon filter failed).

### Files to create / modify
- **Create** `lib/gate/temporalVote.ts` — require a threat verdict to persist across N-of-M recent frames before alerting.
- **Modify** the gate to compute and attach scalar hints (person count from the existing YOLO run, dwell time, motion energy) to the `/api/analyze` payload as *context only*.
- *(Optional)* add a permissive pose model (e.g. MoveNet/MediaPipe) for hand↔object proximity — a hint, not a verdict.

### Step-by-step tasks
1. Add N-of-M voting (recommended default 2-of-3) on `is_threat` to cut single-frame false alarms.
2. Attach scalar hints to the payload; update the prompt so the LLM may use them (see [05-DETECTION-AND-PROMPTS.md](05-DETECTION-AND-PROMPTS.md)).
3. *(Optional)* wire pose proximity as an additional hint.

### Acceptance criteria / verify
- False-alarm rate on a benign scene drops vs Phase 4; staged threats still alert.
- `pnpm typecheck && pnpm lint && pnpm test` clean.

### Tests to add
- vitest for temporal voting (alerts only at N-of-M) and hint extraction.

### Risks & rollback
- **Risk:** voting adds latency to the first alert. Mitigate: keep M small; let very high confidence bypass the vote.
- **Rollback:** all Phase 5 pieces are independent flags; disable to return to Phase 4.

---

## Definition of Done for the demo

- [ ] **Phase 0:** keys wired, `LMSTUDIO_*` name reconciled, worker boot log shows the intended provider chain.
- [ ] **Phase 1:** `/api/analyze` holds the key; token bucket + hard daily counter proven by test; `429` on cap; no key in any client payload.
- [ ] **Phase 2:** static/empty scenes produce zero POSTs; a person entering produces POSTs; staged weapon **and** staged fight both alert.
- [ ] **Phase 3:** one sustained event = only a few calls; POSTed images are downscaled + q~50.
- [ ] **Phase 4:** usage meter visible; unchanged scenes hit the cache; provider rotates proactively at the budget threshold.
- [ ] **End-to-end:** a **≥ 60-minute** live 2-camera run stays inside the free-tier quota (usage meter never hits 100%), with LM Studio confirmed as the fail-safe fallback.
- [ ] `pnpm typecheck && pnpm lint && pnpm test` all clean before the PR.

See [03-FREE-TIER-BUDGET.md](03-FREE-TIER-BUDGET.md) for the demo runbook checklist and [01-PRD.md](01-PRD.md) for the measurable success criteria.
