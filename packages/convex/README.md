# `@userr/convex`

Install this package into a Convex app and register the component from
`convex/convex.config.ts`:

```ts
import { defineApp } from "convex/server";
import feedback from "@userr/convex/convex.config.js";

const app = defineApp();
app.use(feedback, { name: "feedback" });
export default app;
```

Component functions are not client-public. Re-export host functions that
resolve the current actor and authorization, then call the component through
your generated `components.feedback` reference. This prevents the component
from making assumptions about Better Auth, Clerk, Convex Auth, or a user table.
