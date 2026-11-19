import { v } from "convex/values";
import { internalMutation } from "./_generated/server";

const evidence = v.object({
  vehicleId: v.id("vehicles"),
  year: v.number(),
  make: v.string(),
  model: v.string(),
  vehicleTypeId: v.id("vehicleTypes"),
  confidence: v.literal("high"),
  source: v.union(v.literal("fuelEconomy"), v.literal("vpic")),
  rawCategory: v.string(),
});

// Operator-only: input must come from the reviewed high-confidence API audit.
// Bound each transaction, recheck the observed vehicle, and keep a before-image.
// This operation never touches subscriptions, appointments, or invoices.
export const applyBatch = internalMutation({
  args: { records: v.array(evidence) },
  returns: v.object({
    updated: v.array(v.id("vehicles")),
    skipped: v.array(
      v.object({ vehicleId: v.id("vehicles"), reason: v.string() }),
    ),
  }),
  handler: async (ctx, { records }) => {
    if (records.length > 20)
      throw new Error("Use batches of at most 20 vehicles");
    const updated = [];
    const skipped = [];
    for (const record of records) {
      const vehicle = await ctx.db.get(record.vehicleId);
      const type = await ctx.db.get(record.vehicleTypeId);
      let reason: string | undefined;
      if (!vehicle || !type?.isActive) reason = "Vehicle/category unavailable";
      else if (
        vehicle.year !== record.year ||
        vehicle.make !== record.make ||
        vehicle.model !== record.model
      )
        reason = "Vehicle changed since audit";
      else if (
        vehicle.vehicleTypeOverrideBy ||
        vehicle.vehicleTypeOverrideAt ||
        vehicle.classification?.source === "manual"
      )
        reason = "Manual selection preserved";
      else if (
        vehicle.vehicleTypeId &&
        vehicle.vehicleTypeId !== record.vehicleTypeId
      )
        reason = "Existing category requires confirmation";
      else if (
        vehicle.vehicleTypeId &&
        !vehicle.classification?.needsAdminReview
      )
        reason = "Already resolved";
      if (reason || !vehicle || !type) {
        skipped.push({
          vehicleId: record.vehicleId,
          reason: reason ?? "Unavailable",
        });
        continue;
      }
      await ctx.db.insert("vehicleCategoryReconciliations", {
        vehicleId: vehicle._id,
        issue: 208,
        action: "assigned",
        reconciledAt: Date.now(),
        before: {
          vehicleTypeId: vehicle.vehicleTypeId,
          size: vehicle.size,
          classification: vehicle.classification,
        },
        vehicleTypeId: type._id,
        source: record.source,
        rawCategory: record.rawCategory,
      });
      await ctx.db.patch(vehicle._id, {
        vehicleTypeId: type._id,
        size: type.legacySize,
        classification: {
          source: record.source,
          confidence: "high",
          rawCategory: record.rawCategory,
          needsAdminReview: false,
        },
      });
      updated.push(vehicle._id);
    }
    return { updated, skipped };
  },
});

export const flagBatch = internalMutation({
  args: {
    records: v.array(
      v.object({
        vehicleId: v.id("vehicles"),
        year: v.number(),
        make: v.string(),
        model: v.string(),
        expectedVehicleTypeId: v.optional(v.id("vehicleTypes")),
        reason: v.string(),
      }),
    ),
  },
  returns: v.object({
    flagged: v.array(v.id("vehicles")),
    skipped: v.array(v.id("vehicles")),
  }),
  handler: async (ctx, { records }) => {
    if (records.length > 20)
      throw new Error("Use batches of at most 20 vehicles");
    const flagged = [];
    const skipped = [];
    for (const record of records) {
      const vehicle = await ctx.db.get(record.vehicleId);
      if (
        !vehicle ||
        vehicle.year !== record.year ||
        vehicle.make !== record.make ||
        vehicle.model !== record.model ||
        vehicle.vehicleTypeId !== record.expectedVehicleTypeId ||
        vehicle.classification?.needsAdminReview ||
        vehicle.vehicleTypeOverrideAt ||
        vehicle.vehicleTypeOverrideBy ||
        vehicle.classification?.source === "manual"
      ) {
        skipped.push(record.vehicleId);
        continue;
      }
      const source = vehicle.classification?.source ?? "fallback";
      await ctx.db.insert("vehicleCategoryReconciliations", {
        vehicleId: vehicle._id,
        issue: 208,
        action: "flagged",
        reconciledAt: Date.now(),
        before: {
          vehicleTypeId: vehicle.vehicleTypeId,
          size: vehicle.size,
          classification: vehicle.classification,
        },
        vehicleTypeId: vehicle.vehicleTypeId,
        source,
        rawCategory: record.reason,
      });
      await ctx.db.patch(vehicle._id, {
        classification: {
          source,
          confidence: "low",
          rawCategory: vehicle.classification?.rawCategory ?? record.reason,
          needsAdminReview: true,
        },
      });
      flagged.push(vehicle._id);
    }
    return { flagged, skipped };
  },
});
