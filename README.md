# CAMX2 — AI-Powered Surveillance Platform

> **Real-time threat detection, multi-model AI verification, and forensic video analysis in a single unified platform.**

---

## Table of Contents

- [Overview](#overview)
- [Key Features](#key-features)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Detection Models](#detection-models)
- [AI Pipelines](#ai-pipelines)
- [Database Schema](#database-schema)
- [Pages & UI](#pages--ui)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Environment Variables](#environment-variables)
- [Running Locally](#running-locally)
- [Scripts](#scripts)
- [Contributing](#contributing)

---

## Overview

**CAMX2** is a full-stack, production-grade AI surveillance platform that combines on-device neural inference with cloud-based LLM reasoning to provide accurate, real-time threat detection across any camera network.

The system follows a **two-pass verification architecture**: a fast ONNX model first identifies potential threats in a live feed frame, then a Vision-Language Model (VLM) independently confirms or overturn the detection — dramatically reducing false positives while maintaining near-zero latency on true alerts.

Beyond live monitoring, CAMX2 includes a complete **forensic video analysis pipeline** that accepts uploaded recordings, extracts key frames via YOLO-based scene scoring, performs per-frame narrative analysis with an LLM, produces a natural-language summary, and exposes a **RAG-powered Q&A chat** interface so operators can query footage in plain language.

---

## Key Features

| Feature | Description |
|---|---|
| **Live Surveillance Grid** | Multi-camera dashboard with real-time ONNX inference overlays rendered on an HTML Canvas |
| **Two-Pass Threat Verification** | First-pass LLM flags potential harm → second-pass LLM independently validates → overturn on disagreement |
| **RF-DETR Segmentation** | Instance segmentation using RF-DETR Nano with pixel-accurate mask overlays |
| **YOLO Object Detection** | YOLOv11n (fast), YOLOv11x (high-accuracy), and YOLOv8 weapon-specific models |
| **Watch Loop** | Autonomous background loop polling all enabled cameras every 3 seconds via ffmpeg frame capture |
| **Video Analysis Pipeline** | Upload MP4/MKV → fingerprint cache → ffmpeg frame extraction → YOLO frame scoring → per-frame VLM analysis → Nemotron summary |
| **RAG Chat Q&A** | Ask questions about any analysed footage; retrieval uses vector embeddings + knowledge-graph traversal |
| **Convex Real-Time Sync** | All persistent state (cameras, detections, threat logs, video jobs) lives in Convex — no polling, pure subscriptions |
| **Multi-Provider LLM** | Swap between LM Studio (local, privacy-first) and xAI/Grok (cloud) with a single provider config flag |
| **Threat Log Management** | Full audit trail with ACTIVE / ACKNOWLEDGED / ESCALATED / FALSE_POSITIVE lifecycle tracking |
| **Settings Panel** | Camera management, model configuration, alert rules, face enrollment, deployment profile, user management |
| **Dark / Light Mode** | Full theme support via `next-themes` with semantic CSS status tokens |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                          Browser (Next.js)                          │
│                                                                     │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────┐  ┌──────────┐  │
│  │ Detect Grid │  │ Live Monitor │  │  Analysis  │  │ Settings │  │
│  │ (CameraCard)│  │  (Monitor)   │  │  & Q&A     │  │  Panel   │  │
│  └──────┬──────┘  └──────┬───────┘  └─────┬──────┘  └────┬─────┘  │
│         │  useQuery/      │                │               │        │
│         │  useMutation    │                │               │        │
└─────────┼─────────────────┼────────────────┼───────────────┼────────┘
          │                 │                │               │
          ▼                 ▼                ▼               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     Convex (Real-time Backend)                      │
│                                                                     │
│   cameras  │  detections  │  threatLogs  │  videoJobs  │  users    │
│                    timelineEntries (vector index)                   │
└──────────────────────────┬──────────────────────────────────────────┘
                           │ ConvexHttpClient
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│                   apps/worker  (Node.js + Express)                  │
│                                                                     │
│  ┌─────────────────┐  ┌──────────────────┐  ┌───────────────────┐  │
│  │   Detection      │  │   Watch Loop     │  │  Video Pipeline   │  │
│  │   Pipeline       │  │   (3s cadence)   │  │  (DDD-lite)       │  │
│  │                  │  │                  │  │                   │  │
│  │  preprocess.ts   │  │  runtime.ts      │  │  pipeline/        │  │
│  │  orchestrator.ts │  │  prompts.ts      │  │  application/     │  │
│  │  postprocess.ts  │  │  providers/      │  │  providers/       │  │
│  │  model.ts        │  │  (LmStudio)      │  │  retrieval/       │  │
│  └────────┬─────────┘  └──────┬───────────┘  └─────────┬─────────┘  │
│           │                   │                         │           │
│           ▼                   ▼                         ▼           │
│      onnxruntime-node     LM Studio SDK          LM Studio / xAI   │
│      (ONNX models)        (local VLM)            (frame analysis)   │
└─────────────────────────────────────────────────────────────────────┘
```

### Request Flow — Live Detection

```
Browser captures webcam frame
  → POST /api/detect  (Next.js thin proxy)
    → POST worker:3001/detect
      → preprocess: resize + normalize image tensor
      → ONNX inference (RF-DETR or YOLO)
      → postprocess: NMS, decode masks, filter by confidence
      → push detections to Convex (background, non-blocking)
      → return detections JSON to browser
        → drawDetections() renders boxes/masks on Canvas overlay
```

### Request Flow — Watch Loop (background)

```
startWatchLoop() fires every 3 seconds
  → queries Convex for enabled cameras
  → for each camera (concurrent):
      → ffmpeg captures 1 frame from sourceUrl (RTSP/HTTP)
      → LLM 1st pass: analyzeFrame() → { isHarm, description }
      → if isHarm:
          → LLM 2nd pass: verifyHarm() → { matchesPrompt, reason }
          → if NOT matchesPrompt: overturn, isHarm = false
          → if confirmed: createFromWatch Convex action → threatLog row
              → Browser sees new ACTIVE threat → modal dialog fires
```

### Request Flow — Video Analysis

```
User uploads MP4 → POST /api/video-analysis/jobs
  → worker: fingerprint (SHA-256) → cache hit? return existing job
  → ffmpeg extracts frames at 1 fps
  → YOLO frame scorer: keep frames with relevant objects, score by priority
  → LLM analyzes each kept frame sequentially → timelineEntry rows
  → Nemotron/xAI summarizes full timeline → videoJob.summary
  → Convex vectors indexed for RAG
  → User asks question → RAG retrieval → knowledge-graph → LLM answers
```

---

## Tech Stack

### Frontend (`/` — Next.js App Router)

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router), React 19, TypeScript 5 strict |
| UI Components | shadcn/ui (Radix-based headless) |
| Styling | Tailwind CSS v4 + tw-animate-css |
| Icons | HugeIcons |
| Fonts | Montserrat (headings), Roboto (body), Geist Mono (code) |
| Forms | React Hook Form + Zod |
| Tables | TanStack Table v8 |
| State / sync | Convex React (`useQuery`, `useMutation`) |
| URL state | nuqs |
| Theme | next-themes (dark / light) |

### Worker (`apps/worker` — Node.js)

| Layer | Technology |
|---|---|
| Runtime | Node.js + tsx (watch mode) |
| HTTP Server | Express 4 + CORS + Multer |
| ML Inference | onnxruntime-node |
| Image processing | sharp |
| Video extraction | ffmpeg-static + ffprobe-static |
| Local LLM | @lmstudio/sdk |
| Convex client | ConvexHttpClient |

### Backend

| Layer | Technology |
|---|---|
| Database + Real-time | Convex (tables, mutations, queries, actions) |
| Vector search | Convex vector index (768-dim embeddings on `timelineEntries`) |
| Auth | Convex built-in identity (`tokenIdentifier`) |

### External Services / Models

| Service | Purpose |
|---|---|
| LM Studio | Local VLM for watch verification and video frame analysis |
| xAI / Grok-4.5 | Cloud VLM provider alternative for video analysis |
| NVIDIA Nemotron (NIM) | Timeline summarization (30B) |
| HuggingFace | Weapon detection model source (`weapon-yolov8.onnx`) |

---

## Project Structure

```text
Camx/
├── app/                          # Next.js App Router pages
│   ├── page.tsx                  # → / (Detect Grid)
│   ├── monitor/page.tsx          # → /monitor (Live Monitor Desk)
│   ├── analysis/page.tsx         # → /analysis (Video Analysis + Q&A)
│   ├── operations/page.tsx       # → /operations (Operations Desk)
│   ├── settings/
│   │   ├── layout.tsx            # Settings sidebar shell
│   │   ├── camera-management/    # Add/edit/delete cameras
│   │   ├── model-configuration/  # ONNX model selector
│   │   ├── threat-log/           # Threat log table + status management
│   │   ├── alert-configuration/  # Alert rules
│   │   ├── deployment-profile/   # Deployment metadata
│   │   ├── face-enrollment/      # Face enrolment UI
│   │   └── user-management/      # User profile
│   ├── api/
│   │   └── video-analysis/jobs/  # Thin Next.js proxy → worker
│   ├── globals.css               # Design tokens, status colors, dark mode
│   ├── layout.tsx                # Root layout (fonts, Convex, AppShell)
│   └── ConvexClientProvider.tsx
│
├── apps/worker/                  # Standalone Node.js worker process
│   ├── server.ts                 # Express server + route handlers
│   ├── detection/
│   │   ├── model.ts              # ONNX session management (4 models)
│   │   ├── preprocess.ts         # Image → tensor (resize, normalize)
│   │   ├── postprocess.ts        # NMS, mask decode, confidence filter
│   │   ├── orchestrator.ts       # Multi-model concurrent inference
│   │   └── errors.ts             # Typed error classes
│   ├── watch/
│   │   ├── runtime.ts            # Background surveillance loop + ffmpeg
│   │   ├── prompts.ts            # System prompts for harm analysis
│   │   ├── schema.ts             # Zod response schemas
│   │   └── providers/
│   │       └── LmStudioProvider.ts  # LM Studio watch VLM adapter
│   └── video/
│       ├── application/
│       │   └── service.ts        # VideoAnalysisService (orchestration)
│       ├── pipeline/
│       │   ├── extract-video.ts  # ffmpeg frame extraction
│       │   ├── yolo-frame-selector.ts  # YOLO-scored frame filtering
│       │   ├── analyze-frames.ts # Per-frame LLM analysis
│       │   ├── build-timeline.ts # Timeline aggregation
│       │   └── answer-chat.ts    # Chat answer routing
│       ├── providers/
│       │   ├── types.ts          # VideoAnalysisProvider interface
│       │   ├── lmstudio-provider.ts  # LM Studio video provider
│       │   ├── xai-provider.ts   # xAI/Grok video provider
│       │   └── runtime.ts        # Provider config parsing
│       ├── retrieval/
│       │   ├── query-service.ts  # RAG: vector search + graph query
│       │   ├── graph-builder.ts  # Knowledge graph from timeline
│       │   ├── chunking.ts       # Timeline → RAG chunks
│       │   └── time-range.ts     # Time-range parsing from questions
│       ├── storage/
│       │   └── local-store.ts    # In-process job store + disk cache
│       ├── contracts/
│       │   └── schemas.ts        # Zod frame/chat response schemas
│       └── domain/               # Value types, stage definitions
│
├── convex/                       # Convex backend (one file per table)
│   ├── schema.ts                 # Full DB schema with validators
│   ├── cameras.ts                # list, get, create, update, remove
│   ├── detections.ts             # push, getLatest
│   ├── threatLogs.ts             # list, latestActive, updateStatus, createFromWatch
│   ├── videoJobs.ts              # create, get, update, list
│   ├── timelineEntries.ts        # insert, list, vector search
│   └── users.ts                  # get, upsert (auth identity mapping)
│
├── components/
│   ├── camera/
│   │   ├── CameraCard.tsx        # Per-camera card with live feed + detections
│   │   ├── CameraFeed.tsx        # Webcam / RTSP video element
│   │   ├── CameraOverlay.tsx     # Canvas overlay (polls worker, draws detections)
│   │   ├── CameraControls.tsx    # Toggle camera/detect/watch/model buttons
│   │   ├── CameraDebugPanel.tsx  # Debug latency + watch result panel
│   │   └── CameraStatusBadge.tsx # Nominal / Warning / Critical badge
│   ├── analysis/
│   │   ├── analysis-video-player.tsx  # Timeline-marker video player
│   │   ├── analysis-shell.tsx    # Analysis page layout shell
│   │   └── video-watch-session.tsx    # useAnalysisSession hook + all upload logic
│   ├── shell/
│   │   ├── TopNav.tsx            # Sticky navigation bar
│   │   ├── AppShell.tsx          # Root layout wrapper
│   │   ├── ThemeSwitcher.tsx     # Dark/light toggle
│   │   └── sub-nav.tsx           # Sub-navigation tabs
│   ├── ui/                       # shadcn/ui primitives
│   └── DetectView.tsx            # Surveillance grid + threat alert dialog
│
├── hooks/
│   ├── useCameraDevices.ts       # Enumerate local MediaDevices
│   ├── use-data-table.ts         # TanStack Table generic hook
│   ├── use-debounced-callback.ts
│   └── use-callback-ref.ts
│
├── lib/
│   ├── draw.ts                   # Canvas drawing (boxes, masks, labels)
│   ├── coco.ts                   # COCO class names (80 classes)
│   ├── parsers.ts                # URL / query param parsers
│   ├── convex-client.ts          # ConvexHttpClient singleton
│   └── utils.ts                  # cn() className utility
│
├── types/
│   └── video-analysis.ts         # Shared TypeScript types
│
├── scripts/
│   ├── download-models.js        # postinstall: downloads 5 ONNX models
│   └── cleanup-video-tmp.js      # Removes stale temp video files
│
├── public/models/                # ONNX model files (git-ignored, auto-downloaded)
│   ├── rf-detr-seg-nano.onnx     # ~117 MB — segmentation
│   ├── rfdetr-nano.onnx          # ~103 MB — detection only
│   ├── yolo11n.onnx              # ~10 MB  — fast general detection
│   ├── yolo11x.onnx              # ~218 MB — high-accuracy general detection
│   └── weapon-yolov8.onnx        # ~12 MB  — weapon-specific detection
│
├── package.json                  # Root workspace (web + dev scripts)
├── pnpm-workspace.yaml           # PNPM monorepo config
└── tsconfig.json
```

---

## Detection Models

CAMX2 ships with **5 ONNX models** downloaded automatically on `pnpm install`:

| Model File | Type | Input | Purpose |
|---|---|---|---|
| `rf-detr-seg-nano.onnx` | RT-DETR + segmentation | 312×312 MEAN/STD norm | General object detection with pixel-accurate instance masks |
| `rfdetr-nano.onnx` | RT-DETR | 312×312 MEAN/STD norm | Detection-only variant (lighter) |
| `yolo11n.onnx` | YOLOv11 Nano | 640×640 /255 norm | Fast general-purpose detection (80 COCO classes) |
| `yolo11x.onnx` | YOLOv11 Extra-Large | 640×640 /255 norm | High-accuracy general detection — used by watch loop & video frame scorer |
| `weapon-yolov8.onnx` | YOLOv8 | 640×640 /255 norm | Weapon-specific detection (knife, firearm, etc.) |

### Postprocessing Details

- **RF-DETR**: Reads `pred_boxes` + `logits` + optional `masks` tensors. Applies sigmoid to logits, filters by confidence threshold (0.3), runs NMS (IoU 0.5), decodes RLE-style binary masks.
- **YOLO**: Reads `output0` tensor in `[1, 84, N]` layout. Transposes, filters by confidence (0.25), runs vectorized NMS (IoU 0.45), maps class IDs to COCO names.
- Both pipelines share the same `preprocess.ts` cache key strategy — concurrent model runs on the same frame reuse the same preprocessed tensor.

---

## AI Pipelines

### 1. Watch Surveillance Loop

The watch loop runs in the worker process on a **3-second polling cadence**:

```
Every 3 seconds:
  For each enabled camera (concurrent):
    1. Capture frame → ffmpeg (RTSP/HTTP) or mock frame (no source)
    2. Base64 encode frame
    3. LLM 1st pass (analyzeFrame):
         System: WATCH_SYSTEM_PROMPT (universal threat taxonomy)
         Response: { isHarm: bool, description: string }
    4. If isHarm:
         LLM 2nd pass (verifyHarm):
           System: WATCH_VERIFICATION_SYSTEM_PROMPT
           Question: "Does this description match the image?"
           Response: { matchesPrompt: bool, reason: string }
         If matchesPrompt === false → overturn (isHarm = false)
         If confirmed → Convex action: createFromWatch()
                         → threatLogs row: status = ACTIVE
                         → Browser modal fires immediately
```

**The toy/replica exception** is encoded directly into the system prompt: objects that are unmistakably toys in clearly benign, playful contexts are excluded.

**Harm categories monitored**: weapons, interpersonal violence, forced entry, fire/smoke, medical emergency, crush hazard, tampering with safety equipment.

### 2. Video Analysis Pipeline

```
Upload video (≤100MB MP4/MKV/H.264/H.265)
  │
  ├─ Fingerprint: SHA-256 of first 2MB → check local disk cache
  │   └─ Cache hit? Return existing job immediately
  │
  ├─ Frame extraction (ffmpeg):
  │   └─ 1 frame per second, JPEG quality 2, piped in-memory
  │
  ├─ YOLO Frame Scorer (yolo-frame-selector.ts):
  │   ├─ Runs yolo11x ONNX on each frame
  │   ├─ Security-relevant COCO classes: person, knife, scissors, bat...
  │   ├─ Priority scoring: knife=100, person=70, car=45...
  │   └─ Keeps top-N frames by score, drops redundant similar frames
  │
  ├─ Per-frame LLM Analysis (sequential):
  │   ├─ Provider: LM Studio (local) or xAI/Grok (cloud)
  │   ├─ Input: frame image + previous summary + recent timeline
  │   ├─ Output: { sceneSummary, visibleObjects, events, continuityNotes }
  │   └─ Writes timelineEntry to Convex (with 768-dim embedding)
  │
  ├─ Timeline Summarization (Nemotron 30B / xAI):
  │   └─ Full timeline text → { timelineText, summaryText }
  │       → stored in videoJob.summary
  │
  └─ RAG Q&A (on demand):
      ├─ Vector search: embed question → cosine similarity over timelineEntries
      ├─ Time-range extraction: parse "at 2:30" / "between 1-3 min" from question
      ├─ Knowledge-graph traversal: object co-occurrence graph built from timeline
      └─ LLM answers with retrieved evidence blocks as context
```

### 3. LLM Provider Interface

Both watch and video pipelines use a typed `Provider` interface — switching between local (LM Studio) and cloud (xAI/Grok) requires only a config change:

```typescript
interface VideoAnalysisProvider {
  kind: "lmstudio" | "xai";
  embedTexts(inputs: string[]): Promise<number[][]>;
  analyzeFrame(input: ProviderFrameInput): Promise<FrameArtifact>;
  summarizeTimeline(timeline: TimelineEntry[]): Promise<SummaryArtifact>;
  answerQuestion(input: QuestionInput): Promise<{ answer: string; modelKey: string }>;
}
```

---

## Database Schema

All persistent state lives in Convex. Tables:

### `cameras`
| Field | Type | Notes |
|---|---|---|
| `cameraId` | string | Stable UUID |
| `name` | string | Display name |
| `location` | string | Physical location |
| `zone` | string | Zone tag |
| `sourceType` | `"device" \| "network"` | Webcam vs RTSP/HTTP |
| `sourceKey` | string | Device index or stream URL |
| `sourceUrl` | string | Full URL for network sources |
| `enabled` | boolean | Controls watch loop inclusion |

### `detections`
| Field | Type | Notes |
|---|---|---|
| `cameraId` | string | FK to cameras |
| `detections` | array | `[{ x1, y1, x2, y2, confidence, class, mask? }]` |
| `frame` | object | `{ width, height }` |
| `createdAt` | number | Unix ms timestamp |

### `threatLogs`
| Field | Type | Notes |
|---|---|---|
| `requestId` | string | Unique per detection event |
| `cameraId` | string | Source camera |
| `classification` | string | Threat class label |
| `severity` | `"critical" \| "warning" \| "nominal"` | |
| `previewText` | string | LLM description |
| `frameSrc` | string? | Base64 preview frame |
| `vlmAnalysis` | string[] | Raw LLM outputs (both passes) |
| `verification` | object | `{ applied, matchesPrompt, overturned, reason, modelKey, latencyMs }` |
| `status` | `"ACTIVE" \| "ACKNOWLEDGED" \| "ESCALATED" \| "FALSE_POSITIVE"` | Lifecycle |

### `videoJobs`
| Field | Type | Notes |
|---|---|---|
| `status` | enum | `idle → uploading → extracting → analyzing → combining → completed \| error` |
| `fingerprint` | string | SHA-256 for cache deduplication |
| `sourceFileName` | string | Original filename |
| `totalFrames` / `analyzedFrames` | number | Progress tracking |
| `cache` | object | `{ fingerprint, cacheHit, source: "memory \| disk \| upload" }` |
| `summary` | object? | `{ timelineText, summaryText, modelKey, rawText }` |

### `timelineEntries`
| Field | Type | Notes |
|---|---|---|
| `jobId` | ID | FK to videoJobs |
| `frameIndex` / `timestampMs` / `timestampLabel` | various | Temporal position |
| `frameAnalysis` | string | Scene narrative |
| `objects` | record | Object → description map |
| `llm` | object? | `{ narrative: { modelKey, systemPrompt, userPrompt, responseRaw }, tracking: {...} }` |
| `embedding` | number[]? | 768-dim vector for semantic search |

> Vector index `by_embedding` (768 dims) is defined on `timelineEntries`, filtered by `jobId`, powering the RAG Q&A retrieval.

---

## Pages & UI

| Route | Page | Description |
|---|---|---|
| `/` | **Detect Grid** | Live multi-camera surveillance grid. Each `CameraCard` independently polls the worker for detections and renders Canvas overlays. Threat alert modal fires on any `ACTIVE` threat log. |
| `/monitor` | **Live Monitor Desk** | Full-screen single-camera operator panel with camera selector, model toggle (RF-DETR ↔ YOLO), detection overlay, Intel Stream Log, and debug panel. |
| `/analysis` | **Analysis & Q&A** | Video upload → full pipeline visualizer → video player with timeline markers → AI summary panel → RAG chat interface. |
| `/operations` | **Operations Desk** | System health dashboard: camera count, Convex query rate, WebGPU load, 24h threat count, memory/VLM/thread metrics. |
| `/settings/camera-management` | **Camera Management** | CRUD for cameras (device/network), test stream, enable/disable. |
| `/settings/model-configuration` | **Model Configuration** | Select active detection model, confidence thresholds, NMS IoU. |
| `/settings/threat-log` | **Threat Log** | Full audit table with filter/sort, bulk status updates (Acknowledge, Escalate, Mark FP). |
| `/settings/alert-configuration` | **Alert Configuration** | Configure notification rules, severity thresholds. |
| `/settings/deployment-profile` | **Deployment Profile** | Deployment name, location, operator metadata. |
| `/settings/face-enrollment` | **Face Enrollment** | Enroll known faces for recognition tagging. |
| `/settings/user-management` | **User Management** | Manage operator accounts and roles. |

### Design System

- **Status semantic tokens** (never hardcode hex — always use these):
  - `--status-nominal` — green (OKLCH 0.627 0.265 149°)
  - `--status-warning` — amber (OKLCH 0.795 0.184 86°)
  - `--status-critical` — red (OKLCH 0.577 0.245 27°)
- **Typography**: Montserrat (headings), Roboto (body), Geist Mono (code/data)
- **Theme**: Full dark mode via `.dark` class with OKLCH color tokens

---

## Prerequisites

| Requirement | Version | Notes |
|---|---|---|
| Node.js | ≥ 20 | Required for ES modules + ONNX |
| pnpm | ≥ 9 | Package manager |
| LM Studio | Latest | Required for local VLM (watch + video pipelines) |
| Convex account | — | Free tier is sufficient |
| ffmpeg | Bundled | Included via `ffmpeg-static`; no separate install needed |

**Optional** (for cloud video analysis):
- xAI API key (`XAI_API_KEY`) for Grok-4.5 provider

---

## Installation

```bash
# 1. Clone the repository
git clone https://github.com/LordRushii/Camx-.git
cd Camx-

# 2. Install dependencies (also downloads ONNX models automatically)
pnpm install
```

The `postinstall` script (`scripts/download-models.js`) will automatically download the 5 ONNX model files (~470 MB total) into `public/models/`. Models are git-ignored and fetched from GitHub releases and HuggingFace on first install.

```text
✓ rf-detr-seg-nano.onnx   (~117 MB)
✓ rfdetr-nano.onnx         (~103 MB)
✓ yolo11n.onnx             (~10 MB)
✓ yolo11x.onnx             (~218 MB)
✓ weapon-yolov8.onnx       (~12 MB)
```

---

## Environment Variables

Create a `.env.local` file in the project root:

```env
# ── Convex ────────────────────────────────────────────────────────────
# Your Convex deployment URL (get from: npx convex dev)
NEXT_PUBLIC_CONVEX_URL=https://<your-deployment>.convex.cloud

# ── LM Studio ────────────────────────────────────────────────────────
# LM Studio server URL (default: http://localhost:1234)
LMSTUDIO_URL=http://localhost:1234

# ── xAI (optional) ────────────────────────────────────────────────────
# Required only if using the xAI/Grok video analysis provider
XAI_API_KEY=xai-...

# ── Worker ────────────────────────────────────────────────────────────
# Worker HTTP port (default: 3001)
PORT=3001

# ── ffmpeg (optional) ─────────────────────────────────────────────────
# Override bundled ffmpeg path if needed
FFMPEG_PATH=/usr/bin/ffmpeg
```

### Setting up Convex

```bash
# Initialize your Convex project (first-time only)
npx convex dev
```

Follow the prompts to create or link a Convex project. This sets `NEXT_PUBLIC_CONVEX_URL` and pushes the schema.

---

## Running Locally

```bash
# Start both Next.js and the worker concurrently
pnpm dev
```

This runs:
- **Next.js** web app on `http://localhost:3000`
- **Worker** (Express + ONNX + watch loop) on `http://localhost:3001`

Logs are color-coded: `[web]` in cyan, `[worker]` in magenta.

> **LM Studio**: Before starting, open LM Studio, load a vision-capable model (e.g., `lfm-ucf-400m` or similar), and start the local server on port 1234. The watch loop and video analysis pipelines will connect automatically.

---

## Scripts

| Command | Description |
|---|---|
| `pnpm dev` | Start Next.js + worker in parallel (hot reload) |
| `pnpm build` | Production build of the Next.js app |
| `pnpm start` | Serve the production Next.js build |
| `pnpm lint` | ESLint across the workspace |
| `pnpm format` | Prettier format all `.ts` / `.tsx` files |
| `pnpm typecheck` | `tsc --noEmit` across the workspace |
| `node scripts/download-models.js` | Re-download ONNX models manually |
| `node scripts/cleanup-video-tmp.js` | Remove stale temp video extraction files |

---

## Contributing

1. **Read `AGENTS.md`** — it contains the prime directive, stack rules, Convex conventions, and phase discipline that all contributors must follow.
2. **Check `docs/CAMX2-COMPLETE-REFERENCE.md`** before writing new logic — a reference implementation almost always exists.
3. Follow the existing DDD-lite structure in `apps/worker/video/`.
4. Run `pnpm typecheck && pnpm lint` before submitting any PR — a PR that doesn't typecheck is not done.
5. Any ported detection/postprocessing logic must include a unit test.

---

<p align="center">
  Built with ❤️ — Next.js · Convex · ONNX Runtime · LM Studio · TypeScript
</p>
