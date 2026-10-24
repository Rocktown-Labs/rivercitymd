import { v } from "convex/values";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { getUserIdFromIdentity, requireAdmin } from "./auth";
import { getEffectiveServicePricingForVehicle } from "./lib/pricing";
import { normalizeUserNotificationPreferences } from "./lib/notificationSettings";
import { getCentralHour, getNextNineAmCentral } from "./lib/scheduling";

const campaignAudienceValidator = v.object({
  draftIds: v.optional(v.array(v.id("bookingDrafts"))),
  statuses: v.optional(
    v.array(
      v.union(
        v.literal("expired"),
        v.literal("checkout_open"),
        v.literal("cancelled"),
      ),
    ),
  ),
  serviceIds: v.optional(v.array(v.id("services"))),
  createdAfter: v.optional(v.number()),
  createdBefore: v.optional(v.number()),
  onlyMembershipEligible: v.optional(v.boolean()),
});

type CampaignAudience = {
  draftIds?: Id<"bookingDrafts">[];
  statuses?: Array<"expired" | "checkout_open" | "cancelled">;
  serviceIds?: Id<"services">[];
  createdAfter?: number;
  createdBefore?: number;
  onlyMembershipEligible?: boolean;
};

type MembershipOfferMetadata = {
  planName?: string;
  includedServiceName?: string;
  vehicleLabel?: string;
  oneTimePrice?: number;
  monthlyPrice?: number;
  savingsPerVisit?: number;
  annualSavings?: number;
  resumeUrl?: string;
  membershipKind?: "replacement" | "after_detail";
};

type RecipientCandidate = {
  draftId: Id<"bookingDrafts">;
  userId?: Id<"users">;
  email: string;
  name: string;
  consent: boolean;
  skipReason?: string;
  metadata: MembershipOfferMetadata;
};

type AudienceCounts = {
  total: number;
  eligible: number;
  skippedNoConsent: number;
  skippedSuppressed: number;
  skippedNoEmail: number;
  replacement: number;
  afterDetail: number;
};

type AudienceResolution = {
  candidates: RecipientCandidate[];
  counts: AudienceCounts;
};

function normalizeEmail(email: string | null | undefined) {
  return email?.trim().toLowerCase() ?? "";
}

function vehicleLabel(vehicle: {
  year?: number;
  make?: string;
  model?: string;
}) {
  return [vehicle.year, vehicle.make, vehicle.model]
    .filter(Boolean)
    .join(" ")
    .trim();
}

function servicePricingShape(
  service: Doc<"services">,
  prices: Doc<"serviceVehiclePrices">[],
  vehicleTypeById: Map<Id<"vehicleTypes">, Doc<"vehicleTypes">>,
) {
  return {
    ...service,
    vehiclePrices: prices
      .filter((row) => row.serviceId === service._id)
      .map((row) => ({
        ...row,
        vehicleType: vehicleTypeById.get(row.vehicleTypeId) ?? null,
      })),
  };
}

export const resolveAudienceInternal = internalQuery({
  args: { audience: campaignAudienceValidator },
  handler: async (
    ctx,
    args,
  ): Promise<AudienceResolution> => {
    const audience = args.audience as CampaignAudience;
    const drafts = audience.draftIds?.length
      ? (
          await Promise.all(
            audience.draftIds.map((draftId) => ctx.db.get(draftId)),
          )
        ).filter((draft): draft is Doc<"bookingDrafts"> => draft !== null)
      : await ctx.db.query("bookingDrafts").collect();

    const statuses = new Set(audience.statuses ?? ["expired"]);
    const services = await ctx.db.query("services").collect();
    const serviceById = new Map(services.map((service) => [service._id, service]));
    const activePlans = services.filter(
      (service) =>
        service.isActive &&
        service.serviceType === "subscription" &&
        (service.includedServiceIds?.length ?? 0) > 0,
    );
    const prices = await ctx.db.query("serviceVehiclePrices").collect();
    const vehicleTypes = await ctx.db.query("vehicleTypes").collect();
    const vehicleTypeById = new Map(
      vehicleTypes.map((vehicleType) => [vehicleType._id, vehicleType]),
    );
    const planShapes = activePlans.map((plan) =>
      servicePricingShape(plan, prices, vehicleTypeById),
    );
    const serviceShapes = new Map(
      services.map((service) => [
        service._id,
        servicePricingShape(service, prices, vehicleTypeById),
      ]),
    );

    const existingVehicles = await Promise.all(
      drafts.flatMap((draft) =>
        draft.existingVehicleIds.map((vehicleId) => ctx.db.get(vehicleId)),
      ),
    );
    const existingVehicleById = new Map(
      existingVehicles
        .filter((vehicle): vehicle is Doc<"vehicles"> => vehicle !== null)
        .map((vehicle) => [vehicle._id, vehicle]),
    );

    const candidates: RecipientCandidate[] = [];
    let skippedNoConsent = 0;
    let skippedSuppressed = 0;
    let skippedNoEmail = 0;
    let replacement = 0;
    let afterDetail = 0;

    for (const draft of drafts) {
      if (draft.status === "converted" || draft.status === "completed") continue;
      if (!statuses.has(draft.status as "expired")) {
        continue;
      }
      if (
        audience.createdAfter !== undefined &&
        (draft._creationTime ?? 0) < audience.createdAfter
      ) {
        continue;
      }
      if (
        audience.createdBefore !== undefined &&
        (draft._creationTime ?? 0) > audience.createdBefore
      ) {
        continue;
      }
      if (
        audience.serviceIds?.length &&
        !draft.serviceIds.some((serviceId) =>
          audience.serviceIds!.includes(serviceId),
        )
      ) {
        continue;
      }

      const replacementPlan = activePlans.find((plan) =>
        (plan.includedServiceIds ?? []).some((serviceId) =>
          draft.serviceIds.includes(serviceId),
        ),
      );
      if (audience.onlyMembershipEligible && !replacementPlan) {
        continue;
      }

      const email = normalizeEmail(draft.customerEmail);
      if (!email) {
        skippedNoEmail += 1;
        continue;
      }

      const user =
        (draft.convertedUserId
          ? await ctx.db.get(draft.convertedUserId)
          : null) ??
        (await ctx.db
          .query("users")
          .withIndex("by_email", (q) => q.eq("email", email))
          .first());
      const suppression = await ctx.db
        .query("emailSuppressions")
        .withIndex("by_email", (q) => q.eq("email", email))
        .first();
      const hasConsent =
        Boolean(user?.notificationPreferences?.marketingEmails) &&
        !suppression;

      if (suppression) {
        skippedSuppressed += 1;
      } else if (!hasConsent) {
        skippedNoConsent += 1;
      }

      const plan = replacementPlan ?? activePlans[0];
      const includedServiceId =
        plan?.includedServiceIds?.find((serviceId) =>
          draft.serviceIds.includes(serviceId),
        ) ?? plan?.includedServiceIds?.[0];
      const includedService = includedServiceId
        ? serviceById.get(includedServiceId)
        : null;
      const planShape = plan
        ? planShapes.find((candidate) => candidate._id === plan._id)
        : null;
      const includedShape = includedServiceId
        ? serviceShapes.get(includedServiceId)
        : null;

      const draftVehicle = draft.draftVehicles?.[0];
      const existingVehicle = draft.existingVehicleIds
        .map((vehicleId) => existingVehicleById.get(vehicleId))
        .find(Boolean);
      const vehicle = draftVehicle ?? existingVehicle;
      const vehicleContext = {
        vehicleSize: (vehicle?.size ?? draft.vehicleSize ?? "medium") as
          | "small"
          | "medium"
          | "large",
        vehicleTypeId: vehicle?.vehicleTypeId ?? null,
      };
      const planPricing =
        planShape && includedService
          ? getEffectiveServicePricingForVehicle(planShape, vehicleContext)
          : null;
      const includedPricing =
        includedShape && includedService
          ? getEffectiveServicePricingForVehicle(includedShape, vehicleContext)
          : null;
      const monthlyPrice = planPricing?.price ?? 0;
      const oneTimePrice = includedPricing?.price ?? 0;
      const isReplacement = Boolean(replacementPlan);
      const savingsPerVisit = isReplacement
        ? Math.max(0, oneTimePrice - monthlyPrice)
        : undefined;

      const metadata: MembershipOfferMetadata = {
        planName: plan?.name,
        includedServiceName: includedService?.name,
        vehicleLabel: vehicle ? vehicleLabel(vehicle) : undefined,
        monthlyPrice: monthlyPrice > 0 ? monthlyPrice : undefined,
        oneTimePrice: isReplacement ? oneTimePrice : undefined,
        savingsPerVisit,
        annualSavings: savingsPerVisit ? savingsPerVisit * 12 : undefined,
        membershipKind: isReplacement ? "replacement" : "after_detail",
      };

      if (!plan || !includedService || monthlyPrice <= 0) {
        continue;
      }
      if (isReplacement) replacement += 1;
      else afterDetail += 1;

      candidates.push({
        draftId: draft._id,
        userId: user?._id,
        email,
        name: draft.customerName || "there",
        consent: hasConsent,
        skipReason: suppression
          ? "suppressed"
          : !hasConsent
            ? "no_marketing_consent"
            : undefined,
        metadata,
      });
    }

    const eligible = candidates.filter((candidate) => candidate.consent).length;
    return {
      candidates,
      counts: {
        total: candidates.length,
        eligible,
        skippedNoConsent,
        skippedSuppressed,
        skippedNoEmail,
        replacement,
        afterDetail,
      },
    };
  },
});

export const previewAudience = query({
  args: { audience: campaignAudienceValidator },
  handler: async (
    ctx,
    args,
  ): Promise<{
    counts: AudienceCounts;
    samples: Array<{
      email: string;
      name: string;
      consent: boolean;
      skipReason?: string;
      planName?: string;
      includedServiceName?: string;
      monthlyPrice?: number;
      oneTimePrice?: number;
      savingsPerVisit?: number;
      membershipKind?: "replacement" | "after_detail";
    }>;
  }> => {
    await requireAdmin(ctx);
    const result: AudienceResolution = await ctx.runQuery(
      internal.campaigns.resolveAudienceInternal,
      { audience: args.audience },
    );
    return {
      counts: result.counts,
      samples: result.candidates.slice(0, 12).map((candidate) => ({
        email: candidate.email,
        name: candidate.name,
        consent: candidate.consent,
        skipReason: candidate.skipReason,
        planName: candidate.metadata.planName,
        includedServiceName: candidate.metadata.includedServiceName,
        monthlyPrice: candidate.metadata.monthlyPrice,
        oneTimePrice: candidate.metadata.oneTimePrice,
        savingsPerVisit: candidate.metadata.savingsPerVisit,
        membershipKind: candidate.metadata.membershipKind,
      })),
    };
  },
});

export const findMaintenanceRefreshRecoveryCandidatesInternal = internalQuery({
  args: {},
  handler: async (ctx): Promise<{
    candidates: Array<{
      draftId: Id<"bookingDrafts">;
      email: string;
      name: string;
      lastActivityAt: number;
    }>;
  }> => {
    const services = await ctx.db.query("services").collect();
    const maintenanceServiceIds = new Set(
      services
        .filter(
          (service) =>
            service.isActive &&
            service.name.toLowerCase().includes("maintenance refresh"),
        )
        .map((service) => service._id),
    );
    if (maintenanceServiceIds.size === 0) {
      return { candidates: [] };
    }

    const drafts = await ctx.db.query("bookingDrafts").collect();
    const candidates = drafts
      .filter(
        (draft) =>
          draft.status === "expired" &&
          !draft.abandonedEmailSentAt &&
          !draft.abandonedEmailScheduledId &&
          !draft.abandonedFollowUpScheduledId &&
          Boolean(draft.customerEmail) &&
          draft.serviceIds.some((serviceId) =>
            maintenanceServiceIds.has(serviceId),
          ),
      )
      .sort((a, b) => b.lastActivityAt - a.lastActivityAt);

    const byEmail = new Map<string, Doc<"bookingDrafts">>();
    for (const draft of candidates) {
      const email = draft.customerEmail.trim().toLowerCase();
      if (!byEmail.has(email)) {
        byEmail.set(email, draft);
      }
    }

    return {
      candidates: [...byEmail.values()].map((draft) => ({
        draftId: draft._id,
        email: draft.customerEmail,
        name: draft.customerName,
        lastActivityAt: draft.lastActivityAt,
      })),
    };
  },
});

export const markRecoveryBackfillScheduledInternal = internalMutation({
  args: {
    draftId: v.id("bookingDrafts"),
    abandonedEmailScheduledId: v.id("_scheduled_functions"),
    abandonedFollowUpScheduledId: v.id("_scheduled_functions"),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.draftId, {
      abandonedEmailScheduledId: args.abandonedEmailScheduledId,
      abandonedFollowUpScheduledId: args.abandonedFollowUpScheduledId,
    });
  },
});

export const enqueueMaintenanceRefreshRecovery = internalAction({
  args: { force: v.optional(v.boolean()) },
  handler: async (
    ctx,
    args,
  ): Promise<{
    skipped: boolean;
    count: number;
    recipients: string[];
    firstSendAt: number | null;
    followUpSendAt: number | null;
  }> => {
    if (!args.force && getCentralHour() !== 8) {
      return {
        skipped: true,
        count: 0,
        recipients: [],
        firstSendAt: null,
        followUpSendAt: null,
      };
    }

    const result = await ctx.runQuery(
      internal.campaigns.findMaintenanceRefreshRecoveryCandidatesInternal,
      {},
    );
    if (result.candidates.length === 0) {
      return {
        skipped: false,
        count: 0,
        recipients: [],
        firstSendAt: null,
        followUpSendAt: null,
      };
    }

    const firstSendAt = getNextNineAmCentral();
    const followUpSendAt = firstSendAt + 24 * 60 * 60 * 1000;

    for (const candidate of result.candidates) {
      const abandonedEmailScheduledId = await ctx.scheduler.runAt(
        firstSendAt,
        internal.payments.sendAbandonedBookingRecoveryEmail,
        { draftId: candidate.draftId, stage: "first" },
      );
      const abandonedFollowUpScheduledId = await ctx.scheduler.runAt(
        followUpSendAt,
        internal.payments.sendAbandonedBookingRecoveryEmail,
        { draftId: candidate.draftId, stage: "follow_up" },
      );
      await ctx.runMutation(
        internal.campaigns.markRecoveryBackfillScheduledInternal,
        {
          draftId: candidate.draftId,
          abandonedEmailScheduledId,
          abandonedFollowUpScheduledId,
        },
      );
    }

    return {
      skipped: false,
      count: result.candidates.length,
      recipients: result.candidates.map((candidate) => candidate.email),
      firstSendAt,
      followUpSendAt,
    };
  },
});

export const createCampaignInternal = internalMutation({
  args: {
    name: v.string(),
    audience: campaignAudienceValidator,
    createdBy: v.id("users"),
    scheduledAt: v.optional(v.number()),
    status: v.optional(
      v.union(v.literal("scheduled"), v.literal("sending")),
    ),
    candidates: v.array(
      v.object({
        draftId: v.id("bookingDrafts"),
        userId: v.optional(v.id("users")),
        email: v.string(),
        name: v.string(),
        consent: v.boolean(),
        skipReason: v.optional(v.string()),
        metadata: v.object({
          planName: v.optional(v.string()),
          includedServiceName: v.optional(v.string()),
          vehicleLabel: v.optional(v.string()),
          oneTimePrice: v.optional(v.number()),
          monthlyPrice: v.optional(v.number()),
          savingsPerVisit: v.optional(v.number()),
          annualSavings: v.optional(v.number()),
          resumeUrl: v.optional(v.string()),
          membershipKind: v.optional(
            v.union(v.literal("replacement"), v.literal("after_detail")),
          ),
        }),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const status = args.status ?? "sending";
    const skipped = args.candidates.filter((candidate) => !candidate.consent);
    const campaignId = await ctx.db.insert("emailCampaigns", {
      name: args.name,
      type: "membership_offer",
      status,
      templateKey: "maintenance_club_offer",
      subject: "Keep your vehicle clean for less",
      audience: args.audience,
      totalRecipients: args.candidates.length,
      sentCount: 0,
      failedCount: 0,
      skippedCount: skipped.length,
      createdBy: args.createdBy,
      createdAt: now,
      scheduledAt: args.scheduledAt,
      startedAt: status === "sending" ? now : undefined,
    });

    for (const candidate of args.candidates) {
      await ctx.db.insert("emailCampaignRecipients", {
        campaignId,
        draftId: candidate.draftId,
        userId: candidate.userId,
        email: candidate.email,
        name: candidate.name,
        status: candidate.consent ? "pending" : "skipped",
        skipReason: candidate.skipReason,
        consent: candidate.consent,
        unsubscribeToken: crypto.randomUUID(),
        metadata: candidate.metadata,
      });
    }

    return {
      campaignId,
      totalRecipients: args.candidates.length,
      eligible: args.candidates.length - skipped.length,
      skipped: skipped.length,
      scheduledAt: args.scheduledAt,
    };
  },
});

export const startMembershipCampaign = action({
  args: {
    name: v.string(),
    audience: campaignAudienceValidator,
    scheduledAt: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<{
    campaignId: Id<"emailCampaigns">;
    totalRecipients: number;
    eligible: number;
    skipped: number;
    scheduledAt?: number;
  }> => {
    await requireAdmin(ctx);
    const createdBy = await getUserIdFromIdentity(ctx);
    if (!createdBy) throw new Error("Not authenticated");

    const now = Date.now();
    const scheduledAt =
      args.scheduledAt && args.scheduledAt > now + 60_000
        ? args.scheduledAt
        : undefined;

    const resolved = await ctx.runQuery(
      internal.campaigns.resolveAudienceInternal,
      { audience: args.audience },
    );
    if (resolved.counts.eligible === 0) {
      throw new Error(
        "No recipients are eligible. Marketing emails require an explicit marketing opt-in and no suppression.",
      );
    }

    const campaign = await ctx.runMutation(
      internal.campaigns.createCampaignInternal,
      {
        name: args.name,
        audience: args.audience,
        createdBy,
        candidates: resolved.candidates,
        scheduledAt,
        status: scheduledAt ? "scheduled" : "sending",
      },
    );

    if (!scheduledAt) {
      await ctx.scheduler.runAfter(
        0,
        internal.campaigns.processCampaignBatch,
        { campaignId: campaign.campaignId },
      );
    }

    return campaign;
  },
});

export const getCampaignInternal = internalQuery({
  args: { campaignId: v.id("emailCampaigns") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.campaignId);
  },
});

export const claimDueCampaignsInternal = internalMutation({
  args: {},
  handler: async (ctx): Promise<Id<"emailCampaigns">[]> => {
    const now = Date.now();
    const scheduled = await ctx.db
      .query("emailCampaigns")
      .withIndex("by_status", (q) => q.eq("status", "scheduled"))
      .take(50);
    const due = scheduled.filter(
      (campaign) =>
        campaign.scheduledAt !== undefined && campaign.scheduledAt <= now,
    );

    for (const campaign of due) {
      await ctx.db.patch(campaign._id, {
        status: "sending",
        startedAt: now,
      });
    }

    return due.map((campaign) => campaign._id);
  },
});

export const processDueCampaigns = internalAction({
  args: {},
  handler: async (ctx): Promise<null> => {
    const campaignIds = await ctx.runMutation(
      internal.campaigns.claimDueCampaignsInternal,
      {},
    );
    for (const campaignId of campaignIds) {
      await ctx.scheduler.runAfter(
        0,
        internal.campaigns.processCampaignBatch,
        { campaignId },
      );
    }
    return null;
  },
});

export const claimCampaignNowInternal = internalMutation({
  args: { campaignId: v.id("emailCampaigns") },
  handler: async (ctx, args): Promise<boolean> => {
    const campaign = await ctx.db.get(args.campaignId);
    if (!campaign) return false;
    if (campaign.status === "sent" || campaign.status === "cancelled") {
      return false;
    }
    if (campaign.status === "sending") return false;

    await ctx.db.patch(args.campaignId, {
      status: "sending",
      startedAt: Date.now(),
    });
    return true;
  },
});

export const sendCampaignNow = action({
  args: { campaignId: v.id("emailCampaigns") },
  handler: async (ctx, args): Promise<boolean> => {
    await requireAdmin(ctx);
    const claimed = await ctx.runMutation(
      internal.campaigns.claimCampaignNowInternal,
      { campaignId: args.campaignId },
    );
    if (!claimed) return false;

    await ctx.scheduler.runAfter(
      0,
      internal.campaigns.processCampaignBatch,
      { campaignId: args.campaignId },
    );
    return true;
  },
});

export const cancelCampaign = mutation({
  args: { campaignId: v.id("emailCampaigns") },
  handler: async (ctx, args): Promise<boolean> => {
    await requireAdmin(ctx);
    const campaign = await ctx.db.get(args.campaignId);
    if (!campaign) return false;
    if (campaign.status === "sent" || campaign.status === "cancelled") {
      return false;
    }

    await ctx.db.patch(args.campaignId, {
      status: "cancelled",
      completedAt: Date.now(),
    });
    return true;
  },
});

export const getPendingRecipientsInternal = internalQuery({
  args: {
    campaignId: v.id("emailCampaigns"),
    limit: v.number(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("emailCampaignRecipients")
      .withIndex("by_campaign_and_status", (q) =>
        q.eq("campaignId", args.campaignId).eq("status", "pending"),
      )
      .take(args.limit);
  },
});

export const countPendingRecipientsInternal = internalQuery({
  args: { campaignId: v.id("emailCampaigns") },
  handler: async (ctx, args) => {
    const pending = await ctx.db
      .query("emailCampaignRecipients")
      .withIndex("by_campaign_and_status", (q) =>
        q.eq("campaignId", args.campaignId).eq("status", "pending"),
      )
      .collect();
    return pending.length;
  },
});

export const isRecipientEligibleInternal = internalQuery({
  args: {
    email: v.string(),
    userId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    const suppression = await ctx.db
      .query("emailSuppressions")
      .withIndex("by_email", (q) => q.eq("email", args.email))
      .first();
    if (suppression) return { eligible: false, reason: "suppressed" };

    const user = args.userId
      ? await ctx.db.get(args.userId)
      : await ctx.db
          .query("users")
          .withIndex("by_email", (q) => q.eq("email", args.email))
          .first();
    if (!user?.notificationPreferences?.marketingEmails) {
      return { eligible: false, reason: "no_marketing_consent" };
    }
    return { eligible: true };
  },
});

export const recordRecipientResultInternal = internalMutation({
  args: {
    campaignId: v.id("emailCampaigns"),
    recipientId: v.id("emailCampaignRecipients"),
    status: v.union(
      v.literal("sent"),
      v.literal("failed"),
      v.literal("skipped"),
    ),
    error: v.optional(v.string()),
    skipReason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.recipientId, {
      status: args.status,
      error: args.error,
      skipReason: args.skipReason,
      sentAt: args.status === "sent" ? Date.now() : undefined,
    });

    const campaign = await ctx.db.get(args.campaignId);
    if (!campaign) return;
    await ctx.db.patch(args.campaignId, {
      sentCount:
        campaign.sentCount + (args.status === "sent" ? 1 : 0),
      failedCount:
        campaign.failedCount + (args.status === "failed" ? 1 : 0),
      skippedCount:
        campaign.skippedCount + (args.status === "skipped" ? 1 : 0),
    });
  },
});

export const finalizeCampaignInternal = internalMutation({
  args: { campaignId: v.id("emailCampaigns") },
  handler: async (ctx, args) => {
    const recipients = await ctx.db
      .query("emailCampaignRecipients")
      .withIndex("by_campaign", (q) => q.eq("campaignId", args.campaignId))
      .collect();
    const sent = recipients.filter((recipient) => recipient.status === "sent").length;
    const failed = recipients.filter((recipient) => recipient.status === "failed").length;
    const skipped = recipients.filter((recipient) => recipient.status === "skipped").length;
    await ctx.db.patch(args.campaignId, {
      status: "sent",
      completedAt: Date.now(),
      sentCount: sent,
      failedCount: failed,
      skippedCount: skipped,
    });
  },
});

export const processCampaignBatch = internalAction({
  args: { campaignId: v.id("emailCampaigns") },
  handler: async (ctx, args): Promise<null> => {
    const campaign = await ctx.runQuery(
      internal.campaigns.getCampaignInternal,
      { campaignId: args.campaignId },
    );
    if (
      !campaign ||
      campaign.status === "cancelled" ||
      campaign.status === "sent"
    ) {
      return null;
    }
    if (campaign.status === "scheduled") {
      if (campaign.scheduledAt && campaign.scheduledAt > Date.now()) {
        return null;
      }
      const claimed = await ctx.runMutation(
        internal.campaigns.claimCampaignNowInternal,
        { campaignId: args.campaignId },
      );
      if (!claimed) return null;
    }

    const recipients = await ctx.runQuery(
      internal.campaigns.getPendingRecipientsInternal,
      { campaignId: args.campaignId, limit: 2 },
    );

    for (const recipient of recipients) {
      const eligibility = await ctx.runQuery(
        internal.campaigns.isRecipientEligibleInternal,
        { email: recipient.email, userId: recipient.userId },
      );
      if (!eligibility.eligible) {
        await ctx.runMutation(
          internal.campaigns.recordRecipientResultInternal,
          {
            campaignId: args.campaignId,
            recipientId: recipient._id,
            status: "skipped",
            skipReason: eligibility.reason,
          },
        );
        continue;
      }

      try {
        await ctx.runAction(
          internal.emails.sendMaintenanceClubCampaignEmail,
          {
            to: recipient.email,
            customerName: recipient.name,
            planName: recipient.metadata?.planName ?? "Maintenance Club",
            includedServiceName:
              recipient.metadata?.includedServiceName ?? "Maintenance Refresh",
            vehicleLabel: recipient.metadata?.vehicleLabel,
            oneTimePrice: recipient.metadata?.oneTimePrice,
            monthlyPrice: recipient.metadata?.monthlyPrice ?? 0,
            savingsPerVisit: recipient.metadata?.savingsPerVisit,
            annualSavings: recipient.metadata?.annualSavings,
            resumeToken: (
              await ctx.runQuery(internal.bookingDrafts.getByIdInternal, {
                draftId: recipient.draftId!,
              })
            )?.resumeToken ?? "",
            unsubscribeToken: recipient.unsubscribeToken,
          },
        );
        await ctx.runMutation(
          internal.campaigns.recordRecipientResultInternal,
          {
            campaignId: args.campaignId,
            recipientId: recipient._id,
            status: "sent",
          },
        );
      } catch (error) {
        await ctx.runMutation(
          internal.campaigns.recordRecipientResultInternal,
          {
            campaignId: args.campaignId,
            recipientId: recipient._id,
            status: "failed",
            error: error instanceof Error ? error.message : String(error),
          },
        );
      }
    }

    const pending = await ctx.runQuery(
      internal.campaigns.countPendingRecipientsInternal,
      { campaignId: args.campaignId },
    );
    if (pending > 0) {
      await ctx.scheduler.runAfter(
        1000,
        internal.campaigns.processCampaignBatch,
        { campaignId: args.campaignId },
      );
    } else {
      await ctx.runMutation(
        internal.campaigns.finalizeCampaignInternal,
        { campaignId: args.campaignId },
      );
    }

    return null;
  },
});

export const sendRecoveryForDraft = action({
  args: { draftId: v.id("bookingDrafts") },
  handler: async (ctx, args): Promise<boolean> => {
    await requireAdmin(ctx);
    return await ctx.runAction(
      internal.payments.sendAbandonedBookingRecoveryEmail,
      { draftId: args.draftId, stage: "first" },
    );
  },
});

export const sendMembershipCampaignTest = action({
  args: {
    to: v.string(),
    planName: v.optional(v.string()),
    includedServiceName: v.optional(v.string()),
    monthlyPrice: v.optional(v.number()),
    oneTimePrice: v.optional(v.number()),
    savingsPerVisit: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<boolean> => {
    await requireAdmin(ctx);
    await ctx.runAction(internal.emails.sendMaintenanceClubCampaignEmail, {
      to: args.to,
      customerName: "there",
      planName: args.planName ?? "River City Maintenance Club",
      includedServiceName: args.includedServiceName ?? "Maintenance Refresh",
      monthlyPrice: args.monthlyPrice ?? 145,
      oneTimePrice: args.oneTimePrice ?? 175,
      savingsPerVisit: args.savingsPerVisit ?? 30,
      annualSavings: (args.savingsPerVisit ?? 30) * 12,
      resumeToken: "preview",
      unsubscribeToken: "preview",
    });
    return true;
  },
});

export const listCampaigns = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const campaigns = await ctx.db
      .query("emailCampaigns")
      .withIndex("by_created")
      .order("desc")
      .take(50);
    return campaigns;
  },
});

export const unsubscribe = mutation({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const recipient = await ctx.db
      .query("emailCampaignRecipients")
      .withIndex("by_unsubscribe_token", (q) =>
        q.eq("unsubscribeToken", args.token),
      )
      .first();
    if (!recipient) return { success: false, email: null };

    const user =
      (recipient.userId ? await ctx.db.get(recipient.userId) : null) ??
      (await ctx.db
        .query("users")
        .withIndex("by_email", (q) => q.eq("email", recipient.email))
        .first());
    if (user) {
      const preferences = normalizeUserNotificationPreferences(
        user.notificationPreferences,
      );
      await ctx.db.patch(user._id, {
        notificationPreferences: {
          ...preferences,
          marketingEmails: false,
        },
      });
    }

    const existing = await ctx.db
      .query("emailSuppressions")
      .withIndex("by_email", (q) => q.eq("email", recipient.email))
      .first();
    if (!existing) {
      await ctx.db.insert("emailSuppressions", {
        email: recipient.email,
        reason: "unsubscribe",
        source: "campaign_email",
        createdAt: Date.now(),
      });
    }

    return { success: true, email: recipient.email };
  },
});
