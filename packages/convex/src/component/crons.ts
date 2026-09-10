import { cronJobs } from "convex/server";

import { internal } from "./_generated/api.js";

const crons = cronJobs();

// Off the top of the hour by Convex's own spreading guidance: let the
// platform pick the minute within the interval cadence.
crons.interval("deliver webhooks", { minutes: 1 }, internal.webhooks.deliverDue, {
  limit: 20,
});

export default crons;
