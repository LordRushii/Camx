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

// ─── NVIDIA NIM API helper ───────────────────────────────────────────────────

const NVIDIA_NIM_MODEL = "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning";

type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string; detail?: "auto" | "low" | "high" } };

interface OpenRouterMessage {
  role: "system" | "user" | "assistant";
  content: string | ContentPart[];
}

async function queryOpenRouter(options: {
  apiKey: string;
  model: string;
  messages: OpenRouterMessage[];
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
}): Promise<string> {
  const body: Record<string, unknown> = {
    model: options.model,
    messages: options.messages,
    temperature: options.temperature ?? 0.1,
    max_tokens: options.maxTokens ?? 1000,
    // Disable the reasoning/thinking chain — we only want the final output
    chat_template_kwargs: { enable_thinking: false },
  };
  if (options.jsonMode) {
    body.response_format = { type: "json_object" };
  }

  const response = await fetch(
    "https://integrate.api.nvidia.com/v1/chat/completions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${options.apiKey}`,
      },
      body: JSON.stringify(body),
    },
  );

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`NVIDIA NIM API error (HTTP ${response.status}): ${errText}`);
  }

  const resJson = (await response.json()) as {
    choices?: { message?: { content?: string | null } }[];
  };

  const text = resJson.choices?.[0]?.message?.content;
  if (!text) {
    throw new Error(
      `NVIDIA NIM returned an empty response: ${JSON.stringify(resJson)}`,
    );
  }
  return text;
}

function requireOpenRouterKey(operation: string): string {
  const key = process.env.NVIDIA_API_KEY;
  if (!key || key.trim() === "") {
    throw new Error(
      `NVIDIA_API_KEY is not set. ${operation} requires the NVIDIA API key.`,
    );
  }
  return key;
}

function resolveOpenRouterModel(): string {
  return NVIDIA_NIM_MODEL;
}

/**
 * Reasoning models (e.g. Nemotron) emit a thinking chain before the JSON:
 *   "We need to analyze this frame carefully... {\"sceneSummary\":...}"
 *   or  "<think>...</think>\n{\"sceneSummary\":...}"
 *
 * Strategy:
 *   1. Strip <think>...</think> blocks first (explicit reasoning wrappers).
 *   2. Find the FIRST '{' — that is where the JSON object starts.
 *   3. Find the LAST '}' — that is where it ends.
 *   4. Fall back to markdown-fence stripping if no braces found.
 */
function cleanJsonResponse(rawText: string): string {
  // 1. Strip <think>...</think> reasoning blocks
  let text = rawText.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();

  // 2. Strip markdown fences if present
  if (text.startsWith("```")) {
    text = text.replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/, "").trim();
  }

  // 3. Slice from the first '{' to the last '}' to drop any remaining preamble
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    return text.slice(firstBrace, lastBrace + 1).trim();
  }

  return text;
}

/**
 * Attempt to repair JSON that was truncated by a token limit.
 * Handles unterminated strings, arrays, and objects.
 * Returns the repaired string — caller should still try JSON.parse on it.
 */
function repairTruncatedJson(json: string): string {
  let s = json.trim();

  // Close an unterminated string literal
  const quoteCount = (s.match(/(?<!\\)"/g) || []).length;
  if (quoteCount % 2 !== 0) {
    s += '"';
  }

  // Walk through to figure out what brackets are still open
  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  for (const ch of s) {
    if (escaped) { escaped = false; continue; }
    if (ch === '\\' && inString) { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{' || ch === '[') stack.push(ch);
    if (ch === '}' && stack.at(-1) === '{') stack.pop();
    if (ch === ']' && stack.at(-1) === '[') stack.pop();
  }

  // Close in reverse order
  while (stack.length > 0) {
    const opener = stack.pop();
    // Remove trailing comma before closing
    s = s.replace(/,\s*$/, '');
    s += opener === '{' ? '}' : ']';
  }

  return s;
}


/**
 * Strip reasoning-model preamble from plain-text responses.
 * Nemotron often outputs "<think>...</think>\n\nActual answer here."
 * We drop everything up to and including the closing </think> tag.
 * If no tag is found the text is returned as-is.
 */
function stripReasoningPreamble(rawText: string): string {
  const thinkEnd = rawText.indexOf("</think>");
  if (thinkEnd !== -1) {
    return rawText.slice(thinkEnd + "</think>".length).trim();
  }
  return rawText.trim();
}

/**
 * Some reasoning models (e.g. Nemotron) return array fields as a
 * comma-separated string instead of a JSON array.  Coerce them in-place
 * before passing to the strict Zod schema so we don't have to relax it.
 */
function coerceArrayFields(
  raw: Record<string, unknown>,
  fields: string[],
): Record<string, unknown> {
  for (const field of fields) {
    const val = raw[field];
    if (typeof val === "string") {
      raw[field] = val
        .split(/,\s*|\n/)
        .map((s) => s.trim())
        .filter(Boolean);
    }
  }
  return raw;
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

  // ── Frame analysis — OpenRouter API ──────────────────────────────────────

  async analyzeFrame(input: ProviderFrameInput) {
    const apiKey = requireOpenRouterKey("Frame analysis");
    const model = resolveOpenRouterModel();

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

    const base64Image = imageBuffer.toString("base64");
    const dataUrl = `data:image/png;base64,${base64Image}`;

    const contextLines = [
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
    ];

    const rawText = await queryOpenRouter({
      apiKey,
      model,
      messages: [
        {
          role: "system",
          content: [
            "You analyze one CCTV frame and use short recent context carefully.",
            "Return strict JSON only — no markdown, no extra text.",
            "Be factual and concise.",
            "Do not invent details that are not visible in the image.",
          ].join(" "),
        },
        {
          role: "user",
          content: [
            { type: "text", text: contextLines.join("\n") },
            {
              type: "image_url",
              image_url: { url: dataUrl },
            },
          ],
        },
      ],
      temperature: 0,
      maxTokens: 2048,
    });

    const cleanedText = cleanJsonResponse(rawText);
    let jsonObj: Record<string, unknown>;
    try {
      jsonObj = JSON.parse(cleanedText) as Record<string, unknown>;
    } catch {
      // Token-limit truncation — attempt repair
      const repaired = repairTruncatedJson(cleanedText);
      jsonObj = JSON.parse(repaired) as Record<string, unknown>;
    }
    const rawParsed = coerceArrayFields(jsonObj, [
      "visibleObjects",
      "events",
      "continuityNotes",
    ]);
    const parsed = frameAnalysisResponseSchema.parse(rawParsed);
    return {
      sceneSummary: normalizeWhitespace(parsed.sceneSummary),
      visibleObjects: dedupeStrings(parsed.visibleObjects, 12),
      events: dedupeStrings(parsed.events, 12),
      continuityNotes: dedupeStrings(parsed.continuityNotes, 8),
      rawText,
      modelKey: model,
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

  // ── Video Summary — OpenRouter ───────────────────────────────────────────

  async summarizeTimeline(
    timeline: readonly VideoAnalysisTimelineEntry[],
  ): Promise<VideoAnalysisSummaryArtifact> {
    const apiKey = requireOpenRouterKey("Video summary");
    const timelineText = buildTimelineText(timeline);
    const model = resolveOpenRouterModel();

    const summaryText = await queryOpenRouter({
      apiKey,
      model,
      messages: [
        {
          role: "system",
          content: [
            "You summarize analyzed CCTV footage into a practical, crime-scene-oriented security brief.",
            "Analyze the sequence of events across all frames.",
            "If there is any suspicious activity, potential threats, or criminal activity (e.g. weapons, physical violence, fighting, intrusion, theft, or suspicious behavior), highlight it clearly.",
            "If there is no suspicious or criminal activity detected, explicitly state: 'This is a normal video.'",
            "Be chronological, compact, and grounded in the supplied timeline only.",
          ].join(" "),
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

    const cleanedSummary = stripReasoningPreamble(summaryText);
    return {
      timelineText,
      summaryText: cleanedSummary,
      modelKey: model,
      rawText: cleanedSummary,
    };
  }

  // ── Q&A Context Summary — OpenRouter ──────────────────────────────────────

  async summarizeQueryContext(input: {
    readonly question: string;
    readonly summary: VideoAnalysisSummaryArtifact;
    readonly resolvedTimeRange: VideoAnalysisResolvedTimeRange | null;
    readonly evidence: readonly RetrievedEvidenceChunk[];
    readonly graphMatches: readonly GraphMatch[];
    readonly conversation: readonly VideoAnalysisChatMessage[];
    readonly insufficientEvidence: boolean;
  }): Promise<{ readonly summary: string; readonly modelKey: string }> {
    const apiKey = requireOpenRouterKey("Q&A context summary");
    const model = resolveOpenRouterModel();

    const conversationBlock =
      input.conversation.length > 0
        ? input.conversation
            .slice(-4)
            .map((msg) => `${msg.role}: ${msg.content}`)
            .join("\n")
        : "No prior conversation context.";

    const summary = await queryOpenRouter({
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

    return { summary: stripReasoningPreamble(summary), modelKey: model };
  }

  // ── Q&A Answer — OpenRouter ───────────────────────────────────────────────

  async answerQuestion(input: {
    readonly question: string;
    readonly messages: readonly VideoAnalysisChatMessage[];
    readonly queryContext: VideoQueryContextResult;
  }): Promise<{ readonly answer: string; readonly modelKey: string }> {
    const apiKey = requireOpenRouterKey("Q&A");
    const model = resolveOpenRouterModel();

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

    const messages: OpenRouterMessage[] = [
      { role: "system", content: systemPrompt },
      ...normalizedMessages.map((msg) => ({
        role: msg.role === "assistant" ? ("assistant" as const) : ("user" as const),
        content: msg.content,
      })),
      { role: "user", content: input.question },
    ];

    const answer = await queryOpenRouter({
      apiKey,
      model,
      messages,
      temperature: 0.1,
      maxTokens: 1000,
    });

    return { answer: stripReasoningPreamble(answer), modelKey: model };
  }
}
