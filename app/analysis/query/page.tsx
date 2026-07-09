"use client";

import type React from "react";
import { useState, useRef, useEffect } from "react";
import { useAnalysisSession } from "@/components/analysis/video-watch-session";

// ─── Timestamp parser ──────────────────────────────────────────────────────────
// Extracts [HH:MM:SS] or [MM:SS] tokens from AI answer text and turns them
// into highlighted inline badges.

function renderAnswerWithTimestamps(content: string): React.JSX.Element[] {
  const parts = content.split(/(\[\d{1,2}:\d{2}(?::\d{2})?\])/g);
  return parts.map((part, i) => {
    if (/^\[\d{1,2}:\d{2}(?::\d{2})?\]$/.test(part)) {
      return (
        <span
          key={i}
          className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-op-elevated border border-op-border-active text-[10px] font-mono text-op-silver mx-0.5 align-baseline"
        >
          <span
            className="material-symbols-outlined text-[10px]"
            style={{ fontVariationSettings: '"wght" 300' }}
          >
            schedule
          </span>
          {part.slice(1, -1)}
        </span>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AnalysisQueryPage(): React.JSX.Element {
  const {
    isReplyProcessing,
    isVideoReady,
    job,
    messages,
    selectedVideoName,
    selectedVideoUrl,
    sendMessage,
    clearMessages,
    uploadPhase,
  } = useAnalysisSession();

  const [inputValue, setInputValue] = useState("");
  const [videoExpanded, setVideoExpanded] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, isReplyProcessing]);

  const handleSend = () => {
    const trimmed = inputValue.trim();
    if (!trimmed || isReplyProcessing || !isVideoReady) return;
    void sendMessage(trimmed);
    setInputValue("");
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey || !e.shiftKey)) {
      e.preventDefault();
      handleSend();
    }
  };

  const cameraLabel = selectedVideoName
    ? selectedVideoName.replace(/\.[^.]+$/, "").toUpperCase()
    : "NO VIDEO";

  const systemStatus =
    uploadPhase === "completed"
      ? "SYSTEM READY"
      : uploadPhase === "error"
        ? "SYSTEM ERROR"
        : uploadPhase === "idle"
          ? "AWAITING VIDEO"
          : "PROCESSING";

  const statusDotClass =
    uploadPhase === "completed"
      ? "bg-op-nominal"
      : uploadPhase === "error"
        ? "bg-op-critical"
        : uploadPhase === "idle"
          ? "bg-op-text-sec"
          : "bg-op-warning animate-pulse";

  const placeholder = isVideoReady
    ? "Ask anything about this footage... (Enter to send)"
    : uploadPhase === "idle"
      ? "Upload a video on the Analysis tab first..."
      : "Waiting for analysis to complete...";

  const suggestedQuestions = [
    "Summarize all events in this footage",
    "What objects were detected and when?",
    "Was there any unusual or suspicious activity?",
    "List all people detected with timestamps",
    "What happened between [00:30] and [01:00]?",
  ];

  return (
    <div className="flex-1 flex overflow-hidden h-full">

      {/* ── Chat Area ──────────────────────────────────────────── */}
      <main className="flex-1 min-w-0 flex flex-col bg-op-surface">

        {/* Status bar */}
        <div className="h-10 border-b border-op-border flex items-center px-4 justify-between bg-op-elevated shrink-0">
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${statusDotClass}`} />
            <span className="font-mono text-xs text-op-text-sec tracking-wider">
              {systemStatus}
            </span>
            {selectedVideoName && (
              <>
                <span className="text-op-border font-mono text-xs">·</span>
                <span className="font-mono text-xs text-op-silver truncate max-w-56">
                  {cameraLabel}
                </span>
              </>
            )}
          </div>
          <div className="flex items-center gap-3">
            {messages.length > 0 && (
              <button
                type="button"
                onClick={clearMessages}
                className="text-[10px] font-mono text-op-text-sec hover:text-op-silver flex items-center gap-1 transition-colors"
              >
                <span
                  className="material-symbols-outlined text-[12px]"
                  style={{ fontVariationSettings: '"wght" 300' }}
                >
                  delete_sweep
                </span>
                CLEAR CHAT
              </button>
            )}
            <span className="font-mono text-[10px] text-op-text-sec">
              AI QUERY
            </span>
          </div>
        </div>

        {/* Chat messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-5 min-h-0">

          {/* Empty state */}
          {messages.length === 0 && !isReplyProcessing && (
            <div className="flex-1 flex flex-col items-center justify-center h-full text-center gap-5 py-16">
              <span
                className="material-symbols-outlined text-[3.5rem] text-op-text-muted"
                style={{ fontVariationSettings: '"wght" 100' }}
              >
                neurology
              </span>
              <div className="space-y-1">
                <div className="font-mono text-sm text-op-silver">
                  {isVideoReady ? "INTELLIGENCE LAYER READY" : uploadPhase === "idle" ? "NO VIDEO LOADED" : "ANALYSIS IN PROGRESS"}
                </div>
                <div className="font-mono text-xs text-op-text-muted">
                  {isVideoReady
                    ? "Ask anything about the video footage below"
                    : uploadPhase === "idle"
                      ? "Upload a video on the Analysis tab and wait for it to complete"
                      : "The AI is analyzing your video — please wait"}
                </div>
              </div>
              {isVideoReady && (
                <div className="flex flex-wrap justify-center gap-2 max-w-xl mt-2">
                  {suggestedQuestions.map((q) => (
                    <button
                      key={q}
                      type="button"
                      onClick={() => setInputValue(q)}
                      className="bg-op-elevated border border-op-border hover:border-op-border-active text-op-silver px-3 py-1.5 font-mono text-xs transition-colors duration-75 text-left"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Messages */}
          {messages.map((msg) => {
            const isUser = msg.role === "user";
            const time = new Date().toLocaleTimeString("en-US", {
              hour: "2-digit",
              minute: "2-digit",
              hour12: false,
            });
            return (
              <div
                key={msg.id}
                className={`flex flex-col w-full ${isUser ? "items-end" : "items-start"}`}
              >
                {/* Label row */}
                <div
                  className={`text-[10px] font-mono text-op-text-sec mb-1.5 flex items-center gap-1.5 ${isUser ? "flex-row-reverse" : ""}`}
                >
                  {!isUser && (
                    <span
                      className="material-symbols-outlined text-[11px] text-op-silver"
                      style={{ fontVariationSettings: '"wght" 300' }}
                    >
                      smart_toy
                    </span>
                  )}
                  <span>{isUser ? "YOU" : "AI ANALYST"}</span>
                  <span className="text-op-text-muted">{time}</span>
                </div>

                {/* Bubble */}
                {isUser ? (
                  <div className="bg-op-elevated border border-op-border-active px-4 py-2.5 max-w-[80%] text-sm text-op-silver font-mono leading-relaxed">
                    {msg.content}
                  </div>
                ) : (
                  <div className="bg-op-base border border-op-border px-4 py-3.5 w-full text-sm font-mono text-op-silver leading-relaxed">
                    <div className="whitespace-pre-wrap break-words">
                      {renderAnswerWithTimestamps(msg.content)}
                    </div>
                    {/* Model key badge if present */}
                    {(msg as any).modelKey && (
                      <div className="mt-3 pt-2 border-t border-op-border flex items-center gap-1.5 text-[10px] font-mono text-op-text-muted">
                        <span
                          className="material-symbols-outlined text-[11px]"
                          style={{ fontVariationSettings: '"wght" 300' }}
                        >
                          memory
                        </span>
                        {(msg as any).modelKey}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {/* Thinking indicator */}
          {isReplyProcessing && (
            <div className="flex flex-col items-start w-full">
              <div className="text-[10px] font-mono text-op-text-sec mb-1.5 flex items-center gap-1.5">
                <span
                  className="material-symbols-outlined text-[11px] text-op-silver"
                  style={{ fontVariationSettings: '"wght" 300' }}
                >
                  smart_toy
                </span>
                <span>AI ANALYST // PROCESSING...</span>
              </div>
              <div className="bg-op-base border border-op-border px-4 py-4 w-full">
                <div className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-op-silver animate-bounce [animation-delay:0ms]" />
                  <span className="w-1.5 h-1.5 rounded-full bg-op-silver animate-bounce [animation-delay:150ms]" />
                  <span className="w-1.5 h-1.5 rounded-full bg-op-silver animate-bounce [animation-delay:300ms]" />
                </div>
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {/* Input area */}
        <div className="p-4 border-t border-op-border bg-op-surface shrink-0">
          <div className="relative flex items-center border border-op-border bg-op-base focus-within:border-op-silver transition-colors duration-75">
            <div className="pl-3 pr-2 text-op-silver font-mono font-bold shrink-0">
              &gt;
            </div>
            <input
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={!isVideoReady || isReplyProcessing}
              placeholder={placeholder}
              className="w-full bg-transparent border-none text-sm text-op-silver placeholder:text-op-text-muted focus:ring-0 font-mono py-3 outline-none disabled:opacity-50"
            />
            <button
              type="button"
              onClick={handleSend}
              disabled={!isVideoReady || isReplyProcessing || !inputValue.trim()}
              className="pr-3 pl-2 text-op-text-sec hover:text-op-silver transition-colors duration-75 flex items-center shrink-0 disabled:opacity-30"
            >
              <span
                className="material-symbols-outlined"
                style={{ fontVariationSettings: '"wght" 200' }}
              >
                send
              </span>
            </button>
          </div>
          <div className="flex justify-between items-center mt-2 px-1">
            <span className="text-[10px] font-mono text-op-text-muted">
              {isVideoReady
                ? `${job?.progress?.totalFrames ?? "—"} frames indexed · timestamps auto-extracted`
                : "video analysis required before querying"}
            </span>
            <span className="text-[10px] font-mono text-op-text-muted">
              ENTER TO SEND
            </span>
          </div>
        </div>
      </main>

      {/* ── Right Panel: Context ────────────────────────────────── */}
      <aside className="w-56 bg-op-surface border-l border-op-border flex-col shrink-0 hidden xl:flex">
        <div className="h-10 border-b border-op-border flex items-center px-3 bg-op-elevated shrink-0">
          <span className="font-mono text-xs text-op-text-sec tracking-tight">
            CONTEXT
          </span>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-4">

          {/* Active video preview */}
          {selectedVideoUrl ? (
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <div className="text-[10px] font-mono text-op-text-sec">ACTIVE VIDEO</div>
                <button
                  type="button"
                  onClick={() => setVideoExpanded((v) => !v)}
                  className="text-[10px] font-mono text-op-text-sec hover:text-op-silver transition-colors"
                >
                  {videoExpanded ? "HIDE" : "SHOW"}
                </button>
              </div>
              {videoExpanded && (
                <div className="relative bg-black border border-op-border overflow-hidden aspect-video mb-1.5">
                  {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                  <video
                    src={selectedVideoUrl}
                    className="w-full h-full object-contain grayscale"
                    muted
                    playsInline
                  />
                  <div className="absolute inset-0 pointer-events-none border border-op-border-active" />
                </div>
              )}
              <div className="text-[10px] font-mono text-op-text-sec truncate">
                {selectedVideoName ?? "UNKNOWN"}
              </div>
            </div>
          ) : (
            <div className="text-[10px] font-mono text-op-text-muted text-center py-4">
              No video loaded
            </div>
          )}

          {/* Job stats */}
          {job && (
            <div>
              <div className="text-[10px] font-mono text-op-text-sec mb-2 border-b border-op-border pb-1">
                JOB INFO
              </div>
              <div className="space-y-1.5">
                <div className="flex justify-between">
                  <span className="font-mono text-[10px] text-op-text-sec">STATUS</span>
                  <span className="font-mono text-[10px] text-op-silver uppercase">{job.status}</span>
                </div>
                <div className="flex justify-between">
                  <span className="font-mono text-[10px] text-op-text-sec">FRAMES</span>
                  <span className="font-mono text-[10px] text-op-silver">{job.progress?.totalFrames ?? "—"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="font-mono text-[10px] text-op-text-sec">ANALYZED</span>
                  <span className="font-mono text-[10px] text-op-silver">{job.progress?.completedFrames ?? "—"}</span>
                </div>
              </div>
            </div>
          )}

          {/* Summary snippet */}
          {job?.summary?.summaryText && (
            <div>
              <div className="text-[10px] font-mono text-op-text-sec mb-1.5 border-b border-op-border pb-1">
                SCENE SUMMARY
              </div>
              <p className="text-[10px] font-mono text-op-silver leading-relaxed line-clamp-6">
                {job.summary.summaryText}
              </p>
            </div>
          )}

          {/* Conversation count */}
          {messages.length > 0 && (
            <div className="border border-op-border bg-op-base p-2">
              <div className="text-[10px] font-mono text-op-text-sec mb-1">SESSION</div>
              <div className="flex justify-between items-center">
                <span className="font-mono text-[10px] text-op-text-sec">MESSAGES</span>
                <span className="font-mono text-xs text-op-silver">{messages.length}</span>
              </div>
              <div className="flex justify-between items-center mt-1">
                <span className="font-mono text-[10px] text-op-text-sec">QUERIES</span>
                <span className="font-mono text-xs text-op-silver">
                  {messages.filter((m) => m.role === "user").length}
                </span>
              </div>
            </div>
          )}

        </div>
      </aside>
    </div>
  );
}
