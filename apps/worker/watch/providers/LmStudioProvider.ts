import { LMStudioClient } from "@lmstudio/sdk";
import type { WatchProvider } from "./types.js";
import {
  WATCH_SYSTEM_PROMPT,
  WATCH_USER_MESSAGE,
  WATCH_VERIFICATION_SYSTEM_PROMPT,
  watchVerificationUserMessage,
} from "../prompts.js";
import {
  WATCH_RESPONSE_SCHEMA,
  WATCH_HARM_VERIFICATION_SCHEMA,
  parseWatchModelJson,
  parseWatchHarmVerificationJson,
  type WatchResult,
} from "../schema.js";

export class LmStudioProvider implements WatchProvider {
  private client: LMStudioClient;
  private watchModelKey: string;

  constructor(config?: { baseUrl?: string; watchModelKey?: string; apiToken?: string }) {
    const baseUrl = config?.baseUrl || process.env.LMSTUDIO_BASE_URL || "ws://127.0.0.1:1234";
    this.watchModelKey = config?.watchModelKey || process.env.LMSTUDIO_WATCH_MODEL || "lfm-2.5-ucf-1.6b";

    const apiToken = config?.apiToken || process.env.LM_API_TOKEN;
    if (apiToken && apiToken.trim() !== "") {
      process.env.LM_API_TOKEN = apiToken.trim();
    }

    let normalizedUrl = baseUrl.trim();
    if (/^https:\/\//i.test(normalizedUrl)) {
      normalizedUrl = normalizedUrl.replace(/^https:\/\//i, "wss://");
    } else if (/^http:\/\//i.test(normalizedUrl)) {
      normalizedUrl = normalizedUrl.replace(/^http:\/\//i, "ws://");
    }

    this.client = new LMStudioClient({
      baseUrl: normalizedUrl,
      verboseErrorMessages: false,
    });
  }

  async analyzeFrame(
    base64Image: string,
    mimeType: string
  ): Promise<{ result: WatchResult; rawText: string; modelKey: string }> {
    const model = await this.client.llm.model(this.watchModelKey);
    const ext = mimeType.split("/")[1] || "png";
    const image = await this.client.files.prepareImageBase64(`frame.${ext}`, base64Image);

    const response = await model.respond(
      [
        { role: "system", content: WATCH_SYSTEM_PROMPT },
        {
          role: "user",
          content: WATCH_USER_MESSAGE,
          images: [image],
        },
      ],
      {
        maxTokens: 420,
        temperature: 0,
        structured: {
          type: "json",
          jsonSchema: WATCH_RESPONSE_SCHEMA as unknown as Record<string, unknown>,
        },
      }
    );

    const rawText = response?.content?.trim();
    if (!rawText) {
      throw new Error("LM Studio returned empty response");
    }

    const parsed = JSON.parse(rawText);
    const result = parseWatchModelJson(parsed);

    return {
      result,
      rawText,
      modelKey: this.watchModelKey,
    };
  }

  async verifyHarm(
    base64Image: string,
    mimeType: string,
    description: string
  ): Promise<{
    matchesPrompt: boolean;
    reason: string;
    rawText: string;
    modelKey: string;
    latencyMs: number;
  }> {
    const startTime = performance.now();
    const model = await this.client.llm.model(this.watchModelKey);
    const ext = mimeType.split("/")[1] || "png";
    const image = await this.client.files.prepareImageBase64(`frame.${ext}`, base64Image);

    const response = await model.respond(
      [
        { role: "system", content: WATCH_VERIFICATION_SYSTEM_PROMPT },
        {
          role: "user",
          content: watchVerificationUserMessage(description),
          images: [image],
        },
      ],
      {
        maxTokens: 280,
        temperature: 0,
        structured: {
          type: "json",
          jsonSchema: WATCH_HARM_VERIFICATION_SCHEMA as unknown as Record<string, unknown>,
        },
      }
    );

    const rawText = response?.content?.trim();
    if (!rawText) {
      throw new Error("LM Studio returned empty verification response");
    }

    const parsed = JSON.parse(rawText);
    const result = parseWatchHarmVerificationJson(parsed);
    const latencyMs = performance.now() - startTime;

    return {
      matchesPrompt: result.matchesPrompt,
      reason: result.reason,
      rawText,
      modelKey: this.watchModelKey,
      latencyMs,
    };
  }
}
