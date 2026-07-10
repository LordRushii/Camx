import {
  DEFAULT_MODEL_CONFIGURATION,
  parseModelConfigurationJson,
} from "@/app/lib/model-configuration-shared";
import type { VideoAnalysisProviderConfig } from "@/types/video-analysis";

export function defaultProviderConfig(): VideoAnalysisProviderConfig {
  return {
    provider: "lmstudio",
    baseUrl:
      process.env.LMSTUDIO_BASE_URL ??
      process.env.NEXT_PUBLIC_LMSTUDIO_URL ??
      DEFAULT_MODEL_CONFIGURATION.baseUrl,
    apiToken:
      process.env.VIDEO_WATCH_SUMMARY_MODEL_KEY ??
      process.env.LMSTUDIO_API_TOKEN ??
      process.env.LM_API_TOKEN ??
      "",
    frameModelKey:
      process.env.VIDEO_WATCH_FRAME_MODEL_KEY ??
      process.env.LMSTUDIO_FRAME_MODEL ??
      DEFAULT_MODEL_CONFIGURATION.frameAnalysisModelKey,
    summaryModelKey:
      process.env.LMSTUDIO_SUMMARY_MODEL ??
      DEFAULT_MODEL_CONFIGURATION.summaryChatModelKey,
    embeddingModelKey:
      process.env.LM_EMBEDDING_MODEL_KEY ??
      process.env.LMSTUDIO_EMBEDDING_MODEL ??
      DEFAULT_MODEL_CONFIGURATION.embeddingModelKey,
  };
}

export function parseProviderConfigFromFormData(
  raw: string | null,
): VideoAnalysisProviderConfig {
  if (typeof raw !== "string" || raw.trim() === "") {
    return defaultProviderConfig();
  }

  const config = parseModelConfigurationJson(raw);
  return {
    provider: "lmstudio",
    baseUrl:
      config.baseUrl ||
      process.env.LMSTUDIO_BASE_URL ||
      process.env.NEXT_PUBLIC_LMSTUDIO_URL ||
      DEFAULT_MODEL_CONFIGURATION.baseUrl,
    apiToken:
      config.apiToken && config.apiToken.trim() !== ""
        ? config.apiToken.trim()
        : (process.env.VIDEO_WATCH_SUMMARY_MODEL_KEY ||
           process.env.LMSTUDIO_API_TOKEN ||
           process.env.LM_API_TOKEN ||
           ""),
    frameModelKey:
      config.frameAnalysisModelKey ||
      process.env.VIDEO_WATCH_FRAME_MODEL_KEY ||
      process.env.LMSTUDIO_FRAME_MODEL ||
      DEFAULT_MODEL_CONFIGURATION.frameAnalysisModelKey,
    summaryModelKey:
      config.summaryChatModelKey ||
      process.env.LMSTUDIO_SUMMARY_MODEL ||
      DEFAULT_MODEL_CONFIGURATION.summaryChatModelKey,
    embeddingModelKey:
      process.env.LM_EMBEDDING_MODEL_KEY ??
      config.embeddingModelKey ??
      process.env.LMSTUDIO_EMBEDDING_MODEL ??
      DEFAULT_MODEL_CONFIGURATION.embeddingModelKey,
  };
}
