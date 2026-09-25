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

const GEMINI_BASE_URL =
  "https://generativelanguage.googleapis.com/v1beta/models";
const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";

interface GeminiPart {
  text?: string;
  inlineData?: { mimeType: string; data: string };
}

/**
 * GeminiProvider — Google AI Studio native vision via generateContent.
 *
 * Gemini's responseSchema does not support the watch draft-07 conditional
 * schema (allOf/if/then), so we use JSON mode (responseMimeType) plus the
 * shared prompts and the robust parseWatch* coercers. Model thinking is
 * disabled (thinkingBudget 0) to keep the watch loop fast and deterministic.
 */
export class GeminiProvider implements WatchProvider {
  private readonly apiKey: string;
  private readonly modelKey: string;

  constructor(config?: { apiKey?: string; watchModelKey?: string }) {
    const apiKey = (config?.apiKey || process.env.GEMINI_API_KEY || "").trim();
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY is not set");
    }
    this.apiKey = apiKey;
    this.modelKey =
      config?.watchModelKey ||
      process.env.GEMINI_WATCH_MODEL ||
      DEFAULT_GEMINI_MODEL;
  }

  private async generate(
    systemPrompt: string,
    userText: string,
    images: { base64: string; mimeType: string }[],
    maxOutputTokens: number
  ): Promise<string> {
    const url = `${GEMINI_BASE_URL}/${this.modelKey}:generateContent?key=${this.apiKey}`;
    const parts: GeminiPart[] = [
      { text: userText },
      ...images.map((img) => ({
        inlineData: { mimeType: img.mimeType, data: img.base64 },
      })),
    ];

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: "user", parts }],
        generationConfig: {
          temperature: 0,
          maxOutputTokens,
          responseMimeType: "application/json",
          thinkingConfig: { thinkingBudget: 0 },
        },
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Gemini API error (HTTP ${response.status}): ${errText}`);
    }

    const resJson = (await response.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const text = resJson.candidates?.[0]?.content?.parts
      ?.map((p) => p.text ?? "")
      .join("")
      .trim();
    if (!text) {
      throw new Error(
        `Gemini returned an empty response: ${JSON.stringify(resJson)}`
      );
    }
    return text;
  }

  async analyzeFrame(
    base64Image: string,
    mimeType: string
  ): Promise<{ result: WatchResult; rawText: string; modelKey: string }> {
    const rawText = await this.generate(
      WATCH_SYSTEM_PROMPT,
      WATCH_USER_MESSAGE,
      [{ base64: base64Image, mimeType }],
      512
    );
    const result = parseWatchModelJson(JSON.parse(cleanJsonResponse(rawText)));
    return { result, rawText, modelKey: this.modelKey };
  }

  async analyzeBurst(
    frames: BurstFrame[],
    context: string
  ): Promise<{ result: WatchResult; rawText: string; modelKey: string }> {
    const rawText = await this.generate(
      WATCH_BURST_SYSTEM_PROMPT,
      watchBurstUserMessage(context, frames.length),
      frames.map((f) => ({ base64: f.base64, mimeType: f.mimeType })),
      640
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
    const rawText = await this.generate(
      WATCH_VERIFICATION_SYSTEM_PROMPT,
      watchVerificationUserMessage(description),
      [{ base64: base64Image, mimeType }],
      320
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
