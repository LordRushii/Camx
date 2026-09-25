/**
 * Local ONNX "gate" — the free trigger that runs on every frame before any LLM
 * call. It uses the existing detection orchestrator (YOLO + the purpose-built
 * weapon model) to decide whether the scene contains anything worth escalating
 * to the vision model: a weapon, or a person combined with scene motion.
 *
 * Idle footage (no people, no weapons, no motion) never opens an event, so the
 * expensive cloud model is only called when something actually happens.
 */
import { runOrchestrator } from "../detection/orchestrator.js";
import type { DetectionModel } from "../detection/model.js";
import type { MotionResult } from "./motion.js";

// COCO class ids emitted by the yolo11 model that we treat as relevant.
const COCO_PERSON = 0;
const COCO_WEAPONISH = new Map<number, string>([
  [34, "baseball bat"],
  [43, "knife"],
  [76, "scissors"],
]);

export interface GateResult {
  readonly personPresent: boolean;
  readonly weaponPresent: boolean;
  /** Short human-readable list of what the local models saw, for LLM context. */
  readonly summary: string;
}

export interface GateDecision extends GateResult {
  readonly triggered: boolean;
  readonly reasons: string[];
}

function gateModels(): DetectionModel[] {
  const raw = (process.env.WATCH_GATE_MODELS || "yolo,weapon")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean) as DetectionModel[];
  const valid: DetectionModel[] = ["rfdetr", "yolo", "security", "weapon"];
  const filtered = raw.filter((m) => valid.includes(m));
  return filtered.length ? filtered : ["yolo"];
}

function num(envKey: string, fallback: number): number {
  const v = Number(process.env[envKey]);
  return Number.isFinite(v) && v > 0 && v <= 1 ? v : fallback;
}

/**
 * Run the local detector(s) on a single frame and summarize object presence.
 * Failures in any single model are swallowed (the gate must never crash the
 * loop); a model that errors simply contributes no detections.
 */
export async function runGate(frameBuffer: Buffer): Promise<GateResult> {
  const models = gateModels();
  const minConf = num("WATCH_GATE_MIN_CONF", 0.35);
  const weaponMinConf = num("WATCH_WEAPON_MIN_CONF", 0.4);

  let personPresent = false;
  let weaponPresent = false;
  const seen: string[] = [];

  const results = await Promise.allSettled(
    models.map((m) => runOrchestrator(frameBuffer, [m])),
  );

  results.forEach((settled, i) => {
    if (settled.status !== "fulfilled") {
      console.warn(
        `[WATCH GATE] model "${models[i]}" failed:`,
        settled.reason instanceof Error ? settled.reason.message : settled.reason,
      );
      return;
    }
    const [res] = settled.value;
    if (!res) return;

    if (models[i] === "weapon") {
      // Purpose-built weapon detector: any confident detection = weapon.
      const hit = res.detections.find((d) => d.confidence >= weaponMinConf);
      if (hit) {
        weaponPresent = true;
        seen.push("weapon");
      }
      return;
    }

    // COCO models (yolo / security): inspect specific class ids.
    for (const d of res.detections) {
      if (d.confidence < minConf) continue;
      if (d.class === COCO_PERSON) {
        personPresent = true;
      } else if (COCO_WEAPONISH.has(d.class)) {
        weaponPresent = true;
        seen.push(COCO_WEAPONISH.get(d.class)!);
      }
    }
  });

  if (personPresent) seen.unshift("person");

  const summary = seen.length
    ? `local detector saw: ${[...new Set(seen)].join(", ")}`
    : "local detector saw no people or weapons";

  return { personPresent, weaponPresent, summary };
}

/**
 * Combine local detections with motion to decide whether to open an event.
 * Policy: a weapon always triggers; a person triggers only when the scene is
 * also moving (a still person resting is not an event).
 */
export function decideTrigger(
  gate: GateResult,
  motion: MotionResult,
): GateDecision {
  const reasons: string[] = [];
  if (gate.weaponPresent) reasons.push("weapon-detected");
  if (gate.personPresent && motion.moved) reasons.push("person+motion");

  return {
    ...gate,
    triggered: reasons.length > 0,
    reasons,
  };
}
