import * as ort from "onnxruntime-node";
import { type DetectionModel, getSession, getInputName, getOutputNames } from "./model.js";
import { preprocess, type ImageInfo } from "./preprocess.js";
import { postprocessRfDetr, postprocessYolo, type Detection } from "./postprocess.js";

export interface OrchestratorResult {
  readonly modelType: DetectionModel;
  readonly detections: readonly Detection[];
  readonly frame: {
    readonly width: number;
    readonly height: number;
  };
}

export async function runOrchestrator(
  imageBuffer: Buffer,
  modelTypes: DetectionModel[]
): Promise<OrchestratorResult[]> {
  // Preprocess cache stores promises so that concurrent queries for the same dimensions/normalization
  // resolve using the same in-flight preprocessing task.
  const preprocessCache = new Map<string, Promise<{ tensor: ort.Tensor; image: ImageInfo }>>();

  const getPreprocessed = (modelType: DetectionModel) => {
    // yolo and security share the exact same 640x640 dimensions and /255 normalization.
    // rfdetr uses 312x312 dimensions and custom MEAN/STD normalization.
    const cacheKey = modelType === "rfdetr" ? "rfdetr" : "yolo_security";

    if (!preprocessCache.has(cacheKey)) {
      const preprocessModelType = modelType === "rfdetr" ? "rfdetr" : "yolo";
      const promise = preprocess(imageBuffer, preprocessModelType);
      preprocessCache.set(cacheKey, promise);
    }
    return preprocessCache.get(cacheKey)!;
  };

  return await Promise.all(
    modelTypes.map(async (modelType): Promise<OrchestratorResult> => {
      // 1. Get cached/shared preprocessed tensor & image metadata
      const { tensor, image } = await getPreprocessed(modelType);

      // 2. Load model session and run inference
      const session = await getSession(modelType);
      const inputName = getInputName(session, modelType);
      const runResults = await session.run({ [inputName]: tensor });

      // 3. Postprocess outputs
      let detections: readonly Detection[];
      if (modelType === "rfdetr") {
        const outputNames = getOutputNames(session, "rfdetr");
        const predBoxes = runResults[outputNames.boxes]!;
        const logits = runResults[outputNames.logits]!;
        const masks = outputNames.masks ? runResults[outputNames.masks] : undefined;
        detections = postprocessRfDetr(predBoxes, logits, image, masks);
      } else {
        const outputNames = getOutputNames(session, modelType);
        const output = runResults[outputNames.output]!;
        detections = postprocessYolo(output, image);
      }

      return {
        modelType,
        detections,
        frame: {
          width: image.origWidth,
          height: image.origHeight,
        },
      };
    })
  );
}
