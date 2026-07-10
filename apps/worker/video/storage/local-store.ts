/* eslint-disable @typescript-eslint/no-explicit-any */
import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../../convex/_generated/api.js";
import type {
  VideoAnalysisFrameArtifact,
  VideoAnalysisGraphArtifact,
  VideoAnalysisRetrievalChunk,
  VideoAnalysisRetrievalEntity,
  VideoAnalysisSummaryArtifact,
  VideoAnalysisTimelineEntry,
  VideoAnalysisStage,
} from "@/types/video-analysis";
import {
  frameArtifactSchema,
  persistedJobRecordSchema,
  summaryArtifactSchema,
  timelineEntrySchema,
} from "../contracts/schemas";
import type { PersistedVideoAnalysisJob } from "../domain/internal";
import {
  retrievalChunkSchema,
  retrievalEntitySchema,
  graphArtifactSchema as retrievalGraphArtifactSchema,
} from "../retrieval/contracts";
import { readJsonFile, writeJsonFile } from "../utils/json";
import {
  frameArtifactPath,
  frameArtifactsDirPath,
  jobDir,
  manifestFilePath,
  retrievalChunksFilePath,
  retrievalDirPath,
  retrievalEntitiesFilePath,
  retrievalGraphFilePath,
  sourceVideoPath,
  stateFilePath,
  summaryFilePath,
  timelineFilePath,
  VIDEO_ANALYSIS_ROOT,
} from "./paths";
import type { VideoAnalysisStore, VideoFrameManifest } from "./types";

const manifestSchema = z.object({
  fingerprint: z.string().min(1),
  sourceFileName: z.string().min(1),
  sourceByteLength: z.number().int().nonnegative(),
  videoPath: z.string().min(1),
  frameCount: z.number().int().nonnegative(),
  createdAt: z.string().min(1),
  frames: z.array(
    z.object({
      frameIndex: z.number().int().nonnegative(),
      timestampMs: z.number().nonnegative(),
      timestampLabel: z.string().min(1),
      imagePath: z.string().min(1),
      width: z.number().int().positive().nullable(),
      height: z.number().int().positive().nullable(),
    }),
  ),
});
export class LocalVideoAnalysisStore implements VideoAnalysisStore {
  private readonly jobIdsByFingerprint = new Map<string, string>();
  private _convexClient: ConvexHttpClient | null = null;

  constructor(convexClient?: ConvexHttpClient) {
    if (convexClient) {
      this._convexClient = convexClient;
    }
  }

  get convexClient(): ConvexHttpClient {
    if (!this._convexClient) {
      const url = process.env.NEXT_PUBLIC_CONVEX_URL || "";
      this._convexClient = new ConvexHttpClient(url);
    }
    return this._convexClient;
  }

  async getJobId(fingerprint: string): Promise<string> {
    const cached = this.jobIdsByFingerprint.get(fingerprint);
    if (cached) return cached;

    const job = (await this.convexClient.query(api.videoJobs.getByFingerprint, {
      fingerprint,
    })) as { _id: string } | null;
    if (!job) {
      throw new Error(`No video job found for fingerprint: ${fingerprint}`);
    }
    this.jobIdsByFingerprint.set(fingerprint, job._id);
    return job._id;
  }

  async uploadFrame(processedBuffer: Buffer | ArrayBuffer): Promise<{ storageId: string; url: string }> {
    const arrayBuffer =
      processedBuffer instanceof Buffer
        ? (processedBuffer.buffer.slice(
            processedBuffer.byteOffset,
            processedBuffer.byteOffset + processedBuffer.byteLength
          ) as ArrayBuffer)
        : processedBuffer;

    return await this.convexClient.action(api.videoJobs.uploadFrame, {
      frameBytes: arrayBuffer as ArrayBuffer,
    });
  }

  async ensureRoot(): Promise<void> {
    await fs.mkdir(VIDEO_ANALYSIS_ROOT, { recursive: true });
  }

  async loadJobByFingerprint(
    fingerprint: string,
  ): Promise<PersistedVideoAnalysisJob | null> {
    const job: any = await this.convexClient.query(api.videoJobs.getByFingerprint, {
      fingerprint,
    });
    if (!job) return null;
    return this.mapConvexJobToPersisted(job);
  }

  async loadJobById(jobId: string): Promise<PersistedVideoAnalysisJob | null> {
    const job: any = await this.convexClient.query(api.videoJobs.get, {
      jobId: jobId as any,
    });
    if (!job) return null;
    return this.mapConvexJobToPersisted(job);
  }

  async saveJob(job: PersistedVideoAnalysisJob): Promise<void> {
    let convexStatus: "idle" | "checking_cache" | "uploading" | "extracting" | "analyzing" | "combining" | "completed" | "error" = "idle";
    if (job.status === "queued") {
      convexStatus = "idle";
    } else if (job.status === "extracting") {
      convexStatus = "extracting";
    } else if (job.status === "analyzing") {
      convexStatus = "analyzing";
    } else if (job.status === "summarizing") {
      convexStatus = "combining";
    } else if (job.status === "completed") {
      convexStatus = "completed";
    } else if (job.status === "error") {
      convexStatus = "error";
    }

    const summaryArg = job.summary ? {
      timelineText: job.summary.timelineText,
      summaryText: job.summary.summaryText,
      modelKey: job.summary.modelKey,
      rawText: job.summary.rawText,
    } : undefined;

    await this.convexClient.mutation(api.videoJobs.updateProgress, {
      jobId: job.jobId as any,
      status: convexStatus,
      analyzedFrames: job.progress?.completedFrames,
      totalFrames: job.progress?.totalFrames,
      summary: summaryArg,
      error: job.error,
    });
  }

  private mapConvexJobToPersisted(job: any): PersistedVideoAnalysisJob {
    let stage: VideoAnalysisStage = "queued";
    if (job.status === "extracting") stage = "extracting";
    else if (job.status === "analyzing") stage = "analyzing";
    else if (job.status === "combining") stage = "summarizing";
    else if (job.status === "completed") stage = "completed";
    else if (job.status === "error") stage = "error";

    const total = job.totalFrames ?? 0;
    const completed = job.analyzedFrames ?? 0;
    const ratio = total > 0 ? completed / total : 0;

    const providerConfig = {
      provider: "lmstudio" as const,
      baseUrl:
        process.env.LMSTUDIO_BASE_URL ||
        process.env.NEXT_PUBLIC_LMSTUDIO_URL ||
        "http://127.0.0.1:1234",
      apiToken:
        process.env.VIDEO_WATCH_SUMMARY_MODEL_KEY ||
        process.env.LMSTUDIO_API_TOKEN ||
        process.env.LM_API_TOKEN ||
        "",
      frameModelKey:
        process.env.VIDEO_WATCH_FRAME_MODEL_KEY ||
        process.env.LMSTUDIO_FRAME_MODEL ||
        "lfm-ucf-400m",
      summaryModelKey:
        process.env.LMSTUDIO_SUMMARY_MODEL ||
        "google/gemma-4-e4b",
      embeddingModelKey:
        process.env.LM_EMBEDDING_MODEL_KEY ||
        process.env.LMSTUDIO_EMBEDDING_MODEL ||
        "nomic-embed-text-v1.5",
    };

    return {
      ok: true,
      jobId: job._id,
      fingerprint: job.fingerprint,
      sourceFileName: job.sourceFileName,
      status: stage,
      progress: {
        stage,
        totalFrames: total,
        completedFrames: completed,
        completionRatio: ratio,
      },
      provider: "lmstudio" as const,
      cache: {
        fingerprint: job.fingerprint,
        cacheHit: job.cache?.cacheHit ?? false,
        source: job.cache?.source ?? "upload",
      },
      createdAt: job.createdAt || new Date(job._creationTime).toISOString(),
      updatedAt: job.updatedAt || new Date(job._creationTime).toISOString(),
      summary: job.summary ? {
        timelineText: job.summary.timelineText,
        summaryText: job.summary.summaryText,
        modelKey: job.summary.modelKey,
        rawText: job.summary.rawText,
      } : undefined,
      error: job.error,
      providerConfig,
    };
  }

  async writeSourceVideo(
    fingerprint: string,
    sourceFileName: string,
    videoBuffer: Buffer,
  ): Promise<string> {
    const targetPath = sourceVideoPath(fingerprint, sourceFileName);
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, videoBuffer);
    return targetPath;
  }

  async readManifest(fingerprint: string): Promise<VideoFrameManifest | null> {
    return readJsonFile(fs, manifestFilePath(fingerprint), manifestSchema);
  }

  async saveManifest(manifest: VideoFrameManifest): Promise<void> {
    await fs.mkdir(jobDir(manifest.fingerprint), { recursive: true });
    await writeJsonFile(fs, manifestFilePath(manifest.fingerprint), manifest);
  }

  async saveFrameArtifact(
    fingerprint: string,
    artifact: VideoAnalysisFrameArtifact,
  ): Promise<void> {
    await fs.mkdir(frameArtifactsDirPath(fingerprint), { recursive: true });
    await writeJsonFile(
      fs,
      frameArtifactPath(fingerprint, artifact.frameIndex),
      artifact,
    );

    try {
      const jobId = await this.getJobId(fingerprint);
      const objectsRecord: Record<string, string> = {};
      artifact.visibleObjects.forEach((obj, idx) => {
        objectsRecord[idx.toString()] = obj;
      });

      await this.convexClient.mutation(api.timelineEntries.insert, {
        jobId: jobId as any,
        frameIndex: artifact.frameIndex,
        timestampMs: artifact.timestampMs,
        timestampLabel: artifact.timestampLabel,
        frameAnalysis: artifact.sceneSummary,
        priorFrameAnalysis: "",
        priorVisibleObjects: [],
        objects: objectsRecord,
        rawText: artifact.rawText,
        modelKey: artifact.modelKey,
        latencyMs: artifact.latencyMs,
        fromCache: false,
      });
    } catch (err) {
      console.error(`[STORE] Failed to write frame artifact to Convex:`, err);
    }
  }

  async readFrameArtifacts(
    fingerprint: string,
  ): Promise<readonly VideoAnalysisFrameArtifact[]> {
    try {
      const jobId = await this.getJobId(fingerprint);
      const entries = await this.convexClient.query(api.timelineEntries.listByJob, {
        jobId: jobId as any,
      });
      if (entries && entries.length > 0) {
        return entries.map((entry: any) => ({
          frameIndex: entry.frameIndex,
          timestampMs: entry.timestampMs,
          timestampLabel: entry.timestampLabel,
          sceneSummary: entry.frameAnalysis,
          visibleObjects: Object.values(entry.objects),
          events: [],
          continuityNotes: [],
          rawText: entry.rawText,
          modelKey: entry.modelKey,
          latencyMs: entry.latencyMs,
          imagePath: "",
          width: null,
          height: null,
        }));
      }
    } catch (err) {
      console.warn(`[STORE] Failed to read frame artifacts from Convex, falling back to disk:`, err);
    }

    const dir = frameArtifactsDirPath(fingerprint);
    const entries = await fs.readdir(dir).catch(() => []);
    const artifacts = await Promise.all(
      entries
        .filter((entry) => entry.endsWith(".json"))
        .sort()
        .map((entry) =>
          readJsonFile(fs, path.join(dir, entry), frameArtifactSchema),
        ),
    );
    return artifacts.filter(Boolean) as readonly VideoAnalysisFrameArtifact[];
  }

  async saveTimeline(
    fingerprint: string,
    timeline: readonly VideoAnalysisTimelineEntry[],
  ): Promise<void> {
    await writeJsonFile(fs, timelineFilePath(fingerprint), timeline);
  }

  async readTimeline(
    fingerprint: string,
  ): Promise<readonly VideoAnalysisTimelineEntry[]> {
    const schema = z.array(timelineEntrySchema);
    return (
      (await readJsonFile(fs, timelineFilePath(fingerprint), schema)) ?? []
    );
  }

  async saveSummary(
    fingerprint: string,
    summary: VideoAnalysisSummaryArtifact,
  ): Promise<void> {
    const jobId = await this.getJobId(fingerprint);
    await this.convexClient.mutation(api.videoJobs.updateProgress, {
      jobId: jobId as any,
      status: "completed",
      summary: {
        timelineText: summary.timelineText,
        summaryText: summary.summaryText,
        modelKey: summary.modelKey,
        rawText: summary.rawText,
      },
    });
  }

  async readSummary(
    fingerprint: string,
  ): Promise<VideoAnalysisSummaryArtifact | null> {
    const job: any = await this.convexClient.query(api.videoJobs.getByFingerprint, {
      fingerprint,
    });
    if (!job || !job.summary) return null;
    return {
      timelineText: job.summary.timelineText,
      summaryText: job.summary.summaryText,
      modelKey: job.summary.modelKey,
      rawText: job.summary.rawText,
    };
  }

  async saveRetrievalChunks(
    fingerprint: string,
    chunks: readonly VideoAnalysisRetrievalChunk[],
  ): Promise<void> {
    await fs.mkdir(retrievalDirPath(fingerprint), { recursive: true });
    await writeJsonFile(fs, retrievalChunksFilePath(fingerprint), chunks);
  }

  async readRetrievalChunks(
    fingerprint: string,
  ): Promise<readonly VideoAnalysisRetrievalChunk[]> {
    const schema = z.array(retrievalChunkSchema);
    return (
      (await readJsonFile(fs, retrievalChunksFilePath(fingerprint), schema)) ??
      []
    );
  }

  async saveRetrievalEntities(
    fingerprint: string,
    entities: readonly VideoAnalysisRetrievalEntity[],
  ): Promise<void> {
    await fs.mkdir(retrievalDirPath(fingerprint), { recursive: true });
    await writeJsonFile(fs, retrievalEntitiesFilePath(fingerprint), entities);
  }

  async readRetrievalEntities(
    fingerprint: string,
  ): Promise<readonly VideoAnalysisRetrievalEntity[]> {
    const schema = z.array(retrievalEntitySchema);
    return (
      (await readJsonFile(
        fs,
        retrievalEntitiesFilePath(fingerprint),
        schema,
      )) ?? []
    );
  }

  async saveRetrievalGraph(
    fingerprint: string,
    graph: VideoAnalysisGraphArtifact,
  ): Promise<void> {
    await fs.mkdir(retrievalDirPath(fingerprint), { recursive: true });
    await writeJsonFile(fs, retrievalGraphFilePath(fingerprint), graph);
  }

  async readRetrievalGraph(
    fingerprint: string,
  ): Promise<VideoAnalysisGraphArtifact | null> {
    return readJsonFile(
      fs,
      retrievalGraphFilePath(fingerprint),
      retrievalGraphArtifactSchema,
    );
  }

  async clearJob(fingerprint: string): Promise<void> {
    await fs.rm(jobDir(fingerprint), { recursive: true, force: true });
  }
}
