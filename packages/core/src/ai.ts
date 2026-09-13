import type { TextGenerationProvider } from "./types.js";

export type CompletionResult =
  | { text: string; reason?: undefined }
  | { text: null; reason: "unconfigured" | "empty" | "provider_error" };

/**
 * Best-effort text generation boundary for host jobs. It has no provider SDK,
 * key access, persistence, or retry policy. A null result is deliberately
 * usable: callers retain their normal non-AI workflow and may retry later.
 */
export async function tryComplete(
  provider: TextGenerationProvider | undefined,
  prompt: string,
): Promise<CompletionResult> {
  if (!provider) return { text: null, reason: "unconfigured" };
  if (!prompt.trim()) return { text: null, reason: "empty" };
  try {
    const text = (await provider.complete({ prompt })).trim();
    return text ? { text } : { text: null, reason: "empty" };
  } catch {
    return { text: null, reason: "provider_error" };
  }
}
