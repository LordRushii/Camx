import { YOLO_COCO_CLASSES } from "@/lib/coco";
import { runOrchestrator } from "../../detection/orchestrator.js";

/** COCO classes relevant to CCTV crime / threat triage. */
const SECURITY_CLASS_NAMES = new Set([
  "person",
  "bicycle",
  "car",
  "motorcycle",
  "bus",
  "train",
  "truck",
  "boat",
  "backpack",
  "handbag",
  "suitcase",
  "baseball bat",
  "knife",
  "scissors",
]);

/** Higher priority = more important for threat triage. */
const CLASS_PRIORITY: Record<string, number> = {
  knife: 100,
  scissors: 90,
  "baseball bat": 85,
  person: 70,
  motorcycle: 55,
  truck: 50,
  bus: 50,
  car: 45,
  bicycle: 40,
  boat: 35,
  train: 30,
  backpack: 25,
  handbag: 20,
  suitcase: 20,
};

export interface YoloDetectionLabel {
  readonly classId: number;
  readonly className: string;
  readonly confidence: number;
}

export interface FrameSelectionResult {
  readonly keep: boolean;
  readonly reason: string;
  readonly detections: readonly YoloDetectionLabel[];
  readonly score: number;
}

/**
 * Run the local YOLO11x ("security") detector and decide whether a candidate
 * frame is worth sending to the cloud VLM.
 *
 * Standard COCO YOLO does not include firearms; knives and person/vehicle
 * presence are the local triage signal. Grok vision then describes weapons
 * and behaviour on the retained frames.
 */
export async function scoreFrameForSecurity(
  imageBuffer: Buffer,
  options?: {
    readonly minConfidence?: number;
  },
): Promise<FrameSelectionResult> {
  const minConfidence = options?.minConfidence ?? 0.3;
  const results = await runOrchestrator(imageBuffer, ["security"]);
  const detections = (results[0]?.detections ?? [])
    .filter((d) => d.confidence >= minConfidence)
    .map((d) => {
      const className =
        YOLO_COCO_CLASSES[d.class] ?? `class_${d.class}`;
      return {
        classId: d.class,
        className,
        confidence: d.confidence,
      } satisfies YoloDetectionLabel;
    })
    .filter((d) => SECURITY_CLASS_NAMES.has(d.className));

  if (detections.length === 0) {
    return {
      keep: false,
      reason: "no_security_objects",
      detections: [],
      score: 0,
    };
  }

  let score = 0;
  for (const d of detections) {
    const priority = CLASS_PRIORITY[d.className] ?? 10;
    score += priority * d.confidence;
  }

  const labels = [...new Set(detections.map((d) => d.className))].join(", ");
  return {
    keep: true,
    reason: `yolo11x: ${labels}`,
    detections,
    score,
  };
}

/**
 * Run the local specialized weapon detector and decide whether a candidate
 * frame is worth sending to the cloud VLM.
 */
export async function scoreFrameForWeapon(
  imageBuffer: Buffer,
  options?: {
    readonly minConfidence?: number;
  },
): Promise<FrameSelectionResult> {
  const minConfidence = options?.minConfidence ?? 0.25;
  try {
    const results = await runOrchestrator(imageBuffer, ["weapon"]);
    const detections = (results[0]?.detections ?? [])
      .filter((d) => d.confidence >= minConfidence)
      .map((d) => {
        const className = d.class === 0 ? "handgun" : d.class === 1 ? "knife" : `weapon_class_${d.class}`;
        return {
          classId: d.class,
          className,
          confidence: d.confidence,
        } satisfies YoloDetectionLabel;
      });

    if (detections.length === 0) {
      return {
        keep: false,
        reason: "no_weapon_objects",
        detections: [],
        score: 0,
      };
    }

    let score = 0;
    for (const d of detections) {
      score += 100 * d.confidence; // High weight for weapons
    }

    const labels = [...new Set(detections.map((d) => d.className))].join(", ");
    return {
      keep: true,
      reason: `weapon-yolov8: ${labels}`,
      detections,
      score,
    };
  } catch (error) {
    console.warn("[yolo-frame-selector] weapon model failed to run, fallback gracefully:", error);
    return {
      keep: false,
      reason: "weapon_model_failed",
      detections: [],
      score: 0,
    };
  }
}

export interface MultiSelectionResult {
  readonly keep: boolean;
  readonly score: number;
  readonly signature: string;
}

/**
 * Parallelized scoring that runs both standard security and specialized weapon models
 * in a single orchestrator call to share preprocessing and run concurrently.
 */
export async function scoreFrameForSecurityAndWeapon(
  imageBuffer: Buffer,
  options?: {
    readonly minSecurityConfidence?: number;
    readonly minWeaponConfidence?: number;
  }
): Promise<MultiSelectionResult> {
  const minSecurityConf = options?.minSecurityConfidence ?? 0.3;
  const minWeaponConf = options?.minWeaponConfidence ?? 0.25;

  try {
    const results = await runOrchestrator(imageBuffer, ["security", "weapon"]);
    const securityResult = results.find(r => r.modelType === "security");
    const weaponResult = results.find(r => r.modelType === "weapon");

    const securityDetections = (securityResult?.detections ?? [])
      .filter((d) => d.confidence >= minSecurityConf)
      .map((d) => {
        const className = YOLO_COCO_CLASSES[d.class] ?? `class_${d.class}`;
        return {
          classId: d.class,
          className,
          confidence: d.confidence,
          x1: d.x1,
          y1: d.y1,
          x2: d.x2,
          y2: d.y2,
        };
      })
      .filter((d) => SECURITY_CLASS_NAMES.has(d.className));

    const weaponDetections = (weaponResult?.detections ?? [])
      .filter((d) => d.confidence >= minWeaponConf)
      .map((d) => {
        const className = d.class === 0 ? "handgun" : d.class === 1 ? "knife" : `weapon_class_${d.class}`;
        return {
          classId: d.class,
          className,
          confidence: d.confidence,
        };
      });

    // Check for potential physical interaction / fight gestures (2+ people close or overlapping)
    let hasFightGesture = false;
    const people = securityDetections.filter(d => d.className === "person");
    if (people.length >= 2) {
      const width = securityResult?.frame.width ?? 640;
      const height = securityResult?.frame.height ?? 640;
      const maxDim = Math.max(width, height) || 1;

      for (let i = 0; i < people.length; i++) {
        for (let j = i + 1; j < people.length; j++) {
          const pA = people[i]!;
          const pB = people[j]!;

          // Check direct bounding box overlap
          const xOverlap = Math.max(0, Math.min(pA.x2, pB.x2) - Math.max(pA.x1, pB.x1));
          const yOverlap = Math.max(0, Math.min(pA.y2, pB.y2) - Math.max(pA.y1, pB.y1));
          const hasOverlap = xOverlap > 0 && yOverlap > 0;

          // Check center-to-center distance
          const cxA = (pA.x1 + pA.x2) / 2;
          const cyA = (pA.y1 + pA.y2) / 2;
          const cxB = (pB.x1 + pB.x2) / 2;
          const cyB = (pB.y1 + pB.y2) / 2;
          const dist = Math.sqrt((cxA - cxB) ** 2 + (cyA - cyB) ** 2);
          const relativeDist = dist / maxDim;

          if (hasOverlap || relativeDist < 0.3) {
            hasFightGesture = true;
            break;
          }
        }
        if (hasFightGesture) break;
      }
    }

    const keepSecurity = securityDetections.length > 0;
    const keepWeapon = weaponDetections.length > 0;

    if (!keepSecurity && !keepWeapon) {
      return {
        keep: false,
        score: 0,
        signature: "",
      };
    }

    let securityScore = 0;
    for (const d of securityDetections) {
      const priority = CLASS_PRIORITY[d.className] ?? 10;
      securityScore += priority * d.confidence;
    }
    if (hasFightGesture) {
      securityScore += 80;
    }

    let weaponScore = 0;
    for (const d of weaponDetections) {
      weaponScore += 100 * d.confidence;
    }

    const score = Math.max(securityScore, weaponScore);
    const signatureParts = [
      ...securityDetections.map((d) => d.className),
      ...weaponDetections.map((d) => d.className),
    ];
    if (hasFightGesture) {
      signatureParts.push("fight_gesture");
    }
    const signature = signatureParts.join("|");

    return {
      keep: true,
      score,
      signature,
    };
  } catch (error) {
    console.warn("[yolo-frame-selector] multi model scoring failed, fallback gracefully:", error);
    return {
      keep: false,
      score: 0,
      signature: "",
    };
  }
}


/**
 * Thin a dense list of candidate indices so we keep high-value frames and
 * avoid sending near-duplicates (same objects a second later).
 */
export function thinSelectedIndices(input: {
  readonly candidates: readonly {
    readonly index: number;
    readonly score: number;
    readonly signature: string;
  }[];
  readonly minGapMs: number;
  readonly sampleFps: number;
  readonly maxFrames?: number;
}): readonly number[] {
  const maxFrames = input.maxFrames ?? 48;
  const gapFrames = Math.max(
    1,
    Math.round((input.minGapMs / 1000) * input.sampleFps),
  );

  const sorted = [...input.candidates].sort((a, b) => b.score - a.score);
  const kept: number[] = [];
  const keptSet = new Set<number>();

  for (const candidate of sorted) {
    if (kept.length >= maxFrames) break;
    const tooClose = kept.some(
      (k) => Math.abs(k - candidate.index) < gapFrames,
    );
    if (tooClose) {
      // Allow if signature is meaningfully different (new object set)
      const near = kept.find((k) => Math.abs(k - candidate.index) < gapFrames);
      const nearCandidate = input.candidates.find((c) => c.index === near);
      if (nearCandidate && nearCandidate.signature === candidate.signature) {
        continue;
      }
      if (tooClose && Math.abs((near ?? 0) - candidate.index) < Math.ceil(gapFrames / 2)) {
        continue;
      }
    }
    kept.push(candidate.index);
    keptSet.add(candidate.index);
  }

  // Always include first and last security hit if present for timeline anchors
  if (input.candidates.length > 0) {
    const first = input.candidates.reduce((a, b) =>
      a.index < b.index ? a : b,
    );
    const last = input.candidates.reduce((a, b) =>
      a.index > b.index ? a : b,
    );
    if (!keptSet.has(first.index) && kept.length < maxFrames) {
      kept.push(first.index);
      keptSet.add(first.index);
    }
    if (!keptSet.has(last.index) && kept.length < maxFrames) {
      kept.push(last.index);
    }
  }

  return [...kept].sort((a, b) => a - b);
}

export function detectionSignature(
  detections: readonly YoloDetectionLabel[],
): string {
  return [...new Set(detections.map((d) => d.className))].sort().join("|");
}
