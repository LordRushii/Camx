import { spawn } from "node:child_process";
import ffmpegStatic from "ffmpeg-static";
import sharp from "sharp";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../convex/_generated/api.js";
import type { WatchProvider, BurstFrame } from "./providers/index.js";
import { pushFrame, recentFrames, clearCamera } from "./frameBuffer.js";
import { detectMotion, clearMotion } from "./motion.js";
import { runGate, decideTrigger } from "./gate.js";
import { VisionCallGateway } from "./rateLimiter.js";

export interface CameraDoc {
  _id: string;
  cameraId: string;
  name: string;
  location: string;
  zone: string;
  sourceType: "device" | "network";
  sourceKey: string;
  sourceUrl: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

// Keep track of active watch jobs per camera to prevent concurrent executions
const activeWatchCameraIds = new Set<string>();

// Per-camera cooldown: epoch-ms until which we suppress new escalations after an
// alert, so one event produces one alert instead of firing every loop.
const cooldownUntil = new Map<string, number>();

function cooldownMs(): number {
  const v = Number(process.env.WATCH_COOLDOWN_MS);
  return Number.isFinite(v) && v > 0 ? v : 60_000;
}

function burstFrameCount(): number {
  const v = Number(process.env.WATCH_BURST_FRAMES);
  if (!Number.isFinite(v)) return 6;
  return Math.max(1, Math.min(10, Math.floor(v)));
}

/**
 * Spawn FFmpeg to capture a single frame from the camera's stream.
 */
export async function captureFrameFromStream(sourceUrl: string): Promise<Buffer> {
  const ffmpegPath = process.env.FFMPEG_PATH || (typeof ffmpegStatic === "string" ? ffmpegStatic : "ffmpeg");

  return new Promise((resolve, reject) => {
    const args = [
      "-hide_banner",
      "-loglevel",
      "error",
    ];

    if (sourceUrl.toLowerCase().startsWith("rtsp:")) {
      args.push("-rtsp_transport", "tcp");
    }

    args.push(
      "-i", sourceUrl,
      "-vframes", "1",
      "-q:v", "2",
      "-f", "image2",
      "pipe:1"
    );

    const child = spawn(ffmpegPath, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });

    const chunks: Buffer[] = [];
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      chunks.push(chunk);
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve(Buffer.concat(chunks));
      } else {
        reject(new Error(`FFmpeg failed with code ${code}: ${stderr.trim()}`));
      }
    });

    child.on("error", (err) => {
      reject(err);
    });
  });
}

/**
 * Generate a mock frame using sharp if physical capture is unavailable.
 */
export async function generateMockFrame(text: string): Promise<Buffer> {
  const svgText = `
    <svg width="640" height="480" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="#121214"/>
      <text x="50%" y="45%" dominant-baseline="middle" text-anchor="middle" font-family="monospace" font-size="22" font-weight="bold" fill="#f43f5e">
        [LIVE MONITORING CAM]
      </text>
      <text x="50%" y="55%" dominant-baseline="middle" text-anchor="middle" font-family="monospace" font-size="16" fill="#9ca3af">
        ${text.replace(/\n/g, ' ')}
      </text>
    </svg>
  `;
  return sharp(Buffer.from(svgText)).png().toBuffer();
}

/**
 * Run a single event-gated watch iteration for a camera.
 *
 * Pipeline: capture frame -> buffer + motion (free) -> local ONNX gate (free) ->
 * only if an event is triggered and we're not cooling down or rate-limited, send
 * a burst of recent frames to the vision model, verify, and log the threat.
 */
async function runWatchForCamera(
  camera: CameraDoc,
  convexClient: ConvexHttpClient,
  provider: WatchProvider,
  gateway: VisionCallGateway
): Promise<void> {
  if (activeWatchCameraIds.has(camera.cameraId)) {
    return;
  }
  activeWatchCameraIds.add(camera.cameraId);

  try {
    let frameBuffer: Buffer;
    const mimeType = "image/jpeg";

    try {
      if (camera.sourceType === "network" && camera.sourceUrl) {
        frameBuffer = await captureFrameFromStream(camera.sourceUrl);
      } else {
        frameBuffer = await generateMockFrame(`Camera: ${camera.name} (${camera.cameraId})`);
      }
    } catch (captureErr) {
      console.warn(`[WATCH RUNTIME] Failed to capture frame for ${camera.cameraId}:`, captureErr);
      frameBuffer = await generateMockFrame(`Camera: ${camera.name} [Capture Failed]`);
    }

    // Always maintain the rolling buffer + motion baseline (free, no LLM cost).
    pushFrame(camera.cameraId, { ts: Date.now(), buffer: frameBuffer, mimeType });
    const motion = await detectMotion(camera.cameraId, frameBuffer);

    // Suppress escalation while cooling down from a recent alert.
    const now = Date.now();
    if ((cooldownUntil.get(camera.cameraId) ?? 0) > now) {
      return;
    }

    // Local ONNX gate — the free trigger. Idle scenes stop here.
    const gate = await runGate(frameBuffer);
    const decision = decideTrigger(gate, motion);
    if (!decision.triggered) {
      return;
    }

    // Rate-limit / budget guard before any cloud call.
    const denyReason = gateway.tryAcquire();
    if (denyReason) {
      console.warn(
        `[WATCH RUNTIME] ${camera.cameraId} event (${decision.reasons.join(",")}) skipped: ${denyReason}`,
      );
      return;
    }

    console.log(
      `[WATCH RUNTIME] Event on ${camera.cameraId} [${decision.reasons.join(",")}] (motion=${motion.score.toFixed(3)}); running burst analysis...`,
    );

    let analysisRes: { result: { isHarm: boolean | null; description: string | null }; rawText: string; modelKey: string };
    try {
      const burst: BurstFrame[] = recentFrames(camera.cameraId, burstFrameCount()).map((f) => ({
        base64: f.buffer.toString("base64"),
        mimeType: f.mimeType,
      }));
      analysisRes = await provider.analyzeBurst(burst, gate.summary);
    } finally {
      gateway.release();
    }

    let isHarm = analysisRes.result.isHarm === true;
    let description = analysisRes.result.description;
    let matchesPrompt = null;
    let reason = null;
    let verificationLatencyMs = null;
    let verificationModelKey = null;
    let verificationRawText = null;
    let overturned = false;

    const base64Latest = frameBuffer.toString("base64");

    // 2nd LLM call: verification check if burst reported harm.
    if (isHarm && description) {
      console.log(`[WATCH RUNTIME] Harm detected on ${camera.cameraId}, running second-pass verification...`);
      const verificationRes = await provider.verifyHarm(base64Latest, mimeType, description);
      matchesPrompt = verificationRes.matchesPrompt;
      reason = verificationRes.reason;
      verificationLatencyMs = verificationRes.latencyMs;
      verificationModelKey = verificationRes.modelKey;
      verificationRawText = verificationRes.rawText;

      if (!matchesPrompt) {
        isHarm = false;
        description = null;
        overturned = true;
        console.log(`[WATCH RUNTIME] Threat overturned on ${camera.cameraId} (matchesPrompt === false).`);
      } else {
        console.log(`[WATCH RUNTIME] Threat CONFIRMED on ${camera.cameraId}!`);
      }
    }

    // Call Convex action if harm was verified.
    if (isHarm && description) {
      // Open cooldown window so this event doesn't re-fire every loop.
      cooldownUntil.set(camera.cameraId, Date.now() + cooldownMs());

      const requestId = `watch-${Math.random().toString(36).substring(2, 11)}`;
      const timestamp = new Date().toISOString();

      const frameArrayBuffer = frameBuffer.buffer.slice(
        frameBuffer.byteOffset,
        frameBuffer.byteOffset + frameBuffer.byteLength
      ) as ArrayBuffer;

      await convexClient.action(api.threatLogs.createFromWatch, {
        cameraId: camera.cameraId,
        requestId,
        timestamp,
        classification: "Watch Threat",
        confidence: 90,
        previewText: description,
        vlmAnalysis: [analysisRes.rawText, verificationRawText || ""].filter(Boolean),
        frameBytes: frameArrayBuffer,
        verification: {
          applied: true,
          matchesPrompt,
          overturned,
          reason,
          modelKey: verificationModelKey,
          latencyMs: verificationLatencyMs,
        },
      });
      console.log(`[WATCH RUNTIME] Active threat log created for camera ${camera.cameraId}`);
    }
  } catch (err) {
    console.error(`[WATCH RUNTIME] Error running watch pipeline for camera ${camera.cameraId}:`, err);
  } finally {
    activeWatchCameraIds.delete(camera.cameraId);
  }
}

/**
 * Start the background surveillance watch loop.
 */
export function startWatchLoop(convexClient: ConvexHttpClient, provider: WatchProvider) {
  const gateway = new VisionCallGateway();

  const runIteration = async () => {
    try {
      const cameras = (await convexClient.query(api.cameras.list)) as CameraDoc[];
      const enabledCameras = cameras.filter((c) => c.enabled);

      // Release buffers/motion state for cameras that are no longer enabled.
      const enabledIds = new Set(enabledCameras.map((c) => c.cameraId));
      for (const c of cameras) {
        if (!enabledIds.has(c.cameraId)) {
          clearCamera(c.cameraId);
          clearMotion(c.cameraId);
          cooldownUntil.delete(c.cameraId);
        }
      }

      await Promise.all(
        enabledCameras.map((camera) =>
          runWatchForCamera(camera, convexClient, provider, gateway)
        )
      );
    } catch (err) {
      console.error("[WATCH RUNTIME] Error in watch loop run:", err);
    } finally {
      // Loop cadence: 3 seconds
      setTimeout(runIteration, 3000);
    }
  };

  setTimeout(runIteration, 3000);
}
