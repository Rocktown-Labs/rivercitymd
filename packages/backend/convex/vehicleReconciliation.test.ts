import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";
import { modules } from "./test.setup";

test("API reconciliation preserves overrides, stale records and financial history, and is repeatable", async () => {
  const t = convexTest(schema, modules);
  const { records, manual, stale } = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      name: "Test",
      email: "test@invalid.example",
      role: "client",
    });
    const type = await ctx.db.insert("vehicleTypes", {
      name: "SUV",
      slug: "suv",
      legacySize: "large",
      isActive: true,
      displayOrder: 1,
      createdAt: 1,
      updatedAt: 1,
    });
    const records = [];
    for (let i = 0; i < 3; i++) {
      const vehicleId = await ctx.db.insert("vehicles", {
        userId,
        year: 2019,
        make: "Honda",
        model: "crv",
        size: "medium",
        ...(i === 1 ? { vehicleTypeOverrideAt: 123, vehicleTypeId: type } : {}),
      });
      records.push({
        vehicleId,
        year: 2019,
        make: "Honda",
        model: "crv",
        vehicleTypeId: type,
        source: "fuelEconomy" as const,
        confidence: "high" as const,
        rawCategory: "Small Sport Utility Vehicle 4WD",
      });
    }
    await ctx.db.patch(records[2].vehicleId, { model: "Pilot" });
    return {
      records,
      manual: records[1].vehicleId,
      stale: records[2].vehicleId,
    };
  });
  const result = await t.mutation(internal.vehicleReconciliation.applyBatch, {
    records,
  });
  expect(result.updated).toEqual([records[0].vehicleId]);
  expect(result.skipped).toEqual(
    expect.arrayContaining([
      { vehicleId: manual, reason: "Manual selection preserved" },
      { vehicleId: stale, reason: "Vehicle changed since audit" },
    ]),
  );
  expect(
    (await t.mutation(internal.vehicleReconciliation.applyBatch, { records }))
      .updated,
  ).toEqual([]);
  const audit = await t.run((ctx) =>
    ctx.db.query("vehicleCategoryReconciliations").take(5),
  );
  expect(audit).toHaveLength(1);
  expect(audit[0].before.size).toBe("medium");
  expect(
    (await t.run((ctx) => ctx.db.get(records[0].vehicleId)))?.classification
      ?.needsAdminReview,
  ).toBe(false);
});

test("unresolved legacy vehicles are flagged without changing their type or identity", async () => {
  const t = convexTest(schema, modules);
  const vehicleId = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      name: "Test",
      email: "test@invalid.example",
      role: "client",
    });
    return await ctx.db.insert("vehicles", {
      userId,
      year: 2022,
      make: "GMC",
      model: "Denali",
      size: "large",
    });
  });
  const args = {
    records: [
      {
        vehicleId,
        year: 2022,
        make: "GMC",
        model: "Denali",
        reason: "Trim-only model; Dustin confirmation needed",
      },
    ],
  };
  expect(
    (await t.mutation(internal.vehicleReconciliation.flagBatch, args)).flagged,
  ).toEqual([vehicleId]);
  expect(
    (await t.mutation(internal.vehicleReconciliation.flagBatch, args)).flagged,
  ).toEqual([]);
  expect(await t.run((ctx) => ctx.db.get(vehicleId))).toMatchObject({
    make: "GMC",
    model: "Denali",
    size: "large",
    classification: { needsAdminReview: true },
  });
});
