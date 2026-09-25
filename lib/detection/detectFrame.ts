import { type InferenceSession, type Tensor } from "onnxruntime-web";
import { type Detection } from "@/lib/draw";
import { rgbaToInputTensor, postprocessYolo } from "@/lib/detection/yolo";

const INPUT_SIZE = 640;

// Reused offscreen canvas to avoid per-frame allocation.
let scratchCanvas: HTMLCanvasElement | null = null;
let scratchCtx: CanvasRenderingContext2D | null = null;

function getScratchContext(): CanvasRenderingContext2D {
  if (!scratchCanvas) {
    scratchCanvas = document.createElement("canvas");
    scratchCanvas.width = INPUT_SIZE;
    scratchCanvas.height = INPUT_SIZE;
  }
  if (!scratchCtx) {
    scratchCtx = scratchCanvas.getContext("2d", { willReadFrequently: true });
    if (!scratchCtx) throw new Error("Failed to acquire 2D canvas context for detection");
  }
  return scratchCtx;
}

/**
 * Run YOLO11n inference on the current video frame entirely in the browser.
 * Draws the frame stretched (fit:"fill") to a 640x640 offscreen canvas to match
 * the server preprocess, then runs the ONNX session and post-processes to
 * Detections scaled back to the video's natural dimensions.
 */
export async function detectVideoFrame(
  video: HTMLVideoElement,
  session: InferenceSession,
): Promise<{ detections: Detection[]; latencyMs: number }> {
  const start = performance.now();

  const origW = video.videoWidth;
  const origH = video.videoHeight;

  const ctx = getScratchContext();
  // Stretch to 640x640 (fit:"fill"), matching the server preprocess.
  ctx.drawImage(video, 0, 0, INPUT_SIZE, INPUT_SIZE);
  const imageData = ctx.getImageData(0, 0, INPUT_SIZE, INPUT_SIZE);

  const inputData = rgbaToInputTensor(imageData.data, INPUT_SIZE);

  const ort = await import("onnxruntime-web");
  const inputTensor = new ort.Tensor("float32", inputData, [1, 3, INPUT_SIZE, INPUT_SIZE]);

  const inputName = session.inputNames[0];
  const feeds: Record<string, Tensor> = { [inputName]: inputTensor };
  const results = await session.run(feeds);

  const outputTensor = results["output0"] ?? results[session.outputNames[0]];
  const detections = postprocessYolo(
    outputTensor.data as Float32Array,
    outputTensor.dims,
    origW,
    origH,
    { inputSize: INPUT_SIZE },
  );

  const latencyMs = performance.now() - start;
  return { detections, latencyMs };
}
