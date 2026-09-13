import assert from "node:assert/strict";
import test from "node:test";
import { authorizeWidgetSubmission, signWidgetToken, verifyWidgetToken, type RateLimitRequest } from "./widget-security.js";

const secret = "0123456789abcdef0123456789abcdef";
const claims = { version: 1 as const, boardId: "board", subject: "actor-1", nonce: "nonce-1", issuedAt: 1_000, expiresAt: 61_000 };

test("widget host tokens are scoped, short-lived, and tamper evident", async () => {
  const token = await signWidgetToken(secret, claims);
  assert.deepEqual(await verifyWidgetToken(secret, token, "board", 2_000), { valid: true, claims });
  assert.deepEqual(await verifyWidgetToken(secret, token, "other", 2_000), { valid: false, reason: "wrong_board" });
  assert.deepEqual(await verifyWidgetToken(secret, token, "board", 61_000), { valid: false, reason: "expired" });
  const [payload, signature] = token.split("."); const tamperedSignature = `${signature.slice(0, -1)}${signature.endsWith("0") ? "1" : "0"}`;
  assert.deepEqual(await verifyWidgetToken(secret, `${payload}.${tamperedSignature}`, "board", 2_000), { valid: false, reason: "invalid_signature" });
});

test("widget guard consumes subject and network limits in one host transaction", async () => {
  const token = await signWidgetToken(secret, claims); let requests: readonly RateLimitRequest[] = [];
  const allowed = await authorizeWidgetSubmission({ token, secret, boardId: "board", networkFingerprint: "hashed-network", now: 2_000, limiter: { consumeMany: async (input) => { requests = input; return { allowed: true }; } } });
  assert.equal(allowed.allowed, true); assert.deepEqual(requests, [{ key: "widget:Ym9hcmQ:subject:YWN0b3ItMQ", limit: 10, windowMs: 60_000 }, { key: "widget:Ym9hcmQ:network:aGFzaGVkLW5ldHdvcms", limit: 30, windowMs: 60_000 }]);
  const denied = await authorizeWidgetSubmission({ token, secret, boardId: "board", networkFingerprint: "hashed-network", now: 2_000, limiter: { consumeMany: async () => ({ allowed: false, retryAfterMs: 500 }) } });
  assert.deepEqual(denied, { allowed: false, reason: "rate_limited", retryAfterMs: 500 });
});
