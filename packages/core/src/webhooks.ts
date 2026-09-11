import type { Id, WebhookEnvelope, WebhookEventType } from "./types.js";

/** Vote counts that fan out to webhooks. Every vote still writes its row and
 *  bumps the counter; only these milestones enqueue a delivery (spam control). */
export const VOTE_MILESTONES: readonly number[] = [10, 25, 50, 100];

/** Bounded per-request timeout for webhook delivery (10s). Endpoints that
 *  accept a connection but never respond must fail the attempt — never stall
 *  the batch. Both workers pass this to fetch; tests override it lower. */
export const WEBHOOK_TIMEOUT_MS = 10_000;

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

function isIPv4(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
}

function ipv4Bytes(host: string): [number, number, number, number] | null {
  const parts = host.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return null;
  }
  return parts as [number, number, number, number];
}

function isBlockedIPv4(host: string): boolean {
  const bytes = ipv4Bytes(host);
  if (!bytes) return true; // malformed numeric host: fail closed
  const [a, b] = bytes;
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 0) return true;
  return false;
}

function isBlockedIPv6(host: string): boolean {
  const h = host.toLowerCase();
  if (h === "::1" || h === "::") return true;
  if (h.startsWith("fe80:") || h.startsWith("fe80::")) return true;
  if (h.startsWith("fc") || h.startsWith("fd")) return true;
  if (h.includes(":")) return true; // any other literal IPv6: fail closed
  return false;
}

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "metadata.google.internal",
  "metadata.google.com",
  "instance-data",
  "instance-data-compute",
]);

/**
 * Outbound destination policy for webhook URLs. Blocks loopback, private,
 * link-local (incl. cloud metadata endpoints), and malformed hosts at
 * registration time, on both adapters.
 *
 * Deliberately syntactic (no DNS resolution) so it runs offline in tests and
 * validators: DNS-rebinding past this check is a documented residual risk
 * (see webhook-protocol.md). Delivery complements it with redirect:"manual"
 * (no redirect-target SSRF) plus a bounded timeout.
 */
export function assertSafeWebhookUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid webhook URL: unparseable "${url}".`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Invalid webhook URL: must be http(s).");
  }
  if (parsed.username || parsed.password) {
    throw new Error("Invalid webhook URL: credentials are not allowed.");
  }
  const host = parsed.hostname.toLowerCase().replace(/\.$/, "");
  if (!host) throw new Error("Invalid webhook URL: missing host.");
  if (BLOCKED_HOSTNAMES.has(host)) {
    throw new Error(`Invalid webhook URL: host "${host}" is blocked.`);
  }
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new Error(`Invalid webhook URL: host "${host}" is internal.`);
  }
  if (isIPv4(host)) {
    if (isBlockedIPv4(host)) {
      throw new Error(`Invalid webhook URL: IP "${host}" is private or reserved.`);
    }
    return;
  }
  if (host.includes(":")) {
    if (isBlockedIPv6(host)) {
      throw new Error(`Invalid webhook URL: IP "${host}" is private or reserved.`);
    }
    return;
  }
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
