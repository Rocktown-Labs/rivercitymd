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

test("researched identity corrections require evidence, retain before-images, and only confirm matching overrides", async () => {
  const t = convexTest(schema, modules);
  const record = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      name: "Test",
      email: "research@example.invalid",
      role: "client",
    });
    const vehicleTypeId = await ctx.db.insert("vehicleTypes", {
      name: "Truck",
      slug: "truck",
      legacySize: "large",
      isActive: true,
      displayOrder: 1,
      createdAt: 1,
      updatedAt: 1,
    });
    const vehicleId = await ctx.db.insert("vehicles", {
      userId,
      year: 2016,
      make: "GMC",
      model: "Sierr 2500HD Denali",
      vehicleTypeId,
      vehicleTypeOverrideAt: 123,
      size: "medium",
      classification: {
        source: "fallback",
        confidence: "low",
        needsAdminReview: true,
      },
    });
    return {
      vehicleId,
      vehicleTypeId,
      year: 2016,
      make: "GMC",
      model: "Sierr 2500HD Denali",
      source: "manual" as const,
      confidence: "high" as const,
      rawCategory: "Manufacturer confirms Sierra is a truck",
      correctedModel: "Sierra 2500HD Denali",
      confirmExistingManualCategory: true,
    };
  });
  await expect(
    t.mutation(internal.vehicleReconciliation.applyBatch, {
      records: [record],
    }),
  ).rejects.toThrow("evidence is required");
  const evidenceUrls = ["https://www.gmc.com/trucks/sierra/1500"];
  const args = { records: [{ ...record, evidenceUrls }] };
  expect(
    (await t.mutation(internal.vehicleReconciliation.applyBatch, args)).updated,
  ).toEqual([record.vehicleId]);
  expect(await t.run((ctx) => ctx.db.get(record.vehicleId))).toMatchObject({
    model: "Sierra 2500HD Denali",
    vehicleTypeOverrideAt: 123,
    vehicleTypeId: record.vehicleTypeId,
    size: "large",
    classification: { source: "manual", needsAdminReview: false },
  });
  const audit = await t.run((ctx) =>
    ctx.db.query("vehicleCategoryReconciliations").take(5),
  );
  expect(audit).toHaveLength(1);
  expect(audit[0]).toMatchObject({
    before: { make: "GMC", model: "Sierr 2500HD Denali", size: "medium" },
    evidenceUrls,
  });
  expect(
    (await t.mutation(internal.vehicleReconciliation.applyBatch, args)).updated,
  ).toEqual([]);
});


test("same-category confirmation with padded spelling fields is idempotent",async()=>{
 const t=convexTest(schema,modules);
 const record=await t.run(async(ctx)=>{
  const userId=await ctx.db.insert("users",{name:"Test",email:"padding@example.invalid",role:"client"});
  const vehicleTypeId=await ctx.db.insert("vehicleTypes",{name:"Truck",slug:"truck",legacySize:"large",isActive:true,displayOrder:1,createdAt:1,updatedAt:1});
  const vehicleId=await ctx.db.insert("vehicles",{userId,year:2025,make:"GMC",model:"Sierra",vehicleTypeId,vehicleTypeOverrideAt:123,classification:{source:"manual",confidence:"low",needsAdminReview:true}});
  return {vehicleId,vehicleTypeId,year:2025,make:"GMC",model:"Sierra",source:"manual" as const,confidence:"high" as const,rawCategory:"Reviewed Truck",correctedMake:" GMC ",correctedModel:" Sierra ",confirmExistingManualCategory:true,evidenceUrls:["https://www.gmc.com/trucks/sierra/1500"]};
 });
 expect((await t.mutation(internal.vehicleReconciliation.applyBatch,{records:[record]})).updated).toEqual([record.vehicleId]);
 expect((await t.mutation(internal.vehicleReconciliation.applyBatch,{records:[record]})).updated).toEqual([]);
 expect(await t.run(ctx=>ctx.db.query("vehicleCategoryReconciliations").take(5))).toHaveLength(1);
});
