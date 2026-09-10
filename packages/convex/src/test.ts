/// <reference types="vite/client" />

import type { TestConvex } from "convex-test";
import type { GenericSchema, SchemaDefinition } from "convex/server";

import schema from "./component/schema.js";

const modules = import.meta.glob("./component/**/*.ts");

/**
 * Register the Userr component on a `convexTest` instance, mirroring how a
 * host app mounts it with `app.use(userr)`. Consumers call this with their own
 * app-level test instance; the component's tables stay isolated under `name`.
 */
export function register(
  test: TestConvex<SchemaDefinition<GenericSchema, boolean>>,
  name = "userr",
): void {
  test.registerComponent(name, schema, modules);
}

export { modules, schema };
export default { modules, register, schema };
