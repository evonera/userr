import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import {
  generateWebhookSecret,
  nextRetryAt,
  secretPreview,
  signWebhook,
  verifyWebhookSignature,
} from "./webhooks.js";

describe("webhook crypto", () => {
  it("signs and verifies round-trip", async () => {
    const secret = generateWebhookSecret();
    assert.equal(secret.length, 64);
    const signature = await signWebhook(secret, '{"a":1}');
    assert.ok(signature.startsWith("sha256="));
    assert.equal(await verifyWebhookSignature(secret, '{"a":1}', signature), true);
  });

  it("rejects tampered bodies and wrong secrets", async () => {
    const secret = generateWebhookSecret();
    const signature = await signWebhook(secret, '{"a":1}');
    assert.equal(
      await verifyWebhookSignature(secret, '{"a":2}', signature),
      false,
    );
    assert.equal(
      await verifyWebhookSignature(generateWebhookSecret(), '{"a":1}', signature),
      false,
    );
  });

  it("fails closed on malformed signatures", async () => {
    const secret = generateWebhookSecret();
    assert.equal(await verifyWebhookSignature(secret, "x", ""), false);
    assert.equal(await verifyWebhookSignature(secret, "x", "sha256:abc"), false);
    assert.equal(
      await verifyWebhookSignature(secret, "x", "sha256=dead"),
      false,
    );
  });

  it("masks secrets to the last four chars", () => {
    assert.equal(secretPreview("abcdef1234"), "…1234");
  });
});

describe("retry schedule", () => {
  it("spaces retries then exhausts", () => {
    const now = 1_000_000;
    assert.equal(nextRetryAt(1, now), now + 60_000);
    assert.equal(nextRetryAt(5, now), now + 43_200_000);
    assert.equal(nextRetryAt(6, now), null);
    assert.equal(nextRetryAt(99, now), null);
  });
});
