# CAMX2 — AI-Powered Surveillance Platform

> Real-time threat detection, two-pass AI verification, and forensic video analysis — in one unified platform.

---

## Overview

CAMX2 combines on-device ONNX vision models with LLM reasoning to detect threats across a camera network in real time. Every potential threat is checked twice — a fast **first pass** flags it, an independent **second pass** confirms or overturns it — cutting false positives without sacrificing latency.

Beyond live monitoring, CAMX2 can ingest uploaded footage, extract and score key frames, generate a natural-language narrative of what happened, and answer plain-language questions about it via **RAG-powered chat**.

---

## Architecture

<p align="center">
  <img src="docs/architecture.png" alt="CAMX2 architecture diagram" width="820">
</p>

| Flow | Path |
|---|---|
| **Live detection** | Browser frame → Worker ONNX inference → boxes/masks on canvas, results pushed to Convex |
| **Watch loop** | Every 3s, ffmpeg grabs a frame per camera → LLM pass 1 flags harm → LLM pass 2 verifies → confirmed threats become `threatLogs` rows → UI alerts instantly via Convex subscription |
| **Video analysis** | Upload → frame extraction → YOLO scores frames → LLM narrates each kept frame → timeline summarized → embeddings power RAG chat |
| **Live grid (browser → server)** | Browser gate (motion + person + pHash novelty) → `POST /api/analyze` → token-bucket + hard budget → vision-LLM → verify-on-positive → Convex `threatLogs` |

## Live grid on free tiers

The live monitoring grid sends frames to a **server proxy** (`/api/analyze`), never directly from the
browser. The proxy enforces a token-bucket rate cap (~8 calls/min), a hard daily/session budget that
**cannot** be exceeded, and provider rotation (Gemini → Groq → NVIDIA → LM Studio local). The browser
gate (motion + YOLO person + perceptual-hash dedup) drops idle/duplicate frames for free, so a 1+ hour
demo fits inside a single free-tier quota. See `docs/live-detection-plan/` for the full design.

## Key Features

| Feature | What it does |
|---|---|
| **Live Surveillance Grid** | Multi-camera dashboard, real-time ONNX overlays on canvas |
| **Two-Pass Threat Verification** | Independent LLM re-check before any alert fires |
| **RF-DETR + YOLO Detection** | Segmentation + fast/high-accuracy/weapon-specific detection models |
| **Watch Loop** | Autonomous background monitoring, no manual polling |
| **Budget-Safe Live Proxy** | `/api/analyze`: token bucket + hard budget + provider rotation, keys server-side only |
| **Browser Gate** | Motion + person + pHash novelty — idle/empty/duplicate frames never cost a call |
| **Usage Meter** | Live calls/min · today vs budget · active provider · green/amber/red state |
| **Video Analysis Pipeline** | Upload → scene scoring → per-frame LLM analysis → AI summary |
| **RAG Chat Q&A** | Ask natural-language questions about analyzed footage |
| **Convex Real-Time Sync** | All state lives in Convex — pure subscriptions, no polling |
| **Multi-Provider LLM** | Swap LM Studio (local/private) ↔ NVIDIA API (cloud) via config |
| **Threat Log Lifecycle** | ACTIVE → ACKNOWLEDGED / ESCALATED / FALSE_POSITIVE |

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 16 (App Router), React 19, TypeScript, Tailwind v4, shadcn/ui |
| Backend | Convex (DB, real-time sync, vector search, auth) |
| Live proxy | Next.js Route Handler (`/api/analyze`), Node runtime |
| Worker | Node.js + Express, onnxruntime-node, sharp, ffmpeg-static |
| Local AI | LM Studio SDK (vision-capable model) |
| Cloud AI | Gemini 2.5 Flash / Groq Llama 4 Scout / NVIDIA NIM — rotation + budget |
| Tooling | pnpm workspaces, ESLint, Prettier, Vitest |

## Detection Models

Auto-downloaded on `pnpm install` (~470 MB total) into `public/models/`:

| Model | Purpose |
|---|---|
| `rf-detr-seg-nano.onnx` | General detection + pixel-accurate masks |
| `rfdetr-nano.onnx` | Lighter detection-only variant |
| `yolo11n.onnx` | Fast general-purpose detection (live grid gate: person class) |
| `yolo11x.onnx` | High-accuracy detection (watch loop / video scoring) |
| `weapon-yolov8.onnx` | Weapon-specific detection (worker gate context only) |

---

## Getting Started

**Prerequisites:** Node.js ≥ 20 · pnpm ≥ 9 · [LM Studio](https://lmstudio.ai/) running locally · a Convex project

```bash
git clone https://github.com/LordRushii/Camx-.git
cd Camx-
pnpm install        # also downloads ONNX models automatically
npx convex dev       # link/create your Convex project + push schema
pnpm dev             # runs Next.js (:3000) + worker (:3001) together
```

Before starting, open LM Studio, load a vision-capable model, and start its local server (default `ws://127.0.0.1:1234`). The watch loop, live proxy fallback, and video pipeline connect to it automatically.

### `.env.local`

```env
NEXT_PUBLIC_CONVEX_URL=https://<your-deployment>.convex.cloud
GEMINI_API_KEY=...             # live proxy primary provider
GROQ_API_KEY=...               # live proxy secondary provider
WATCH_PROVIDER=gemini
WATCH_RATE_PER_MIN=8           # budget fail-safe (see .env.example for all caps)
LMSTUDIO_BASE_URL=ws://127.0.0.1:1234
NVIDIA_API_KEY=nvapi-...       # optional, for cloud video analysis / summarization
PORT=3001                      # worker port
```

---

## Scripts

| Command | Description |
|---|---|
| `pnpm dev` | Run Next.js + worker together (hot reload) |
| `pnpm build` / `pnpm start` | Production build / serve |
| `pnpm test` / `pnpm test:watch` | Vitest unit suites (gateway, gate, phash, cache, voting) |
| `pnpm lint` · `pnpm format` · `pnpm typecheck` | Code quality checks |
| `node scripts/download-models.js` | Re-download ONNX models |
| `node scripts/cleanup-video-tmp.js` | Clear stale video temp files |

---

## Contributing

1. Read `AGENTS.md` for stack conventions and Convex rules before touching backend code.
2. Check `docs/CAMX2-COMPLETE-REFERENCE.md` — a reference implementation usually already exists.
3. Follow the existing DDD-lite structure under `apps/worker/video/`.
4. Run `pnpm typecheck && pnpm lint && pnpm test` before opening a PR.

---

<p align="center">Built with Next.js · Convex · ONNX Runtime · LM Studio · TypeScript</p>
