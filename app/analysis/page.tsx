"use client";

import Link from "next/link";
import type React from "react";
import { useMemo, useRef, useState } from "react";
import { AnalysisVideoPlayer } from "@/components/analysis/analysis-video-player";
import { useAnalysisSession } from "@/components/analysis/video-watch-session";

// ─── Pipeline step definition ─────────────────────────────────────────────────

type StepStatus = "complete" | "active" | "pending" | "error";

interface PipelineStep {
  id: string;
  icon: string;
  label: string;
  sublabel?: string;
  stat?: string;
  status: StepStatus;
}

function buildPipelineSteps(
  uploadPhase: string,
  analyzedFrames: number,
  totalFrames: number,
  hasError: boolean,
): PipelineStep[] {
  const order = [
    "uploading",
    "extracting",
    "analyzing",
    "summarizing",
    "completed",
  ];

  const completed = (step: string) => {
    const currentIdx = order.indexOf(uploadPhase);
    const stepIdx = order.indexOf(step);
    if (uploadPhase === "completed") return true;
    return currentIdx > stepIdx;
  };

  const isCurrent = (step: string) =>
    uploadPhase === step ||
    (step === "uploading" && uploadPhase === "checking_cache");

  const status = (step: string): StepStatus => {
    if (hasError) {
      if (isCurrent(step)) return "error";
      if (completed(step)) return "complete";
      return "pending";
    }
    if (completed(step)) return "complete";
    if (isCurrent(step)) return "active";
    return "pending";
  };

  return [
    {
      id: "uploading",
      icon: "upload_file",
      label: "Pre-process Payload",
      sublabel: "Fingerprint & cache check",
      stat: status("uploading") === "complete" ? "100%" : "--",
      status: status("uploading"),
    },
    {
      id: "extracting",
      icon: "movie",
      label: "Frame Extraction",
      sublabel: "ffmpeg · 1 fps sample",
      stat: status("extracting") === "complete" ? "done" : "--",
      status: status("extracting"),
    },
    {
      id: "analyzing",
      icon: "camera",
      label: "Frame Analysis",
      sublabel: "LM Studio · lfm-ucf-400m",
      stat:
        uploadPhase === "analyzing"
          ? `${Math.round((analyzedFrames / Math.max(totalFrames, 1)) * 100)}%`
          : status("analyzing") === "complete"
            ? "100%"
            : "--",
      status: status("analyzing"),
    },
    {
      id: "summarizing",
      icon: "auto_awesome",
      label: "Nemotron Summary",
      sublabel: "Nemotron · NVIDIA NIM",
      stat:
        status("summarizing") === "complete" || uploadPhase === "completed"
          ? "done"
          : "--",
      status: status("summarizing"),
    },
    {
      id: "report",
      icon: "chat",
      label: "Q&A Ready",
      sublabel: "Gemma 4 · RAG",
      stat: uploadPhase === "completed" ? "live" : "--",
      status: uploadPhase === "completed" ? "complete" : "pending",
    },
  ];
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function AnalysisPage(): React.JSX.Element {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatBottomRef = useRef<HTMLDivElement>(null);
  const [chatInput, setChatInput] = useState("");

  const {
    analyzedFrames,
    attachVideo,
    buildHref,
    clearCache,
    isCacheActionPending,
    isReplyProcessing,
    isVideoReady,
    job,
    messages,
    phaseLabel,
    runFreshAnalysis,
    selectedVideoName,
    selectedVideoUrl,
    sendMessage,
    totalFrames,
    uploadPhase,
    error,
  } = useAnalysisSession();

  const pipelineSteps = useMemo(
    () =>
      buildPipelineSteps(
        uploadPhase,
        analyzedFrames,
        totalFrames,
        uploadPhase === "error",
      ),
    [analyzedFrames, totalFrames, uploadPhase],
  );

  const seqLabel = job?.jobId?.slice(0, 7).toUpperCase() ?? "SEQ-094";
  const cameraLabel = job?.sourceFileName ?? "CAM-04-NORTH_ENTRANCE";

  const handleChatSend = () => {
    const trimmed = chatInput.trim();
    if (!trimmed || isReplyProcessing || !isVideoReady) return;
    void sendMessage(trimmed);
    setChatInput("");
    setTimeout(
      () => chatBottomRef.current?.scrollIntoView({ behavior: "smooth" }),
      50,
    );
  };

  const handleChatKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleChatSend();
    }
  };

  return (
    <div className="flex h-full min-h-0 overflow-hidden p-2 gap-2">
      {/* ── Left aside: Upload + Pipeline ──────────────────────────── */}
      <aside className="w-72 flex flex-col gap-2 shrink-0">
        {/* Source Payload card */}
        <div className="bg-op-surface border border-op-border rounded-sm p-4 flex flex-col gap-3">
          <div className="font-mono text-xs text-foreground uppercase tracking-wider mb-1">
            Source Payload
          </div>

          {/* Drop zone */}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            suppressHydrationWarning
            className="border border-dashed border-op-border-active hover:border-op-silver transition-colors bg-op-base p-6 flex flex-col items-center justify-center text-center gap-2 cursor-pointer h-32 rounded-sm"
          >
            <span className="material-symbols-outlined text-op-text-sec text-[28px]">
              upload_file
            </span>
            <span className="text-xs text-op-text-sec">
              {selectedVideoName ? (
                <span className="text-op-silver">{selectedVideoName}</span>
              ) : (
                <>
                  Drag &amp; drop video payload
                  <br />
                  or{" "}
                  <span className="text-foreground underline underline-offset-2">
                    browse directory
                  </span>
                </>
              )}
            </span>
          </button>

          <div className="flex justify-between items-center text-[10px] font-mono text-op-text-sec">
            <span>MAX: 2GB (MP4, MKV)</span>
            <span>H.264/H.265</span>
          </div>

          {/* Action buttons – only shown when a job exists */}
          {(job || selectedVideoUrl) && (
            <div className="flex flex-wrap gap-2 pt-1 border-t border-op-border">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="text-[10px] font-mono text-op-text-sec hover:text-foreground uppercase tracking-wider transition-colors"
              >
                Replace
              </button>
              <span className="text-op-border">|</span>
              <button
                type="button"
                onClick={() => {
                  void runFreshAnalysis();
                }}
                disabled={isCacheActionPending || !selectedVideoUrl}
                className="text-[10px] font-mono text-op-text-sec hover:text-foreground uppercase tracking-wider transition-colors disabled:opacity-40"
              >
                Fresh Run
              </button>
              <span className="text-op-border">|</span>
              <button
                type="button"
                onClick={() => {
                  void clearCache();
                }}
                disabled={isCacheActionPending || !job}
                className="text-[10px] font-mono text-op-text-sec hover:text-op-critical uppercase tracking-wider transition-colors disabled:opacity-40"
              >
                Clear Cache
              </button>
            </div>
          )}
        </div>

        {/* Analysis Pipeline card */}
        <div className="flex-1 bg-op-surface border border-op-border rounded-sm p-4 flex flex-col overflow-hidden">
          <div className="flex justify-between items-center mb-4">
            <span className="font-mono text-xs text-foreground uppercase tracking-wider">
              Analysis Pipeline
            </span>
            <span className="px-2 py-0.5 bg-op-base border border-op-border-active text-[10px] font-mono text-op-text-sec rounded-sm">
              {seqLabel}
            </span>
          </div>

          <div className="flex-1 overflow-y-auto pr-2">
            <ul className="flex flex-col font-mono text-xs">
              {pipelineSteps.map((step, idx) => {
                const isLast = idx === pipelineSteps.length - 1;
                const isActive = step.status === "active";
                const isComplete = step.status === "complete";
                const isError = step.status === "error";

                const rowColor = isError
                  ? "text-op-critical"
                  : isActive
                    ? "text-foreground"
                    : isComplete
                      ? "text-op-silver"
                      : "text-op-text-sec";

                const iconColor = isError
                  ? "text-op-critical"
                  : isActive
                    ? "text-foreground"
                    : isComplete
                      ? "text-op-silver"
                      : "text-op-text-sec";

                return (
                  <li key={step.id} className="flex flex-col relative">
                    {(isActive || isError) && (
                      <div
                        className={`absolute -left-4 top-0 bottom-0 w-1 ${isError ? "bg-op-critical" : "bg-op-silver"}`}
                      />
                    )}
                    <div
                      className={`flex items-start gap-3 py-2 ${rowColor} ${
                        isActive || isError
                          ? `bg-op-elevated px-2 -mx-2 rounded-sm border ${isError ? "border-op-critical/40" : "border-op-border"}`
                          : ""
                      }`}
                    >
                      <span
                        className={`material-symbols-outlined text-[16px] mt-0.5 shrink-0 ${iconColor} ${isActive ? "animate-pulse" : ""}`}
                        style={
                          isComplete
                            ? { fontVariationSettings: '"FILL" 1' }
                            : undefined
                        }
                      >
                        {isError ? "error" : step.icon}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className={isActive || isError ? "font-medium" : ""}>
                          {step.label}
                        </div>
                        {step.sublabel && (
                          <div className="text-[9px] text-op-text-sec mt-0.5 truncate">
                            {step.sublabel}
                          </div>
                        )}
                      </div>
                      <span
                        className={`ml-auto text-[10px] shrink-0 ${isError ? "text-op-critical" : isComplete ? "text-op-silver" : "text-op-text-sec"}`}
                      >
                        {isError ? "ERR" : step.stat}
                      </span>
                    </div>
                    {!isLast && (
                      <div
                        className={`h-4 border-l ml-1.75 ${
                          isComplete
                            ? "border-op-border-active"
                            : "border-op-border"
                        }`}
                      />
                    )}
                  </li>
                );
              })}
            </ul>

            {/* Gemma badge */}
            <div className="mt-4 pt-3 border-t border-op-border">
              <div className="flex items-center gap-2 px-1">
                <span className="material-symbols-outlined text-[14px] text-op-text-sec">
                  auto_awesome
                </span>
                <span className="font-mono text-[9px] text-op-text-sec uppercase tracking-wider">
                  Powered by Nemotron (30B)
                </span>
              </div>
              <div className="font-mono text-[9px] text-op-text-sec/60 px-1 mt-1">
                Summary &amp; Q&amp;A via NVIDIA NIM API
              </div>
            </div>
          </div>
        </div>
      </aside>

      {/* ── Right section: Viewer + Summary + Chat ───────────────────── */}
      <section className="flex-1 flex flex-col gap-2 min-w-0">
        {/* Error banner */}
        {error && (
          <div className="border border-op-critical bg-op-critical/10 px-4 py-2 font-mono text-xs text-foreground rounded-sm">
            {error}
          </div>
        )}

        {/* Viewer */}
        <div className="flex-[2] bg-op-surface border border-op-border rounded-sm relative overflow-hidden flex flex-col min-h-0">
          <AnalysisVideoPlayer
            src={selectedVideoUrl}
            title={cameraLabel.toUpperCase()}
            timelineMarkers={[20, 45, 70]}
            overlays={
              selectedVideoUrl ? (
                <>
                  <div className="absolute top-[30%] left-[45%] w-32 h-64 border border-op-silver bg-op-silver/10 pointer-events-none">
                    <div className="absolute -top-5 -left-px bg-op-silver text-op-base px-1 text-[9px] font-mono font-bold uppercase">
                      PERSON 94%
                    </div>
                  </div>
                  <div className="absolute top-[45%] left-[20%] w-24 h-48 border border-op-critical bg-op-critical/10 pointer-events-none">
                    <div className="absolute -top-5 -left-px bg-op-critical text-foreground px-1 text-[9px] font-mono font-bold uppercase">
                      UNAUTHORIZED 88%
                    </div>
                  </div>
                </>
              ) : null
            }
          />

          {/* Live phase status strip */}
          {job && job.status !== "completed" && (
            <div className="border-t border-op-border bg-op-elevated px-4 py-2 shrink-0 flex items-center gap-3">
              <span className="w-1.5 h-1.5 rounded-full bg-op-warning animate-pulse shrink-0" />
              <span className="font-mono text-[10px] text-op-warning uppercase">
                {job.status}
              </span>
              <span className="font-mono text-[10px] text-op-text-sec truncate">
                {phaseLabel}
              </span>
            </div>
          )}
        </div>

        {/* Bottom row: Summary + Chat ─────────────────────────────────── */}
        <div className="flex-[3] flex gap-2 overflow-hidden min-h-0">

          {/* Gemma Summary panel */}
          <div className="w-80 shrink-0 bg-op-surface border border-op-border rounded-sm flex flex-col overflow-hidden">
            <div className="h-9 border-b border-op-border bg-op-elevated px-3 flex items-center gap-2 shrink-0">
              <span className="material-symbols-outlined text-[14px] text-op-text-sec">
                auto_awesome
              </span>
              <span className="font-mono text-[10px] text-foreground uppercase tracking-widest">
                Gemma Summary
              </span>
              <span className="ml-auto font-mono text-[9px] text-op-text-sec">
                {job?.summary?.modelKey || "gemma"}
              </span>
            </div>

            <div className="flex-1 overflow-y-auto p-3">
              {job?.summary ? (
                <>
                  <p className="text-[11px] leading-5 text-op-silver">
                    {job.summary.summaryText}
                  </p>
                  <div className="mt-3 pt-3 border-t border-op-border flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-[11px] text-op-text-sec">
                      info
                    </span>
                    <span className="font-mono text-[9px] text-op-text-sec">
                      {job.cache.cacheHit
                        ? `Cache hit (${job.cache.source})`
                        : "Fresh analysis"}
                    </span>
                  </div>
                </>
              ) : uploadPhase === "idle" ? (
                <div className="h-full flex flex-col items-center justify-center gap-2 text-center">
                  <span className="material-symbols-outlined text-[28px] text-op-text-sec">
                    auto_awesome
                  </span>
                  <p className="font-mono text-[10px] text-op-text-sec">
                    Upload a video to generate
                    <br />a Gemma summary
                  </p>
                </div>
              ) : uploadPhase === "completed" ? (
                <div className="flex items-center gap-2 text-op-text-sec">
                  <span className="font-mono text-[10px]">No summary yet</span>
                </div>
              ) : (
                <div className="h-full flex flex-col items-center justify-center gap-2 text-center">
                  <span className="material-symbols-outlined text-[22px] text-op-text-sec animate-pulse">
                    hourglass_top
                  </span>
                  <p className="font-mono text-[10px] text-op-text-sec">
                    Generating summary…
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Gemma Chat panel */}
          <div className="flex-1 bg-op-surface border border-op-border rounded-sm flex flex-col overflow-hidden">
            <div className="h-9 border-b border-op-border bg-op-elevated px-3 flex items-center gap-2 shrink-0">
              <span className="material-symbols-outlined text-[14px] text-op-text-sec">
                chat
              </span>
              <span className="font-mono text-[10px] text-foreground uppercase tracking-widest">
                AI Query
              </span>
              <span className="ml-auto font-mono text-[9px] text-op-text-sec">
                {job?.summary?.modelKey || "gemma"}
              </span>
              {messages.length > 0 && (
                <Link
                  href={buildHref("/analysis/query")}
                  className="flex items-center gap-1 font-mono text-[9px] text-op-silver hover:text-foreground transition-colors uppercase tracking-wider ml-2"
                >
                  <span className="material-symbols-outlined text-[10px]">
                    open_in_full
                  </span>
                  Expand
                </Link>
              )}
            </div>

            {/* Message list */}
            <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2">
              {messages.length === 0 && !isReplyProcessing ? (
                <div className="h-full flex flex-col items-center justify-center gap-2 text-center">
                  <span className="material-symbols-outlined text-[28px] text-op-text-sec">
                    psychology
                  </span>
                  <p className="font-mono text-[10px] text-op-text-sec">
                    {isVideoReady
                      ? "Ask Gemma about this footage"
                      : "Analysis needed before Q&A"}
                  </p>
                  {isVideoReady && (
                    <div className="flex flex-wrap gap-1 justify-center mt-1">
                      {[
                        "What happened?",
                        "Any suspicious activity?",
                        "Who entered the frame?",
                      ].map((q) => (
                        <button
                          key={q}
                          type="button"
                          onClick={() => {
                            void sendMessage(q);
                          }}
                          className="font-mono text-[9px] text-op-text-sec border border-op-border rounded-sm px-2 py-1 hover:border-op-silver hover:text-foreground transition-colors"
                        >
                          {q}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <>
                  {messages.map((msg) => (
                    <div
                      key={msg.id}
                      className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                    >
                      {msg.role === "assistant" && (
                        <span className="material-symbols-outlined text-[12px] text-op-text-sec mt-1 mr-1.5 shrink-0">
                          auto_awesome
                        </span>
                      )}
                      <div
                        className={`max-w-[80%] px-2.5 py-1.5 rounded-sm text-[11px] leading-5 font-sans ${
                          msg.role === "user"
                            ? "bg-op-elevated border border-op-border-active text-foreground"
                            : "text-op-silver"
                        }`}
                      >
                        {msg.content}
                      </div>
                    </div>
                  ))}
                  {isReplyProcessing && (
                    <div className="flex items-center gap-1.5">
                      <span className="material-symbols-outlined text-[12px] text-op-text-sec">
                        auto_awesome
                      </span>
                      <div className="flex gap-1">
                        {[0, 1, 2].map((i) => (
                          <span
                            key={i}
                            className="w-1 h-1 rounded-full bg-op-text-sec animate-pulse"
                            style={{ animationDelay: `${i * 150}ms` }}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                  <div ref={chatBottomRef} />
                </>
              )}
            </div>

            {/* Input row */}
            <div className="border-t border-op-border p-2 shrink-0 flex gap-2">
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={handleChatKey}
                disabled={!isVideoReady || isReplyProcessing}
                suppressHydrationWarning
                placeholder={
                  isVideoReady
                    ? "Ask about this footage…"
                    : "Upload & analyse a video first…"
                }
                className="flex-1 bg-op-base border border-op-border rounded-sm px-3 py-1.5 font-mono text-[11px] text-foreground placeholder:text-op-text-sec focus:outline-none focus:border-op-silver disabled:opacity-40"
              />
              <button
                type="button"
                onClick={handleChatSend}
                disabled={
                  !isVideoReady || isReplyProcessing || !chatInput.trim()
                }
                className="bg-op-elevated border border-op-border rounded-sm px-3 flex items-center gap-1 font-mono text-[10px] text-op-silver hover:text-foreground hover:border-op-silver transition-colors disabled:opacity-40"
              >
                <span className="material-symbols-outlined text-[14px]">
                  send
                </span>
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="video/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void attachVideo(file);
        }}
      />
    </div>
  );
}
