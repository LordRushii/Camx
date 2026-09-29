import { describe, it, expect } from "vitest";
import {
  DISPATCH_TIMEOUT_MS,
  describeDispatchError,
  serverFailureDetail,
  describeFailedStatus,
} from "../dispatchError";

describe("DISPATCH_TIMEOUT_MS", () => {
  it("leaves the server room to answer before the browser gives up", () => {
    // Server budget is 12s and persistence is bounded on top of it.
    expect(DISPATCH_TIMEOUT_MS).toBeGreaterThanOrEqual(15_000);
  });
});

describe("describeDispatchError", () => {
  it("names the deadline instead of leaking the browser's 'signal timed out'", () => {
    const timeout = new Error("signal timed out");
    timeout.name = "TimeoutError";
    const msg = describeDispatchError(timeout);
    expect(msg).toBe("no verdict: server did not answer within 20s");
    expect(msg).not.toMatch(/signal timed out/);
  });

  it("treats an abort the same way", () => {
    const abort = new Error("The user aborted a request.");
    abort.name = "AbortError";
    expect(describeDispatchError(abort)).toContain("did not answer within");
  });

  it("honours a custom timeout when wording the message", () => {
    const timeout = new Error("x");
    timeout.name = "TimeoutError";
    expect(describeDispatchError(timeout, 5_000)).toContain("within 5s");
  });

  it("passes a normal error message through unchanged", () => {
    expect(describeDispatchError(new Error("Failed to fetch"))).toBe("Failed to fetch");
  });

  it("falls back for non-Error throwables and blank messages", () => {
    expect(describeDispatchError("boom")).toBe("analyze-error");
    expect(describeDispatchError(new Error("   "))).toBe("analyze-error");
    expect(describeDispatchError(null)).toBe("analyze-error");
  });
});

describe("serverFailureDetail", () => {
  it("prefers the route's detail field", async () => {
    const res = { json: async () => ({ ok: false, error: "provider-failed", detail: "gemini timed out after 7000ms" }) };
    expect(await serverFailureDetail(res)).toBe("gemini timed out after 7000ms");
  });

  it("falls back through error then reason", async () => {
    expect(await serverFailureDetail({ json: async () => ({ error: "provider-failed" }) })).toBe("provider-failed");
    expect(await serverFailureDetail({ json: async () => ({ reason: "rate-limited" }) })).toBe("rate-limited");
  });

  it("returns null for bodies with nothing usable", async () => {
    expect(await serverFailureDetail({ json: async () => ({}) })).toBeNull();
    expect(await serverFailureDetail({ json: async () => ({ detail: "  " }) })).toBeNull();
    expect(await serverFailureDetail({ json: async () => null })).toBeNull();
    expect(await serverFailureDetail({ json: async () => "plain text" })).toBeNull();
    expect(await serverFailureDetail({ json: async () => ({ detail: 42 }) })).toBeNull();
  });

  it("returns null instead of throwing on an unparseable body", async () => {
    const res = {
      json: async () => {
        throw new Error("Unexpected token < in JSON");
      },
    };
    await expect(serverFailureDetail(res)).resolves.toBeNull();
  });
});

describe("describeFailedStatus", () => {
  it("appends the reason when there is one", () => {
    expect(describeFailedStatus(502, "gemini timed out after 7000ms")).toBe(
      "analyze-failed:502 — gemini timed out after 7000ms",
    );
  });

  it("shows only the status without a reason", () => {
    expect(describeFailedStatus(502, null)).toBe("analyze-failed:502");
    expect(describeFailedStatus(400, "")).toBe("analyze-failed:400");
  });

  it("does not repeat a detail that already contains the status", () => {
    expect(describeFailedStatus(502, "analyze-failed:502")).toBe("analyze-failed:502");
  });
});
