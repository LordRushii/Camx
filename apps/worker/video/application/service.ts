/* eslint-disable @typescript-eslint/no-explicit-any */
import { randomUUID } from "node:crypto";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../../convex/_generated/api.js";
import type {
  VideoAnalysisChatMessage,
  VideoAnalysisFrameArtifact,
  VideoAnalysisJob,
  VideoAnalysisProviderConfig,
  VideoAnalysisSummaryArtifact,
  VideoAnalysisTimelineEntry,
} from "@/types/video-analysis";
import { VideoAnalysisError } from "../contracts/error-codes";
import type { PersistedVideoAnalysisJob } from "../domain/internal";
import { createProgress, withProgressFrameCount } from "../domain/stages";
import { analyzeFrames } from "../pipeline/analyze-frames";
import { answerChatQuestion } from "../pipeline/answer-chat";
import { buildTimeline } from "../pipeline/build-timeline";
import { extractVideoFrames } from "../pipeline/extract-video";
import { LmStudioVideoAnalysisProvider } from "../providers/lmstudio-provider";
import type { VideoAnalysisProvider } from "../providers/types";
import {
  ensureRetrievalArtifacts,
  resolveVideoQueryContext,
} from "../retrieval/query-service";
import { LocalVideoAnalysisStore } from "../storage/local-store";
import { sourceVideoPath } from "../storage/paths";
import type { VideoAnalysisStore } from "../storage/types";
import { sha256 } from "../utils/hash";
import { VideoAnalysisWorker } from "../worker/executor";

class VideoAnalysisApplicationService {
  private readonly store: VideoAnalysisStore;
  private readonly worker: VideoAnalysisWorker;
  private readonly jobsById = new Map<string, PersistedVideoAnalysisJob>();
  private readonly jobsByFingerprint = new Map<
    string,
    PersistedVideoAnalysisJob
  >();

  constructor(convexClient?: ConvexHttpClient, store?: VideoAnalysisStore) {
    this.store = store ?? new LocalVideoAnalysisStore(convexClient);
    this.worker = new VideoAnalysisWorker(this.store);
  }

  private providerFor(
    config: VideoAnalysisProviderConfig,
  ): VideoAnalysisProvider {
    return new LmStudioVideoAnalysisProvider(config);
  }

  private toPublicJob(job: PersistedVideoAnalysisJob): VideoAnalysisJob {
    const { providerConfig: _providerConfig, ...publicJob } = job;
    return publicJob;
  }

  private remember(job: PersistedVideoAnalysisJob): PersistedVideoAnalysisJob {
    this.jobsById.set(job.jobId, job);
    this.jobsByFingerprint.set(job.fingerprint, job);
    return job;
  }

  private async persist(
    job: PersistedVideoAnalysisJob,
  ): Promise<PersistedVideoAnalysisJob> {
    this.remember(job);
    await this.store.saveJob(job);

    const storeObj = this.store as any;
    if (storeObj.convexClient) {
      try {
        let convexStatus: "idle" | "checking_cache" | "uploading" | "extracting" | "analyzing" | "combining" | "completed" | "error" = "idle";
        if (job.status === "queued") convexStatus = "uploading";
        else if (job.status === "extracting") convexStatus = "extracting";
        else if (job.status === "analyzing") convexStatus = "analyzing";
        else if (job.status === "summarizing") convexStatus = "combining";
        else if (job.status === "completed") convexStatus = "completed";
        else if (job.status === "error") convexStatus = "error";

        const updateData: any = {
          jobId: job.jobId as any,
          status: convexStatus,
        };
        if (job.progress && job.progress.totalFrames !== undefined) {
          updateData.totalFrames = job.progress.totalFrames;
        }
        if (job.progress && job.progress.completedFrames !== undefined) {
          updateData.analyzedFrames = job.progress.completedFrames;
        }
        if (job.summary) {
          updateData.summary = {
            timelineText: JSON.stringify(job.summary),
            summaryText: job.summary.summaryText || "",
            modelKey: job.summary.modelKey || "",
            rawText: job.summary.rawText || "",
          };
        }
        if (job.error) {
          updateData.error = job.error;
        }
        await storeObj.convexClient.mutation(api.videoJobs.updateProgress, updateData);
      } catch (err) {
        console.error(`[SERVICE] Failed to update job progress in Convex:`, err);
      }
    }

    return job;
  }

  private async loadByFingerprint(
    fingerprint: string,
  ): Promise<PersistedVideoAnalysisJob | null> {
    const mem = this.jobsByFingerprint.get(fingerprint);
    if (mem) return mem;
    const disk = await this.store.loadJobByFingerprint(fingerprint);
    return disk ? this.remember(disk) : null;
  }

  private async loadById(
    jobId: string,
  ): Promise<PersistedVideoAnalysisJob | null> {
    const mem = this.jobsById.get(jobId);
    if (mem) return mem;
    const disk = await this.store.loadJobById(jobId);
    return disk ? this.remember(disk) : null;
  }

  async createJob(input: {
    readonly sourceFileName: string;
    readonly videoBuffer: Buffer;
    readonly clientFingerprint?: string | null;
    readonly forceRefresh?: boolean;
    readonly providerConfig: VideoAnalysisProviderConfig;
  }): Promise<VideoAnalysisJob> {
    await this.store.ensureRoot();
    const fingerprint = sha256(input.videoBuffer);
    if (
      input.clientFingerprint &&
      input.clientFingerprint.length > 0 &&
      input.clientFingerprint !== fingerprint
    ) {
      throw new VideoAnalysisError(
        "BAD_REQUEST",
        400,
        "Client fingerprint did not match uploaded video bytes",
      );
    }

    const existing = await this.loadByFingerprint(fingerprint);
    if (input.forceRefresh && existing) {
      // Explicit cache-bust: wipe old job from memory, disk, and Convex
      this.jobsById.delete(existing.jobId);
      this.jobsByFingerprint.delete(existing.fingerprint);
      await this.worker.removeArtifacts(existing.fingerprint);
      const storeObj = this.store as any;
      if (storeObj.convexClient) {
        try {
          await storeObj.convexClient.mutation(api.videoJobs.deleteJob, {
            jobId: existing.jobId as any,
          });
        } catch (err) {
          console.warn(`[SERVICE] Failed to delete refresh job from Convex:`, err);
        }
      }
    } else if (existing) {
      // Return existing job as-is, including any error state — let the UI
      // display the error and prompt the user to click "Fresh Run".
      const cacheSource = this.worker.isRunning(existing.jobId)
        ? "memory"
        : "disk";
      const cached = {
        ...existing,
        cache: {
          fingerprint,
          cacheHit: true,
          source: cacheSource,
        },
      } satisfies PersistedVideoAnalysisJob;
      return this.toPublicJob(await this.persist(cached));
    }

    await this.store.writeSourceVideo(
      fingerprint,
      input.sourceFileName,
      input.videoBuffer,
    );

    const storeObj = this.store as any;
    let jobId = randomUUID();
    if (storeObj.convexClient) {
      try {
        const convexJobId = await storeObj.convexClient.mutation(api.videoJobs.create, {
          fingerprint,
          sourceFileName: input.sourceFileName,
          totalFrames: 0,
          cache: {
            fingerprint,
            cacheHit: false,
            source: "upload",
          },
        });
        jobId = convexJobId;
      } catch (err) {
        console.error(`[SERVICE] Failed to create job in Convex:`, err);
      }
    }

    const job: PersistedVideoAnalysisJob = {
      ok: true,
      jobId,
      fingerprint,
      sourceFileName: input.sourceFileName,
      status: "queued",
      progress: createProgress("queued"),
      provider: input.providerConfig.provider,
      cache: {
        fingerprint,
        cacheHit: false,
        source: "upload",
      },
      providerConfig: input.providerConfig,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await this.persist(job);

    void this.worker.start(job, async () => {
      await this.runJob(
        job.jobId,
        input.videoBuffer.length,
        input.providerConfig,
      );
    });

    return this.toPublicJob(job);
  }

  private async runJob(
    jobId: string,
    sourceByteLength: number,
    providerConfig: VideoAnalysisProviderConfig,
  ): Promise<void> {
    const current = await this.loadById(jobId);
    if (!current) return;
    const provider = this.providerFor(providerConfig);

    try {
      let job = await this.persist({
        ...current,
        status: "extracting",
        progress: createProgress("extracting"),
        updatedAt: new Date().toISOString(),
      });

      const manifest =
        (await this.store.readManifest(job.fingerprint)) ??
        (await extractVideoFrames({
          fingerprint: job.fingerprint,
          sourceFileName: job.sourceFileName,
          sourceByteLength,
          sourcePath: sourceVideoPath(job.fingerprint, job.sourceFileName),
          store: this.store,
        }));

      // Clean up the source video file as it's no longer needed for analysis
      await this.store.deleteSourceVideo(job.fingerprint, job.sourceFileName).catch((err) => {
        console.warn(`[video-analysis] Failed to delete source video for ${job.fingerprint}:`, err);
      });

      job = await this.persist({
        ...job,
        status: "analyzing",
        progress: createProgress("analyzing", manifest.frameCount, 0),
        updatedAt: new Date().toISOString(),
      });

      const frames = await analyzeFrames({
        fingerprint: job.fingerprint,
        manifest,
        provider,
        store: this.store,
        concurrency: 1,
        onFrameComplete: async (completed, total) => {
          const fresh = await this.loadById(jobId);
          if (!fresh) return;
          await this.persist({
            ...fresh,
            status: "analyzing",
            progress: withProgressFrameCount(
              createProgress("analyzing", total, completed),
              completed,
              total,
            ),
            updatedAt: new Date().toISOString(),
          });
        },
      });

      job = await this.persist({
        ...job,
        status: "summarizing",
        progress: createProgress(
          "summarizing",
          manifest.frameCount,
          manifest.frameCount,
        ),
        updatedAt: new Date().toISOString(),
      });

      const timeline = buildTimeline(frames);
      await this.store.saveTimeline(job.fingerprint, timeline);
      const summary = await provider.summarizeTimeline(timeline);
      await this.store.saveSummary(job.fingerprint, summary);
      await ensureRetrievalArtifacts({
        fingerprint: job.fingerprint,
        timeline,
        store: this.store,
        provider,
      }).catch((error: unknown) => {
        console.warn(
          `[video-analysis] retrieval bootstrap failed for ${job.fingerprint}`,
          error,
        );
      });

      await this.persist({
        ...job,
        status: "completed",
        progress: createProgress(
          "completed",
          manifest.frameCount,
          manifest.frameCount,
        ),
        summary,
        updatedAt: new Date().toISOString(),
      });

      // Clean up other temp files (frames directory, frame-artifacts directory, manifest.json)
      await this.store.cleanupTempFiles(job.fingerprint).catch((err) => {
        console.warn(`[video-analysis] Failed to clean up temp files for ${job.fingerprint}:`, err);
      });
    } catch (error) {
      const failed = await this.loadById(jobId);
      if (!failed) return;

      // Detect LM Studio / VLM provider connection failures and surface a
      // clear, actionable error message instead of a raw ECONNREFUSED stack.
      let errorMessage =
        error instanceof Error ? error.message : "Unknown video analysis error";
      const isConnRefused =
        errorMessage.includes("ECONNREFUSED") ||
        errorMessage.includes("WebSocket connection refused") ||
        errorMessage.includes("connect ECONNREFUSED");
      if (isConnRefused) {
        errorMessage =
          "Cannot connect to the VLM provider (LM Studio). " +
          "Please start LM Studio, enable its local API server (port 1234), " +
          "load your vision model, then click \"Fresh Run\" to retry.";
      }

      await this.persist({
        ...failed,
        status: "error",
        progress: {
          ...failed.progress,
          stage: "error",
        },
        updatedAt: new Date().toISOString(),
        error: errorMessage,
      });

      // Clean up on error too to prevent leaks
      await this.store.cleanupTempFiles(failed.fingerprint).catch((err) => {
        console.warn(`[video-analysis] Failed to clean up temp files on error for ${failed.fingerprint}:`, err);
      });
    }
  }

  async getJobStatus(input: {
    readonly jobId?: string | null;
    readonly fingerprint?: string | null;
  }): Promise<VideoAnalysisJob | null> {
    if (input.jobId) {
      const job = await this.loadById(input.jobId);
      return job ? this.toPublicJob(job) : null;
    }
    if (input.fingerprint) {
      const job = await this.loadByFingerprint(input.fingerprint);
      return job ? this.toPublicJob(job) : null;
    }
    return null;
  }

  async clearJob(jobId: string): Promise<VideoAnalysisJob | null> {
    const job = await this.loadById(jobId);
    if (!job) return null;
    this.jobsById.delete(job.jobId);
    this.jobsByFingerprint.delete(job.fingerprint);
    await this.worker.removeArtifacts(job.fingerprint);

    const storeObj = this.store as any;
    if (storeObj.convexClient) {
      try {
        await storeObj.convexClient.mutation(api.videoJobs.deleteJob, {
          jobId: jobId as any,
        });
      } catch (err) {
        console.error(`[SERVICE] Failed to delete job from Convex:`, err);
      }
    }

    return this.toPublicJob(job);
  }

  async answerQuestion(input: {
    readonly jobId: string;
    readonly question: string;
    readonly messages: readonly VideoAnalysisChatMessage[];
    readonly timeRange?: { readonly start: string; readonly end: string };
  }): Promise<{ readonly answer: string; readonly modelKey: string }> {
    const job = await this.loadById(input.jobId);
    if (!job) {
      throw new VideoAnalysisError(
        "NOT_FOUND",
        404,
        "Video analysis job not found",
      );
    }
    const summary = await this.store.readSummary(job.fingerprint);
    if (!summary) {
      throw new VideoAnalysisError(
        "BAD_REQUEST",
        400,
        "Video analysis summary is not ready yet",
      );
    }
    const timeline = await this.store.readTimeline(job.fingerprint);
    const provider = this.providerFor(job.providerConfig);
    const queryContext = await resolveVideoQueryContext({
      job,
      store: this.store,
      provider,
      summary,
      timeline,
      request: {
        question: input.question,
        conversation: input.messages,
        timeRange: input.timeRange,
      },
    });
    return answerChatQuestion({
      provider,
      question: input.question,
      messages: input.messages,
      queryContext,
    });
  }

  async getArtifacts(jobId: string): Promise<{
    readonly job: VideoAnalysisJob;
    readonly frames: readonly VideoAnalysisFrameArtifact[];
    readonly timeline: readonly VideoAnalysisTimelineEntry[];
    readonly summary: VideoAnalysisSummaryArtifact | null;
  }> {
    const job = await this.loadById(jobId);
    if (!job) {
      throw new VideoAnalysisError(
        "NOT_FOUND",
        404,
        "Video analysis job not found",
      );
    }
    const [frames, timeline, summary] = await Promise.all([
      this.store.readFrameArtifacts(job.fingerprint),
      this.store.readTimeline(job.fingerprint),
      this.store.readSummary(job.fingerprint),
    ]);
    return { job: this.toPublicJob(job), frames, timeline, summary };
  }
}

export { VideoAnalysisApplicationService };
export const videoAnalysisService = new VideoAnalysisApplicationService();
