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

const GROQ_BASE_URL = "https://api.groq.com/openai/v1";
const DEFAULT_GROQ_MODEL = "meta-llama/llama-4-scout-17b-16e-instruct";

type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string | ContentPart[];
}

/**
 * GroqProvider — Llama 4 vision via Groq's OpenAI-compatible chat completions
 * endpoint. No credit card, fast inference. Uses JSON mode + the shared watch
 * prompts and parsers (mirrors the xAI video provider's HTTP pattern).
 */
export class GroqProvider implements WatchProvider {
  private readonly apiKey: string;
  private readonly modelKey: string;

  constructor(config?: { apiKey?: string; watchModelKey?: string }) {
    const apiKey = (config?.apiKey || process.env.GROQ_API_KEY || "").trim();
    if (!apiKey) {
      throw new Error("GROQ_API_KEY is not set");
    }
    this.apiKey = apiKey;
    this.modelKey =
      config?.watchModelKey || process.env.GROQ_WATCH_MODEL || DEFAULT_GROQ_MODEL;
  }

  private async chat(messages: ChatMessage[], maxTokens: number): Promise<string> {
    const response = await fetch(`${GROQ_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.modelKey,
        messages,
        temperature: 0,
        max_tokens: maxTokens,
        response_format: { type: "json_object" },
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Groq API error (HTTP ${response.status}): ${errText}`);
    }

    const resJson = (await response.json()) as {
      choices?: { message?: { content?: string | null } }[];
    };
    const text = resJson.choices?.[0]?.message?.content;
    if (!text || text.trim() === "") {
      throw new Error(`Groq returned an empty response: ${JSON.stringify(resJson)}`);
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
