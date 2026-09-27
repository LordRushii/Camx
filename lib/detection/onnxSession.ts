import { type InferenceSession } from "onnxruntime-web";

// The matching .wasm/.mjs artifacts are copied into public/ort by
// scripts/copy-ort-artifacts.js (runs on postinstall) and served by Next from
// /ort/. Serving locally removes a runtime dependency on the jsDelivr CDN —
// if that fetch fails, ORT throws inside its wasm module and the inference
// loop in CameraCard silently swallows the error, leaving the overlay blank.
const WASM_BASE = "/ort/";

// Served by Next from public/models/yolo11n.onnx.
const MODEL_URL = "/models/yolo11n.onnx";

let sessionPromise: Promise<InferenceSession> | null = null;

/**
 * Lazily create (and cache) a singleton YOLO11n InferenceSession in the browser.
 * Tries the WebGPU execution provider first, falling back to WASM. Throws if
 * called during SSR. On failure the cached promise is cleared so a later call
 * can retry.
 */
export function getYoloSession(): Promise<InferenceSession> {
  if (typeof window === "undefined") {
    throw new Error("getYoloSession() must be called in the browser, not during SSR");
  }
  if (!sessionPromise) {
    sessionPromise = createSession().catch((err) => {
      sessionPromise = null; // allow a retry on the next call
      throw err;
    });
  }
  return sessionPromise;
}

async function createSession(): Promise<InferenceSession> {
  // Dynamic import keeps onnxruntime-web out of the SSR/server bundle.
  const ort = await import("onnxruntime-web");
  ort.env.wasm.wasmPaths = WASM_BASE;
  // When running on WebGPU, ORT deliberately keeps a few shape/bookkeeping ops
  // on CPU and logs a warning about it ("Some nodes were not assigned to the
  // preferred execution providers"). That is expected behavior, not an error.
  // env.logLevel alone does NOT suppress it: the message originates from ORT's
  // C++ core inside the WASM module, which uses its own per-session severity
  // setting, so we pass logSeverityLevel: ERROR (3) in every create() call.
  ort.env.logLevel = "error";
  const LOG_SEVERITY_ERROR = 3;

  // Prefer probing for WebGPU support up front rather than letting the
  // session creation fail noisily in browsers without a GPU adapter.
  const webgpuAvailable =
    typeof navigator !== "undefined" && "gpu" in navigator;

  if (webgpuAvailable) {
    try {
      const session = await ort.InferenceSession.create(MODEL_URL, {
        executionProviders: ["webgpu"],
        logSeverityLevel: LOG_SEVERITY_ERROR,
      });
      console.log("[yolo] InferenceSession initialized with execution provider: webgpu");
      return session;
    } catch (webgpuErr) {
      console.warn(
        "[yolo] WebGPU execution provider unavailable, falling back to wasm:",
        webgpuErr instanceof Error ? webgpuErr.message : webgpuErr,
      );
    }
  }

  const session = await ort.InferenceSession.create(MODEL_URL, {
    executionProviders: ["wasm"],
    logSeverityLevel: LOG_SEVERITY_ERROR,
  });
  console.log("[yolo] InferenceSession initialized with execution provider: wasm");
  return session;
}
