import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import schema from "./schema";
import { internal } from "./_generated/api";
import { modules, stripeFetchMock } from "./test.setup";

afterEach(() => vi.stubGlobal("fetch", vi.fn(stripeFetchMock)));

async function setup() {
  const t = convexTest(schema, modules);
  const args = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      name: "Customer",
      email: "club@test.invalid",
      role: "client",
      stripeCustomerId: "cus_club",
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
    const vehicle = await ctx.db.insert("vehicles", {
      userId,
      year: 2023,
      make: "GMC",
      model: "Yukon",
      size: "large",
    });
    const service = await ctx.db.insert("services", {
      name: "Club",
      description: "Monthly",
      basePrice: 165,
      duration: 60,
      isActive: true,
      serviceType: "subscription",
    });
    await ctx.db.insert("serviceVehiclePrices", {
      serviceId: service,
      vehicleTypeId: type,
      price: 145,
      duration: 60,
      isAvailable: true,
      createdAt: 1,
      updatedAt: 1,
    });
    const location = {
      street: "1 Main",
      city: "Little Rock",
      state: "AR",
      zip: "72201",
    };
    const subscriptionId = await ctx.db.insert("subscriptions", {
      userId,
      vehicleIds: [vehicle],
      serviceIds: [service],
      frequency: "monthly",
      preferredDayOfWeek: 1,
      preferredTime: "10:00",
      location,
      status: "active",
      totalPrice: 165,
      stripeSubscriptionId: "sub_club",
      createdBy: userId,
    });
    for (const status of ["draft", "paid"] as const) {
      const appointmentId = await ctx.db.insert("appointments", {
        userId,
        subscriptionId,
        vehicleIds: [vehicle],
        serviceIds: [service],
        scheduledDate: "2027-12-20",
        scheduledTime: "10:00",
        duration: 60,
        location,
        status: "pending",
        totalPrice: 165,
        createdBy: userId,
      });
      await ctx.db.insert("invoices", {
        appointmentId,
        userId,
        invoiceNumber: status,
        items: [
          { serviceName: "Club", quantity: 1, unitPrice: 165, totalPrice: 165 },
        ],
        subtotal: 165,
        tax: 0,
        total: 165,
        status,
        dueDate: "2027-12-20",
        remainingBalance: status === "paid" ? 0 : 165,
      });
    }
    return {
      subscriptionId,
      vehicleId: vehicle,
      vehicleTypeId: type,
      expectedOldPrice: 165,
      expectedNewPrice: 145,
      today: new Date().toLocaleDateString("en-CA", {
        timeZone: "America/Chicago",
      }),
    };
  });
  return { t, args };
}

function stripeSubscription(amount: number, priceId: string) {
  return {
    id: "sub_club",
    customer: "cus_club",
    livemode: true,
    status: "active",
    billing_cycle_anchor: 123456,
    items: {
      data: [
        {
          id: "si_club",
          quantity: 1,
          price: {
            id: priceId,
            product: "prod_club",
            unit_amount: amount,
            currency: "usd",
            recurring: { interval: "month", interval_count: 1 },
          },
        },
      ],
    },
  };
}

test("future-only correction verifies Stripe, preserves paid invoices, and captures vehicle/rate", async () => {
  const { t, args } = await setup();
  let current = stripeSubscription(16500, "price_old");
  const posts: URLSearchParams[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, options?: RequestInit) => {
      if (new URL(url).pathname === "/v1/products/prod_club")
        return Response.json({ id: "prod_club", active: true });
      if (options?.method === "POST") {
        const body = new URLSearchParams(String(options.body));
        posts.push(body);
        expect(body.get("proration_behavior")).toBe("none");
        expect(
          [...body.keys()].some((key) =>
            key.startsWith("billing_cycle_anchor"),
          ),
        ).toBe(false);
        expect(body.get("items[0][price_data][unit_amount]")).toBe("14500");
        current = stripeSubscription(14500, "price_new");
      }
      return Response.json(current);
    }),
  );
  expect(
    (await t.action(internal.subscriptionCorrections.reconcile, args)).applied,
  ).toBe(false);
  expect(posts).toHaveLength(0);
  const result = await t.action(internal.subscriptionCorrections.reconcile, {
    ...args,
    apply: true,
  });
  expect(result).toMatchObject({
    applied: true,
    stripePriceAfter: 145,
    updatedAppointments: 1,
    preservedInvoices: 1,
  });
  await t.action(internal.subscriptionCorrections.reconcile, {
    ...args,
    apply: true,
  });
  expect(posts).toHaveLength(1);
  const sub = await t.run((ctx) => ctx.db.get(args.subscriptionId));
  expect(sub?.totalPrice).toBe(145);
  expect(sub?.rateCorrections).toHaveLength(1);
  expect(sub?.vehiclePricingSnapshot?.[0]).toMatchObject({
    year: 2023,
    make: "GMC",
    model: "Yukon",
    vehicleTypeName: "SUV",
    unitPrice: 145,
  });
  const invoices = await t.run((ctx) => ctx.db.query("invoices").collect());
  expect(invoices.find((i) => i.status === "paid")?.total).toBe(165);
  expect(invoices.find((i) => i.status === "draft")?.total).toBe(145);
  expect(
    (await t.run((ctx) => ctx.db.get(args.vehicleId)))?.vehicleTypeId,
  ).toBe(args.vehicleTypeId);
});

test("an unexpected Stripe price stops the correction without local changes", async () => {
  const { t, args } = await setup();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json(stripeSubscription(20000, "price_other"))),
  );
  await expect(
    t.action(internal.subscriptionCorrections.reconcile, {
      ...args,
      apply: true,
    }),
  ).rejects.toThrow(/reviewed correction/);
  expect(
    (await t.run((ctx) => ctx.db.get(args.subscriptionId)))?.totalPrice,
  ).toBe(165);
  expect(
    (await t.run((ctx) => ctx.db.get(args.vehicleId)))?.vehicleTypeId,
  ).toBeUndefined();
});

test("archived products stay archived while a retry-safe active replacement receives the corrected rate", async () => {
  const { t, args } = await setup();
  let current = stripeSubscription(16500, "price_old");
  const productKeys: string[] = [];
  const rateKeys: string[] = [];
  let productPosts = 0;
  let ratesChanged = 0;
  let failFirstUpdate = true;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, options?: RequestInit) => {
      const path = new URL(url).pathname;
      if (path === "/v1/products/prod_club")
        return Response.json({
          id: "prod_club",
          active: false,
          tax_code: "txcd_10000000",
        });
      if (path === "/v1/products") {
        productPosts++;
        productKeys.push(
          (options?.headers as Record<string, string>)["Idempotency-Key"],
        );
        expect(new URLSearchParams(String(options?.body)).get("tax_code")).toBe(
          "txcd_10000000",
        );
        expect(
          (options?.headers as Record<string, string>)["Idempotency-Key"],
        ).toContain("club-rate-product-208-");
        return Response.json({ id: "prod_replacement", active: true });
      }
      if (options?.method === "POST") {
        expect(path).toBe("/v1/subscriptions/sub_club");
        const body = new URLSearchParams(String(options.body));
        expect(body.get("items[0][price_data][product]")).toBe(
          "prod_replacement",
        );
        expect(body.get("proration_behavior")).toBe("none");
        expect(body.has("billing_cycle_anchor")).toBe(false);
        expect(
          (options.headers as Record<string, string>)["Idempotency-Key"],
        ).toContain("v2-");
        rateKeys.push(
          (options.headers as Record<string, string>)["Idempotency-Key"],
        );
        if (failFirstUpdate) {
          failFirstUpdate = false;
          throw new Error("Network failed after product creation");
        }
        ratesChanged++;
        current = stripeSubscription(14500, "price_new");
      }
      return Response.json(current);
    }),
  );
  await expect(
    t.action(internal.subscriptionCorrections.reconcile, {
      ...args,
      apply: true,
    }),
  ).rejects.toThrow("Network failed after product creation");
  expect(
    (await t.run((ctx) => ctx.db.get(args.subscriptionId)))?.totalPrice,
  ).toBe(165);
  const result = await t.action(internal.subscriptionCorrections.reconcile, {
    ...args,
    apply: true,
  });
  expect(result.stripePriceAfter).toBe(145);
  await t.action(internal.subscriptionCorrections.reconcile, {
    ...args,
    apply: true,
  });
  // Stripe receives two requests with the same key and replays the same
  // replacement product; the completed third call makes no extra requests.
  expect(productPosts).toBe(2);
  expect(productKeys).toHaveLength(2);
  expect(new Set(productKeys).size).toBe(1);
  expect(rateKeys).toHaveLength(2);
  expect(new Set(rateKeys).size).toBe(1);
  expect(ratesChanged).toBe(1);
});
