import { MODEL_CONFIGURATION_STORAGE_KEY } from "@/app/lib/model-configuration-shared";
import type {
  VideoAnalysisChatMessage,
  VideoAnalysisChatResponse,
  VideoAnalysisError,
  VideoAnalysisJob,
  VideoAnalysisJobResponse,
  VideoAnalysisTimeRangeInput,
} from "@/types/video-analysis";

export type VideoAnalysisUiPhase =
  | "idle"
  | "checking_cache"
  | "uploading"
  | VideoAnalysisJob["status"];

function parseError(json: unknown): VideoAnalysisError {
  const value = json as Record<string, unknown>;
  if (
    value?.ok === false &&
    typeof value.errorCode === "string" &&
    typeof value.message === "string"
  ) {
    return value as unknown as VideoAnalysisError;
  }
  // Server returned an error-shaped response but not in our exact format —
  // synthesize a conforming VideoAnalysisError so the UI always gets a
  // displayable message instead of throwing.
  const message =
    typeof value?.message === "string"
      ? value.message
      : typeof value?.error === "string"
        ? value.error
        : "An unknown error occurred. The worker may be unreachable.";
  return {
    ok: false,
    errorCode: typeof value?.errorCode === "string" ? value.errorCode : "INTERNAL_ERROR",
    message,
  } as unknown as VideoAnalysisError;
}

export function parseVideoAnalysisJobResponse(
  json: unknown,
): VideoAnalysisJobResponse {
  const value = json as Record<string, unknown>;
  if (value?.ok === false) {
    return parseError(json);
  }
  if (
    value?.ok === true &&
    typeof value.jobId === "string" &&
    typeof value.fingerprint === "string" &&
    typeof value.sourceFileName === "string" &&
    typeof value.status === "string"
  ) {
    return value as unknown as VideoAnalysisJob;
  }
  // Response didn't match expected job shape — return a synthetic error
  // instead of crashing the UI with an unhandled exception.
  return parseError({ ok: false, errorCode: "INVALID_RESPONSE", message: "Received an unexpected response from the server. Please try again." });
}

export function parseVideoAnalysisChatResponse(
  json: unknown,
): VideoAnalysisChatResponse {
  const value = json as Record<string, unknown>;
  if (value?.ok === false) {
    return parseError(json);
  }
  if (
    value?.ok === true &&
    typeof value.answer === "string" &&
    typeof value.modelKey === "string"
  ) {
    return value as unknown as VideoAnalysisChatResponse;
  }
  throw new Error("Invalid video analysis chat response");
}

export async function createVideoAnalysisJob(
  video: File,
  clientFingerprint?: string,
  options?: { readonly forceRefresh?: boolean },
): Promise<VideoAnalysisJobResponse> {
  const formData = new FormData();
  formData.append("video", video);
  if (clientFingerprint) {
    formData.append("clientFingerprint", clientFingerprint);
  }
  if (options?.forceRefresh) {
    formData.append("forceRefresh", "true");
  }
  if (typeof window !== "undefined") {
    const raw = window.localStorage.getItem(MODEL_CONFIGURATION_STORAGE_KEY);
    if (raw) {
      formData.append("model_config", raw);
    }
  }

  const response = await fetch("/api/video-analysis/jobs", {
    method: "POST",
    body: formData,
  });
  return parseVideoAnalysisJobResponse(await response.json());
}

export async function fetchVideoAnalysisJob(
  jobId: string,
): Promise<VideoAnalysisJobResponse> {
  const response = await fetch(`/api/video-analysis/jobs/${jobId}`, {
    method: "GET",
    cache: "no-store",
  });
  return parseVideoAnalysisJobResponse(await response.json());
}

export async function clearVideoAnalysisJob(
  jobId: string,
): Promise<{ ok: true; fingerprint: string } | VideoAnalysisError> {
  const response = await fetch(`/api/video-analysis/jobs/${jobId}`, {
    method: "DELETE",
  });
  const json = await response.json();
  if (json?.ok === true && typeof json.fingerprint === "string") {
    return json as { ok: true; fingerprint: string };
  }
  return parseError(json);
}

export async function askVideoAnalysisQuestion(input: {
  readonly jobId: string;
  readonly question: string;
  readonly messages?: readonly VideoAnalysisChatMessage[];
  readonly timeRange?: VideoAnalysisTimeRangeInput;
}): Promise<VideoAnalysisChatResponse> {
  const response = await fetch(`/api/video-analysis/jobs/${input.jobId}/chat`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      question: input.question,
      messages: input.messages ?? [],
      timeRange: input.timeRange,
    }),
  });
  return parseVideoAnalysisChatResponse(await response.json());
}
