import { defineApp } from "convex/server";
import userr from "@userr/convex/convex.config.js";

const app = defineApp();
app.use(userr);
export default app;
