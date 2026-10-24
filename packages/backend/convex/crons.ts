import { cronJobs } from "convex/server";
import { components, internal } from "./_generated/api.js";
import { internalMutation } from "./_generated/server.js";

const crons = cronJobs();

const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

crons.interval(
  "process-scheduled-email-campaigns",
  { minutes: 5 },
  internal.campaigns.processDueCampaigns,
  {},
);

crons.interval(
  "queue-maintenance-refresh-recovery",
  { minutes: 60 },
  internal.campaigns.enqueueMaintenanceRefreshRecovery,
  {},
);

export const cleanupResend = internalMutation({
  args: {},
  handler: async (ctx) => {
    await ctx.scheduler.runAfter(0, components.resend.lib.cleanupOldEmails, {
      olderThan: ONE_WEEK_MS,
    });
    await ctx.scheduler.runAfter(
      0,
      components.resend.lib.cleanupAbandonedEmails,
      { olderThan: ONE_WEEK_MS },
    );
  },
});

// Note: Cron job can be set up manually in Convex dashboard:
// Run "crons.interval" with name "cleanupResend" and schedule "{ hours: 1 }"

export default crons;
