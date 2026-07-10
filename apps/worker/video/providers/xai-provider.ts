import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
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

const XAI_BASE_URL = "https://api.x.ai/v1";
/** Matches Convex timelineEntries vector index dimensions. */
const EMBEDDING_DIMS = 768;
const DEFAULT_MODEL = "grok-4.5";

// ─── Timeline / evidence helpers ──────────────────────────────────────────────

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
  if (!resolvedTimeRange) return "No explicit time range requested.";
  return `Requested window: ${resolvedTimeRange.startMs}ms to ${resolvedTimeRange.endMs}ms.`;
}

function renderEvidenceList(evidence: readonly RetrievedEvidenceChunk[]): string {
  return evidence.map(renderEvidenceChunk).join("\n\n") || "No evidence retrieved.";
}

function renderGraphMatchList(matches: readonly GraphMatch[]): string {
  return matches.map(renderGraphMatch).join("\n") || "No graph matches.";
}

// ─── API key ──────────────────────────────────────────────────────────────────

function requireXaiKey(operation: string): string {
  const key =
    process.env.XAI_API_KEY?.trim() ||
    process.env.VIDEO_WATCH_SUMMARY_MODEL_KEY?.trim() ||
    "";
  if (!key) {
    throw new Error(
      `XAI_API_KEY is not set. ${operation} requires an xAI API key in .env.local.`,
    );
  }
  return key;
}

function resolveModel(configModel?: string): string {
  return (
    process.env.XAI_MODEL?.trim() ||
    configModel?.trim() ||
    process.env.VIDEO_WATCH_SUMMARY_MODEL?.trim() ||
    DEFAULT_MODEL
  );
}

// ─── xAI chat completions (OpenAI-compatible) ─────────────────────────────────

type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string; detail?: "auto" | "low" | "high" } };

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string | ContentPart[];
}

async function xaiChat(options: {
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
}): Promise<string> {
  const body: Record<string, unknown> = {
    model: options.model,
    messages: options.messages,
    temperature: options.temperature ?? 0.1,
    max_tokens: options.maxTokens ?? 1000,
  };
  if (options.jsonMode) {
    body.response_format = { type: "json_object" };
  }

  const response = await fetch(`${XAI_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${options.apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`xAI API error (HTTP ${response.status}): ${errText}`);
  }

  const resJson = (await response.json()) as {
    choices?: { message?: { content?: string | null } }[];
  };
  const text = resJson.choices?.[0]?.message?.content;
  if (!text) {
    throw new Error(
      `xAI returned an empty response: ${JSON.stringify(resJson)}`,
    );
  }
  return text;
}

function cleanJsonResponse(rawText: string): string {
  let cleaned = rawText.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/i, "");
    cleaned = cleaned.replace(/\n?```$/, "");
  }
  return cleaned.trim();
}

// ─── Local 768-d embeddings (xAI has no public embeddings API) ────────────────

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s:_-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

function hashToken(token: string, salt: number): number {
  const digest = createHash("sha256")
    .update(`${salt}:${token}`)
    .digest();
  return digest.readUInt32BE(0) % EMBEDDING_DIMS;
}

/**
 * Deterministic hashed bag-of-words embedding sized for Convex vector search.
 * Good enough for short CCTV timeline retrieval without a remote embed API.
 */
export function localEmbed(text: string): number[] {
  const vec = new Float64Array(EMBEDDING_DIMS);
  const tokens = tokenize(text);
  if (tokens.length === 0) {
    return Array.from(vec);
  }
  for (const token of tokens) {
    const i0 = hashToken(token, 0);
    const i1 = hashToken(token, 1);
    vec[i0] += 1;
    vec[i1] += 0.5;
  }
  let norm = 0;
  for (let i = 0; i < EMBEDDING_DIMS; i++) norm += vec[i]! * vec[i]!;
  norm = Math.sqrt(norm) || 1;
  const out = new Array<number>(EMBEDDING_DIMS);
  for (let i = 0; i < EMBEDDING_DIMS; i++) out[i] = vec[i]! / norm;
  return out;
}

// ─── Provider ─────────────────────────────────────────────────────────────────

/**
 * XaiVideoAnalysisProvider — xAI Grok for all cloud pipeline steps:
 *  - Frame analysis:      grok-4.5 (vision)
 *  - Timeline summary:    grok-4.5
 *  - Q&A context summary: grok-4.5
 *  - Q&A answer:          grok-4.5
 *  - Text embeddings:     local 768-d hashed BoW (Convex-compatible)
 *
 * Frame pre-selection is handled by YOLO11x in extract-video, not here.
 */
export class XaiVideoAnalysisProvider implements VideoAnalysisProvider {
  readonly kind = "xai" as const;
  private readonly modelKey: string;

  constructor(config: VideoAnalysisProviderConfig) {
    this.modelKey = resolveModel(config.summaryModelKey || config.frameModelKey);
  }

  async analyzeFrame(input: ProviderFrameInput) {
    const apiKey = requireXaiKey("Frame analysis");

    let imageBuffer: Buffer;
    if (
      input.imagePath.startsWith("http://") ||
      input.imagePath.startsWith("https://")
    ) {
      const fetchRes = await fetch(input.imagePath);
      if (!fetchRes.ok) {
        throw new Error(
          `Failed to fetch frame image (HTTP ${fetchRes.status}): ${input.imagePath}`,
        );
      }
      imageBuffer = Buffer.from(await fetchRes.arrayBuffer());
    } else {
      imageBuffer = await fs.readFile(input.imagePath);
    }
    const base64Image = imageBuffer.toString("base64");
    const dataUrl = `data:image/png;base64,${base64Image}`;

    const contextLines: string[] = [
      `Frame time: ${input.timestampLabel}.`,
      input.previousSummary
        ? `Previous frame summary: ${input.previousSummary}`
        : "Previous frame summary: none.",
      input.recentTimeline.length > 0
        ? `Recent context:\n${input.recentTimeline.join("\n")}`
        : "Recent context: none.",
      "",
      "You are analyzing a CCTV security frame pre-filtered by YOLO11x for people, vehicles, or potential weapons.",
      "Focus on crime/threat indicators: people, weapons (guns, knives, bats), vehicles, fights, intrusion, fire/smoke, medical distress.",
      "",
      "Return JSON with these fields:",
      "- sceneSummary: short paragraph about what is visible now",
      '- visibleObjects: flat array of strings (e.g. ["person", "vehicle", "knife"])',
      "- events: flat array of strings (important actions or changes happening now)",
      "- continuityNotes: flat array of strings (how this frame continues, changes, or ends recent activity)",
    ];

    const rawText = await xaiChat({
      apiKey,
      model: this.modelKey,
      messages: [
        {
          role: "system",
          content: [
            "You analyze one CCTV frame and use short recent context carefully.",
            "Return strict JSON only — no markdown, no extra text.",
            "Ensure visibleObjects, events, and continuityNotes are flat arrays of strings.",
            "Be factual and concise. Do not invent details that are not visible.",
            "Call out weapons, violence, and unauthorized presence when visible.",
          ].join(" "),
        },
        {
          role: "user",
          content: [
            { type: "text", text: contextLines.join("\n") },
            {
              type: "image_url",
              image_url: { url: dataUrl, detail: "high" },
            },
          ],
        },
      ],
      temperature: 0,
      maxTokens: 700,
      jsonMode: true,
    });

    const rawParsed = JSON.parse(cleanJsonResponse(rawText)) as Record<
      string,
      unknown
    >;

    if (rawParsed && typeof rawParsed === "object") {
      const arrayFields = ["visibleObjects", "events", "continuityNotes"] as const;
      for (const field of arrayFields) {
        if (Array.isArray(rawParsed[field])) {
          rawParsed[field] = (rawParsed[field] as unknown[]).map((item) => {
            if (item && typeof item === "object") {
              const obj = item as Record<string, unknown>;
              return String(
                obj.name || obj.object || obj.label || obj.text || JSON.stringify(item),
              );
            }
            return String(item);
          });
        }
      }
    }

    const parsed = frameAnalysisResponseSchema.parse(rawParsed);
    return {
      sceneSummary: normalizeWhitespace(parsed.sceneSummary),
      visibleObjects: dedupeStrings(parsed.visibleObjects, 12),
      events: dedupeStrings(parsed.events, 12),
      continuityNotes: dedupeStrings(parsed.continuityNotes, 8),
      rawText,
      modelKey: this.modelKey,
    };
  }

  async embedTexts(inputs: readonly string[]): Promise<readonly number[][]> {
    return inputs.map((text) => localEmbed(text));
  }

  async summarizeTimeline(
    timeline: readonly VideoAnalysisTimelineEntry[],
  ): Promise<VideoAnalysisSummaryArtifact> {
    const apiKey = requireXaiKey("Video summary");
    const timelineText = buildTimelineText(timeline);

    const summaryText = await xaiChat({
      apiKey,
      model: this.modelKey,
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
      modelKey: this.modelKey,
      rawText: summaryText,
    };
  }

  async summarizeQueryContext(input: {
    readonly question: string;
    readonly summary: VideoAnalysisSummaryArtifact;
    readonly resolvedTimeRange: VideoAnalysisResolvedTimeRange | null;
    readonly evidence: readonly RetrievedEvidenceChunk[];
    readonly graphMatches: readonly GraphMatch[];
    readonly conversation: readonly VideoAnalysisChatMessage[];
    readonly insufficientEvidence: boolean;
  }): Promise<{ readonly summary: string; readonly modelKey: string }> {
    const apiKey = requireXaiKey("Q&A context summary");

    const conversationBlock =
      input.conversation.length > 0
        ? input.conversation
            .slice(-4)
            .map((msg) => `${msg.role}: ${msg.content}`)
            .join("\n")
        : "No prior conversation context.";

    const summary = await xaiChat({
      apiKey,
      model: this.modelKey,
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

    return { summary, modelKey: this.modelKey };
  }

  async answerQuestion(input: {
    readonly question: string;
    readonly messages: readonly VideoAnalysisChatMessage[];
    readonly queryContext: VideoQueryContextResult;
  }): Promise<{ readonly answer: string; readonly modelKey: string }> {
    const apiKey = requireXaiKey("Q&A");

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

    const messages: ChatMessage[] = [
      { role: "system", content: systemPrompt },
      ...normalizedMessages.map((msg) => ({
        role: msg.role as "user" | "assistant",
        content: msg.content,
      })),
      { role: "user", content: input.question },
    ];

    const answer = await xaiChat({
      apiKey,
      model: this.modelKey,
      messages,
      temperature: 0.1,
      maxTokens: 1000,
    });

    return { answer, modelKey: this.modelKey };
  }
}
