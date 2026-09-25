/**
 * Strip ```json ... ``` markdown fences some models wrap JSON in, so the raw
 * text is safe to hand to JSON.parse. Cloud watch providers share this.
 */
export function cleanJsonResponse(rawText: string): string {
  let cleaned = rawText.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/i, "");
    cleaned = cleaned.replace(/\n?```$/, "");
  }
  return cleaned.trim();
}
