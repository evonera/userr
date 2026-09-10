import { afterEach, describe, test } from "vitest";

import { runConformanceSuite } from "@userr/core";

import { repository, setupDatabase, type TestDb } from "./setup.js";

/**
 * Phase 2 proof: the Postgres adapter satisfies the same shared domain
 * contract as the Convex component. Parity is claimed on this suite, not on
 * inspection.
 */
describe("domain conformance (Postgres)", () => {
  let close: (() => Promise<void>) | null = null;

  afterEach(async () => {
    if (close) {
      await close();
      close = null;
    }
  });

  test("Postgres adapter passes the shared suite", async () => {
    const setup: { db: TestDb; close: () => Promise<void> } =
      await setupDatabase();
    close = setup.close;
    await runConformanceSuite(repository(setup.db));
  });
});
