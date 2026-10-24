import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { modules } from "./test.setup";
import { seedBookingSetup } from "./testUtils/bookingSetup";

async function createExpiredDraft(
  t: ReturnType<typeof convexTest>,
  args: {
    email: string;
    maintenanceServiceId: Awaited<ReturnType<typeof seedServices>>["maintenanceServiceId"];
  },
) {
  const draft = await t.mutation(
    internal.bookingDrafts.createOrUpdateInternal,
    {
      name: args.email.split("@")[0],
      email: args.email,
      phone: "555-0100",
      address: {
        street: "100 Main St",
        city: "Little Rock",
        state: "AR",
        zip: "72201",
      },
      vehicles: [
        {
          year: 2022,
          make: "Toyota",
          model: "Highlander",
          size: "medium",
          serviceIds: [args.maintenanceServiceId],
        },
      ],
      serviceIds: [args.maintenanceServiceId],
      scheduledDate: "2026-08-03",
      scheduledTime: "10:00",
      travelDistanceMiles: 0,
    },
  );
  await t.run(async (ctx) => {
    await ctx.db.patch(draft.draftId, {
      status: "expired",
      expiredAt: Date.now(),
      lastActivityAt: Date.now(),
    });
  });
  return draft.draftId;
}

async function seedServices(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const maintenanceServiceId = await ctx.db.insert("services", {
      name: "Maintenance Refresh",
      description: "Recurring maintenance.",
      basePrice: 175,
      basePriceSmall: 150,
      basePriceMedium: 175,
      basePriceLarge: 200,
      duration: 90,
      serviceType: "standard",
      bookingRole: "core",
      isActive: true,
      isSubscribable: true,
      subscriptionFrequencies: ["monthly", "biweekly"],
    });
    const planServiceId = await ctx.db.insert("services", {
      name: "River City Maintenance Club",
      description: "Monthly membership.",
      basePrice: 145,
      basePriceSmall: 125,
      basePriceMedium: 145,
      basePriceLarge: 165,
      duration: 90,
      serviceType: "subscription",
      bookingRole: "core",
      isActive: true,
      includedServiceIds: [maintenanceServiceId],
      subscriptionFrequencies: ["monthly"],
    });
    return { maintenanceServiceId, planServiceId };
  });
}

describe("membership campaign audience", () => {
  test("requires marketing consent and respects suppressions", async () => {
    const t = convexTest(schema, modules);
    await seedBookingSetup(t, { includeBookableService: false });
    const { maintenanceServiceId } = await seedServices(t);

    const adminId = await t.run(async (ctx) => {
      return await ctx.db.insert("users", {
        name: "Admin",
        email: "campaign-admin@example.com",
        role: "admin",
      });
    });

    await t.run(async (ctx) => {
      await ctx.db.insert("users", {
        name: "Opted In",
        email: "opted-in@example.com",
        notificationPreferences: { marketingEmails: true },
      });
      await ctx.db.insert("users", {
        name: "No Consent",
        email: "no-consent@example.com",
        notificationPreferences: { marketingEmails: false },
      });
      await ctx.db.insert("users", {
        name: "Suppressed",
        email: "suppressed@example.com",
        notificationPreferences: { marketingEmails: true },
      });
      await ctx.db.insert("emailSuppressions", {
        email: "suppressed@example.com",
        reason: "unsubscribe",
        source: "test",
        createdAt: Date.now(),
      });
    });

    await createExpiredDraft(t, {
      email: "opted-in@example.com",
      maintenanceServiceId,
    });
    await createExpiredDraft(t, {
      email: "no-consent@example.com",
      maintenanceServiceId,
    });
    await createExpiredDraft(t, {
      email: "suppressed@example.com",
      maintenanceServiceId,
    });

    const result = await t.query(
      internal.campaigns.resolveAudienceInternal,
      { audience: { statuses: ["expired"] } },
    );

    expect(result.counts).toMatchObject({
      total: 3,
      eligible: 1,
      skippedNoConsent: 1,
      skippedSuppressed: 1,
      replacement: 3,
      afterDetail: 0,
    });
    const optedIn = result.candidates.find(
      (candidate) => candidate.email === "opted-in@example.com",
    );
    expect(optedIn?.consent).toBe(true);
    expect(optedIn?.metadata).toMatchObject({
      planName: "River City Maintenance Club",
      includedServiceName: "Maintenance Refresh",
      monthlyPrice: 145,
      oneTimePrice: 175,
      savingsPerVisit: 30,
      annualSavings: 360,
      membershipKind: "replacement",
    });

    const campaign = await t.mutation(
      internal.campaigns.createCampaignInternal,
      {
        name: "Test campaign",
        audience: { statuses: ["expired"] },
        createdBy: adminId,
        candidates: result.candidates,
      },
    );
    expect(campaign).toMatchObject({
      totalRecipients: 3,
      eligible: 1,
      skipped: 2,
    });

    const recipients = await t.run(async (ctx) => {
      return await ctx.db
        .query("emailCampaignRecipients")
        .withIndex("by_campaign", (q) => q.eq("campaignId", campaign.campaignId))
        .collect();
    });
    expect(
      recipients.filter((recipient) => recipient.status === "pending"),
    ).toHaveLength(1);
    expect(
      recipients.filter((recipient) => recipient.status === "skipped"),
    ).toHaveLength(2);

    const pendingRecipient = recipients.find(
      (recipient) => recipient.status === "pending",
    )!;
    const unsubscribeResult = await t.mutation(api.campaigns.unsubscribe, {
      token: pendingRecipient.unsubscribeToken,
    });
    expect(unsubscribeResult.success).toBe(true);

    const user = await t.run(async (ctx) => {
      return await ctx.db
        .query("users")
        .withIndex("by_email", (q) => q.eq("email", "opted-in@example.com"))
        .first();
    });
    expect(user?.notificationPreferences?.marketingEmails).toBe(false);

    const suppression = await t.run(async (ctx) => {
      return await ctx.db
        .query("emailSuppressions")
        .withIndex("by_email", (q) => q.eq("email", "opted-in@example.com"))
        .first();
    });
    expect(suppression?.reason).toBe("unsubscribe");
  });

  test("schedules campaigns and claims them when due", async () => {
    const t = convexTest(schema, modules);
    await seedBookingSetup(t, { includeBookableService: false });
    const { maintenanceServiceId } = await seedServices(t);

    const adminId = await t.run(async (ctx) => {
      return await ctx.db.insert("users", {
        name: "Scheduler Admin",
        email: "scheduler-admin@example.com",
        role: "admin",
      });
    });
    const draftId = await createExpiredDraft(t, {
      email: "scheduled@example.com",
      maintenanceServiceId,
    });

    const future = Date.now() + 60 * 60 * 1000;
    const campaign = await t.mutation(
      internal.campaigns.createCampaignInternal,
      {
        name: "Scheduled campaign",
        audience: { statuses: ["expired"] },
        createdBy: adminId,
        scheduledAt: future,
        status: "scheduled",
        candidates: [
          {
            draftId,
            email: "scheduled@example.com",
            name: "Scheduled",
            consent: true,
            metadata: {
              planName: "River City Maintenance Club",
              includedServiceName: "Maintenance Refresh",
              monthlyPrice: 145,
              oneTimePrice: 175,
              savingsPerVisit: 30,
              annualSavings: 360,
              membershipKind: "replacement" as const,
            },
          },
        ],
      },
    );
    expect(campaign.scheduledAt).toBe(future);

    const scheduledCampaign = await t.run(async (ctx) => {
      return await ctx.db.get(campaign.campaignId);
    });
    expect(scheduledCampaign?.status).toBe("scheduled");
    expect(scheduledCampaign?.startedAt).toBeUndefined();

    const claimedTooEarly = await t.mutation(
      internal.campaigns.claimDueCampaignsInternal,
      {},
    );
    expect(claimedTooEarly).toEqual([]);

    await t.run(async (ctx) => {
      await ctx.db.patch(campaign.campaignId, {
        scheduledAt: Date.now() - 1000,
      });
    });

    const claimed = await t.mutation(
      internal.campaigns.claimDueCampaignsInternal,
      {},
    );
    expect(claimed).toEqual([campaign.campaignId]);

    const sendingCampaign = await t.run(async (ctx) => {
      return await ctx.db.get(campaign.campaignId);
    });
    expect(sendingCampaign?.status).toBe("sending");
    expect(sendingCampaign?.startedAt).toBeTypeOf("number");
  });

  test("dedupes Maintenance Refresh recovery candidates by email", async () => {
    const t = convexTest(schema, modules);
    await seedBookingSetup(t, { includeBookableService: false });
    const { maintenanceServiceId } = await seedServices(t);

    await createExpiredDraft(t, {
      email: "repeat@example.com",
      maintenanceServiceId,
    });
    await createExpiredDraft(t, {
      email: "repeat@example.com",
      maintenanceServiceId,
    });
    await createExpiredDraft(t, {
      email: "unique@example.com",
      maintenanceServiceId,
    });

    const result = await t.query(
      internal.campaigns.findMaintenanceRefreshRecoveryCandidatesInternal,
      {},
    );
    expect(result.candidates).toHaveLength(2);
    expect(
      result.candidates.map((candidate) => candidate.email).sort(),
    ).toEqual(["repeat@example.com", "unique@example.com"]);
  });

  test("excludes existing customers but keeps the allowlisted admin", async () => {
    const t = convexTest(schema, modules);
    await seedBookingSetup(t, { includeBookableService: false });
    const { maintenanceServiceId } = await seedServices(t);

    const existingUserId = await t.run(async (ctx) => {
      return await ctx.db.insert("users", {
        name: "Existing Customer",
        email: "existing-customer@example.com",
        role: "client",
      });
    });
    await t.run(async (ctx) => {
      await ctx.db.insert("appointments", {
        userId: existingUserId,
        vehicleIds: [],
        serviceIds: [],
        scheduledDate: "2026-08-04",
        scheduledTime: "10:00",
        duration: 60,
        location: {
          street: "100 Main St",
          city: "Little Rock",
          state: "AR",
          zip: "72201",
        },
        status: "completed",
        totalPrice: 100,
        createdBy: existingUserId,
      });
    });

    const adminId = await t.run(async (ctx) => {
      return await ctx.db.insert("users", {
        name: "Cameron Stewart",
        email: "camstewart7@gmail.com",
        role: "admin",
      });
    });
    await t.run(async (ctx) => {
      await ctx.db.insert("appointments", {
        userId: adminId,
        vehicleIds: [],
        serviceIds: [],
        scheduledDate: "2026-08-05",
        scheduledTime: "11:00",
        duration: 60,
        location: {
          street: "100 Main St",
          city: "Little Rock",
          state: "AR",
          zip: "72201",
        },
        status: "completed",
        totalPrice: 100,
        createdBy: adminId,
      });
    });

    await createExpiredDraft(t, {
      email: "existing-customer@example.com",
      maintenanceServiceId,
    });
    await createExpiredDraft(t, {
      email: "new-customer@example.com",
      maintenanceServiceId,
    });
    await createExpiredDraft(t, {
      email: "camstewart7@gmail.com",
      maintenanceServiceId,
    });

    const result = await t.query(
      internal.campaigns.findMaintenanceRefreshRecoveryCandidatesInternal,
      {},
    );
    expect(
      result.candidates.map((candidate) => candidate.email).sort(),
    ).toEqual(["camstewart7@gmail.com", "new-customer@example.com"]);
  });

  test("queues recovery for specific drafts", async () => {
    const t = convexTest(schema, modules);
    await seedBookingSetup(t, { includeBookableService: false });
    const { maintenanceServiceId } = await seedServices(t);
    const draftId = await createExpiredDraft(t, {
      email: "specific@example.com",
      maintenanceServiceId,
    });

    const result = await t.action(
      internal.campaigns.enqueueRecoveryForDraftsInternal,
      { draftIds: [draftId] },
    );
    expect(result.queued).toHaveLength(1);
    expect(result.queued[0]?.draftId).toBe(draftId);

    const draft = await t.run(async (ctx) => {
      return await ctx.db.get(draftId);
    });
    expect(draft?.abandonedEmailScheduledId).toBeTypeOf("string");
    expect(draft?.abandonedFollowUpScheduledId).toBeTypeOf("string");
  });

  test("excludes admin accounts from recovery candidates", async () => {
    const t = convexTest(schema, modules);
    await seedBookingSetup(t, { includeBookableService: false });
    const { maintenanceServiceId } = await seedServices(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("users", {
        name: "Admin User",
        email: "admin-user@example.com",
        role: "admin",
      });
    });
    await createExpiredDraft(t, {
      email: "admin-user@example.com",
      maintenanceServiceId,
    });

    const result = await t.query(
      internal.campaigns.findMaintenanceRefreshRecoveryCandidatesInternal,
      {},
    );
    expect(result.candidates).toHaveLength(0);
  });
});
