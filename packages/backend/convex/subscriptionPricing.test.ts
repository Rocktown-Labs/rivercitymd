import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { modules } from "./test.setup";

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const admin = await ctx.db.insert("users", {
      name: "Admin",
      email: "admin@club.test",
      role: "admin",
    });
    const user = await ctx.db.insert("users", {
      name: "Customer",
      email: "customer@club.test",
      role: "client",
    });
    await ctx.db.patch(admin, { clerkUserId: admin });
    await ctx.db.patch(user, { clerkUserId: user });
    const car = await ctx.db.insert("vehicleTypes", {
      name: "Car",
      slug: "car",
      legacySize: "medium",
      isActive: true,
      displayOrder: 1,
      createdAt: 1,
      updatedAt: 1,
    });
    const vehicle = await ctx.db.insert("vehicles", {
      userId: user,
      year: 2025,
      make: "Tesla",
      model: "Model S",
      size: "medium",
      vehicleTypeId: car,
    });
    const service = await ctx.db.insert("services", {
      name: "Maintenance Club",
      description: "Monthly",
      duration: 60,
      isActive: true,
      serviceType: "subscription",
      basePrice: 145,
      basePriceSmall: 125,
      basePriceMedium: 145,
      basePriceLarge: 165,
    });
    await ctx.db.insert("serviceVehiclePrices", {
      serviceId: service,
      vehicleTypeId: car,
      price: 125,
      duration: 60,
      isAvailable: true,
      createdAt: 1,
      updatedAt: 1,
    });
    return { admin, user, car, vehicle, service };
  });
  return {
    t,
    ids,
    admin: t.withIdentity({ subject: ids.admin, email: "admin@club.test" }),
  };
}

test("admin subscription uses Car matrix $125 rather than legacy medium $145", async () => {
  const { t, ids, admin } = await setup();
  const id = await admin.mutation(api.subscriptions.create, {
    userId: ids.user,
    vehicleIds: [ids.vehicle],
    serviceIds: [ids.service],
    frequency: "monthly",
    preferredDayOfWeek: 5,
    preferredTime: "10:00",
    startDate: "2027-12-10",
    location: {
      street: "1 Main",
      city: "Little Rock",
      state: "AR",
      zip: "72201",
    },
  });
  const saved = await t.run(ctx => ctx.db.get(id));
  expect(saved?.totalPrice).toBe(125);
  expect(saved?.vehiclePricingSnapshot?.[0]).toMatchObject({ year: 2025, make: "Tesla", model: "Model S", vehicleTypeName: "Car", unitPrice: 125 });
  await t.run(ctx => ctx.db.patch(ids.vehicle, { model: "Edited later" }));
  expect((await t.run(ctx => ctx.db.get(id)))?.vehiclePricingSnapshot?.[0].model).toBe("Model S");
});

test("category pricing never guesses from a legacy size", async () => {
  const { t, ids, admin } = await setup();
  await t.run((ctx) =>
    ctx.db.patch(ids.vehicle, { vehicleTypeId: undefined, size: "large" }),
  );
  await expect(
    admin.mutation(api.subscriptions.create, {
      userId: ids.user,
      vehicleIds: [ids.vehicle],
      serviceIds: [ids.service],
      frequency: "monthly",
      preferredDayOfWeek: 5,
      preferredTime: "10:00",
      startDate: "2027-12-10",
      location: {
        street: "1 Main",
        city: "Little Rock",
        state: "AR",
        zip: "72201",
      },
    }),
  ).rejects.toThrow(/category/);
});

test("next appointment comes from upcoming visits rather than the January cursor", async () => {
  const { t, ids, admin } = await setup();
  await t.run(async (ctx) => {
    const sub = await ctx.db.insert("subscriptions", {
      userId: ids.user,
      vehicleIds: [ids.vehicle],
      serviceIds: [ids.service],
      frequency: "monthly",
      preferredDayOfWeek: 5,
      preferredTime: "10:00",
      location: {
        street: "1 Main",
        city: "Little Rock",
        state: "AR",
        zip: "72201",
      },
      status: "active",
      totalPrice: 125,
      createdBy: ids.admin,
      nextScheduledDate: "2027-01-20",
    });
    for (const [date, status] of [
      ["2026-10-20", "pending"],
      ["2026-11-20", "cancelled"],
      ["2026-12-20", "pending"],
    ] as const) {
      await ctx.db.insert("appointments", {
        subscriptionId: sub,
        userId: ids.user,
        vehicleIds: [ids.vehicle],
        serviceIds: [ids.service],
        scheduledDate: date,
        scheduledTime: "10:00",
        duration: 60,
        totalPrice: 125,
        status,
        createdBy: ids.admin,
        location: {
          street: "1 Main",
          city: "Little Rock",
          state: "AR",
          zip: "72201",
        },
      });
    }
  });
  const result = await admin.query(api.subscriptions.list, {
    today: "2026-11-18",
  });
  expect(result[0].nextAppointmentDate).toBe("2026-12-20");
  expect(result[0].nextScheduledDate).toBe("2027-01-20");
});
