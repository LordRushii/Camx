import { type InferenceSession } from "onnxruntime-web";

// Keep in sync with the installed onnxruntime-web version (package.json).
// The matching .wasm/.mjs artifacts are served from the jsDelivr CDN so we
// don't have to copy them into /public or configure webpack asset handling.
const ORT_VERSION = "1.30.0";
const WASM_CDN = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/`;

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
  ort.env.wasm.wasmPaths = WASM_CDN;

  try {
    const session = await ort.InferenceSession.create(MODEL_URL, {
      executionProviders: ["webgpu"],
    });
    console.log("[yolo] InferenceSession initialized with execution provider: webgpu");
    return session;
  } catch (webgpuErr) {
    console.warn(
      "[yolo] WebGPU execution provider unavailable, falling back to wasm:",
      webgpuErr instanceof Error ? webgpuErr.message : webgpuErr,
    );
    const session = await ort.InferenceSession.create(MODEL_URL, {
      executionProviders: ["wasm"],
    });
    console.log("[yolo] InferenceSession initialized with execution provider: wasm");
    return session;
  }
}
