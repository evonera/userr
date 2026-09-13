import { signWebhook, verifyWebhookSignature } from "./webhooks.js";

export interface WidgetTokenClaims { version: 1; boardId: string; subject: string; nonce: string; issuedAt: number; expiresAt: number; }
export type WidgetTokenFailureReason = "malformed" | "invalid_signature" | "expired" | "not_yet_valid" | "wrong_board";
export type WidgetTokenVerification = { valid: true; claims: WidgetTokenClaims } | { valid: false; reason: WidgetTokenFailureReason };
export interface RateLimitRequest { key: string; limit: number; windowMs: number; }
export interface AtomicRateLimiter { consumeMany(requests: readonly RateLimitRequest[]): Promise<{ allowed: boolean; retryAfterMs?: number }>; }
export interface WidgetGuardInput { token: string; secret: string; boardId: string; networkFingerprint: string; limiter: AtomicRateLimiter; now?: number; subjectLimit?: Omit<RateLimitRequest, "key">; networkLimit?: Omit<RateLimitRequest, "key">; }
export type WidgetGuardResult = { allowed: true; claims: WidgetTokenClaims } | { allowed: false; reason: WidgetTokenFailureReason } | { allowed: false; reason: "rate_limited"; retryAfterMs?: number };

const MAX_TOKEN_BYTES = 4096;
const MAX_TOKEN_TTL_MS = 60 * 60 * 1000;
const CLOCK_SKEW_MS = 30_000;

function encodeBase64Url(value: string): string { const bytes = new TextEncoder().encode(value); let binary = ""; for (const byte of bytes) binary += String.fromCharCode(byte); return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, ""); }
function decodeBase64Url(value: string): string { const padded = value.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - value.length % 4) % 4); const binary = atob(padded); return new TextDecoder().decode(Uint8Array.from(binary, (character) => character.charCodeAt(0))); }
function validText(value: unknown): value is string { return typeof value === "string" && value.length > 0 && value.length <= 200; }
function validateClaims(value: unknown): value is WidgetTokenClaims { if (!value || typeof value !== "object") return false; const claims = value as Partial<WidgetTokenClaims>; return claims.version === 1 && validText(claims.boardId) && validText(claims.subject) && validText(claims.nonce) && Number.isSafeInteger(claims.issuedAt) && Number.isSafeInteger(claims.expiresAt) && Number(claims.expiresAt) > Number(claims.issuedAt) && Number(claims.expiresAt) - Number(claims.issuedAt) <= MAX_TOKEN_TTL_MS; }
function validateSecret(secret: string): void { if (new TextEncoder().encode(secret).length < 32) throw new Error("Widget token secrets must contain at least 32 bytes."); }

/** Creates a short-lived host token. The HMAC secret must remain server-side. */
export async function signWidgetToken(secret: string, claims: WidgetTokenClaims): Promise<string> {
  validateSecret(secret); if (!validateClaims(claims)) throw new Error("Widget token claims are invalid or exceed the one-hour lifetime."); const payload = encodeBase64Url(JSON.stringify(claims)); const signature = await signWebhook(secret, payload); return `${payload}.${signature}`;
}

/** Verifies signature, lifetime, and board scope without throwing on untrusted token input. */
export async function verifyWidgetToken(secret: string, token: string, expectedBoardId: string, now = Date.now()): Promise<WidgetTokenVerification> {
  validateSecret(secret); if (!Number.isSafeInteger(now) || token.length > MAX_TOKEN_BYTES) return { valid: false, reason: "malformed" }; const parts = token.split("."); if (parts.length !== 2 || !parts[0] || !parts[1]) return { valid: false, reason: "malformed" };
  let claims: unknown; try { claims = JSON.parse(decodeBase64Url(parts[0])); } catch { return { valid: false, reason: "malformed" }; } if (!validateClaims(claims)) return { valid: false, reason: "malformed" }; if (!await verifyWebhookSignature(secret, parts[0], parts[1])) return { valid: false, reason: "invalid_signature" }; if (claims.boardId !== expectedBoardId) return { valid: false, reason: "wrong_board" }; if (claims.issuedAt > now + CLOCK_SKEW_MS) return { valid: false, reason: "not_yet_valid" }; if (claims.expiresAt <= now) return { valid: false, reason: "expired" }; return { valid: true, claims };
}

/** Verifies a host token, then atomically consumes subject and host-hashed network limits. */
export async function authorizeWidgetSubmission(input: WidgetGuardInput): Promise<WidgetGuardResult> {
  const verification = await verifyWidgetToken(input.secret, input.token, input.boardId, input.now); if (!verification.valid) return { allowed: false, reason: verification.reason }; if (!validText(input.networkFingerprint)) throw new Error("A non-empty host-hashed network fingerprint is required.");
  const subjectLimit = input.subjectLimit ?? { limit: 10, windowMs: 60_000 }; const networkLimit = input.networkLimit ?? { limit: 30, windowMs: 60_000 }; for (const limit of [subjectLimit, networkLimit]) if (!Number.isSafeInteger(limit.limit) || limit.limit <= 0 || !Number.isSafeInteger(limit.windowMs) || limit.windowMs <= 0) throw new Error("Widget rate limits must be positive integers.");
  const boardKey = encodeBase64Url(input.boardId); const subjectKey = encodeBase64Url(verification.claims.subject); const networkKey = encodeBase64Url(input.networkFingerprint); const result = await input.limiter.consumeMany([{ key: `widget:${boardKey}:subject:${subjectKey}`, ...subjectLimit }, { key: `widget:${boardKey}:network:${networkKey}`, ...networkLimit }]); return result.allowed ? { allowed: true, claims: verification.claims } : { allowed: false, reason: "rate_limited", retryAfterMs: result.retryAfterMs };
}
