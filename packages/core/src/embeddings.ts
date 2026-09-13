import type { EmbeddingProvider } from "./types.js";

/** Best-effort provider boundary. Callers persist a successful vector
 * asynchronously; null means retain lexical matching and retry later. */
export async function tryEmbed(
  provider: EmbeddingProvider | undefined,
  text: string,
): Promise<readonly number[] | null> {
  if (!provider || !text.trim()) return null;
  try {
    const vector = await provider.embed({ text });
    if (vector.length !== provider.dimensions || vector.some((value) => !Number.isFinite(value))) return null;
    return vector;
  } catch { return null; }
}
