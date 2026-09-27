/**
 * Convex HTTP action helper for the server-side live route.
 *
 * The route runs in a Next.js Route Handler, not inside a React render tree,
 * so it uses Convex's HTTP actions endpoint. NEXT_PUBLIC_CONVEX_URL is the
 * deployment URL — safe to read server-side (it is public by design; the
 * provider API keys are the secrets, and those never appear here).
 */
export function getConvexSiteUrl(): string {
  const url =
    process.env.NEXT_PUBLIC_CONVEX_URL ||
    process.env.CONVEX_URL ||
    process.env.NEXT_PUBLIC_CONVEX_SITE_URL ||
    "";
  if (!url) {
    throw new Error(
      "NEXT_PUBLIC_CONVEX_URL is not set — cannot write threat logs to Convex",
    );
  }
  return url.replace(/\/$/, "");
}
