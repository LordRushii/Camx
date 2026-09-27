import type { WatchProvider, BurstFrame } from "./types.js";
import { cleanJsonResponse } from "./shared.js";
import {
  WATCH_SYSTEM_PROMPT,
  WATCH_USER_MESSAGE,
  WATCH_VERIFICATION_SYSTEM_PROMPT,
  watchVerificationUserMessage,
  WATCH_BURST_SYSTEM_PROMPT,
  watchBurstUserMessage,
} from "../prompts.js";
import {
  parseWatchModelJson,
  parseWatchHarmVerificationJson,
  type WatchResult,
} from "../schema.js";

const NVIDIA_BASE_URL = "https://integrate.api.nvidia.com/v1";
const DEFAULT_NVIDIA_MODEL = "meta/llama-3.2-90b-vision-instruct";

type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string | ContentPart[];
}

/**
 * NvidiaProvider — NVIDIA NIM vision via the OpenAI-compatible chat
 * completions endpoint (Llama 3.2 90B Vision). Free-tier credits are
 * LIFETIME, not daily, so the live chain treats it as overflow and spends
 * it last (see docs/live-detection-plan/03-FREE-TIER-BUDGET.md §2/§5).
 */
export class NvidiaProvider implements WatchProvider {
  private readonly apiKey: string;
  private readonly modelKey: string;

  constructor(config?: { apiKey?: string; watchModelKey?: string }) {
    const apiKey = (config?.apiKey || process.env.NVIDIA_API_KEY || "").trim();
    if (!apiKey) {
      throw new Error("NVIDIA_API_KEY is not set");
    }
    this.apiKey = apiKey;
    this.modelKey =
      config?.watchModelKey || process.env.NVIDIA_WATCH_MODEL || DEFAULT_NVIDIA_MODEL;
  }

  private async chat(messages: ChatMessage[], maxTokens: number): Promise<string> {
    const response = await fetch(`${NVIDIA_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
        Accept: "application/json",
      },
      body: JSON.stringify({
        model: this.modelKey,
        messages,
        temperature: 0,
        max_tokens: maxTokens,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`NVIDIA API error (HTTP ${response.status}): ${errText}`);
    }

    const resJson = (await response.json()) as {
      choices?: { message?: { content?: string | null } }[];
    };
    const text = resJson.choices?.[0]?.message?.content;
    if (!text || text.trim() === "") {
      throw new Error(`NVIDIA returned an empty response: ${JSON.stringify(resJson)}`);
    }
    return text;
  }

  async analyzeFrame(
    base64Image: string,
    mimeType: string
  ): Promise<{ result: WatchResult; rawText: string; modelKey: string }> {
    const dataUrl = `data:${mimeType};base64,${base64Image}`;
    const rawText = await this.chat(
      [
        { role: "system", content: WATCH_SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            { type: "text", text: WATCH_USER_MESSAGE },
            { type: "image_url", image_url: { url: dataUrl } },
          ],
        },
      ],
      420
    );

    const result = parseWatchModelJson(JSON.parse(cleanJsonResponse(rawText)));
    return { result, rawText, modelKey: this.modelKey };
  }

  async analyzeBurst(
    frames: BurstFrame[],
    context: string
  ): Promise<{ result: WatchResult; rawText: string; modelKey: string }> {
    const imageParts: ContentPart[] = frames.map((f) => ({
      type: "image_url",
      image_url: { url: `data:${f.mimeType};base64,${f.base64}` },
    }));
    const rawText = await this.chat(
      [
        { role: "system", content: WATCH_BURST_SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            { type: "text", text: watchBurstUserMessage(context, frames.length) },
            ...imageParts,
          ],
        },
      ],
      560
    );

    const result = parseWatchModelJson(JSON.parse(cleanJsonResponse(rawText)));
    return { result, rawText, modelKey: this.modelKey };
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
    const dataUrl = `data:${mimeType};base64,${base64Image}`;
    const rawText = await this.chat(
      [
        { role: "system", content: WATCH_VERIFICATION_SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            { type: "text", text: watchVerificationUserMessage(description) },
            { type: "image_url", image_url: { url: dataUrl } },
          ],
        },
      ],
      280
    );

    const parsed = parseWatchHarmVerificationJson(
      JSON.parse(cleanJsonResponse(rawText))
    );
    return {
      matchesPrompt: parsed.matchesPrompt,
      reason: parsed.reason,
      rawText,
      modelKey: this.modelKey,
      latencyMs: performance.now() - startTime,
    };
  }
}
