import type { EmbeddingProvider } from "./types.js";

/** Best-effort provider boundary. Callers persist a successful vector
 * asynchronously; null means retain lexical matching and retry later. */
export async function tryEmbed(
  provider: EmbeddingProvider | undefined,
  text: string,
): Promise<readonly number[] | null> {
  return (await tryEmbedResult(provider, text)).vector;
}
export type EmbeddingResult = { vector: readonly number[] | null; reason?: "unconfigured" | "empty" | "provider_error" | "invalid_vector" };
export async function tryEmbedResult(provider: EmbeddingProvider | undefined, text: string): Promise<EmbeddingResult> {
  if (!provider) return { vector: null, reason: "unconfigured" };
  if (!text.trim()) return { vector: null, reason: "empty" };
  try {
    const vector = await provider.embed({ text });
    if (vector.length !== provider.dimensions || vector.some((value) => !Number.isFinite(value))) return { vector: null, reason: "invalid_vector" };
    return { vector };
  } catch { return { vector: null, reason: "provider_error" }; }
}
