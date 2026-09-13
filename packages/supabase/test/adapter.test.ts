import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { vector } from "@electric-sql/pglite/vector";
import { runConformanceSuite } from "@userr/core";
import * as schema from "@userr/neon/schema";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterEach, describe, expect, test } from "vitest";

import {
  createPrivateFeedbackChannel,
  createRepository,
  feedbackTopic,
  SUPABASE_MIGRATION_PATHS,
} from "../src/index.js";

describe("Supabase adapter", () => {
  let close: (() => Promise<void>) | undefined;

  afterEach(async () => {
    await close?.();
    close = undefined;
  });

  test("shares the complete Postgres repository contract", async () => {
    const client = new PGlite({ extensions: { vector, pg_trgm } });
    await client.waitReady;
    const db = drizzle(client, { schema });
    await migrate(db, {
      migrationsFolder: fileURLToPath(
        new URL("../../neon/drizzle", import.meta.url),
      ),
    });
    close = () => client.close();
    await runConformanceSuite(createRepository(db));
  });

  test("uses only private feedback channels", () => {
    expect(feedbackTopic("board_1")).toBe("feedback:board_1");
    expect(() => feedbackTopic("board:1")).toThrow(/topic segment/);
    const channel = { id: "channel" };
    const client = {
      channel: (topic: string, options: { config: { private: true } }) => {
        assert.equal(topic, "feedback:board_1");
        assert.deepEqual(options, { config: { private: true } });
        return channel;
      },
    };
    expect(createPrivateFeedbackChannel(client, "board_1")).toBe(channel);
  });

  test("ships full schema, RLS, and private Broadcast authorization", async () => {
    const root = new URL("../supabase/migrations/", import.meta.url);
    const [schemaSql, rlsSql, upgradeSql] = await Promise.all(
      ["0000_userr_schema.sql", "0001_userr_rls.sql", "0002_userr_upgrade.sql"].map(
        (name) => readFile(new URL(name, root), "utf8"),
      ),
    );
    expect(SUPABASE_MIGRATION_PATHS).toHaveLength(4);
    for (const table of [
      "comments",
      "events",
      "subscriptions",
      "changelog_entries",
      "roadmap_lanes",
      "webhooks",
      "deliveries",
      "blocked_actors",
    ]) {
      expect(schemaSql).toContain(`public.${table}`);
    }
    expect(schemaSql).toContain("vector(1536)");
    expect(schemaSql).toContain("pg_trgm");
    expect(upgradeSql).toContain("add column if not exists moderation");
    expect(rlsSql).toContain("for select to authenticated");
    expect(rlsSql).toContain("for insert to authenticated");
    expect(rlsSql).toContain("realtime.messages.extension = 'broadcast'");
    expect(rlsSql).toContain("realtime.topic()");
    expect(rlsSql).toContain("userr_realtime_memberships");
  });
});
