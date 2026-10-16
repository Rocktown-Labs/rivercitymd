import { convexTest } from "convex-test";
import { expect, test, describe, vi, beforeEach, beforeAll } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { modules, stripeFetchMock } from "./test.setup";

// 2026-12-07 is a Monday, 2026-12-08 a Tuesday (both in the future).
const MONDAY = "2026-12-07";
const TUESDAY = "2026-12-08";

let fetchCalls: { url: string; body?: string }[] = [];

async function fetchCapture(url: string | URL, options?: RequestInit) {
  const urlString = typeof url === "string" ? url : url.toString();
  // Parse the hostname rather than matching a substring so the mock cannot
  // accidentally treat an arbitrary host as Stripe.
  let isStripeUrl = false;
  try {
    isStripeUrl = new URL(urlString).hostname === "api.stripe.com";
  } catch {
    isStripeUrl = false;
  }
  if (isStripeUrl) {
    fetchCalls.push({
      url: urlString,
      body: options?.body ? String(options.body) : undefined,
    });
  }
  return stripeFetchMock(url, options);
}

async function seedUser(t: any) {
  const userId = await t.run(async (ctx: any) => {
    return await ctx.db.insert("users", {
      name: "Sub Customer",
      email: "subcustomer@test.com",
      role: "client",
      timesServiced: 0,
      totalSpent: 0,
      status: "active",
      stripeCustomerId: "cus_sub_test",
    });
  });
  await t.run(async (ctx: any) => {
    await ctx.db.patch(userId, { clerkUserId: userId });
  });
  return userId;
}

async function seedOtherUser(t: any) {
  const userId = await t.run(async (ctx: any) => {
    return await ctx.db.insert("users", {
      name: "Other Customer",
      email: "othercustomer@test.com",
      role: "client",
      timesServiced: 0,
      totalSpent: 0,
      status: "active",
    });
  });
  await t.run(async (ctx: any) => {
    await ctx.db.patch(userId, { clerkUserId: userId });
  });
  return userId;
}

async function seedVehicle(t: any, userId: any) {
  return await t.run(async (ctx: any) => {
    return await ctx.db.insert("vehicles", {
      userId,
      year: 2022,
      make: "Toyota",
      model: "Camry",
      size: "medium",
    });
  });
}

async function seedService(t: any) {
  return await t.run(async (ctx: any) => {
    return await ctx.db.insert("services", {
      name: "Maintenance Wash",
      description: "Recurring wash",
      basePrice: 100,
      basePriceSmall: 95,
      basePriceMedium: 100,
      basePriceLarge: 110,
      duration: 60,
      serviceType: "subscription",
      isActive: true,
    });
  });
}

async function seedAvailability(t: any, dayOfWeek: number) {
  await t.run(async (ctx: any) => {
    await ctx.db.insert("availability", {
      dayOfWeek,
      startTime: "08:00",
      endTime: "17:00",
      isActive: true,
    });
  });
}

async function seedAllWeekAvailability(t: any) {
  for (let day = 0; day < 7; day++) {
    await seedAvailability(t, day);
  }
}

async function appointmentInvoice(t: any, appointmentId: any) {
  return await t.run(async (ctx: any) => {
    const rows = await ctx.db.query("invoices").collect();
    return rows.find((r: any) => r.appointmentId === appointmentId) ?? null;
  });
}

async function getUserDoc(t: any, userId: any) {
  return await t.run(async (ctx: any) => {
    return await ctx.db.get(userId);
  });
}

async function seedSubscription(
  t: any,
  args: {
    userId: any;
    serviceId: any;
    vehicleId: any;
    adminId: any;
    startDate?: string;
    preferredTime?: string;
    status?: string;
    nextScheduledDate?: string;
  },
) {
  return await t.run(async (ctx: any) => {
    return await ctx.db.insert("subscriptions", {
      userId: args.userId,
      serviceIds: [args.serviceId],
      vehicleIds: [args.vehicleId],
      frequency: "monthly",
      preferredDayOfWeek: 1,
      preferredTime: args.preferredTime ?? "09:00",
      location: {
        street: "123 Main St",
        city: "Little Rock",
        state: "AR",
        zip: "72201",
      },
      totalPrice: 100,
      startDate: args.startDate,
      nextScheduledDate:
        args.nextScheduledDate !== undefined
          ? args.nextScheduledDate
          : args.startDate,
      status: (args.status as any) ?? "pending_payment",
      createdBy: args.adminId,
    });
  });
}

async function seedConflictingAppointment(
  t: any,
  args: { userId: any; vehicleId: any; serviceId: any; createdBy: any; date: string; time: string },
) {
  await t.run(async (ctx: any) => {
    await ctx.db.insert("appointments", {
      userId: args.userId,
      vehicleIds: [args.vehicleId],
      serviceIds: [args.serviceId],
      scheduledDate: args.date,
      scheduledTime: args.time,
      duration: 60,
      location: {
        street: "123 Main St",
        city: "Little Rock",
        state: "AR",
        zip: "72201",
      },
      status: "confirmed",
      totalPrice: 100,
      createdBy: args.createdBy,
    });
  });
}

async function getSubscription(t: any, subscriptionId: any) {
  return await t.run(async (ctx: any) => {
    return await ctx.db.get(subscriptionId);
  });
}

async function subscriptionAppointments(t: any, subscriptionId: any) {
  return await t.run(async (ctx: any) => {
    const all = await ctx.db.query("appointments").collect();
    return all.filter((a: any) => a.subscriptionId === subscriptionId);
  });
}

describe("subscriptions", () => {
  beforeAll(() => {
    process.env.TZ = "UTC";
  });

  beforeEach(() => {
    fetchCalls = [];
    vi.stubGlobal("fetch", vi.fn(fetchCapture));
  });

  test("checkout session charges immediately via subscription mode", async () => {
    const t = convexTest(schema, modules);
    const userId = await seedUser(t);
    const vehicleId = await seedVehicle(t, userId);
    const serviceId = await seedService(t);
    await seedAvailability(t, 1); // Monday
    const subId = await seedSubscription(t, {
      userId,
      serviceId,
      vehicleId,
      adminId: userId,
      startDate: MONDAY,
      preferredTime: "09:00",
    });

    const url = await t.action(
      internal.subscriptions.createCheckoutSession,
      { subscriptionId: subId },
    );
    expect(url).toContain("checkout.stripe.com/test");

    const sessionCall = fetchCalls.find((c) =>
      c.url.includes("/v1/checkout/sessions"),
    );
    expect(sessionCall).toBeTruthy();
    const body = String(sessionCall!.body);
    expect(body).toContain("mode=subscription");
    expect(body).toContain("unit_amount%5D=10000");
    expect(body).toContain("recurring%5D%5Binterval%5D=month");
    expect(body).toContain("River+City+MD+Subscription");
    expect(body).toContain("subscription_data%5Bmetadata%5D%5BsubscriptionId%5D=");

    // No billing_cycle_anchor: recurring billing runs from the payment date.
    expect(body).not.toContain("billing_cycle_anchor");

    const sub = await getSubscription(t, subId);
    expect(sub.stripeCheckoutSessionId).toBe("cs_test_123");
  });

  test("checkout session rejects a taken time slot", async () => {
    const t = convexTest(schema, modules);
    const userId = await seedUser(t);
    const otherUserId = await seedOtherUser(t);
    const vehicleId = await seedVehicle(t, userId);
    const serviceId = await seedService(t);
    await seedAvailability(t, 1); // Monday
    const subId = await seedSubscription(t, {
      userId,
      serviceId,
      vehicleId,
      adminId: userId,
      startDate: MONDAY,
      preferredTime: "09:00",
    });
    await seedConflictingAppointment(t, {
      userId: otherUserId,
      vehicleId,
      serviceId,
      createdBy: otherUserId,
      date: MONDAY,
      time: "09:00",
    });

    await expect(
      t.action(internal.subscriptions.createCheckoutSession, {
        subscriptionId: subId,
      }),
    ).rejects.toThrow(/no longer available/i);
    expect(
      fetchCalls.find((c) => c.url.includes("/v1/checkout/sessions")),
    ).toBeUndefined();
  });

  test("subscriptions without a chosen date email a dashboard link instead of a charge", async () => {
    const t = convexTest(schema, modules);
    const userId = await seedUser(t);
    const vehicleId = await seedVehicle(t, userId);
    const serviceId = await seedService(t);
    const subId = await seedSubscription(t, {
      userId,
      serviceId,
      vehicleId,
      adminId: userId,
    });

    const url = await t.action(
      internal.subscriptions.createCheckoutSession,
      { subscriptionId: subId },
    );
    expect(url).toContain("/dashboard/subscriptions");
    expect(
      fetchCalls.find((c) => c.url.includes("/v1/checkout/sessions")),
    ).toBeUndefined();

    // A checkout-link notification was queued with the dashboard URL.
    const dispatch = await t.run(async (ctx: any) => {
      const rows = await ctx.db.query("notificationDispatches").collect();
      return (
        rows.find((r: any) => r.checkoutUrl === url && r.subscriptionId === subId) ??
        null
      );
    });
    expect(dispatch).toBeTruthy();
  });

  test("activation books the first appointment and pre-schedules the next cycle", async () => {
    const t = convexTest(schema, modules);
    const userId = await seedUser(t);
    const vehicleId = await seedVehicle(t, userId);
    const serviceId = await seedService(t);
    await seedAllWeekAvailability(t);
    const subId = await seedSubscription(t, {
      userId,
      serviceId,
      vehicleId,
      adminId: userId,
      startDate: MONDAY,
      preferredTime: "09:00",
    });

    await t.action(internal.subscriptions.handleCheckoutCompleted, {
      subscriptionId: subId,
      stripeSubscriptionId: "sub_stripe_1",
      paymentStatus: "paid",
    });

    const sub = await getSubscription(t, subId);
    expect(sub.status).toBe("active");
    expect(sub.stripeSubscriptionId).toBe("sub_stripe_1");

    let appts = await subscriptionAppointments(t, subId);
    expect(appts).toHaveLength(2);

    // First cycle: booked confirmed with a paid invoice.
    expect(appts[0].status).toBe("confirmed");
    expect(appts[0].scheduledDate).toBe(MONDAY);
    expect(appts[0].scheduledTime).toBe("09:00");
    const firstInvoice = await appointmentInvoice(t, appts[0]._id);
    expect(firstInvoice?.status).toBe("paid");

    // Next cycle: pre-scheduled pending with a draft invoice.
    expect(appts[1].status).toBe("pending");
    expect(appts[1].scheduledDate).toBe("2027-01-07");
    expect(appts[1].notes).toContain("confirms on payment");
    const nextInvoice = await appointmentInvoice(t, appts[1]._id);
    expect(nextInvoice?.status).toBe("draft");

    // Duplicate webhook delivery must not double-book either cycle.
    await t.action(internal.subscriptions.handleCheckoutCompleted, {
      subscriptionId: subId,
      stripeSubscriptionId: "sub_stripe_1",
      paymentStatus: "paid",
    });
    appts = await subscriptionAppointments(t, subId);
    expect(appts).toHaveLength(2);
  });

  test("handleCheckoutCompleted waits for async payment confirmation", async () => {
    const t = convexTest(schema, modules);
    const userId = await seedUser(t);
    const vehicleId = await seedVehicle(t, userId);
    const serviceId = await seedService(t);
    const subId = await seedSubscription(t, {
      userId,
      serviceId,
      vehicleId,
      adminId: userId,
      startDate: MONDAY,
    });

    await t.action(internal.subscriptions.handleCheckoutCompleted, {
      subscriptionId: subId,
      stripeSubscriptionId: "sub_stripe_async",
      paymentStatus: "unpaid",
    });

    const sub = await getSubscription(t, subId);
    expect(sub.status).toBe("pending_payment");
    expect(await subscriptionAppointments(t, subId)).toHaveLength(0);
  });

  test("a slot conflict at activation books a pending appointment for rescheduling", async () => {
    const t = convexTest(schema, modules);
    const userId = await seedUser(t);
    const otherUserId = await seedOtherUser(t);
    const vehicleId = await seedVehicle(t, userId);
    const serviceId = await seedService(t);
    await seedAvailability(t, 1); // Monday
    const subId = await seedSubscription(t, {
      userId,
      serviceId,
      vehicleId,
      adminId: userId,
      startDate: MONDAY,
      preferredTime: "09:00",
    });
    await seedConflictingAppointment(t, {
      userId: otherUserId,
      vehicleId,
      serviceId,
      createdBy: otherUserId,
      date: MONDAY,
      time: "09:00",
    });

    await t.action(internal.subscriptions.handleCheckoutCompleted, {
      subscriptionId: subId,
      stripeSubscriptionId: "sub_stripe_2",
      paymentStatus: "paid",
    });

    const appts = await subscriptionAppointments(t, subId);
    expect(appts).toHaveLength(2);
    expect(appts[0].status).toBe("pending");
    expect(appts[0].notes).toContain("conflicts");
    // The following cycle is still pre-scheduled.
    expect(appts[1].status).toBe("pending");
  });

  test("renewal booking is idempotent per Stripe invoice", async () => {
    const t = convexTest(schema, modules);
    const userId = await seedUser(t);
    const vehicleId = await seedVehicle(t, userId);
    const serviceId = await seedService(t);
    await seedAllWeekAvailability(t);
    const subId = await seedSubscription(t, {
      userId,
      serviceId,
      vehicleId,
      adminId: userId,
      status: "active",
      startDate: MONDAY,
      preferredTime: "10:00",
      nextScheduledDate: TUESDAY,
    });
    await t.run(async (ctx: any) => {
      await ctx.db.patch(subId, { stripeSubscriptionId: "sub_stripe_3" });
    });

    await t.action(internal.subscriptions.handleRenewalInvoicePaid, {
      subscriptionId: subId,
      stripeInvoiceId: "in_renewal_1",
    });
    // Duplicate delivery of the same renewal invoice must not double-book
    // or advance the cycle a second time.
    await t.action(internal.subscriptions.handleRenewalInvoicePaid, {
      subscriptionId: subId,
      stripeInvoiceId: "in_renewal_1",
    });

    let appts = await subscriptionAppointments(t, subId);
    expect(appts).toHaveLength(1);
    expect(appts[0].scheduledDate).toBe(TUESDAY);
    // No pre-scheduled appointment existed for this cycle, so it is
    // planned ahead of the following one instead of being confirmed.
    expect(appts[0].status).toBe("pending");
    expect(appts[0].notes).toContain("confirms on payment");
    const cycleInvoice = await appointmentInvoice(t, appts[0]._id);
    expect(cycleInvoice?.status).toBe("draft");

    // A new cycle's invoice confirms the current cycle and pre-schedules
    // the following one.
    await t.action(internal.subscriptions.handleRenewalInvoicePaid, {
      subscriptionId: subId,
      stripeInvoiceId: "in_renewal_2",
    });
    appts = await subscriptionAppointments(t, subId);
    expect(appts).toHaveLength(2);
    expect(appts[0].status).toBe("confirmed");
    expect(appts[1].status).toBe("pending");
    expect(appts[1].scheduledDate).toBe("2027-01-08");
    const confirmedInvoice = await appointmentInvoice(t, appts[0]._id);
    expect(confirmedInvoice?.status).toBe("paid");

    const sub = await getSubscription(t, subId);
    expect(sub.lastRenewalStripeInvoiceId).toBe("in_renewal_2");
  });

  test("each renewal confirms the current cycle and pre-schedules the next", async () => {
    const t = convexTest(schema, modules);
    const userId = await seedUser(t);
    const vehicleId = await seedVehicle(t, userId);
    const serviceId = await seedService(t);
    await seedAllWeekAvailability(t);
    const subId = await seedSubscription(t, {
      userId,
      serviceId,
      vehicleId,
      adminId: userId,
      startDate: MONDAY,
      preferredTime: "09:00",
    });

    await t.action(internal.subscriptions.handleCheckoutCompleted, {
      subscriptionId: subId,
      stripeSubscriptionId: "sub_stripe_4",
      paymentStatus: "paid",
    });

    let appts = await subscriptionAppointments(t, subId);
    expect(appts).toHaveLength(2);
    expect(appts[1].status).toBe("pending");

    let user = await getUserDoc(t, userId);
    expect(user.timesServiced).toBe(1);

    // First renewal: confirms the pre-scheduled cycle and plans the next.
    await t.action(internal.subscriptions.handleRenewalInvoicePaid, {
      subscriptionId: subId,
      stripeInvoiceId: "in_cycle_2",
    });
    appts = await subscriptionAppointments(t, subId);
    expect(appts).toHaveLength(3);
    expect(appts[1].status).toBe("confirmed");
    expect(appts[1].scheduledDate).toBe("2027-01-07");
    const confirmedInvoice = await appointmentInvoice(t, appts[1]._id);
    expect(confirmedInvoice?.status).toBe("paid");
    expect(appts[2].status).toBe("pending");
    expect(appts[2].scheduledDate).toBe("2027-02-07");

    user = await getUserDoc(t, userId);
    expect(user.timesServiced).toBe(2);

    // Second renewal: same confirm + pre-schedule cadence.
    await t.action(internal.subscriptions.handleRenewalInvoicePaid, {
      subscriptionId: subId,
      stripeInvoiceId: "in_cycle_3",
    });
    appts = await subscriptionAppointments(t, subId);
    expect(appts).toHaveLength(4);
    expect(appts[2].status).toBe("confirmed");
    expect(appts[3].status).toBe("pending");
    expect(appts[3].scheduledDate).toBe("2027-03-07");

    user = await getUserDoc(t, userId);
    expect(user.timesServiced).toBe(3);
  });

  test("cancelling the subscription cancels future scheduled appointments", async () => {
    const t = convexTest(schema, modules);
    const userId = await seedUser(t);
    const vehicleId = await seedVehicle(t, userId);
    const serviceId = await seedService(t);
    await seedAllWeekAvailability(t);
    const subId = await seedSubscription(t, {
      userId,
      serviceId,
      vehicleId,
      adminId: userId,
      startDate: MONDAY,
      preferredTime: "09:00",
    });

    await t.action(internal.subscriptions.handleCheckoutCompleted, {
      subscriptionId: subId,
      stripeSubscriptionId: "sub_stripe_5",
      paymentStatus: "paid",
    });
    let appts = await subscriptionAppointments(t, subId);
    expect(appts).toHaveLength(2);

    const asCustomer = t.withIdentity({
      subject: userId,
      email: "subcustomer@test.com",
    });
    await asCustomer.mutation(api.subscriptions.cancelByCustomer, {
      subscriptionId: subId,
    });

    const sub = await getSubscription(t, subId);
    expect(sub.status).toBe("cancelled");
    appts = await subscriptionAppointments(t, subId);
    expect(appts).toHaveLength(2);
    for (const appt of appts) {
      expect(appt.status).toBe("cancelled");
    }
  });

  test("customers can set their service date and time before payment", async () => {
    const t = convexTest(schema, modules);
    const userId = await seedUser(t);
    const vehicleId = await seedVehicle(t, userId);
    const serviceId = await seedService(t);
    await seedAvailability(t, 2); // Tuesday
    const subId = await seedSubscription(t, {
      userId,
      serviceId,
      vehicleId,
      adminId: userId,
      startDate: MONDAY,
    });

    const asCustomer = t.withIdentity({
      subject: userId,
      email: "subcustomer@test.com",
    });
    await asCustomer.mutation(api.subscriptions.updateStartDateByCustomer, {
      subscriptionId: subId,
      startDate: TUESDAY,
      preferredTime: "10:00",
      location: {
        street: "456 Oak Ave",
        city: "Little Rock",
        state: "AR",
        zip: "72202",
      },
    });

    const sub = await getSubscription(t, subId);
    expect(sub.startDate).toBe(TUESDAY);
    expect(sub.preferredTime).toBe("10:00");
    expect(sub.nextScheduledDate).toBe(TUESDAY);
    expect(sub.location.street).toBe("456 Oak Ave");
    expect(sub.location.zip).toBe("72202");
  });
});
