import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import {
  assertSafeWebhookUrl,
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

describe("destination policy", () => {
  it("allows public https endpoints", () => {
    assert.doesNotThrow(() =>
      assertSafeWebhookUrl("https://example.com/hook"),
    );
    assert.doesNotThrow(() =>
      assertSafeWebhookUrl("https://hooks.slack.com:443/services/x"),
    );
  });

  it("rejects loopback, private, and link-local targets", () => {
    const evil = [
      "http://127.0.0.1:3000/hook",
      "http://localhost/hook",
      "http://localhost:8080/x",
      "http://10.0.0.5/hook",
      "http://172.16.4.2/hook",
      "http://192.168.1.10/hook",
      "http://169.254.169.254/latest/meta-data/",
      "http://metadata.google.internal/x",
      "http://[::1]/hook",
      "http://[fe80::1]/hook",
      "http://0.0.0.0/hook",
      "ftp://example.com/hook",
      "not-a-url",
      "https://user:pass@example.com/hook",
      "http://myapp.local/hook",
    ];
    for (const url of evil) {
      assert.throws(() => assertSafeWebhookUrl(url), /Invalid webhook URL/, url);
    }
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
