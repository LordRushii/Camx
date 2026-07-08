import { join } from "node:path";
import express from "express";
import cors from "cors";
import multer from "multer";
import dotenv from "dotenv";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api.js";
import { runOrchestrator } from "./detection/orchestrator.js";
import { type DetectionModel } from "./detection/model.js";
import { DetectError, toHttpStatus } from "./detection/errors.js";
import { startWatchLoop } from "./watch/runtime.js";
import { LmStudioProvider } from "./watch/providers/index.js";

// Load env variables from root folder or local folder
dotenv.config({ path: join(process.cwd(), "..", "..", ".env.local") });
dotenv.config({ path: join(process.cwd(), ".env.local") });

const app = express();
const port = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

const upload = multer({
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
  },
});

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) {
  console.error("CRITICAL ERROR: NEXT_PUBLIC_CONVEX_URL environment variable is not defined.");
}
const convexClient = new ConvexHttpClient(convexUrl || "");

function generateRequestId(): string {
  return `req-${Math.random().toString(36).substring(2, 11)}`;
}

app.post("/detect", upload.single("frame"), async (req, res) => {
  const requestId = generateRequestId();
  const startTime = performance.now();

  try {
    const file = req.file;
    if (!file) {
      return res.status(400).json({
        ok: false,
        requestId,
        errorCode: "BAD_REQUEST",
        message: "Missing 'frame' image file",
      });
    }

    const cameraId = req.body.cameraId;
    if (!cameraId || typeof cameraId !== "string") {
      return res.status(400).json({
        ok: false,
        requestId,
        errorCode: "BAD_REQUEST",
        message: "Missing or invalid 'cameraId' parameter",
      });
    }

    const modelParam = req.body.model;
    let model: DetectionModel = "rfdetr";
    if (modelParam) {
      if (modelParam === "rfdetr" || modelParam === "yolo" || modelParam === "security") {
        model = modelParam;
      } else {
        return res.status(400).json({
          ok: false,
          requestId,
          errorCode: "BAD_REQUEST",
          message: `Unsupported model type: ${modelParam}. Supported: rfdetr, yolo, security`,
        });
      }
    }

    // Run pipeline
    const [result] = await runOrchestrator(file.buffer, [model]);
    if (!result) {
      throw new Error("Pipeline returned no results");
    }

    const { detections, frame } = result;

    // Push detections to Convex in background to minimize latency
    // The worker never blocks the HTTP response on the database transaction.
    // However, the checklist says "runs the pipeline and then calls the Convex detections.push mutation",
    // so we can wait for it or execute it immediately. Let's do it and log success.
    try {
      await convexClient.mutation(api.detections.push, {
        cameraId,
        detections: detections.map(d => ({
          x1: d.x1,
          y1: d.y1,
          x2: d.x2,
          y2: d.y2,
          confidence: d.confidence,
          class: d.class,
          ...(d.mask ? {
            mask: {
              width: d.mask.width,
              height: d.mask.height,
              data: d.mask.data,
            }
          } : {})
        })),
        frame,
      });
    } catch (convexError) {
      console.error(`[WORKER] [${requestId}] Failed to push to Convex:`, convexError);
    }

    const latencyMs = performance.now() - startTime;

    return res.status(200).json({
      ok: true,
      requestId,
      detections,
      frame,
      meta: {
        latencyMs,
      },
    });

  } catch (error) {
    const latencyMs = performance.now() - startTime;
    console.error(`[WORKER] [${requestId}] Error processing detection (${latencyMs.toFixed(1)}ms):`, error);

    if (error instanceof DetectError) {
      return res.status(toHttpStatus(error.errorCode)).json({
        ok: false,
        requestId,
        errorCode: error.errorCode,
        message: error.message,
        details: error.details,
      });
    }

    return res.status(500).json({
      ok: false,
      requestId,
      errorCode: "INTERNAL_ERROR",
      message: error instanceof Error ? error.message : "An unexpected error occurred",
    });
  }
});

app.listen(port, () => {
  console.log(`[WORKER] Standalone detection worker running on port ${port}`);
  console.log(`[WORKER] Connected to Convex URL: ${convexUrl}`);

  // Start watch/harm-verification surveillance loop
  try {
    const watchProvider = new LmStudioProvider();
    startWatchLoop(convexClient, watchProvider);
    console.log("[WORKER] Started background watch / harm-verification pipeline loop");
  } catch (err) {
    console.error("[WORKER] Failed to initialize watch loop:", err);
  }
});
