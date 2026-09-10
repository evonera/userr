import { defineSchema } from "convex/server";

// The host app owns its tables. Userr's tables live in the component and are
// namespaced automatically; this schema stays empty until the host needs its
// own data (user profiles, billing, ...).
export default defineSchema({});
