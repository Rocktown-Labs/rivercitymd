import {
  query,
  mutation,
  action,
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { v } from "convex/values";
import { getUserIdFromIdentity, requireAdmin, isAdmin } from "./auth";
import { internal, api } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { getEffectiveServicePrice, type VehicleSize } from "./lib/pricing";

// --- Helpers ---

function computeNextDate(
  frequency: "biweekly" | "monthly",
  fromDate?: string,
): string {
  const from = fromDate ? new Date(`${fromDate}T12:00:00`) : new Date();
  if (frequency === "monthly") {
    from.setMonth(from.getMonth() + 1);
  } else {
    from.setDate(from.getDate() + 14);
  }
  return from.toISOString().split("T")[0];
}

function computeFirstDate(
  preferredDayOfWeek: number,
): string {
  const now = new Date();
  // Find the next occurrence of preferredDayOfWeek from today (at least 3 days out)
  now.setDate(now.getDate() + 3);
  const currentDay = now.getDay();
  let daysToAdd = preferredDayOfWeek - currentDay;
  if (daysToAdd < 0) daysToAdd += 7;
  now.setDate(now.getDate() + daysToAdd);
  return now.toISOString().split("T")[0];
}

function validateStartDate(startDate: string): void {
  const selectedDate = new Date(`${startDate}T12:00:00`);
  if (Number.isNaN(selectedDate.getTime())) {
    throw new Error("Start date must be a valid date");
  }
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (selectedDate < today) {
    throw new Error("Start date cannot be in the past");
  }
}

// --- Queries ---

export const list = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const subscriptions = await ctx.db.query("subscriptions").collect();

    // Enrich with user/service/vehicle data
    const enriched = await Promise.all(
      subscriptions.map(async (sub) => {
        const user = await ctx.db.get(sub.userId);
        const services = await Promise.all(
          sub.serviceIds.map((id) => ctx.db.get(id)),
        );
        const vehicles = await Promise.all(
          sub.vehicleIds.map((id) => ctx.db.get(id)),
        );
        return {
          ...sub,
          userName: user?.name || user?.email || "Unknown",
          userEmail: user?.email,
          serviceNames: services
            .filter((s): s is Doc<"services"> => s !== null)
            .map((s) => s.name),
          vehicleNames: vehicles
            .filter((v): v is Doc<"vehicles"> => v !== null)
            .map((v) => `${v.year} ${v.make} ${v.model}`),
        };
      }),
    );

    return enriched;
  },
});

export const getByUser = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getUserIdFromIdentity(ctx);
    if (!userId) return [];

    const subscriptions = await ctx.db
      .query("subscriptions")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();

    const enriched = await Promise.all(
      subscriptions.map(async (sub) => {
        const services = await Promise.all(
          sub.serviceIds.map((id) => ctx.db.get(id)),
        );
        const vehicles = await Promise.all(
          sub.vehicleIds.map((id) => ctx.db.get(id)),
        );
        const serviceDocs = services.filter(
          (s): s is Doc<"services"> => s !== null,
        );
        const vehicleDocs = vehicles.filter(
          (v): v is Doc<"vehicles"> => v !== null,
        );
        return {
          ...sub,
          serviceNames: serviceDocs.map((s) => s.name),
          vehicleNames: vehicleDocs.map(
            (v) => `${v.year} ${v.make} ${v.model}`,
          ),
          // Used by the dashboard slot picker to fetch availability windows.
          estimatedDurationMinutes:
            serviceDocs.reduce((sum, s) => sum + s.duration, 0) *
            sub.vehicleIds.length,
        };
      }),
    );

    return enriched;
  },
});

export const getById = query({
  args: { subscriptionId: v.id("subscriptions") },
  handler: async (ctx, args) => {
    const userId = await getUserIdFromIdentity(ctx);
    if (!userId) throw new Error("Not authenticated");

    const sub = await ctx.db.get(args.subscriptionId);
    if (!sub) return null;

    // Allow admin or owner
    if (sub.userId !== userId && !(await isAdmin(ctx))) {
      throw new Error("Access denied");
    }

    const user = await ctx.db.get(sub.userId);
    const services = await Promise.all(
      sub.serviceIds.map((id) => ctx.db.get(id)),
    );
    const vehicles = await Promise.all(
      sub.vehicleIds.map((id) => ctx.db.get(id)),
    );

    return {
      ...sub,
      userName: user?.name || user?.email || "Unknown",
      userEmail: user?.email,
      serviceNames: services
        .filter((s): s is Doc<"services"> => s !== null)
        .map((s) => s.name),
      vehicleNames: vehicles
        .filter((v): v is Doc<"vehicles"> => v !== null)
        .map((v) => `${v.year} ${v.make} ${v.model}`),
    };
  },
});

export const getActiveCount = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const subs = await ctx.db.query("subscriptions").collect();
    return subs.filter(
      (s) => s.status === "pending_payment" || s.status === "past_due",
    ).length;
  },
});

export const getByStripeSubscriptionId = internalQuery({
  args: { stripeSubscriptionId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("subscriptions")
      .withIndex("by_stripe_subscription_id", (q) =>
        q.eq("stripeSubscriptionId", args.stripeSubscriptionId),
      )
      .first();
  },
});

export const getByIdInternal = internalQuery({
  args: { subscriptionId: v.id("subscriptions") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.subscriptionId);
  },
});

// --- Mutations ---

export const create = mutation({
  args: {
    userId: v.id("users"),
    serviceIds: v.array(v.id("services")),
    vehicleIds: v.array(v.id("vehicles")),
    frequency: v.union(v.literal("biweekly"), v.literal("monthly")),
    preferredDayOfWeek: v.number(),
    startDate: v.optional(v.string()),
    preferredTime: v.string(),
    letCustomerChooseDate: v.optional(v.boolean()),
    location: v.object({
      street: v.string(),
      city: v.string(),
      state: v.string(),
      zip: v.string(),
      notes: v.optional(v.string()),
    }),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const adminId = await requireAdmin(ctx).then(() => getUserIdFromIdentity(ctx));
    if (!adminId) throw new Error("Not authenticated");

    const user = await ctx.db.get(args.userId);
    if (!user) throw new Error("User not found");

    // Validate vehicles belong to user
    for (const vehicleId of args.vehicleIds) {
      const vehicle = await ctx.db.get(vehicleId);
      if (!vehicle || vehicle.userId !== args.userId) {
        throw new Error("Vehicle not found or doesn't belong to user");
      }
    }

    // Compute total price from services × vehicles (size-based pricing)
    let totalPrice = 0;
    const vehicles = await Promise.all(
      args.vehicleIds.map((id) => ctx.db.get(id)),
    );

    for (const serviceId of args.serviceIds) {
      const service = await ctx.db.get(serviceId);
      if (!service) throw new Error("Service not found");

      for (const vehicle of vehicles) {
        if (!vehicle) continue;
        const size: VehicleSize = vehicle.size || "medium";
        totalPrice += getEffectiveServicePrice(service, size);
      }
    }

    // When the customer picks the date, leave it unset until they choose a
    // slot at payment time; the checkout link then goes to the dashboard.
    const startDate = args.letCustomerChooseDate
      ? undefined
      : args.startDate || computeFirstDate(args.preferredDayOfWeek);
    if (startDate) {
      validateStartDate(startDate);
    }

    const subscriptionId = await ctx.db.insert("subscriptions", {
      userId: args.userId,
      serviceIds: args.serviceIds,
      vehicleIds: args.vehicleIds,
      frequency: args.frequency,
      preferredDayOfWeek: args.preferredDayOfWeek,
      preferredTime: args.preferredTime,
      location: args.location,
      totalPrice,
      startDate,
      status: "pending_payment",
      nextScheduledDate: startDate,
      notes: args.notes,
      createdBy: adminId,
    });

    // Schedule checkout session creation
    await ctx.scheduler.runAfter(0, internal.subscriptions.createCheckoutSession, {
      subscriptionId,
    });

    return subscriptionId;
  },
});

export const activate = internalMutation({
  args: {
    subscriptionId: v.id("subscriptions"),
    stripeSubscriptionId: v.string(),
  },
  handler: async (ctx, args) => {
    const subscription = await ctx.db.get(args.subscriptionId);
    if (!subscription) return;
    if (subscription.status === "cancelled") {
      await ctx.scheduler.runAfter(
        0,
        internal.subscriptions.cancelStripeSubscription,
        { stripeSubscriptionId: args.stripeSubscriptionId },
      );
      return;
    }
    await ctx.db.patch(args.subscriptionId, {
      status: "active",
      stripeSubscriptionId: args.stripeSubscriptionId,
    });
  },
});

export const saveCheckoutSession = internalMutation({
  args: {
    subscriptionId: v.id("subscriptions"),
    stripeCheckoutSessionId: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.subscriptionId, {
      stripeCheckoutSessionId: args.stripeCheckoutSessionId,
    });
  },
});

export const updateStatus = internalMutation({
  args: {
    subscriptionId: v.id("subscriptions"),
    status: v.union(
      v.literal("pending_payment"),
      v.literal("active"),
      v.literal("paused"),
      v.literal("past_due"),
      v.literal("cancelled"),
    ),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.subscriptionId, {
      status: args.status,
    });
    if (args.status === "cancelled") {
      await ctx.runMutation(internal.subscriptions.cancelFutureAppointments, {
        subscriptionId: args.subscriptionId,
      });
    }
  },
});

export const pause = mutation({
  args: { subscriptionId: v.id("subscriptions") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const sub = await ctx.db.get(args.subscriptionId);
    if (!sub) throw new Error("Subscription not found");
    if (sub.status !== "active") throw new Error("Can only pause active subscriptions");

    await ctx.db.patch(args.subscriptionId, { status: "paused" });

    if (sub.stripeSubscriptionId) {
      await ctx.scheduler.runAfter(0, internal.subscriptions.pauseStripeSubscription, {
        stripeSubscriptionId: sub.stripeSubscriptionId,
      });
    }
  },
});

export const resume = mutation({
  args: { subscriptionId: v.id("subscriptions") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const sub = await ctx.db.get(args.subscriptionId);
    if (!sub) throw new Error("Subscription not found");
    if (sub.status !== "paused") throw new Error("Can only resume paused subscriptions");

    await ctx.db.patch(args.subscriptionId, { status: "active" });

    if (sub.stripeSubscriptionId) {
      await ctx.scheduler.runAfter(0, internal.subscriptions.resumeStripeSubscription, {
        stripeSubscriptionId: sub.stripeSubscriptionId,
      });
    }
  },
});

export const cancel = mutation({
  args: { subscriptionId: v.id("subscriptions") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const sub = await ctx.db.get(args.subscriptionId);
    if (!sub) throw new Error("Subscription not found");

    await ctx.db.patch(args.subscriptionId, {
      status: "cancelled",
      stripeCheckoutSessionId: undefined,
    });
    await ctx.runMutation(internal.subscriptions.cancelFutureAppointments, {
      subscriptionId: args.subscriptionId,
    });

    if (sub.stripeSubscriptionId) {
      await ctx.scheduler.runAfter(0, internal.subscriptions.cancelStripeSubscription, {
        stripeSubscriptionId: sub.stripeSubscriptionId,
      });
    }
    if (sub.stripeCheckoutSessionId) {
      await ctx.scheduler.runAfter(
        0,
        internal.subscriptions.expireCheckoutSession,
        { checkoutSessionId: sub.stripeCheckoutSessionId },
      );
    }
  },
});

export const cancelByCustomer = mutation({
  args: { subscriptionId: v.id("subscriptions") },
  handler: async (ctx, args) => {
    const userId = await getUserIdFromIdentity(ctx);
    if (!userId) throw new Error("Not authenticated");
    const sub = await ctx.db.get(args.subscriptionId);
    if (!sub || sub.userId !== userId) throw new Error("Subscription not found");
    if (sub.status === "cancelled") return;

    await ctx.db.patch(args.subscriptionId, {
      status: "cancelled",
      stripeCheckoutSessionId: undefined,
    });
    await ctx.runMutation(internal.subscriptions.cancelFutureAppointments, {
      subscriptionId: args.subscriptionId,
    });
    if (sub.stripeCheckoutSessionId) {
      await ctx.scheduler.runAfter(
        0,
        internal.subscriptions.expireCheckoutSession,
        { checkoutSessionId: sub.stripeCheckoutSessionId },
      );
    }
    if (sub.stripeSubscriptionId) {
      await ctx.scheduler.runAfter(
        0,
        internal.subscriptions.cancelStripeSubscription,
        { stripeSubscriptionId: sub.stripeSubscriptionId },
      );
    }
  },
});

export const updateStartDateByCustomer = mutation({
  args: {
    subscriptionId: v.id("subscriptions"),
    startDate: v.optional(v.string()),
    preferredTime: v.optional(v.string()),
    location: v.optional(
      v.object({
        street: v.string(),
        city: v.string(),
        state: v.string(),
        zip: v.string(),
        notes: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const userId = await getUserIdFromIdentity(ctx);
    if (!userId) throw new Error("Not authenticated");
    const sub = await ctx.db.get(args.subscriptionId);
    if (!sub || sub.userId !== userId) throw new Error("Subscription not found");
    if (sub.status !== "pending_payment") {
      throw new Error("The schedule can only be changed before payment");
    }
    if (args.startDate !== undefined) {
      validateStartDate(args.startDate);
    }

    const scheduleChanged =
      args.startDate !== undefined || args.preferredTime !== undefined;
    await ctx.db.patch(args.subscriptionId, {
      ...(args.startDate !== undefined
        ? { startDate: args.startDate, nextScheduledDate: args.startDate }
        : {}),
      ...(args.preferredTime !== undefined
        ? { preferredTime: args.preferredTime }
        : {}),
      ...(args.location !== undefined ? { location: args.location } : {}),
      ...(scheduleChanged ? { stripeCheckoutSessionId: undefined } : {}),
    });
    if (scheduleChanged && sub.stripeCheckoutSessionId) {
      await ctx.scheduler.runAfter(
        0,
        internal.subscriptions.expireCheckoutSession,
        { checkoutSessionId: sub.stripeCheckoutSessionId },
      );
    }
  },
});

export const updatePreferences = mutation({
  args: {
    subscriptionId: v.id("subscriptions"),
    preferredDayOfWeek: v.optional(v.number()),
    preferredTime: v.optional(v.string()),
    startDate: v.optional(v.string()),
    location: v.optional(
      v.object({
        street: v.string(),
        city: v.string(),
        state: v.string(),
        zip: v.string(),
        notes: v.optional(v.string()),
      }),
    ),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const { subscriptionId, ...updates } = args;
    const existing = await ctx.db.get(subscriptionId);
    if (!existing) throw new Error("Subscription not found");

    const patch: Record<string, any> = {};
    if (updates.preferredDayOfWeek !== undefined)
      patch.preferredDayOfWeek = updates.preferredDayOfWeek;
    if (updates.preferredTime !== undefined)
      patch.preferredTime = updates.preferredTime;
    if (updates.startDate !== undefined) {
      validateStartDate(updates.startDate);
      patch.startDate = updates.startDate;
      patch.nextScheduledDate = updates.startDate;
    }
    if (updates.location !== undefined)
      patch.location = updates.location;
    if (updates.notes !== undefined)
      patch.notes = updates.notes;

    if (updates.startDate !== undefined && existing.status === "pending_payment") {
      patch.stripeCheckoutSessionId = undefined;
      if (existing.stripeCheckoutSessionId) {
        await ctx.scheduler.runAfter(
          0,
          internal.subscriptions.expireCheckoutSession,
          { checkoutSessionId: existing.stripeCheckoutSessionId },
        );
      }
    }
    await ctx.db.patch(subscriptionId, patch);
  },
});

// Internal mutation to update after appointment creation
export const updateAfterAppointment = internalMutation({
  args: {
    subscriptionId: v.id("subscriptions"),
    appointmentId: v.id("appointments"),
    nextScheduledDate: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.subscriptionId, {
      lastAppointmentId: args.appointmentId,
      nextScheduledDate: args.nextScheduledDate,
    });
  },
});

// Idempotency lookup: has this subscription already booked this date?
export const findAppointmentForSubscriptionDate = internalQuery({
  args: {
    subscriptionId: v.id("subscriptions"),
    scheduledDate: v.string(),
  },
  handler: async (ctx, args) => {
    const appointments = await ctx.db
      .query("appointments")
      .withIndex("by_date", (q) => q.eq("scheduledDate", args.scheduledDate))
      .filter((a) => a.eq(a.field("subscriptionId"), args.subscriptionId))
      .take(5);
    return appointments[0] ?? null;
  },
});

// Handles a completed subscription-mode Checkout Session: activates the
// subscription (idempotently) and books the first service appointment.
// Called from the Stripe webhook for both completed and async-succeeded
// sessions, so it must tolerate duplicate delivery.
export const handleCheckoutCompleted = internalAction({
  args: {
    subscriptionId: v.id("subscriptions"),
    stripeSubscriptionId: v.string(),
    paymentStatus: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const sub = await ctx.runQuery(internal.subscriptions.getByIdInternal, {
      subscriptionId: args.subscriptionId,
    });
    if (!sub || sub.status === "cancelled") return null;

    // Duplicate delivery: this checkout was already handled.
    if (
      sub.status === "active" &&
      sub.stripeSubscriptionId === args.stripeSubscriptionId
    ) {
      return null;
    }

    // Delayed payment methods: wait for async_payment_succeeded before
    // activating or booking.
    if (args.paymentStatus && args.paymentStatus !== "paid") {
      console.info(
        `[subscriptions] checkout session completed without payment (status=${args.paymentStatus}); waiting for async confirmation`,
      );
      return null;
    }

    await ctx.runMutation(internal.subscriptions.activate, {
      subscriptionId: args.subscriptionId,
      stripeSubscriptionId: args.stripeSubscriptionId,
    });
    // Book the first service for the cycle just paid, then pre-schedule the
    // next cycle so the admin calendar always shows the upcoming service.
    await ctx.runAction(internal.subscriptions.createNextAppointment, {
      subscriptionId: args.subscriptionId,
      mode: "book",
    });
    await ctx.runAction(internal.subscriptions.createNextAppointment, {
      subscriptionId: args.subscriptionId,
      mode: "preschedule",
    });
    return null;
  },
});

// Handles a paid subscription renewal invoice (billing_reason
// "subscription_cycle"): books the next service appointment exactly once
// per Stripe invoice, so webhook retries cannot double-book cycles.
export const handleRenewalInvoicePaid = internalAction({
  args: {
    subscriptionId: v.id("subscriptions"),
    stripeInvoiceId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const sub = await ctx.runQuery(internal.subscriptions.getByIdInternal, {
      subscriptionId: args.subscriptionId,
    });
    if (!sub) return null;

    // Duplicate delivery of the same renewal invoice.
    if (sub.lastRenewalStripeInvoiceId === args.stripeInvoiceId) {
      return null;
    }

    // Confirm the cycle that was just paid (it was pre-scheduled as pending),
    // then pre-schedule the following cycle.
    if (sub.lastAppointmentId) {
      await ctx.runMutation(internal.subscriptions.confirmCycleAppointment, {
        subscriptionId: args.subscriptionId,
        appointmentId: sub.lastAppointmentId,
      });
    }
    await ctx.runAction(internal.subscriptions.createNextAppointment, {
      subscriptionId: args.subscriptionId,
      mode: "preschedule",
    });

    // Mark only after booking so a failed booking can still retry.
    await ctx.runMutation(
      internal.subscriptions.markRenewalInvoiceProcessed,
      {
        subscriptionId: args.subscriptionId,
        stripeInvoiceId: args.stripeInvoiceId,
      },
    );
    return null;
  },
});

// Confirms a pre-scheduled cycle appointment once its charge lands:
// pending -> confirmed, draft invoice -> paid, stats updated, customer notified.
export const confirmCycleAppointment = internalMutation({
  args: {
    subscriptionId: v.id("subscriptions"),
    appointmentId: v.id("appointments"),
  },
  handler: async (ctx, args) => {
    const appointment = await ctx.db.get(args.appointmentId);
    if (!appointment || appointment.subscriptionId !== args.subscriptionId) {
      return;
    }
    if (appointment.status !== "pending") return;

    const sub = await ctx.db.get(args.subscriptionId);
    if (!sub || sub.status === "cancelled" || sub.status === "paused") return;

    await ctx.db.patch(args.appointmentId, { status: "confirmed" });

    const invoice = await ctx.db
      .query("invoices")
      .withIndex("by_appointment", (q) =>
        q.eq("appointmentId", args.appointmentId),
      )
      .first();
    if (invoice && invoice.status === "draft") {
      const today = new Date().toISOString().split("T")[0];
      await ctx.db.patch(invoice._id, { status: "paid", paidDate: today });
    }

    const user = await ctx.db.get(sub.userId);
    if (user) {
      await ctx.runMutation(internal.users.updateStats, {
        userId: sub.userId,
        timesServiced: (user.timesServiced || 0) + 1,
        totalSpent: (user.totalSpent || 0) + sub.totalPrice,
      });
    }

    await ctx.scheduler.runAfter(
      0,
      internal.notifications.queueSubscriptionAppointmentScheduled,
      {
        subscriptionId: args.subscriptionId,
        appointmentId: args.appointmentId,
      },
    );
  },
});

// Cancels a subscription's future scheduled appointments when the
// subscription itself is cancelled, so the admin calendar stays accurate.
// Past and already-cancelled services are left untouched.
export const cancelFutureAppointments = internalMutation({
  args: { subscriptionId: v.id("subscriptions") },
  handler: async (ctx, args) => {
    const today = new Date().toISOString().split("T")[0];
    const upcoming = await ctx.db
      .query("appointments")
      .withIndex("by_subscription", (q) =>
        q.eq("subscriptionId", args.subscriptionId),
      )
      .filter((a) =>
        a.or(
          a.eq(a.field("status"), "pending"),
          a.eq(a.field("status"), "confirmed"),
        ),
      )
      .take(50);
    for (const appointment of upcoming) {
      if (appointment.scheduledDate < today) continue;
      await ctx.db.patch(appointment._id, { status: "cancelled" });
    }
  },
});

export const markRenewalInvoiceProcessed = internalMutation({
  args: {
    subscriptionId: v.id("subscriptions"),
    stripeInvoiceId: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.subscriptionId, {
      lastRenewalStripeInvoiceId: args.stripeInvoiceId,
    });
  },
});

// --- Actions ---

export const createCheckoutSession = internalAction({
  args: { subscriptionId: v.id("subscriptions") },
  handler: async (ctx, args): Promise<string> => {
    const sub = await ctx.runQuery(internal.subscriptions.getByIdInternal, {
      subscriptionId: args.subscriptionId,
    });
    if (!sub) throw new Error("Subscription not found");
    if (sub.status !== "pending_payment") {
      throw new Error("This subscription is not awaiting payment");
    }
    if (sub.stripeSubscriptionId) {
      throw new Error("This subscription has already been paid");
    }

    const user = await ctx.runQuery(internal.users.getByIdInternal, {
      userId: sub.userId,
    });
    if (!user) throw new Error("User not found");
    const stripeCustomerId =
      user.stripeCustomerId ||
      (await ctx.runAction(internal.users.ensureStripeCustomer, {
        userId: sub.userId,
      }));

    const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeSecretKey) throw new Error("STRIPE_SECRET_KEY not set");

    if (sub.stripeCheckoutSessionId) {
      const existingResponse = await fetch(
        `https://api.stripe.com/v1/checkout/sessions/${sub.stripeCheckoutSessionId}`,
        {
          headers: { Authorization: `Bearer ${stripeSecretKey}` },
        },
      );
      if (existingResponse.ok) {
        const existingSession = await existingResponse.json();
        if (existingSession.status === "complete") {
          throw new Error("This subscription checkout has already been completed");
        }
        if (existingSession.status === "open" && existingSession.url) {
          await ctx.runAction(internal.subscriptions.sendCheckoutLink, {
            subscriptionId: args.subscriptionId,
            checkoutUrl: existingSession.url,
          });
          return existingSession.url as string;
        }
      }
    }

    // Bill the day it's paid: a full payment-style subscription Checkout that
    // charges the first cycle immediately and recurs from the payment date.
    // The selected service date/time only schedules the first appointment.
    const appUrl =
      process.env.NEXT_PUBLIC_APP_URL ||
      process.env.NEXT_PUBLIC_SITE_URL ||
      "https://rivercitymd.vercel.app";

    if (!sub.startDate) {
      // The customer has not chosen a service date yet. Email a dashboard
      // link so they can pick their date and time, then pay from there.
      const dashboardUrl = `${appUrl}/dashboard/subscriptions`;
      await ctx.runAction(internal.subscriptions.sendCheckoutLink, {
        subscriptionId: args.subscriptionId,
        checkoutUrl: dashboardUrl,
      });
      return dashboardUrl;
    }

    // Validate the chosen slot against availability before creating the
    // charge-enabled checkout session.
    let totalDuration = 0;
    const serviceNames: string[] = [];
    for (const serviceId of sub.serviceIds) {
      const service = await ctx.runQuery(internal.services.getServiceById, {
        serviceId,
      });
      if (service) {
        totalDuration += service.duration * sub.vehicleIds.length;
        serviceNames.push(service.name);
      }
    }
    const petFeeSettings = await ctx.runQuery(
      internal.petFeeSettings.getInternal,
      {},
    );
    totalDuration +=
      (petFeeSettings?.timeAddMinutes ?? 0) *
        (sub.petFeeVehicleIds?.length ?? 0) +
      (sub.travelBufferMinutes ?? 0);
    const availability = await ctx.runQuery(
      api.availability.checkAvailability,
      {
        date: sub.nextScheduledDate || sub.startDate,
        startTime: sub.preferredTime,
        duration: totalDuration,
      },
    );
    if (!availability.available) {
      throw new Error(
        `That time slot is no longer available${availability.reason ? ` (${availability.reason})` : ""}. Please choose another date or time.`,
      );
    }

    const frequencyLabel = sub.frequency === "monthly" ? "Monthly" : "Biweekly";
    const body = new URLSearchParams({
      mode: "subscription",
      customer: stripeCustomerId,
      "payment_method_types[0]": "card",
      "line_items[0][quantity]": "1",
      "line_items[0][price_data][currency]": "usd",
      "line_items[0][price_data][unit_amount]": Math.round(
        sub.totalPrice * 100,
      ).toString(),
      "line_items[0][price_data][product_data][name]":
        "River City MD Subscription",
      "line_items[0][price_data][product_data][description]": `${serviceNames.join(", ") || "Recurring detailing"} — ${frequencyLabel}`,
      "metadata[subscriptionId]": args.subscriptionId,
      "subscription_data[metadata][subscriptionId]": args.subscriptionId,
      success_url: `${appUrl}/dashboard/subscriptions?success=true`,
      cancel_url: `${appUrl}/dashboard/subscriptions?cancelled=true`,
    });
    if (sub.frequency === "monthly") {
      body.set("line_items[0][price_data][recurring][interval]", "month");
    } else {
      body.set("line_items[0][price_data][recurring][interval]", "week");
      body.set(
        "line_items[0][price_data][recurring][interval_count]",
        "2",
      );
    }

    const response = await fetch(
      "https://api.stripe.com/v1/checkout/sessions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${stripeSecretKey}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
      },
    );

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Stripe checkout session failed: ${response.status} ${errText}`);
    }

    const session = await response.json();
    if (!session.id || !session.url) {
      throw new Error("Stripe did not return a checkout session");
    }
    await ctx.runMutation(internal.subscriptions.saveCheckoutSession, {
      subscriptionId: args.subscriptionId,
      stripeCheckoutSessionId: session.id,
    });



    // Send checkout link to customer
    await ctx.runAction(internal.subscriptions.sendCheckoutLink, {
      subscriptionId: args.subscriptionId,
      checkoutUrl: session.url,
    });
    return session.url as string;
  },
});

export const completeSetup = internalAction({
  args: {
    subscriptionId: v.id("subscriptions"),
    setupIntentId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const sub = await ctx.runQuery(internal.subscriptions.getByIdInternal, {
      subscriptionId: args.subscriptionId,
    });
    if (!sub || sub.status === "cancelled") return null;
    if (sub.stripeSubscriptionId) return null;

    const user = await ctx.runQuery(internal.users.getByIdInternal, {
      userId: sub.userId,
    });
    const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
    if (!user?.stripeCustomerId || !stripeSecretKey) {
      throw new Error("Stripe customer or secret key is missing");
    }

    const setupResponse = await fetch(
      `https://api.stripe.com/v1/setup_intents/${args.setupIntentId}`,
      { headers: { Authorization: `Bearer ${stripeSecretKey}` } },
    );
    if (!setupResponse.ok) {
      throw new Error(`Stripe setup intent lookup failed: ${setupResponse.status}`);
    }
    const setupIntent = await setupResponse.json();
    const paymentMethodId = setupIntent.payment_method as string | undefined;
    if (!paymentMethodId) throw new Error("Stripe did not return a payment method");

    const body = new URLSearchParams({
      customer: user.stripeCustomerId,
      "default_payment_method": paymentMethodId,
      "metadata[subscriptionId]": args.subscriptionId,
      "items[0][price_data][currency]": "usd",
      "items[0][price_data][product_data][name]": "River City MD subscription",
      "items[0][price_data][unit_amount]": Math.round(sub.totalPrice * 100).toString(),
      "items[0][quantity]": "1",
      collection_method: "charge_automatically",
      proration_behavior: "none",
    });
    if (sub.frequency === "monthly") {
      body.set("items[0][price_data][recurring][interval]", "month");
    } else {
      body.set("items[0][price_data][recurring][interval]", "week");
      body.set("items[0][price_data][recurring][interval_count]", "2");
    }
    const startDate = sub.startDate || sub.nextScheduledDate;
    if (startDate) {
      const anchor = Math.floor(new Date(`${startDate}T12:00:00Z`).getTime() / 1000);
      if (!Number.isNaN(anchor) && anchor > Math.floor(Date.now() / 1000)) {
        body.set("billing_cycle_anchor", String(anchor));
      }
    }

    const response = await fetch("https://api.stripe.com/v1/subscriptions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${stripeSecretKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });
    if (!response.ok) {
      throw new Error(`Stripe subscription creation failed: ${response.status} ${await response.text()}`);
    }
    const stripeSubscription = await response.json();
    await ctx.runMutation(internal.subscriptions.activate, {
      subscriptionId: args.subscriptionId,
      stripeSubscriptionId: stripeSubscription.id,
    });
    await ctx.runAction(internal.subscriptions.createNextAppointment, {
      subscriptionId: args.subscriptionId,
    });
    return null;
  },
});
export const saveStripeSubscriptionId = internalMutation({
  args: {
    subscriptionId: v.id("subscriptions"),
    stripeSubscriptionId: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.subscriptionId, {
      stripeSubscriptionId: args.stripeSubscriptionId,
    });
  },
});

export const createStripeSubscriptionFromBooking = internalAction({
  args: { subscriptionId: v.id("subscriptions") },
  handler: async (ctx, args): Promise<null> => {
    const sub = await ctx.runQuery(internal.subscriptions.getByIdInternal, {
      subscriptionId: args.subscriptionId,
    });
    if (!sub || sub.status === "cancelled") return null;
    if (sub.stripeSubscriptionId) return null;

    const user = await ctx.runQuery(internal.users.getByIdInternal, {
      userId: sub.userId,
    });
    if (!user) throw new Error("User not found");

    const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeSecretKey) throw new Error("STRIPE_SECRET_KEY not set");

    const stripeCustomerId =
      user.stripeCustomerId ||
      (await ctx.runAction(internal.users.ensureStripeCustomer, {
        userId: sub.userId,
      }));

    const paymentMethodsResponse = await fetch(
      `https://api.stripe.com/v1/customers/${stripeCustomerId}/payment_methods?type=card&limit=1`,
      {
        headers: { Authorization: `Bearer ${stripeSecretKey}` },
      },
    );
    if (!paymentMethodsResponse.ok) {
      const errText = await paymentMethodsResponse.text();
      throw new Error(
        `Stripe payment method lookup failed: ${paymentMethodsResponse.status} ${errText}`,
      );
    }
    const paymentMethods = await paymentMethodsResponse.json();
    const paymentMethodId = paymentMethods?.data?.[0]?.id as string | undefined;
    if (!paymentMethodId) {
      throw new Error("No saved card found for this membership.");
    }

    const defaultPaymentMethodResponse = await fetch(
      `https://api.stripe.com/v1/customers/${stripeCustomerId}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${stripeSecretKey}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          "invoice_settings[default_payment_method]": paymentMethodId,
        }),
      },
    );
    if (!defaultPaymentMethodResponse.ok) {
      const errText = await defaultPaymentMethodResponse.text();
      throw new Error(
        `Stripe default payment method update failed: ${defaultPaymentMethodResponse.status} ${errText}`,
      );
    }

    const nextDate =
      sub.nextScheduledDate ||
      sub.startDate ||
      new Date().toISOString().split("T")[0];
    const trialEnd = Math.floor(
      new Date(`${nextDate}T12:00:00`).getTime() / 1000,
    );

    const body = new URLSearchParams({
      customer: stripeCustomerId,
      default_payment_method: paymentMethodId,
      "items[0][quantity]": "1",
      "items[0][price_data][currency]": "usd",
      "items[0][price_data][unit_amount]": Math.round(
        sub.totalPrice * 100,
      ).toString(),
      "items[0][price_data][product_data][name]":
        "River City MD Membership",
      "items[0][price_data][product_data][description]":
        `${sub.frequency === "monthly" ? "Monthly" : "Biweekly"} membership`,
      trial_end: trialEnd.toString(),
      "metadata[subscriptionId]": args.subscriptionId,
      "metadata[source]": "booking_membership",
    });
    if (sub.frequency === "monthly") {
      body.set("items[0][price_data][recurring][interval]", "month");
    } else {
      body.set("items[0][price_data][recurring][interval]", "week");
      body.set(
        "items[0][price_data][recurring][interval_count]",
        "2",
      );
    }

    const response = await fetch("https://api.stripe.com/v1/subscriptions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${stripeSecretKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });
    if (!response.ok) {
      const errText = await response.text();
      throw new Error(
        `Stripe subscription creation failed: ${response.status} ${errText}`,
      );
    }

    const stripeSubscription = await response.json();
    if (!stripeSubscription?.id) {
      throw new Error("Stripe did not return a subscription");
    }

    await ctx.runMutation(internal.subscriptions.saveStripeSubscriptionId, {
      subscriptionId: args.subscriptionId,
      stripeSubscriptionId: stripeSubscription.id,
    });
    return null;
  },
});

export const startCheckout = action({
  args: { subscriptionId: v.id("subscriptions") },
  returns: v.string(),
  handler: async (ctx, args): Promise<string> => {
    const userId = await getUserIdFromIdentity(ctx);
    if (!userId) throw new Error("Not authenticated");
    const sub = await ctx.runQuery(internal.subscriptions.getByIdInternal, {
      subscriptionId: args.subscriptionId,
    });
    if (!sub || sub.userId !== userId) throw new Error("Subscription not found");
    if (sub.status !== "pending_payment") {
      throw new Error("This subscription no longer needs payment");
    }
    if (!sub.startDate) {
      throw new Error("Choose your service date and time first");
    }
    return await ctx.runAction(internal.subscriptions.createCheckoutSession, {
      subscriptionId: args.subscriptionId,
    });
  },
});

export const sendCheckoutLink = internalAction({
  args: {
    subscriptionId: v.id("subscriptions"),
    checkoutUrl: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.runMutation(internal.notifications.queueSubscriptionCheckoutLinkSent, {
      subscriptionId: args.subscriptionId,
      checkoutUrl: args.checkoutUrl,
    });
  },
});

export const resendCheckoutLink = action({
  args: { subscriptionId: v.id("subscriptions") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const sub = await ctx.runQuery(internal.subscriptions.getByIdInternal, {
      subscriptionId: args.subscriptionId,
    });
    if (!sub || sub.status !== "pending_payment") {
      throw new Error("Only pending subscriptions can receive a checkout link");
    }
    await ctx.runAction(internal.subscriptions.createCheckoutSession, {
      subscriptionId: args.subscriptionId,
    });

  },
});

export const expireCheckoutSession = internalAction({
  args: { checkoutSessionId: v.string() },
  handler: async (_ctx, args) => {
    const secret = process.env.STRIPE_SECRET_KEY;
    if (!secret || !args.checkoutSessionId.trim()) return;

    const response = await fetch(
      `https://api.stripe.com/v1/checkout/sessions/${args.checkoutSessionId}/expire`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${secret}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams(),
      },
    );
    if (!response.ok) {
      const body = await response.text();
      const message = body.toLowerCase();
      if (
        !message.includes("already expired") &&
        !message.includes("already completed") &&
        !message.includes("cannot expire") &&
        !message.includes("status of `complete`") &&
        !message.includes("status in [\"open\"]")
      ) {
        throw new Error(`Stripe checkout expiration failed: ${response.status} ${body}`);
      }
    }
  },
});

export const createNextAppointment = internalAction({
  args: {
    subscriptionId: v.id("subscriptions"),
    // "book" books the cycle being paid now (confirmed + paid invoice + stats).
    // "preschedule" plans the next cycle ahead (pending + draft invoice), to be
    // confirmed when that cycle's charge lands.
    mode: v.optional(v.union(v.literal("book"), v.literal("preschedule"))),
  },
  handler: async (ctx, args) => {
    const sub = await ctx.runQuery(internal.subscriptions.getByIdInternal, {
      subscriptionId: args.subscriptionId,
    });
    if (!sub || sub.status === "cancelled" || sub.status === "paused") return;

    const user = await ctx.runQuery(internal.users.getByIdInternal, {
      userId: sub.userId,
    });
    if (!user) return;

    // Compute next date
    const nextDate =
      sub.nextScheduledDate ||
      sub.startDate ||
      computeFirstDate(sub.preferredDayOfWeek);

    // Compute total duration
    let totalDuration = 0;
    const serviceNames: string[] = [];
    for (const serviceId of sub.serviceIds) {
      const service = await ctx.runQuery(internal.services.getServiceById, { serviceId });
      if (service) {
        totalDuration += service.duration * sub.vehicleIds.length;
        serviceNames.push(service.name);
      }
    }
    const petFeeSettings = await ctx.runQuery(
      internal.petFeeSettings.getInternal,
      {},
    );
    const petFeeVehicleCount = sub.petFeeVehicleIds?.length ?? 0;
    totalDuration +=
      (petFeeSettings?.timeAddMinutes ?? 0) * petFeeVehicleCount +
      (sub.travelBufferMinutes ?? 0);

    // Idempotency: skip if an appointment for this cycle already exists
    // (duplicate webhook deliveries would otherwise double-book).
    const existingForCycle = await ctx.runQuery(
      internal.subscriptions.findAppointmentForSubscriptionDate,
      {
        subscriptionId: args.subscriptionId,
        scheduledDate: nextDate,
      },
    );
    if (existingForCycle) return;

    // Re-check the slot at booking time; the customer may have paid from an
    // emailed link hours or days after choosing the slot.
    const availability = await ctx.runQuery(
      api.availability.checkAvailability,
      {
        date: nextDate,
        startTime: sub.preferredTime,
        duration: totalDuration,
        ignoreAppointmentId: sub.lastAppointmentId ?? undefined,
      },
    );
    const slotAvailable = availability.available;
    const isPreschedule = args.mode === "preschedule";

    // Create appointment. Booked cycles are confirmed (a slot conflict keeps
    // them in the admin booking list as pending for rescheduling);
    // pre-scheduled cycles stay pending until their charge lands.
    const appointmentId = await ctx.runMutation(
      internal.subscriptions.insertAppointment,
      {
        userId: sub.userId,
        vehicleIds: sub.vehicleIds,
        serviceIds: sub.serviceIds,
        scheduledDate: nextDate,
        scheduledTime: sub.preferredTime,
        duration: totalDuration,
        location: sub.location,
        totalPrice: sub.totalPrice,
        subscriptionId: args.subscriptionId,
        notes: slotAvailable
          ? isPreschedule
            ? "[Subscription] Pre-scheduled — confirms on payment"
            : sub.notes
              ? `[Subscription] ${sub.notes}`
              : "[Subscription] Auto-scheduled"
          : isPreschedule
            ? "[Subscription] Pre-scheduled (slot conflict — needs rescheduling) — confirms on payment"
            : "[Subscription] Chosen time conflicts with another booking — needs rescheduling",
        createdBy: sub.createdBy,
        status: isPreschedule || !slotAvailable ? "pending" : "confirmed",
      },
    );

    // Create invoice
    const invoiceItems: Array<{
      itemType?: "service" | "subscription" | "pet_fee" | "travel_fee";
      serviceId?: Id<"services">;
      serviceName: string;
      quantity: number;
      unitPrice: number;
      totalPrice: number;
    }> = [];
    const basePricePerCycle = sub.basePricePerCycle ?? sub.totalPrice;
    for (const serviceId of sub.serviceIds) {
      const service = await ctx.runQuery(internal.services.getServiceById, { serviceId });
      if (service) {
        const lineTotal = basePricePerCycle / sub.serviceIds.length;
        invoiceItems.push({
          itemType: "service",
          serviceId,
          serviceName: service.name,
          quantity: sub.vehicleIds.length,
          unitPrice: lineTotal / sub.vehicleIds.length,
          totalPrice: lineTotal,
        });
      }
    }
    if ((sub.petFeePerCycle ?? 0) > 0 && petFeeVehicleCount > 0) {
      invoiceItems.push({
        itemType: "pet_fee",
        serviceName: "Pet fee",
        quantity: petFeeVehicleCount,
        unitPrice: (sub.petFeePerCycle ?? 0) / petFeeVehicleCount,
        totalPrice: sub.petFeePerCycle ?? 0,
      });
    }
    if ((sub.travelFeePerCycle ?? 0) > 0) {
      invoiceItems.push({
        itemType: "travel_fee",
        serviceName: "Travel fee",
        quantity: 1,
        unitPrice: sub.travelFeePerCycle ?? 0,
        totalPrice: sub.travelFeePerCycle ?? 0,
      });
    }

    const invoiceNumber = `SUB-${Date.now()}`;
    const today = new Date().toISOString().split("T")[0];

    await ctx.runMutation(internal.subscriptions.insertInvoice, {
      appointmentId,
      userId: sub.userId,
      invoiceNumber,
      items: invoiceItems,
      subtotal: sub.totalPrice,
      tax: 0,
      total: sub.totalPrice,
      status: isPreschedule ? "draft" : "paid",
      dueDate: isPreschedule ? nextDate : today,
      paidDate: isPreschedule ? undefined : today,
      paymentOption: "subscription",
    });

    // Compute the NEXT scheduled date (for the cycle after this one)
    const futureDate = computeNextDate(
      sub.frequency,
      nextDate,
    );

    // Update subscription
    await ctx.runMutation(internal.subscriptions.updateAfterAppointment, {
      subscriptionId: args.subscriptionId,
      appointmentId,
      nextScheduledDate: futureDate,
    });

    // Update user stats when the cycle is actually booked/confirmed, not
    // when it is only pre-scheduled ahead of its payment.
    if (!isPreschedule) {
      await ctx.runMutation(internal.users.updateStats, {
        userId: sub.userId,
        timesServiced: (user.timesServiced || 0) + 1,
        totalSpent: (user.totalSpent || 0) + sub.totalPrice,
      });
    }

    if (!isPreschedule) {
      await ctx.runMutation(internal.notifications.queueSubscriptionAppointmentScheduled, {
        subscriptionId: args.subscriptionId,
        appointmentId,
      });
    }
  },
});

// Internal mutations for appointment/invoice creation (called from actions)
export const insertAppointment = internalMutation({
  args: {
    userId: v.id("users"),
    vehicleIds: v.array(v.id("vehicles")),
    serviceIds: v.array(v.id("services")),
    scheduledDate: v.string(),
    scheduledTime: v.string(),
    duration: v.number(),
    location: v.object({
      street: v.string(),
      city: v.string(),
      state: v.string(),
      zip: v.string(),
      notes: v.optional(v.string()),
    }),
    totalPrice: v.number(),
    subscriptionId: v.id("subscriptions"),
    notes: v.optional(v.string()),
    createdBy: v.id("users"),
    status: v.optional(v.union(v.literal("pending"), v.literal("confirmed"))),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("appointments", {
      userId: args.userId,
      vehicleIds: args.vehicleIds,
      serviceIds: args.serviceIds,
      scheduledDate: args.scheduledDate,
      scheduledTime: args.scheduledTime,
      duration: args.duration,
      location: args.location,
      status: args.status ?? "confirmed",
      totalPrice: args.totalPrice,
      paymentOption: "subscription",
      subscriptionId: args.subscriptionId,
      notes: args.notes,
      createdBy: args.createdBy,
    });
  },
});

export const insertInvoice = internalMutation({
  args: {
    appointmentId: v.id("appointments"),
    userId: v.id("users"),
    invoiceNumber: v.string(),
    items: v.array(
      v.object({
        itemType: v.optional(
          v.union(
            v.literal("service"),
            v.literal("subscription"),
            v.literal("pet_fee"),
            v.literal("travel_fee"),
          ),
        ),
        serviceId: v.optional(v.id("services")),
        serviceName: v.string(),
        quantity: v.number(),
        unitPrice: v.number(),
        totalPrice: v.number(),
      }),
    ),
    subtotal: v.number(),
    tax: v.number(),
    total: v.number(),
    status: v.union(
      v.literal("draft"),
      v.literal("sent"),
      v.literal("paid"),
      v.literal("overdue"),
    ),
    dueDate: v.string(),
    paidDate: v.optional(v.string()),
    paymentOption: v.optional(
      v.union(
        v.literal("deposit"),
        v.literal("full"),
        v.literal("in_person"),
        v.literal("subscription"),
      ),
    ),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("invoices", {
      appointmentId: args.appointmentId,
      userId: args.userId,
      invoiceNumber: args.invoiceNumber,
      items: args.items,
      subtotal: args.subtotal,
      tax: args.tax,
      total: args.total,
      status: args.status,
      dueDate: args.dueDate,
      paidDate: args.paidDate,
      paymentOption: args.paymentOption,
    });
  },
});

// Stripe management actions
export const pauseStripeSubscription = internalAction({
  args: { stripeSubscriptionId: v.string() },
  handler: async (_ctx, args) => {
    const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeSecretKey) return;

    await fetch(
      `https://api.stripe.com/v1/subscriptions/${args.stripeSubscriptionId}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${stripeSecretKey}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          cancel_at_period_end: "true",
        }),
      },
    );
  },
});

export const resumeStripeSubscription = internalAction({
  args: { stripeSubscriptionId: v.string() },
  handler: async (_ctx, args) => {
    const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeSecretKey) return;

    await fetch(
      `https://api.stripe.com/v1/subscriptions/${args.stripeSubscriptionId}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${stripeSecretKey}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          cancel_at_period_end: "false",
        }),
      },
    );
  },
});

export const cancelStripeSubscription = internalAction({
  args: { stripeSubscriptionId: v.string() },
  handler: async (_ctx, args) => {
    const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeSecretKey) return;

    await fetch(
      `https://api.stripe.com/v1/subscriptions/${args.stripeSubscriptionId}`,
      {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${stripeSecretKey}`,
        },
      },
    );
  },
});

// Customer portal session for managing payment method
export const createCustomerPortalSession = action({
  args: {},
  returns: v.string(),
  handler: async (ctx): Promise<string> => {
    const userId = await getUserIdFromIdentity(ctx);
    if (!userId) throw new Error("Not authenticated");

    const user = await ctx.runQuery(internal.users.getByIdInternal, { userId });
    if (!user) throw new Error("User not found");
    const stripeCustomerId =
      user.stripeCustomerId ||
      (await ctx.runAction(internal.users.ensureStripeCustomer, { userId }));

    const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeSecretKey) throw new Error("STRIPE_SECRET_KEY not set");

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.CONVEX_SITE_URL || "";

    const portalResponse = await fetch(
      "https://api.stripe.com/v1/billing_portal/sessions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${stripeSecretKey}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          customer: stripeCustomerId,
          return_url: `${appUrl}/dashboard/subscriptions`,
        }),
      },
    );

    if (!portalResponse.ok) {
      const errText = await portalResponse.text();
      throw new Error(`Stripe portal session failed: ${portalResponse.status} ${errText}`);
    }

    const session = await portalResponse.json();
    return session.url as string;
  },
});
