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

// ─── Groq API helper ──────────────────────────────────────────────────────────

interface GroqMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

async function queryGroq(options: {
  apiKey: string;
  model: string;
  messages: GroqMessage[];
  temperature?: number;
  maxTokens?: number;
}): Promise<string> {
  const response = await fetch(
    "https://api.groq.com/openai/v1/chat/completions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${options.apiKey}`,
      },
      body: JSON.stringify({
        model: options.model,
        messages: options.messages,
        temperature: options.temperature ?? 0.1,
        max_tokens: options.maxTokens ?? 1000,
      }),
    },
  );

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Groq API error (HTTP ${response.status}): ${errText}`);
  }

  const resJson = (await response.json()) as {
    choices?: { message?: { content?: string | null } }[];
  };

  const text = resJson.choices?.[0]?.message?.content;
  if (!text) {
    throw new Error(
      `Groq returned an empty response: ${JSON.stringify(resJson)}`,
    );
  }
  return text;
}

function requireGroqKey(operation: string): string {
  const key = process.env.GROQ_API_KEY || process.env.VIDEO_WATCH_SUMMARY_MODEL_KEY;
  if (!key || key.trim() === "") {
    throw new Error(
      `GROQ_API_KEY is not set. ${operation} requires the Groq API key.`,
    );
  }
  return key;
}

function resolveGroqModel(): string {
  return process.env.GROQ_MODEL?.trim() || "llama-3.3-70b-versatile";
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

  // ── Video Summary — Groq ───────────────────────────────────────────────

  async summarizeTimeline(
    timeline: readonly VideoAnalysisTimelineEntry[],
  ): Promise<VideoAnalysisSummaryArtifact> {
    const apiKey = requireGroqKey("Video summary");
    const timelineText = buildTimelineText(timeline);
    const model = resolveGroqModel();

    const summaryText = await queryGroq({
      apiKey,
      model,
      messages: [
        {
          role: "system",
          content:
            "You summarize analyzed CCTV footage into a practical security operator brief. Be chronological, compact, and grounded in the supplied timeline only. Highlight people, vehicles, weapons, and threat-relevant events.",
        },
        {
          role: "user",
          content: [
            "Write 2 to 4 short paragraphs.",
            "Focus on what changed, when it changed, and what remains uncertain.",
            "",
            timelineText || "No timeline entries available.",
          ].join("\n"),
        },
      ],
      temperature: 0.15,
      maxTokens: 1200,
    });

    return {
      timelineText,
      summaryText,
      modelKey: model,
      rawText: summaryText,
    };
  }

  // ── Q&A Context Summary — Groq ──────────────────────────────────────────

  async summarizeQueryContext(input: {
    readonly question: string;
    readonly summary: VideoAnalysisSummaryArtifact;
    readonly resolvedTimeRange: VideoAnalysisResolvedTimeRange | null;
    readonly evidence: readonly RetrievedEvidenceChunk[];
    readonly graphMatches: readonly GraphMatch[];
    readonly conversation: readonly VideoAnalysisChatMessage[];
    readonly insufficientEvidence: boolean;
  }): Promise<{ readonly summary: string; readonly modelKey: string }> {
    const apiKey = requireGroqKey("Q&A context summary");
    const model = resolveGroqModel();

    const conversationBlock =
      input.conversation.length > 0
        ? input.conversation
            .slice(-4)
            .map((msg) => `${msg.role}: ${msg.content}`)
            .join("\n")
        : "No prior conversation context.";

    const summary = await queryGroq({
      apiKey,
      model,
      messages: [
        {
          role: "system",
          content: [
            "You prepare compact retrieval summaries for a CCTV question-answering agent.",
            "Use only the supplied evidence.",
            "Respect the requested question and time range.",
            "If evidence is weak, say so plainly.",
            "Return plain text only.",
          ].join(" "),
        },
        {
          role: "user",
          content: [
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
      temperature: 0.1,
      maxTokens: 700,
    });

    return { summary, modelKey: model };
  }

  // ── Q&A Answer — Groq ───────────────────────────────────────────────────

  async answerQuestion(input: {
    readonly question: string;
    readonly messages: readonly VideoAnalysisChatMessage[];
    readonly queryContext: VideoQueryContextResult;
  }): Promise<{ readonly answer: string; readonly modelKey: string }> {
    const apiKey = requireGroqKey("Q&A");
    const model = resolveGroqModel();

    const normalizedMessages = input.messages.map((m) =>
      chatMessageSchema.parse(m),
    );

    const systemPrompt = [
      "Answer questions about analyzed CCTV footage using only the supplied retrieved context.",
      "Use timestamps when supported.",
      "If the evidence is insufficient, say so clearly.",
      "Prioritize security-relevant facts: people, weapons, vehicles, and threats.",
      "",
      buildQueryContextBlock(input.queryContext),
    ].join("\n");

    const messages: GroqMessage[] = [
      { role: "system", content: systemPrompt },
      ...normalizedMessages.map((msg) => ({
        role: msg.role === "assistant" ? "assistant" as const : "user" as const,
        content: msg.content,
      })),
      { role: "user", content: input.question },
    ];

    const answer = await queryGroq({
      apiKey,
      model,
      messages,
      temperature: 0.1,
      maxTokens: 1000,
    });

    return { answer, modelKey: model };
  }
}
