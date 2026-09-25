import { join, dirname } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as ort from "onnxruntime-node";
import { ModelError } from "./errors.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export type DetectionModel = "rfdetr" | "yolo" | "security" | "weapon";

// Model configuration info
const MODEL_CONFIG = {
  rfdetr: {
    fileName: "rf-detr-seg-nano.onnx",
    inputName: "input",
    logLabel: "RF-DETR",
  },
  yolo: {
    fileName: "yolo11n.onnx",
    inputName: "images",
    outputNames: {
      output: "output0",
    },
    logLabel: "YOLO",
  },
  security: {
    fileName: "yolo11x.onnx",
    inputName: "images",
    outputNames: {
      output: "output0",
    },
    logLabel: "SECURITY",
  },
  weapon: {
    fileName: "weapon-yolov8.onnx",
    inputName: "images",
    outputNames: {
      output: "output0",
    },
    logLabel: "WEAPON",
  },
} as const;

const sessions = new Map<DetectionModel, ort.InferenceSession>();
const initializedModels = new Set<DetectionModel>();

/**
 * Ordered list of execution providers to attempt, each tried ALONE so we can
 * tell which one actually initialized (ORT always appends CPU internally for
 * ops a GPU EP can't handle, so a GPU-only request is safe).
 *
 * NOTE: `onnxruntime-node` does NOT support the "webgpu" provider — that only
 * exists in `onnxruntime-web` (browser). In Node the GPU accelerators are:
 *   - "dml"  DirectML: any DirectX-12 GPU on Windows (NVIDIA/AMD/Intel). The
 *            npm build bundles this on win32/x64 — it drives an RTX card fine.
 *   - "cuda" NVIDIA only, and only if this ORT build ships the CUDA provider
 *            AND the CUDA/cuDNN toolkit is installed. The stock npm build for
 *            Windows does NOT include it, so "cuda" will fall through to CPU.
 * CPU is always the final fallback.
 *
 * Controlled by env `ONNX_EP`: "auto" (default), "dml", "cuda", or "cpu".
 */
function candidateExecutionProviders(): string[] {
  const pref = (process.env.ONNX_EP || "auto").trim().toLowerCase();
  switch (pref) {
    case "cpu":
      return ["cpu"];
    case "dml":
    case "directml":
      return ["dml", "cpu"];
    case "cuda":
      return ["cuda", "cpu"];
    case "auto":
    default:
      // Prefer DirectML on Windows (bundled, no extra install), else CUDA.
      return process.platform === "win32" ? ["dml", "cpu"] : ["cuda", "cpu"];
  }
}

function findModelPath(fileName: string): string {
  const possiblePaths = [
    join(process.cwd(), "public", "models", fileName),
    join(process.cwd(), "..", "..", "public", "models", fileName),
    join(process.cwd(), "..", "public", "models", fileName),
    join(__dirname, "..", "..", "..", "public", "models", fileName),
    join(__dirname, "..", "..", "public", "models", fileName),
  ];

  for (const path of possiblePaths) {
    if (existsSync(path)) {
      return path;
    }
  }

  // Fallback to first path if not found, let creation fail with descriptive path
  return possiblePaths[0];
}

export async function getSession(
  modelType: DetectionModel
): Promise<ort.InferenceSession> {
  // Avoid reloading the same model session
  if (sessions.has(modelType)) return sessions.get(modelType)!;
  const config = MODEL_CONFIG[modelType];
  try {
    const modelPath = findModelPath(config.fileName);
    const candidates = candidateExecutionProviders();

    // Try each candidate EP ALONE, in order, so we can report which one truly
    // initialized. Passing ["dml","cpu"] as one list would let ORT silently use
    // CPU when DirectML fails to register — you'd never know the GPU was skipped.
    // ORT always keeps an internal CPU fallback for individual ops a GPU EP
    // can't run, so requesting a single GPU EP here is safe.
    let session: ort.InferenceSession | undefined;
    let activeEp = "";
    let lastErr: unknown;
    for (const ep of candidates) {
      try {
        session = await ort.InferenceSession.create(modelPath, {
          executionProviders: [ep] as ort.InferenceSession.ExecutionProviderConfig[],
        });
        activeEp = ep;
        break;
      } catch (epErr) {
        lastErr = epErr;
        console.warn(
          `[${config.logLabel}] EP "${ep}" failed to initialize, trying next:`,
          epErr instanceof Error ? epErr.message : epErr,
        );
      }
    }
    if (!session) {
      throw lastErr instanceof Error
        ? lastErr
        : new Error("No execution provider could be initialized");
    }
    sessions.set(modelType, session);

    // Only log model info once per process for each type
    if (!initializedModels.has(modelType)) {
      console.log(`[${config.logLabel}] Model loaded from:`, modelPath);
      console.log(
        `[${config.logLabel}] Active execution provider: ${activeEp}` +
          (activeEp === "cpu" ? " (CPU)" : " (GPU-accelerated)"),
      );
      console.log(`[${config.logLabel}] Input names:`, session.inputNames);
      console.log(`[${config.logLabel}] Output names:`, session.outputNames);
      initializedModels.add(modelType);
    }

    return session;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    throw new ModelError(
      `Failed to load ${config.logLabel} model: ${message}`,
      { modelType },
      error,
    );
  }
}

// Returns the model's correct input tensor name or first available input
export function getInputName(
  session: ort.InferenceSession,
  modelType: DetectionModel,
): string {
  const { inputName } = MODEL_CONFIG[modelType];
  const found = session.inputNames.find(name => name === inputName) ?? session.inputNames[0];
  if (!found) throw new ModelError("Model has no input names", { modelType });
  return found;
}

// Output typing: rfdetr returns boxes/logits/masks, yolo/security returns output
export function getOutputNames(
  session: ort.InferenceSession,
  modelType: "rfdetr",
): {
  readonly boxes: string;
  readonly logits: string;
  readonly masks?: string;
};
export function getOutputNames(
  session: ort.InferenceSession,
  modelType: "yolo" | "security" | "weapon",
): {
  readonly output: string;
};
export function getOutputNames(
  session: ort.InferenceSession,
  modelType: DetectionModel,
):
  | {
      readonly boxes: string;
      readonly logits: string;
      readonly masks?: string;
    }
  | {
      readonly output: string;
    } {
  if (modelType === "rfdetr") {
    let boxes: string | undefined, logits: string | undefined, masks: string | undefined;

    // Try to quickly identify outputs by shape heuristics
    for (const metadata of session.outputMetadata) {
      const shape = "shape" in metadata ? metadata.shape : undefined;
      if (!Array.isArray(shape)) continue;

      if (shape.length === 4) {
        masks = metadata.name;
      } else if (shape.length === 3) {
        const lastDim = Number(shape[2]);
        if (lastDim === 4) boxes = metadata.name;
        if (lastDim > 4) logits = metadata.name;
      }
    }

    // Fallbacks based on naming and order
    boxes ??= session.outputNames.find(name => name.toLowerCase().includes("box")) ?? session.outputNames[0];
    logits ??= session.outputNames.find(name => /logit|label/i.test(name)) ?? session.outputNames[1];
    masks ??= session.outputNames.find(name => name.toLowerCase().includes("mask")) ?? session.outputNames[2];

    if (!boxes || !logits) {
      throw new ModelError("Model must expose both box and logit outputs", {
        modelType,
        availableOutputs: session.outputNames,
      });
    }
    return { boxes, logits, masks };
  }

  // For yolo / security models, output tensor is usually named and always required
  const output =
    session.outputNames.find(
      name => name === MODEL_CONFIG.yolo.outputNames.output,
    ) ?? session.outputNames[0];

  if (!output) {
    throw new ModelError("Model must expose a YOLO output tensor", {
      modelType,
      availableOutputs: session.outputNames,
    });
  }
  return { output };
}
