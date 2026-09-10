import { convexTest } from "convex-test";

import { api } from "../src/component/_generated/api.js";
import schema from "../src/component/schema.js";

const modules = import.meta.glob("../src/component/**/*.ts");

export function setup() {
  return convexTest(schema, modules);
}

export type TestInstance = ReturnType<typeof setup>;

let boardSeq = 0;

export async function createBoard(
  t: TestInstance,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  boardSeq += 1;
  return (await t.mutation(api.boards.create, {
    slug: `board-${boardSeq}`,
    name: `Board ${boardSeq}`,
    ...overrides,
  })) as string;
}

export async function createItem(
  t: TestInstance,
  boardId: string,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  return (await t.mutation(api.items.create, {
    boardId,
    actorId: "alice",
    title: "Dark mode",
    body: "Please add dark mode.",
    kind: "idea",
    ...overrides,
  })) as string;
}

/**
 * A well-formed but unallocated document ID: bumps the numeric prefix of a
 * real ID far past anything allocated in the isolated test database, keeping
 * the table suffix intact so `v.id` validators accept it. Used to exercise
 * handler-level "not found" paths (malformed IDs are rejected by validators
 * before handlers ever run).
 */
export function ghostId(realId: string): string {
  const match = realId.match(/^([0-9]+)(.*)$/);
  if (!match) throw new Error(`Cannot forge ghost ID from ${realId}`);
  return `${BigInt(match[1]) + 999999n}${match[2]}`;
}
