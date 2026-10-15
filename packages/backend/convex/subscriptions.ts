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
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
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
  today.setHours(12, 0, 0, 0);
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
        return {
          ...sub,
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

    const startDate = args.startDate || computeFirstDate(args.preferredDayOfWeek);
    validateStartDate(startDate);

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
    if (!subscription || subscription.status === "cancelled") return;
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

    await ctx.db.patch(args.subscriptionId, { status: "cancelled" });

    if (sub.stripeSubscriptionId) {
      await ctx.scheduler.runAfter(0, internal.subscriptions.cancelStripeSubscription, {
        stripeSubscriptionId: sub.stripeSubscriptionId,
      });
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

    await ctx.db.patch(args.subscriptionId, { status: "cancelled" });
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
    startDate: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getUserIdFromIdentity(ctx);
    if (!userId) throw new Error("Not authenticated");
    const sub = await ctx.db.get(args.subscriptionId);
    if (!sub || sub.userId !== userId) throw new Error("Subscription not found");
    if (sub.status !== "pending_payment") {
      throw new Error("The start date can only be changed before payment");
    }
    validateStartDate(args.startDate);

    await ctx.db.patch(args.subscriptionId, {
      startDate: args.startDate,
      nextScheduledDate: args.startDate,
      stripeCheckoutSessionId: undefined,
    });
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

// --- Actions ---

export const createCheckoutSession = internalAction({
  args: { subscriptionId: v.id("subscriptions") },
  handler: async (ctx, args): Promise<string> => {
    const sub = await ctx.runQuery(internal.subscriptions.getByIdInternal, {
      subscriptionId: args.subscriptionId,
    });
    if (!sub) throw new Error("Subscription not found");

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
        if (existingSession.status === "open" && existingSession.url) {
          await ctx.runAction(internal.subscriptions.sendCheckoutLink, {
            subscriptionId: args.subscriptionId,
            checkoutUrl: existingSession.url,
          });
          return existingSession.url as string;
        }
      }
    }

    // Compute total in cents for subscription
    // Use price_data with the computed total rather than individual recurring prices
    const siteUrl = process.env.CONVEX_SITE_URL || "https://patient-wombat-877.convex.site";
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || siteUrl;

    // Build service description
    const serviceNames: string[] = [];
    for (const serviceId of sub.serviceIds) {
      const service = await ctx.runQuery(internal.services.getServiceById, { serviceId });
      if (service) serviceNames.push(service.name);
    }
    const description = serviceNames.join(", ");

    const body = new URLSearchParams({
      mode: "subscription",
      customer: stripeCustomerId,
      "line_items[0][price_data][currency]": "usd",
      "line_items[0][price_data][product_data][name]": `${description} (${sub.frequency === "monthly" ? "Monthly" : "Biweekly"})`,
      "line_items[0][price_data][unit_amount]": Math.round(sub.totalPrice * 100).toString(),
      "line_items[0][quantity]": "1",
      "metadata[subscriptionId]": args.subscriptionId,
      success_url: `${appUrl}/dashboard/subscriptions?success=true`,
      cancel_url: `${appUrl}/dashboard/subscriptions?cancelled=true`,
    });

    const startDate = sub.startDate || sub.nextScheduledDate;
    if (startDate) {
      const anchor = Math.floor(new Date(`${startDate}T12:00:00Z`).getTime() / 1000);
      if (!Number.isNaN(anchor) && anchor > Math.floor(Date.now() / 1000)) {
        body.set("subscription_data[trial_end]", String(anchor));
      }
    }

    if (sub.frequency === "monthly") {
      body.set("line_items[0][price_data][recurring][interval]", "month");
    } else {
      body.set("line_items[0][price_data][recurring][interval]", "week");
      body.set("line_items[0][price_data][recurring][interval_count]", "2");
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
    await ctx.runAction(internal.subscriptions.createCheckoutSession, {
      subscriptionId: args.subscriptionId,
    });
  },
});

export const createNextAppointment = internalAction({
  args: { subscriptionId: v.id("subscriptions") },
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

    // Create appointment
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
        notes: sub.notes ? `[Subscription] ${sub.notes}` : "[Subscription] Auto-scheduled",
        createdBy: sub.createdBy,
      },
    );

    // Create invoice
    const invoiceItems = [];
    for (const serviceId of sub.serviceIds) {
      const service = await ctx.runQuery(internal.services.getServiceById, { serviceId });
      if (service) {
        invoiceItems.push({
          serviceId,
          serviceName: service.name,
          quantity: sub.vehicleIds.length,
          unitPrice: sub.totalPrice / sub.vehicleIds.length / sub.serviceIds.length,
          totalPrice: sub.totalPrice / sub.serviceIds.length,
        });
      }
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
      status: "paid",
      dueDate: today,
      paidDate: today,
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

    // Update user stats
    await ctx.runMutation(internal.users.updateStats, {
      userId: sub.userId,
      timesServiced: (user.timesServiced || 0) + 1,
      totalSpent: (user.totalSpent || 0) + sub.totalPrice,
    });

    await ctx.runMutation(internal.notifications.queueSubscriptionAppointmentScheduled, {
      subscriptionId: args.subscriptionId,
      appointmentId,
    });
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
      status: "confirmed",
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
        serviceId: v.id("services"),
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
