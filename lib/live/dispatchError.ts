/**
 * Browser-side wording for a failed /api/analyze dispatch.
 *
 * The debug panel is the operator's only window into the pipeline, so a failure
 * must say something actionable. Before this, a slow or hung provider surfaced
 * as the browser's raw "signal timed out" with an empty provider field, which
 * read as "the app is broken" rather than "provider X did not answer in time".
 */

/**
 * How long the browser waits for one dispatch before giving up.
 *
 * The server's own budget (WATCH_REQUEST_BUDGET_MS, default 12s) plus its
 * bounded persistence write is the worst case it can still legitimately answer
 * in; this deadline sits above that so an abort means the SERVER is wedged, not
 * merely slow. Raising this without raising the server budget only delays the
 * diagnosis, so keep the pair in step — see lib/live/requestBudget.ts.
 */
export const DISPATCH_TIMEOUT_MS = 20_000;

/**
 * Describe a dispatch failure in operator terms. An aborted fetch is reported by
 * browsers as `TimeoutError`/`AbortError` with an unhelpful message, so it is
 * rewritten to name the deadline that expired.
 */
export function describeDispatchError(err: unknown, timeoutMs: number = DISPATCH_TIMEOUT_MS): string {
  const name = err instanceof Error ? err.name : "";
  if (name === "TimeoutError" || name === "AbortError") {
    return `no verdict: server did not answer within ${Math.round(timeoutMs / 1000)}s`;
  }
  if (err instanceof Error && err.message.trim()) return err.message;
  return "analyze-error";
}

/**
 * Pull the route's failure `detail` out of an error response body. The route
 * reports `detail` on a 502 (e.g. "gemini timed out after 7000ms"), which is far
 * more useful than the bare status code; a malformed or empty body yields null
 * rather than throwing inside the analysis loop.
 *
 * Accepts anything with a `json()` method so it stays testable without a server.
 */
export async function serverFailureDetail(res: { json(): Promise<unknown> }): Promise<string | null> {
  try {
    const json = await res.json();
    if (!json || typeof json !== "object") return null;
    const { detail, error, reason } = json as { detail?: unknown; error?: unknown; reason?: unknown };
    const value = detail ?? error ?? reason;
    return typeof value === "string" && value.trim() ? value.trim() : null;
  } catch {
    return null;
  }
}

/**
 * Compose the line the debug panel shows for a non-OK dispatch. Empty/duplicate
 * details collapse to just the status so the panel never shows "analyze-failed:502
 * — analyze-failed:502".
 */
export function describeFailedStatus(status: number, detail: string | null): string {
  const base = `analyze-failed:${status}`;
  if (!detail) return base;
  return detail.includes(base) ? detail : `${base} — ${detail}`;
}
