import {
  query,
  mutation,
  internalQuery,
  internalMutation,
} from "./_generated/server";
import type { QueryCtx, MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { getUserIdFromIdentity, isAdmin, requireAdmin } from "./auth";
import { components } from "./_generated/api";

const invoiceStatusValidator = v.union(
  v.literal("draft"),
  v.literal("sent"),
  v.literal("paid"),
  v.literal("overdue"),
);

const remainingBalanceCollectionMethodValidator = v.union(
  v.literal("send_invoice"),
  v.literal("charge_automatically"),
);

const invoiceCreateArgs = {
  appointmentId: v.id("appointments"),
  userId: v.id("users"),
  invoiceNumber: v.string(),
  items: v.array(
    v.object({
      itemType: v.optional(
        v.union(
          v.literal("service"),
          v.literal("pet_fee"),
          v.literal("travel_fee"),
        ),
      ),
      serviceId: v.optional(v.id("services")),
      vehicleId: v.optional(v.id("vehicles")),
      vehicleLabel: v.optional(v.string()),
      vehicleTypeId: v.optional(v.id("vehicleTypes")),
      serviceName: v.string(),
      quantity: v.number(),
      unitPrice: v.number(),
      totalPrice: v.number(),
    }),
  ),
  subtotal: v.number(),
  tax: v.number(),
  total: v.number(),
  status: invoiceStatusValidator,
  dueDate: v.string(),
  stripeInvoiceId: v.optional(v.string()),
  stripeInvoiceUrl: v.optional(v.string()),
  notes: v.optional(v.string()),
  depositAmount: v.optional(v.number()),
  depositPaid: v.optional(v.boolean()),
  depositPaymentIntentId: v.optional(v.string()),
  remainingBalance: v.optional(v.number()),
  finalPaymentIntentId: v.optional(v.string()),
  remainingBalanceCollectionMethod: v.optional(
    remainingBalanceCollectionMethodValidator,
  ),
  couponCode: v.optional(v.string()),
  discountAmount: v.optional(v.number()),
} as const;

async function requireInvoiceReadAccess(
  ctx: QueryCtx | MutationCtx,
  invoice: Doc<"invoices">,
  userId: Id<"users">,
) {
  if (invoice.userId === userId) {
    return;
  }
  if (await isAdmin(ctx)) {
    return;
  }
  throw new Error("Access denied");
}

// Get all invoices
export const list = query({
  args: {
    status: v.optional(
      v.union(
        v.literal("draft"),
        v.literal("sent"),
        v.literal("paid"),
        v.literal("overdue"),
      ),
    ),
  },
  handler: async (ctx, args) => {
    const userId = await getUserIdFromIdentity(ctx);
    if (!userId) throw new Error("Not authenticated");
    const isAdminUser = await isAdmin(ctx);

    if (isAdminUser) {
      if (args.status) {
        return await ctx.db
          .query("invoices")
          .withIndex("by_status", (q) => q.eq("status", args.status!))
          .collect();
      }

      return await ctx.db.query("invoices").collect();
    }

    const userInvoices = await ctx.db
      .query("invoices")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();

    if (args.status) {
      return userInvoices.filter((invoice) => invoice.status === args.status);
    }

    return userInvoices;
  },
});

// Get a single invoice by ID
export const getById = query({
  args: { invoiceId: v.id("invoices") },
  handler: async (ctx, args) => {
    const userId = await getUserIdFromIdentity(ctx);
    if (!userId) throw new Error("Not authenticated");

    const invoice = await ctx.db.get(args.invoiceId);
    if (!invoice) {
      return null;
    }

    await requireInvoiceReadAccess(ctx, invoice, userId);
    return invoice;
  },
});

// Get a single invoice by ID with full details (admin only)
export const getByIdAdmin = query({
  args: { invoiceId: v.id("invoices") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const invoice = await ctx.db.get(args.invoiceId);
    if (!invoice) return null;

    const user = await ctx.db.get(invoice.userId);
    const appointment = await ctx.db.get(invoice.appointmentId);
    const services = appointment
      ? await Promise.all(appointment.serviceIds.map((id) => ctx.db.get(id)))
      : [];
    const vehicles = appointment
      ? await Promise.all(appointment.vehicleIds.map((id) => ctx.db.get(id)))
      : [];

    return {
      ...invoice,
      customer: user?.name || "Unknown",
      customerEmail: user?.email || "",
      customerPhone: user?.phone || "",
      customerAddress: user?.address,
      appointment: appointment
        ? {
            ...appointment,
            services: services.filter((s) => s !== null),
            vehicles: vehicles.filter((v) => v !== null),
          }
        : null,
    };
  },
});

// Get invoice by Stripe invoice ID (owner or admin)
export const getByStripeId = query({
  args: { stripeInvoiceId: v.string() },
  handler: async (ctx, args) => {
    const userId = await getUserIdFromIdentity(ctx);
    if (!userId) throw new Error("Not authenticated");

    const invoice = await ctx.db
      .query("invoices")
      .withIndex("by_stripe_invoice_id", (q) =>
        q.eq("stripeInvoiceId", args.stripeInvoiceId),
      )
      .first();

    if (!invoice) {
      return null;
    }

    await requireInvoiceReadAccess(ctx, invoice, userId);
    return invoice;
  },
});

export const getByStripeIdInternal = internalQuery({
  args: { stripeInvoiceId: v.string() },
  handler: async (ctx, args): Promise<Doc<"invoices"> | null> => {
    return await ctx.db
      .query("invoices")
      .withIndex("by_stripe_invoice_id", (q) =>
        q.eq("stripeInvoiceId", args.stripeInvoiceId),
      )
      .first();
  },
});

// Get invoice by appointment ID
export const getByAppointment = query({
  args: { appointmentId: v.id("appointments") },
  handler: async (ctx, args) => {
    const userId = await getUserIdFromIdentity(ctx);
    if (!userId) throw new Error("Not authenticated");

    const invoice = await ctx.db
      .query("invoices")
      .withIndex("by_appointment", (q) =>
        q.eq("appointmentId", args.appointmentId),
      )
      .first();

    if (!invoice) {
      return null;
    }

    await requireInvoiceReadAccess(ctx, invoice, userId);
    return invoice;
  },
});

// Internal query to get invoice by ID (no auth required, for internal actions)
export const getByIdInternal = internalQuery({
  args: { invoiceId: v.id("invoices") },
  handler: async (ctx, args): Promise<Doc<"invoices"> | null> => {
    return await ctx.db.get(args.invoiceId);
  },
});

// Get invoice count
export const getCount = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);

    const invoices = await ctx.db.query("invoices").collect();
    return { count: invoices.length };
  },
});

export const getCountInternal = internalQuery({
  args: {},
  handler: async (ctx) => {
    const invoices = await ctx.db.query("invoices").collect();
    return { count: invoices.length };
  },
});

// Create invoice
export const create = mutation({
  args: invoiceCreateArgs,
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    return await ctx.db.insert("invoices", args);
  },
});

export const createInternal = internalMutation({
  args: invoiceCreateArgs,
  handler: async (ctx, args) => {
    return await ctx.db.insert("invoices", args);
  },
});

// Delete an invoice
export const deleteInvoice = mutation({
  args: { id: v.id("invoices") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const invoice = await ctx.db.get(args.id);
    if (invoice && invoice.status === "paid") {
      throw new Error("Cannot delete a paid invoice.");
    }

    await ctx.db.delete(args.id);
  },
});

// Update invoice status
export const updateStatus = mutation({
  args: {
    invoiceId: v.id("invoices"),
    status: invoiceStatusValidator,
    paidDate: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const updateData: any = { status: args.status };
    if (args.status === "paid") {
      updateData.paidDate =
        args.paidDate || new Date().toISOString().split("T")[0];
    }

    await ctx.db.patch(args.invoiceId, updateData);

    // Update user stats when admin marks an invoice as paid
    // This handles in-person payments that don't go through the Stripe webhook path
    if (args.status === "paid") {
      const invoice = await ctx.db.get(args.invoiceId);
      if (invoice) {
        const appointment = await ctx.db.get(invoice.appointmentId);
        if (appointment) {
          const user = await ctx.db.get(appointment.userId);
          if (user) {
            await ctx.db.patch(user._id, {
              timesServiced: (user.timesServiced || 0) + 1,
              totalSpent: (user.totalSpent || 0) + invoice.total,
            });
          }
        }
      }
    }

    return args.invoiceId;
  },
});

export const updateBillingSettings = mutation({
  args: {
    invoiceId: v.id("invoices"),
    dueDate: v.string(),
    remainingBalanceCollectionMethod: remainingBalanceCollectionMethodValidator,
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const invoice = await ctx.db.get(args.invoiceId);
    if (!invoice) {
      throw new Error("Invoice not found");
    }
    if (invoice.status === "paid") {
      throw new Error("Paid invoices cannot be edited");
    }
    if (invoice.paymentOption && invoice.paymentOption !== "deposit") {
      throw new Error(
        "Only deposit invoices support editable remaining-balance billing settings",
      );
    }
    if ((invoice.remainingBalance ?? 0) <= 0) {
      throw new Error("Invoice has no remaining balance to configure");
    }

    await ctx.db.patch(args.invoiceId, {
      dueDate: args.dueDate,
      remainingBalanceCollectionMethod: args.remainingBalanceCollectionMethod,
    });
    return args.invoiceId;
  },
});

// Internal mutation to update invoice status (for use by webhook handlers)
export const updateStatusInternal = internalMutation({
  args: {
    invoiceId: v.id("invoices"),
    status: invoiceStatusValidator,
    paidDate: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const updateData: any = { status: args.status };
    if (args.status === "paid") {
      updateData.paidDate =
        args.paidDate || new Date().toISOString().split("T")[0];
    }

    await ctx.db.patch(args.invoiceId, updateData);
    return args.invoiceId;
  },
});

// Update deposit status
export const updateDepositStatus = mutation({
  args: {
    invoiceId: v.id("invoices"),
    depositPaid: v.boolean(),
    depositPaymentIntentId: v.optional(v.string()),
    status: v.optional(
      invoiceStatusValidator,
    ),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const updateData: any = {
      depositPaid: args.depositPaid,
    };

    if (args.depositPaymentIntentId) {
      updateData.depositPaymentIntentId = args.depositPaymentIntentId;
    }

    if (args.status) {
      updateData.status = args.status;
    }

    await ctx.db.patch(args.invoiceId, updateData);
    return args.invoiceId;
  },
});

// Internal mutation to update deposit status (for use by webhook handlers)
export const updateDepositStatusInternal = internalMutation({
  args: {
    invoiceId: v.id("invoices"),
    depositPaid: v.boolean(),
    depositPaymentIntentId: v.optional(v.string()),
    status: v.optional(
      invoiceStatusValidator,
    ),
  },
  handler: async (ctx, args) => {
    const updateData: any = {
      depositPaid: args.depositPaid,
    };

    if (args.depositPaymentIntentId) {
      updateData.depositPaymentIntentId = args.depositPaymentIntentId;
    }

    if (args.status) {
      updateData.status = args.status;
    }

    await ctx.db.patch(args.invoiceId, updateData);
    return args.invoiceId;
  },
});

// Update final payment intent ID
export const updateFinalPayment = mutation({
  args: {
    invoiceId: v.id("invoices"),
    finalPaymentIntentId: v.string(),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    await ctx.db.patch(args.invoiceId, {
      finalPaymentIntentId: args.finalPaymentIntentId,
    });
    return args.invoiceId;
  },
});

// Internal mutation to update final payment intent ID (for use by webhook handlers)
export const updateFinalPaymentInternal = internalMutation({
  args: {
    invoiceId: v.id("invoices"),
    finalPaymentIntentId: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.invoiceId, {
      finalPaymentIntentId: args.finalPaymentIntentId,
    });
    return args.invoiceId;
  },
});

// Internal mutation to update Stripe invoice data (for use by internal actions)
export const updateStripeInvoiceData = internalMutation({
  args: {
    invoiceId: v.id("invoices"),
    stripeInvoiceId: v.string(),
    stripeInvoiceUrl: v.optional(v.string()),
    status: invoiceStatusValidator,
  },
  handler: async (ctx, args) => {
    const patchData: {
      stripeInvoiceId: string;
      stripeInvoiceUrl?: string;
      status: "draft" | "sent" | "paid" | "overdue";
    } = {
      stripeInvoiceId: args.stripeInvoiceId,
      status: args.status,
    };

    if (args.stripeInvoiceUrl !== undefined) {
      patchData.stripeInvoiceUrl = args.stripeInvoiceUrl;
    }

    await ctx.db.patch(args.invoiceId, patchData);
    return args.invoiceId;
  },
});

export const clearStripeInvoiceData = internalMutation({
  args: {
    invoiceId: v.id("invoices"),
    status: invoiceStatusValidator,
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.invoiceId, {
      stripeInvoiceId: undefined,
      stripeInvoiceUrl: undefined,
      status: args.status,
      finalPaymentIntentId: undefined,
    });
    return args.invoiceId;
  },
});

// Mark invoice generation error (called when Stripe invoice creation fails)
export const markInvoiceGenerationError = internalMutation({
  args: {
    invoiceId: v.id("invoices"),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.invoiceId, {
      invoiceGenerationError: args.error,
    });
  },
});

// Clear invoice generation error (used by retry flow)
export const clearInvoiceGenerationError = internalMutation({
  args: {
    invoiceId: v.id("invoices"),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.invoiceId, {
      invoiceGenerationError: undefined,
    });
  },
});

// Internal repair mutation used by payment backfills.
export const resetFalsePaidStateInternal = internalMutation({
  args: {
    invoiceId: v.id("invoices"),
  },
  returns: v.id("invoices"),
  handler: async (ctx, args) => {
    const invoice = await ctx.db.get(args.invoiceId);
    if (!invoice) {
      throw new Error("Invoice not found");
    }

    await ctx.db.patch(args.invoiceId, {
      status: invoice.stripeInvoiceId ? "sent" : "draft",
      paidDate: undefined,
      finalPaymentIntentId: undefined,
    });

    return args.invoiceId;
  },
});

// Get invoices with full details (customer name, service name, etc.) - Admin only
export const listWithDetails = query({
  args: {
    status: v.optional(
      v.union(
        v.literal("draft"),
        v.literal("sent"),
        v.literal("paid"),
        v.literal("overdue"),
      ),
    ),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    let invoices = await ctx.db.query("invoices").collect();

    if (args.status) {
      invoices = invoices.filter((i) => i.status === args.status);
    }

    const enrichedInvoices = await Promise.all(
      invoices.map(async (invoice) => {
        const user = await ctx.db.get(invoice.userId);

        return {
          ...invoice,
          customer: user?.name || "Unknown",
          customerEmail: user?.email || "",
          serviceName: invoice.items[0]?.serviceName || "Service",
          paymentMethod: "Credit Card", // TODO: Add to schema when available
        };
      }),
    );

    return enrichedInvoices.sort((a, b) => b.dueDate.localeCompare(a.dueDate));
  },
});

// Get count of unpaid invoices with deposit paid (for customer)
export const getUnpaidInvoicesCount = query({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const userId = await getUserIdFromIdentity(ctx);
    if (!userId) return 0;

    const invoices = await ctx.db
      .query("invoices")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();

    return invoices.filter(
      (invoice) =>
        invoice.status !== "paid" &&
        invoice.depositPaid === true &&
        invoice.remainingBalance &&
        invoice.remainingBalance > 0,
    ).length;
  },
});

// Get count of unpaid invoices (admin only)
export const getUnpaidInvoicesCountAdmin = query({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    await requireAdmin(ctx);

    const invoices = await ctx.db
      .query("invoices")
      .filter((q) => q.neq(q.field("status"), "paid"))
      .collect();

    return invoices.length;
  },
});

// Get Stripe invoices from component (admin only)
// This provides the source of truth for payment data
// Note: The component's listInvoices requires stripeCustomerId, so we'd need to
// query all customers first. For now, use listWithDetails which shows custom invoices.
// TODO: Enhance this to query Stripe invoices by iterating through customers
export const getStripeInvoices = query({
  args: {
    stripeCustomerId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    // If customer ID provided, get invoices for that customer
    if (args.stripeCustomerId) {
      return await ctx.runQuery(
        components.stripe.public.listInvoices,
        { stripeCustomerId: args.stripeCustomerId },
      );
    }

    // For now, return empty array - admin can use listWithDetails for custom invoices
    // TODO: Query all customers and aggregate their invoices
    return [];
  },
});

// Get invoices for the current user
export const getUserInvoices = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getUserIdFromIdentity(ctx);
    if (!userId) throw new Error("Not authenticated");

    const invoices = await ctx.db
      .query("invoices")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();

    // Enrich with appointment details
    const enrichedInvoices = await Promise.all(
      invoices.map(async (invoice) => {
        const appointment = await ctx.db.get(invoice.appointmentId);
        const services = appointment
          ? await Promise.all(
              appointment.serviceIds.map((id) => ctx.db.get(id)),
            )
          : [];

        return {
          ...invoice,
          appointment: appointment
            ? {
                ...appointment,
                services: services.filter((s) => s !== null),
              }
            : null,
        };
      }),
    );

    return enrichedInvoices.sort((a, b) => b._creationTime - a._creationTime);
  },
});

// Get summary statistics for invoices (admin only)
export const getSummaryStats = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);

    const invoices = await ctx.db.query("invoices").collect();

    const totalRevenue = invoices
      .filter((i) => i.status === "paid")
      .reduce((sum, i) => sum + i.total, 0);

    const pending = invoices
      .filter((i) => i.status === "sent" || i.status === "draft")
      .reduce((sum, i) => sum + i.total, 0);

    const completed = invoices
      .filter((i) => i.status === "paid")
      .reduce((sum, i) => sum + i.total, 0);

    return {
      totalRevenue,
      pending,
      completed,
    };
  },
});

export const updateDiscount = internalMutation({
  args: {
    invoiceId: v.id("invoices"),
    couponCode: v.string(),
    discountAmount: v.number(),
    total: v.number(),
    remainingBalance: v.number(),
  },
  handler: async (ctx, args) => {
    const invoice = await ctx.db.get(args.invoiceId);
    if (!invoice) {
      throw new Error("Invoice not found");
    }
    if (invoice.status === "paid" && (invoice.remainingBalance ?? 0) <= 0) {
      throw new Error("Fully paid invoices cannot be edited");
    }
    await ctx.db.patch(args.invoiceId, {
      couponCode: args.couponCode,
      discountAmount: args.discountAmount,
      total: args.total,
      remainingBalance: args.remainingBalance,
      stripeInvoiceId: undefined,
      stripeInvoiceUrl: undefined,
      finalPaymentIntentId: undefined,
      status: invoice.depositPaid ? "draft" : invoice.status,
      paidDate: invoice.status === "paid" ? undefined : invoice.paidDate,
    });
  },
});

export const removeDiscount = internalMutation({
  args: {
    invoiceId: v.id("invoices"),
  },
  handler: async (ctx, args) => {
    const invoice = await ctx.db.get(args.invoiceId);
    if (!invoice) {
      throw new Error("Invoice not found");
    }
    if (invoice.status === "paid" && (invoice.remainingBalance ?? 0) <= 0) {
      throw new Error("Fully paid invoices cannot be edited");
    }
    const originalTotal = invoice.subtotal + invoice.tax;
    const newRemainingBalance = Math.max(
      0,
      originalTotal -
        (invoice.depositAmount || 0) -
        (invoice.giftCardApplied || 0),
    );

    await ctx.db.patch(args.invoiceId, {
      couponCode: undefined,
      discountAmount: undefined,
      total: originalTotal,
      remainingBalance: newRemainingBalance,
      stripeInvoiceId: undefined,
      stripeInvoiceUrl: undefined,
      finalPaymentIntentId: undefined,
      status: invoice.depositPaid ? "draft" : invoice.status,
      paidDate: invoice.status === "paid" ? undefined : invoice.paidDate,
    });
  },
});
