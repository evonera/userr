import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite/vector";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";

import { createRepository } from "../src/repository.js";
import * as schema from "../src/schema.js";

export type TestDb = PgliteDatabase<typeof schema>;

/** Fresh PGlite database with extensions + migrations applied. PGlite runs
 *  real Postgres (including pgvector and pg_trgm) in-process, so the same
 *  suite that runs here runs against Neon in production with identical SQL. */
export async function setupDatabase(): Promise<{
  db: TestDb;
  close: () => Promise<void>;
}> {
  const client = new PGlite({ extensions: { vector, pg_trgm } });
  await client.waitReady;
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: "./drizzle" });
  return {
    db,
    close: () => client.close(),
  };
}

export function repository(db: TestDb) {
  return createRepository(db);
}
