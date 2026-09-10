import type { Id, WebhookEnvelope, WebhookEventType } from "./types.js";

/** Vote counts that fan out to webhooks. Every vote still writes its row and
 *  bumps the counter; only these milestones enqueue a delivery (spam control). */
export const VOTE_MILESTONES: readonly number[] = [10, 25, 50, 100];

/** Retry delays after each failed attempt: immediate is attempt 0's delivery,
 *  then 1m, 5m, 30m, 2h, 12h. Past the end of the schedule the webhook is
 *  marked failing and deliveries stop being retried. */
export const RETRY_DELAYS_MS: readonly number[] = [
  60_000, 300_000, 1_800_000, 7_200_000, 43_200_000,
];

/** Next retry timestamp after `attempts` total attempts, or null when the
 *  schedule is exhausted (caller marks the webhook failing). */
export function nextRetryAt(attempts: number, now: number): number | null {
  const delay = RETRY_DELAYS_MS[attempts - 1];
  if (delay === undefined) return null;
  return now + delay;
}

/** Unguessable webhook secret. Uses only global Web Crypto, so it runs in
 *  Convex isolates, Node, workers, and browsers alike. */
export function generateWebhookSecret(): string {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function secretPreview(secret: string): string {
  return `…${secret.slice(-4)}`;
}

function bytesToHex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/** HMAC-SHA256 signature (`sha256=<hex>`) for the `X-Feedback-Signature`
 *  header. Async Web Crypto — portable across Convex, Node, and edge. */
export async function signWebhook(secret: string, body: string): Promise<string> {
  const key = await globalThis.crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await globalThis.crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(body),
  );
  return `sha256=${bytesToHex(signature)}`;
}

/** Verify a received signature in constant time. Returns false on malformed
 *  input instead of throwing, so receivers can fail closed cleanly. */
export async function verifyWebhookSignature(
  secret: string,
  body: string,
  signature: string,
): Promise<boolean> {
  if (!signature.startsWith("sha256=")) return false;
  const expected = await signWebhook(secret, body);
  const a = hexToBytes(expected.slice(7));
  const b = hexToBytes(signature.slice(7));
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export function buildEnvelope(input: {
  deliveryId: Id;
  type: WebhookEventType;
  occurredAt: number;
  board: { id: Id; slug: string; name: string };
  data: Record<string, unknown>;
}): WebhookEnvelope {
  return {
    id: input.deliveryId,
    type: input.type,
    occurredAt: input.occurredAt,
    board: input.board,
    data: input.data,
  };
}
