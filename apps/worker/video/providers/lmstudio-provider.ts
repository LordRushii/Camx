import { promises as fs } from "node:fs";
import { createLmStudioClientForRequest } from "../../../../app/lib/lmstudio-client-factory.js";
import type {
  GraphMatch,
  RetrievedEvidenceChunk,
  VideoAnalysisChatMessage,
  VideoAnalysisProviderConfig,
  VideoAnalysisResolvedTimeRange,
  VideoAnalysisSummaryArtifact,
  VideoAnalysisTimelineEntry,
  VideoQueryContextResult,
} from "@/types/video-analysis";
import {
  chatMessageSchema,
  frameAnalysisResponseSchema,
} from "../contracts/schemas";
import {
  buildQueryContextBlock,
  renderEvidenceChunk,
  renderGraphMatch,
} from "../retrieval/summarize-context";
import { dedupeStrings, normalizeWhitespace } from "../utils/text";
import type { ProviderFrameInput, VideoAnalysisProvider } from "./types";

// ─── Timeline helpers ──────────────────────────────────────────────────────────

function buildTimelineText(
  timeline: readonly VideoAnalysisTimelineEntry[],
): string {
  return timeline
    .map((entry) =>
      entry.startTimestampLabel === entry.endTimestampLabel
        ? `${entry.startTimestampLabel}: ${entry.summary}`
        : `${entry.startTimestampLabel}-${entry.endTimestampLabel}: ${entry.summary}`,
    )
    .join("\n");
}

function renderResolvedTimeRange(
  resolvedTimeRange: VideoAnalysisResolvedTimeRange | null,
): string {
  if (!resolvedTimeRange) {
    return "No explicit time range requested.";
  }
  return `Requested window: ${resolvedTimeRange.startMs}ms to ${resolvedTimeRange.endMs}ms.`;
}

function renderEvidenceList(
  evidence: readonly RetrievedEvidenceChunk[],
): string {
  return (
    evidence.map(renderEvidenceChunk).join("\n\n") || "No evidence retrieved."
  );
}

function renderGraphMatchList(matches: readonly GraphMatch[]): string {
  return matches.map(renderGraphMatch).join("\n") || "No graph matches.";
}

// ─── Gemini API helper ─────────────────────────────────────────────────────────

interface GeminiMessage {
  role: "user" | "model";
  parts: { text: string }[];
}

async function queryGemini(options: {
  apiKey: string;
  systemInstruction?: string;
  contents: GeminiMessage[];
  temperature?: number;
  maxTokens?: number;
}): Promise<string> {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${options.apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: options.contents,
        ...(options.systemInstruction
          ? {
              systemInstruction: {
                parts: [{ text: options.systemInstruction }],
              },
            }
          : {}),
        generationConfig: {
          temperature: options.temperature ?? 0.1,
          maxOutputTokens: options.maxTokens ?? 1000,
        },
      }),
    },
  );

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Gemini API error (HTTP ${response.status}): ${errText}`);
  }

  const resJson = (await response.json()) as {
    candidates?: {
      content?: {
        parts?: { text?: string }[];
      };
    }[];
  };

  const text = resJson.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error(
      `Gemini returned an empty response: ${JSON.stringify(resJson)}`,
    );
  }
  return text;
}

function requireGeminiKey(operation: string): string {
  const key = process.env.VIDEO_WATCH_SUMMARY_MODEL_KEY;
  if (!key || key.trim() === "") {
    throw new Error(
      `VIDEO_WATCH_SUMMARY_MODEL_KEY is not set. ${operation} requires the Gemini API key.`,
    );
  }
  return key;
}

// ─── Provider ─────────────────────────────────────────────────────────────────

export class LmStudioVideoAnalysisProvider implements VideoAnalysisProvider {
  readonly kind = "lmstudio" as const;
  private readonly client;

  constructor(private readonly config: VideoAnalysisProviderConfig) {
    this.client = createLmStudioClientForRequest(
      config.baseUrl,
      config.apiToken.trim() === "" ? undefined : config.apiToken,
    );
  }

  // ── Frame analysis — stays on local LM Studio ────────────────────────────

  async analyzeFrame(input: ProviderFrameInput) {
    const model = await this.client.llm.model(this.config.frameModelKey);
    let imageBuffer: Buffer;
    if (
      input.imagePath.startsWith("http://") ||
      input.imagePath.startsWith("https://")
    ) {
      const fetchRes = await fetch(input.imagePath);
      imageBuffer = Buffer.from(await fetchRes.arrayBuffer());
    } else {
      imageBuffer = await fs.readFile(input.imagePath);
    }
    const image = await this.client.files.prepareImageBase64(
      "frame.png",
      imageBuffer.toString("base64"),
    );
    const response = await model.respond(
      [
        {
          role: "system",
          content: [
            "You analyze one CCTV frame and use short recent context carefully.",
            "Return strict JSON only.",
            "Be factual and concise.",
            "Do not invent details that are not visible in the image.",
          ].join(" "),
        },
        {
          role: "user",
          content: [
            `Frame time: ${input.timestampLabel}.`,
            input.previousSummary
              ? `Previous frame summary: ${input.previousSummary}`
              : "Previous frame summary: none.",
            input.recentTimeline.length > 0
              ? `Recent context:\n${input.recentTimeline.join("\n")}`
              : "Recent context: none.",
            "",
            "Return JSON with:",
            "- sceneSummary: short paragraph about what is visible now",
            "- visibleObjects: distinct visible people, vehicles, or items",
            "- events: important actions or changes happening now",
            "- continuityNotes: how this frame continues, changes, or ends recent activity",
          ].join("\n"),
          images: [image],
        },
      ],
      {
        temperature: 0,
        maxTokens: 700,
        structured: {
          type: "json",
          jsonSchema: {
            $schema: "http://json-schema.org/draft-07/schema#",
            type: "object",
            properties: {
              sceneSummary: { type: "string", minLength: 1 },
              visibleObjects: { type: "array", items: { type: "string" } },
              events: { type: "array", items: { type: "string" } },
              continuityNotes: { type: "array", items: { type: "string" } },
            },
            required: [
              "sceneSummary",
              "visibleObjects",
              "events",
              "continuityNotes",
            ],
            additionalProperties: false,
          },
        },
      },
    );

    const rawText = response?.content?.trim();
    if (!rawText) {
      throw new Error("LM Studio returned empty frame analysis response");
    }

    const parsed = frameAnalysisResponseSchema.parse(JSON.parse(rawText));
    return {
      sceneSummary: normalizeWhitespace(parsed.sceneSummary),
      visibleObjects: dedupeStrings(parsed.visibleObjects, 12),
      events: dedupeStrings(parsed.events, 12),
      continuityNotes: dedupeStrings(parsed.continuityNotes, 8),
      rawText,
      modelKey: this.config.frameModelKey,
    };
  }

  // ── Embeddings — stays on local LM Studio ───────────────────────────────

  async embedTexts(inputs: readonly string[]): Promise<readonly number[][]> {
    const model = await this.client.embedding.model(
      this.config.embeddingModelKey,
    );
    const response = await model.embed([...inputs]);
    const normalized = Array.isArray(response) ? response : [response];
    return normalized.map((entry) => entry.embedding);
  }

  // ── Video Summary — Gemini 2.5 Flash ────────────────────────────────────

  async summarizeTimeline(
    timeline: readonly VideoAnalysisTimelineEntry[],
  ): Promise<VideoAnalysisSummaryArtifact> {
    const apiKey = requireGeminiKey("Video summary");
    const timelineText = buildTimelineText(timeline);

    const summaryText = await queryGemini({
      apiKey,
      systemInstruction:
        "You summarize analyzed CCTV footage into a practical operator brief. Be chronological, compact, and grounded in the supplied timeline only.",
      contents: [
        {
          role: "user",
          parts: [
            {
              text: [
                "Write 2 to 4 short paragraphs.",
                "Focus on what changed, when it changed, and what remains uncertain.",
                "",
                timelineText || "No timeline entries available.",
              ].join("\n"),
            },
          ],
        },
      ],
      temperature: 0.15,
      maxTokens: 1200,
    });

    return {
      timelineText,
      summaryText,
      modelKey: "gemini-2.5-flash",
      rawText: summaryText,
    };
  }

  // ── Q&A Context Summary — Gemini 2.5 Flash ──────────────────────────────

  async summarizeQueryContext(input: {
    readonly question: string;
    readonly summary: VideoAnalysisSummaryArtifact;
    readonly resolvedTimeRange: VideoAnalysisResolvedTimeRange | null;
    readonly evidence: readonly RetrievedEvidenceChunk[];
    readonly graphMatches: readonly GraphMatch[];
    readonly conversation: readonly VideoAnalysisChatMessage[];
    readonly insufficientEvidence: boolean;
  }): Promise<{ readonly summary: string; readonly modelKey: string }> {
    const apiKey = requireGeminiKey("Q&A context summary");

    const conversationBlock =
      input.conversation.length > 0
        ? input.conversation
            .slice(-4)
            .map((msg) => `${msg.role}: ${msg.content}`)
            .join("\n")
        : "No prior conversation context.";

    const summary = await queryGemini({
      apiKey,
      systemInstruction: [
        "You prepare compact retrieval summaries for a CCTV question-answering agent.",
        "Use only the supplied evidence.",
        "Respect the requested question and time range.",
        "If evidence is weak, say so plainly.",
        "Return plain text only.",
      ].join(" "),
      contents: [
        {
          role: "user",
          parts: [
            {
              text: [
                `Question: ${input.question}`,
                renderResolvedTimeRange(input.resolvedTimeRange),
                `Insufficient evidence flag: ${input.insufficientEvidence ? "yes" : "no"}`,
                "",
                "Global video summary:",
                input.summary.summaryText,
                "",
                "Relevant evidence:",
                renderEvidenceList(input.evidence),
                "",
                "Graph matches:",
                renderGraphMatchList(input.graphMatches),
                "",
                "Recent conversation:",
                conversationBlock,
                "",
                "Write a 1-2 paragraph context summary for another agent. Include timestamps when supported.",
              ].join("\n"),
            },
          ],
        },
      ],
      temperature: 0.1,
      maxTokens: 700,
    });

    return { summary, modelKey: "gemini-2.5-flash" };
  }

  // ── Q&A Answer — Gemini 2.5 Flash ───────────────────────────────────────

  async answerQuestion(input: {
    readonly question: string;
    readonly messages: readonly VideoAnalysisChatMessage[];
    readonly queryContext: VideoQueryContextResult;
  }): Promise<{ readonly answer: string; readonly modelKey: string }> {
    const apiKey = requireGeminiKey("Q&A");

    const normalizedMessages = input.messages.map((m) =>
      chatMessageSchema.parse(m),
    );

    const systemPrompt = [
      "Answer questions about analyzed CCTV footage using only the supplied retrieved context.",
      "Use timestamps when supported.",
      "If the evidence is insufficient, say so clearly.",
      "",
      buildQueryContextBlock(input.queryContext),
    ].join("\n");

    const contents: GeminiMessage[] = normalizedMessages.map((msg) => ({
      role: msg.role === "assistant" ? "model" : "user",
      parts: [{ text: msg.content }],
    }));
    contents.push({ role: "user", parts: [{ text: input.question }] });

    const answer = await queryGemini({
      apiKey,
      systemInstruction: systemPrompt,
      contents,
      temperature: 0.1,
      maxTokens: 1000,
    });

    return { answer, modelKey: "gemini-2.5-flash" };
  }
}
