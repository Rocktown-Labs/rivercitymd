import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
  type QueryCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { stripeApiCall } from "./lib/stripeApi";

const correction = v.object({
  subscriptionId: v.id("subscriptions"),
  vehicleId: v.id("vehicles"),
  vehicleTypeId: v.id("vehicleTypes"),
  expectedOldPrice: v.number(),
  expectedNewPrice: v.number(),
  today: v.string(),
});
type Correction = typeof correction.type;
const planValidator = v.object({
  subscriptionId: v.id("subscriptions"),
  stripeSubscriptionId: v.string(),
  stripeCustomerId: v.string(),
  vehicleId: v.id("vehicles"),
  year: v.number(),
  make: v.string(),
  model: v.string(),
  vehicleTypeId: v.id("vehicleTypes"),
  vehicleTypeName: v.string(),
  serviceId: v.id("services"),
  oldPrice: v.number(),
  newPrice: v.number(),
});
type Plan = typeof planValidator.type;

async function buildPlan(
  ctx: Pick<QueryCtx, "db">,
  args: Correction,
): Promise<Plan> {
  if (!Number.isFinite(args.expectedOldPrice) || args.expectedOldPrice <= 0 || !Number.isFinite(args.expectedNewPrice) || args.expectedNewPrice <= 0) throw new Error("Only positive paid-plan rates are supported");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(args.today))
    throw new Error("An effective date is required");
  const sub = await ctx.db.get(args.subscriptionId);
  if (
    !sub ||
    sub.status !== "active" ||
    sub.frequency !== "monthly" ||
    !sub.stripeSubscriptionId
  )
    throw new Error("Only active monthly Stripe plans are supported");
  if (
    sub.vehicleIds.length !== 1 ||
    sub.vehicleIds[0] !== args.vehicleId ||
    sub.serviceIds.length !== 1
  )
    throw new Error("Subscription vehicle or service changed; review again");
  if (
    sub.totalPrice !== args.expectedOldPrice &&
    sub.totalPrice !== args.expectedNewPrice
  )
    throw new Error("Stored price changed; review again");
  if ((sub.petFeePerCycle ?? 0) !== 0 || (sub.travelFeePerCycle ?? 0) !== 0)
    throw new Error("Fee-bearing plans require a separate review");
  const vehicle = await ctx.db.get(args.vehicleId);
  if (!vehicle || vehicle.userId !== sub.userId)
    throw new Error("Vehicle ownership mismatch");
  // An existing explicit classification must never be silently replaced.
  if (vehicle.vehicleTypeId && vehicle.vehicleTypeId !== args.vehicleTypeId)
    throw new Error("Vehicle already has a different category");
  const type = await ctx.db.get(args.vehicleTypeId);
  if (!type?.isActive) throw new Error("Vehicle category is not active");
  const serviceId = sub.planServiceId ?? sub.serviceIds[0];
  const row = await ctx.db
    .query("serviceVehiclePrices")
    .withIndex("by_service_and_vehicle_type", (q) =>
      q.eq("serviceId", serviceId).eq("vehicleTypeId", args.vehicleTypeId),
    )
    .unique();
  if (
    !row?.isAvailable ||
    row.price !== args.expectedNewPrice ||
    row.price <= 0
  )
    throw new Error("Expected price does not match the current category rate");
  const user = await ctx.db.get(sub.userId);
  if (!user?.stripeCustomerId) throw new Error("Stripe customer is missing");
  return {
    subscriptionId: sub._id,
    stripeSubscriptionId: sub.stripeSubscriptionId,
    stripeCustomerId: user.stripeCustomerId,
    vehicleId: vehicle._id,
    year: vehicle.year,
    make: vehicle.make.trim(),
    model: vehicle.model.trim(),
    vehicleTypeId: type._id,
    vehicleTypeName: type.name,
    serviceId,
    oldPrice: args.expectedOldPrice,
    newPrice: row.price,
  };
}

export const preview = internalQuery({
  args: correction.fields,
  returns: planValidator,
  handler: buildPlan,
});

export const finalize = internalMutation({
  args: { ...correction.fields, stripePriceId: v.string() },
  returns: v.object({
    updatedAppointments: v.number(),
    preservedInvoices: v.number(),
  }),
  handler: async (ctx, args) => {
    if (
      args.today !==
      new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" })
    )
      throw new Error(
        "Corrections must use today's date; historical invoices cannot be changed",
      );
    const plan = await buildPlan(ctx, args);
    const sub = (await ctx.db.get(args.subscriptionId))!;
    const history = sub.rateCorrections ?? [];
    const repeated = history.some(
      (entry) =>
        entry.stripePriceId === args.stripePriceId &&
        entry.newPrice === plan.newPrice,
    );
    if (!repeated && history.length >= 20)
      throw new Error("Correction history requires review");
    const now = Date.now();
    const type = (await ctx.db.get(args.vehicleTypeId))!;
    await ctx.db.patch(args.vehicleId, {
      vehicleTypeId: type._id,
      size: type.legacySize,
      classification: {
        source: "manual",
        confidence: "high",
        needsAdminReview: false,
        rawCategory:
          "Confirmed from administrator report; rate correction #208",
      },
    });
    await ctx.db.patch(sub._id, {
      totalPrice: plan.newPrice,
      basePricePerCycle: plan.newPrice,
      vehiclePricingSnapshot: [
        {
          vehicleId: plan.vehicleId,
          year: plan.year,
          make: plan.make,
          model: plan.model,
          vehicleTypeId: plan.vehicleTypeId,
          vehicleTypeName: plan.vehicleTypeName,
          serviceId: plan.serviceId,
          unitPrice: plan.newPrice,
          capturedAt: now,
        },
      ],
      rateCorrections: repeated
        ? history
        : [
            ...history,
            {
              correctedAt: now,
              oldPrice: plan.oldPrice,
              newPrice: plan.newPrice,
              vehicleId: plan.vehicleId,
              vehicleTypeId: plan.vehicleTypeId,
              stripePriceId: args.stripePriceId,
              reason:
                "Administrator-confirmed vehicle/category correction; future rate only; no proration or refunds (#208)",
            },
          ],
    });
    let updatedAppointments = 0;
    let preservedInvoices = 0;
    const appointments = await ctx.db
      .query("appointments")
      .withIndex("by_subscription_date", (q) =>
        q.eq("subscriptionId", sub._id).gte("scheduledDate", args.today),
      )
      .take(100);
    for (const appointment of appointments) {
      if (
        appointment.status !== "pending" &&
        appointment.status !== "confirmed"
      )
        continue;
      const invoices = await ctx.db
        .query("invoices")
        .withIndex("by_appointment", (q) =>
          q.eq("appointmentId", appointment._id),
        )
        .take(2);
      const invoice = invoices[0];
      // Paid, issued, discounted, or otherwise complex invoices are history,
      // not an opportunity to create an implicit refund or credit.
      if (
        invoices.length !== 1 ||
        !invoice ||
        invoice.status !== "draft" ||
        invoice.stripeInvoiceId ||
        invoice.tax !== 0 ||
        (invoice.discountAmount ?? 0) !== 0 ||
        (invoice.giftCardApplied ?? 0) !== 0 ||
        (invoice.depositAmount ?? 0) !== 0 ||
        invoice.items.length !== 1 ||
        (invoice.total !== plan.oldPrice && invoice.total !== plan.newPrice)
      ) {
        preservedInvoices++;
        continue;
      }
      if (
        appointment.totalPrice !== plan.oldPrice &&
        appointment.totalPrice !== plan.newPrice
      )
        throw new Error("Appointment price changed; review again");
      const item = invoice.items[0];
      if (item.quantity <= 0) throw new Error("Invalid invoice quantity");
      await ctx.db.patch(invoice._id, {
        subtotal: plan.newPrice,
        total: plan.newPrice,
        remainingBalance: plan.newPrice,
        items: [
          {
            ...item,
            unitPrice: plan.newPrice / item.quantity,
            totalPrice: plan.newPrice,
          },
        ],
      });
      await ctx.db.patch(appointment._id, { totalPrice: plan.newPrice });
      updatedAppointments++;
    }
    return { updatedAppointments, preservedInvoices };
  },
});

const resultValidator = v.object({
  ...planValidator.fields,
  stripePriceBefore: v.number(),
  stripePriceAfter: v.number(),
  stripePriceId: v.string(),
  applied: v.boolean(),
  updatedAppointments: v.number(),
  preservedInvoices: v.number(),
});
type Result = typeof resultValidator.type;

export const reconcile = internalAction({
  args: { ...correction.fields, apply: v.optional(v.boolean()) },
  returns: resultValidator,
  handler: async (ctx, args): Promise<Result> => {
    const { apply, ...input } = args;
    const plan: Plan = await ctx.runQuery(
      internal.subscriptionCorrections.preview,
      input,
    );
    const endpoint = `subscriptions/${encodeURIComponent(plan.stripeSubscriptionId)}`;
    const stripe = await stripeApiCall(endpoint, { method: "GET" });
    const item = stripe.items?.data?.[0];
    const customerId =
      typeof stripe.customer === "string"
        ? stripe.customer
        : stripe.customer?.id;
    if (
      stripe.id !== plan.stripeSubscriptionId ||
      customerId !== plan.stripeCustomerId ||
      stripe.livemode !== true ||
      stripe.status !== "active" ||
      stripe.schedule ||
      stripe.pending_update ||
      stripe.items?.data?.length !== 1 ||
      item?.quantity !== 1 ||
      item.price?.currency !== "usd" ||
      item.price?.recurring?.interval !== "month" ||
      (item.price?.recurring?.interval_count ?? 1) !== 1
    )
      throw new Error("Stripe subscription requires manual review");
    const amount = item.price.unit_amount / 100;
    if (amount !== plan.oldPrice && amount !== plan.newPrice)
      throw new Error("Stripe price does not match the reviewed correction");
    let priceId = item.price.id as string;
    if (apply && amount !== plan.newPrice) {
      const product =
        typeof item.price.product === "string"
          ? item.price.product
          : item.price.product?.id;
      if (!product) throw new Error("Stripe product is missing");
      // Keep the same paid monthly cadence. Omitting the anchor update
      // preserves it on both pre-Endive and Endive API versions; the explicit
      // anchor parameter changed format in Endive. Verify it again below.
      const body = new URLSearchParams({
        "items[0][id]": item.id,
        "items[0][quantity]": "1",
        "items[0][price_data][product]": product,
        "items[0][price_data][currency]": "usd",
        "items[0][price_data][unit_amount]": String(
          Math.round(plan.newPrice * 100),
        ),
        "items[0][price_data][recurring][interval]": "month",
        proration_behavior: "none",
      });
      await stripeApiCall(endpoint, {
        method: "POST",
        body,
        headers: {
          "Idempotency-Key": `club-rate-208-${plan.subscriptionId}-${Math.round(plan.newPrice * 100)}`,
        },
      });
      const verified = await stripeApiCall(endpoint, { method: "GET" });
      const updated = verified.items?.data?.[0];
      if (
        verified.id !== stripe.id ||
        verified.billing_cycle_anchor !== stripe.billing_cycle_anchor ||
        verified.items?.data?.length !== 1 ||
        updated?.price?.unit_amount !== Math.round(plan.newPrice * 100) ||
        updated?.quantity !== 1
      )
        throw new Error(
          "Stripe update verification failed; local records were not changed",
        );
      priceId = updated.price.id;
    }
    const changes = apply
      ? await ctx.runMutation(internal.subscriptionCorrections.finalize, {
          subscriptionId: args.subscriptionId,
          vehicleId: args.vehicleId,
          vehicleTypeId: args.vehicleTypeId,
          expectedOldPrice: args.expectedOldPrice,
          expectedNewPrice: args.expectedNewPrice,
          today: args.today,
          stripePriceId: priceId,
        })
      : { updatedAppointments: 0, preservedInvoices: 0 };
    return {
      ...plan,
      stripePriceBefore: amount,
      stripePriceAfter: apply ? plan.newPrice : amount,
      stripePriceId: priceId,
      applied: apply ?? false,
      ...changes,
    };
  },
});
