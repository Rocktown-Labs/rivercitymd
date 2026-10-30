import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { ConvexError, v } from "convex/values";
import { getUserIdFromIdentity, isAdmin } from "./auth";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { stripeClient } from "./stripeClient";
import { BOOKING_BLOCK_MINUTES } from "./lib/booking";
import { normalizeStripeCouponCode, validateCouponInput } from "./lib/coupons";
import { assertRateLimit, normalizeRateLimitKey } from "./rateLimiter";
import { getEffectiveServicePricingForVehicle } from "./lib/pricing";
import { delay, getStripeSecretKey, stripeApiCall } from "./lib/stripeApi";
import {
  getAvailableGiftCardBalance,
  normalizeGiftCardCode,
  roundCurrency,
} from "./lib/giftCards";

const paymentsInternal: any = (internal as any).payments;
const BOOKING_HOLD_DURATION_MS = 15 * 60 * 1000;
const ABANDONED_RECOVERY_DELAY_MS = 20 * 60 * 1000;
const ABANDONED_FOLLOW_UP_DELAY_MS = 24 * 60 * 60 * 1000;

const backfillSummaryValidator = v.object({
  scanned: v.number(),
  candidates: v.number(),
  patched: v.number(),
  succeeded: v.number(),
  failed: v.number(),
  skipped: v.number(),
  errors: v.array(v.string()),
});

const invoiceStatusValidator = v.union(
  v.literal("draft"),
  v.literal("sent"),
  v.literal("paid"),
  v.literal("overdue"),
);

const invoicePipelineStateValidator = v.object({
  invoiceId: v.id("invoices"),
  appointmentId: v.id("appointments"),
  status: invoiceStatusValidator,
  depositPaid: v.boolean(),
  remainingBalance: v.optional(v.number()),
  stripeInvoiceId: v.optional(v.string()),
  stripeInvoiceUrl: v.optional(v.string()),
  depositPaymentIntentId: v.optional(v.string()),
  finalPaymentIntentId: v.optional(v.string()),
  hasFalsePaidSignature: v.boolean(),
  hasValidFinalPaymentEvidence: v.boolean(),
  stripeInvoiceStatus: v.optional(v.string()),
  stripeInvoiceHostedUrl: v.optional(v.string()),
});

const repairSingleInvoiceValidator = v.object({
  invoiceId: v.id("invoices"),
  dryRun: v.boolean(),
  eligible: v.boolean(),
  patched: v.boolean(),
  succeeded: v.boolean(),
  skipped: v.boolean(),
  reason: v.optional(v.string()),
  stripeInvoiceId: v.optional(v.string()),
  stripeInvoiceUrl: v.optional(v.string()),
  errors: v.array(v.string()),
});

type BackfillSummary = {
  scanned: number;
  candidates: number;
  patched: number;
  succeeded: number;
  failed: number;
  skipped: number;
  errors: string[];
};

type InvoicePipelineState = {
  invoiceId: Id<"invoices">;
  appointmentId: Id<"appointments">;
  status: "draft" | "sent" | "paid" | "overdue";
  depositPaid: boolean;
  remainingBalance?: number;
  stripeInvoiceId?: string;
  stripeInvoiceUrl?: string;
  depositPaymentIntentId?: string;
  finalPaymentIntentId?: string;
  hasFalsePaidSignature: boolean;
  hasValidFinalPaymentEvidence: boolean;
  stripeInvoiceStatus?: string;
  stripeInvoiceHostedUrl?: string;
};

type RepairSingleStripeInvoiceResult = {
  invoiceId: Id<"invoices">;
  dryRun: boolean;
  eligible: boolean;
  patched: boolean;
  succeeded: boolean;
  skipped: boolean;
  reason?: string;
  stripeInvoiceId?: string;
  stripeInvoiceUrl?: string;
  errors: string[];
};

type RemainingBalanceCollectionMethod =
  | "send_invoice"
  | "charge_automatically";

type BookingCheckoutResult = {
  sessionId: string;
  url: string;
  token: string;
  status?: "redirect" | "completed";
  appointmentId?: Id<"appointments">;
};

type ResumeBookingDraftCheckoutResult = {
  status: "redirect" | "requires_new_time" | "converted";
  url?: string;
};

type CancelBookingDraftCheckoutResult = {
  status: "cancelled" | "converted" | "missing";
};

function appendMetadata(
  params: URLSearchParams,
  metadata: Record<string, string>,
): void {
  for (const [key, value] of Object.entries(metadata)) {
    params.append(`metadata[${key}]`, value);
  }
}

function getHostedInvoiceUrl(stripeInvoice: any): string | undefined {
  if (!stripeInvoice) {
    return undefined;
  }
  return stripeInvoice.hosted_invoice_url || stripeInvoice.hostedInvoiceUrl;
}

function getRemainingBalanceCollectionMethod(
  invoice: any,
): RemainingBalanceCollectionMethod {
  return invoice.remainingBalanceCollectionMethod ?? "send_invoice";
}

function formatStripeLineItemDescription(item: any, quantity: number): string {
  return quantity > 1 ? `${item.serviceName} x${quantity}` : item.serviceName;
}

function buildBookingRedirectUrl(origin: string, pathname: string, token: string) {
  if (origin.startsWith("rivercitymd://") || origin.startsWith("exp://")) {
    const scheme = origin.slice(0, origin.indexOf("://"));
    const cleanPath = pathname.replace(/^\/+/, "");
    return `${scheme}://${cleanPath}?token=${encodeURIComponent(token)}`;
  }
  const url = new URL(pathname, origin);
  url.searchParams.set("token", token);
  return url.toString();
}

async function expireStripeCheckoutSessionIfPossible(
  checkoutSessionId: string | undefined,
) {
  if (!checkoutSessionId?.trim()) {
    return;
  }

  try {
    await stripeApiCall(`checkout/sessions/${checkoutSessionId}/expire`, {
      method: "POST",
      body: new URLSearchParams(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : "";
    if (
      message.includes("already expired") ||
      message.includes("already completed") ||
      message.includes("cannot expire") ||
      message.includes("no such checkout.session") ||
      message.includes("status of `complete`") ||
      message.includes("status of complete") ||
      message.includes("status in [\"open\"]")
    ) {
      return;
    }
    throw error;
  }
}

function toStripeDueDateTimestamp(dateString: string): string {
  const timestamp = Date.parse(`${dateString}T12:00:00Z`);
  if (Number.isNaN(timestamp)) {
    throw new Error(`Invalid invoice due date: ${dateString}`);
  }
  return Math.floor(timestamp / 1000).toString();
}

function mapStripeInvoiceStatusToLocalStatus(
  stripeStatus?: string,
): "draft" | "sent" | "paid" | "overdue" {
  if (stripeStatus === "paid") {
    return "paid";
  }
  if (stripeStatus === "uncollectible") {
    return "overdue";
  }
  if (stripeStatus === "draft") {
    return "draft";
  }
  return "sent";
}

function getDiscountFromStripeCoupon(stripeCoupon: any): {
  discountType: "percent" | "amount";
  discountValue: number;
} {
  if (!stripeCoupon || stripeCoupon.valid === false) {
    throw new ConvexError({
      message: "This Stripe coupon is not active.",
    });
  }
  if (typeof stripeCoupon.percent_off === "number" && stripeCoupon.percent_off > 0) {
    return {
      discountType: "percent",
      discountValue: stripeCoupon.percent_off,
    };
  }
  if (typeof stripeCoupon.amount_off === "number" && stripeCoupon.amount_off > 0) {
    return {
      discountType: "amount",
      discountValue: Math.round(stripeCoupon.amount_off) / 100,
    };
  }
  throw new ConvexError({
    message: "This Stripe coupon does not have a supported discount amount.",
  });
}

async function getStripeInvoiceById(stripeInvoiceId: string): Promise<any> {
  return await stripeApiCall(`invoices/${stripeInvoiceId}`, {
    method: "GET",
  });
}

async function findReusableStripeInvoice(
  stripeCustomerId: string,
  invoiceId: Id<"invoices">,
): Promise<any | null> {
  const recentInvoices = await stripeApiCall(
    `invoices?customer=${encodeURIComponent(stripeCustomerId)}&limit=25`,
    { method: "GET" },
  );
  const candidate = recentInvoices?.data?.find(
    (stripeInvoice: any) =>
      stripeInvoice?.metadata?.invoiceId === String(invoiceId) &&
      stripeInvoice?.status !== "void" &&
      stripeInvoice?.status !== "uncollectible",
  );
  return candidate ?? null;
}

async function retireStripeInvoice(stripeInvoiceId: string): Promise<void> {
  const stripeInvoice = await getStripeInvoiceById(stripeInvoiceId);
  if (stripeInvoice.status === "paid") {
    throw new Error("Paid Stripe invoices cannot be reissued");
  }
  if (
    stripeInvoice.status === "void" ||
    stripeInvoice.status === "uncollectible"
  ) {
    return;
  }
  if (stripeInvoice.status === "draft") {
    await stripeApiCall(`invoices/${stripeInvoiceId}`, {
      method: "DELETE",
    });
    return;
  }
  await stripeApiCall(`invoices/${stripeInvoiceId}/void`, {
    method: "POST",
  });
}

async function getFinalPaymentEvidence(invoice: any): Promise<{
  hasValidFinalPaymentEvidence: boolean;
  stripeInvoiceStatus?: string;
  stripeInvoiceHostedUrl?: string;
}> {
  if (
    invoice.finalPaymentIntentId &&
    (!invoice.depositPaymentIntentId ||
      invoice.finalPaymentIntentId !== invoice.depositPaymentIntentId)
  ) {
    return {
      hasValidFinalPaymentEvidence: true,
    };
  }

  if (!invoice.stripeInvoiceId) {
    return {
      hasValidFinalPaymentEvidence: false,
    };
  }

  try {
    const stripeInvoice = await getStripeInvoiceById(invoice.stripeInvoiceId);
    const stripeInvoiceStatus = stripeInvoice.status as string | undefined;
    const stripeInvoiceHostedUrl = getHostedInvoiceUrl(stripeInvoice);
    return {
      hasValidFinalPaymentEvidence: stripeInvoiceStatus === "paid",
      stripeInvoiceStatus,
      stripeInvoiceHostedUrl,
    };
  } catch (error) {
    console.warn(
      `[payments] Unable to fetch Stripe invoice for payment evidence stripeInvoiceId=${invoice.stripeInvoiceId}`,
      error,
    );
    return {
      hasValidFinalPaymentEvidence: false,
    };
  }
}

async function createStripeInvoiceAfterDepositImpl(
  ctx: any,
  args: {
    invoiceId: Id<"invoices">;
    appointmentId: Id<"appointments">;
    forceRecreate?: boolean;
  },
): Promise<{
  stripeInvoiceId: string;
  stripeInvoiceUrl: string;
}> {
  // Validate Stripe configuration early; throws if missing
  getStripeSecretKey();

  const invoice = await ctx.runQuery(internal.invoices.getByIdInternal, {
    invoiceId: args.invoiceId,
  });
  const appointment = await ctx.runQuery(internal.appointments.getByIdInternal, {
    appointmentId: args.appointmentId,
  });

  if (!invoice || !appointment) {
    throw new Error("Invoice or appointment not found");
  }

  const user = await ctx.runQuery(internal.users.getByIdInternal, {
    userId: appointment.userId,
  });
  if (!user) {
    throw new Error("User not found");
  }

  let stripeCustomerId = user.stripeCustomerId;
  if (!stripeCustomerId) {
    stripeCustomerId = await ctx.runAction(internal.users.ensureStripeCustomer, {
      userId: appointment.userId,
    });
  }

  console.log(
    `[payments] createStripeInvoiceAfterDeposit:start invoiceId=${args.invoiceId} appointmentId=${args.appointmentId}`,
  );

  const collectionMethod = getRemainingBalanceCollectionMethod(invoice);
  if (invoice.paymentOption && invoice.paymentOption !== "deposit") {
    throw new Error(
      `Payment option ${invoice.paymentOption} does not create a remaining-balance Stripe invoice`,
    );
  }
  if ((invoice.remainingBalance ?? 0) <= 0) {
    throw new Error("Invoice has no remaining balance to bill");
  }

  if (args.forceRecreate && invoice.stripeInvoiceId) {
    await retireStripeInvoice(invoice.stripeInvoiceId);
    await ctx.runMutation(internal.invoices.clearStripeInvoiceData, {
      invoiceId: args.invoiceId,
      status: "draft",
    });
  }

  if (!args.forceRecreate && invoice.stripeInvoiceId && invoice.stripeInvoiceUrl) {
    console.log(
      `[payments] createStripeInvoiceAfterDeposit:idempotentReuse invoiceId=${args.invoiceId} stripeInvoiceId=${invoice.stripeInvoiceId}`,
    );
    return {
      stripeInvoiceId: invoice.stripeInvoiceId,
      stripeInvoiceUrl: invoice.stripeInvoiceUrl,
    };
  }

  if (!args.forceRecreate && invoice.stripeInvoiceId && !invoice.stripeInvoiceUrl) {
    try {
      const existingStripeInvoice = await getStripeInvoiceById(
        invoice.stripeInvoiceId,
      );
      const existingStripeInvoiceUrl =
        getHostedInvoiceUrl(existingStripeInvoice) || undefined;
      if (existingStripeInvoiceUrl) {
        await ctx.runMutation(internal.invoices.updateStripeInvoiceData, {
          invoiceId: args.invoiceId,
          stripeInvoiceId: invoice.stripeInvoiceId,
          stripeInvoiceUrl: existingStripeInvoiceUrl,
          status: mapStripeInvoiceStatusToLocalStatus(
            existingStripeInvoice.status,
          ),
        });
        console.log(
          `[payments] createStripeInvoiceAfterDeposit:recoveredMissingUrl invoiceId=${args.invoiceId} stripeInvoiceId=${invoice.stripeInvoiceId}`,
        );
        return {
          stripeInvoiceId: invoice.stripeInvoiceId,
          stripeInvoiceUrl: existingStripeInvoiceUrl,
        };
      }
    } catch (error) {
      console.warn(
        `[payments] createStripeInvoiceAfterDeposit:failedExistingInvoiceLookup invoiceId=${args.invoiceId} stripeInvoiceId=${invoice.stripeInvoiceId}`,
        error,
      );
    }
  }

  try {
    const customer = await stripeApiCall(`customers/${stripeCustomerId}`, {
      method: "GET",
    });
    console.log(
      `[payments] createStripeInvoiceAfterDeposit:customerResolved invoiceId=${args.invoiceId} customerId=${stripeCustomerId} hasEmail=${Boolean(customer?.email)}`,
    );
  } catch (error) {
    console.warn(
      `[payments] createStripeInvoiceAfterDeposit:customerLookupFailed invoiceId=${args.invoiceId} customerId=${stripeCustomerId}`,
      error,
    );
  }

  try {
    const reusableStripeInvoice = args.forceRecreate
      ? null
      : await findReusableStripeInvoice(stripeCustomerId, args.invoiceId);
    if (reusableStripeInvoice?.id) {
      let reusableInvoice = await getStripeInvoiceById(reusableStripeInvoice.id);
      console.log(
        `[payments] createStripeInvoiceAfterDeposit:foundReusableStripeInvoice invoiceId=${args.invoiceId} stripeInvoiceId=${reusableInvoice.id} status=${reusableInvoice.status}`,
      );

      if (reusableInvoice.status === "draft") {
        reusableInvoice = await stripeApiCall(
          `invoices/${reusableInvoice.id}/finalize`,
          {
            method: "POST",
          },
        );
        console.log(
          `[payments] createStripeInvoiceAfterDeposit:reusableInvoiceFinalized invoiceId=${args.invoiceId} stripeInvoiceId=${reusableInvoice.id}`,
        );
      }

      let reusableInvoiceUrl =
        getHostedInvoiceUrl(reusableInvoice) || undefined;
      if (!reusableInvoiceUrl) {
        const refreshedReusableInvoice = await getStripeInvoiceById(
          reusableInvoice.id,
        );
        reusableInvoiceUrl =
          getHostedInvoiceUrl(refreshedReusableInvoice) || undefined;
      }

      if (!reusableInvoiceUrl) {
        throw new Error(
          `Reusable Stripe invoice ${reusableInvoice.id} is missing hosted invoice URL`,
        );
      }

      await ctx.runMutation(internal.invoices.updateStripeInvoiceData, {
        invoiceId: args.invoiceId,
        stripeInvoiceId: reusableInvoice.id,
        stripeInvoiceUrl: reusableInvoiceUrl,
        status: mapStripeInvoiceStatusToLocalStatus(reusableInvoice.status),
      });

      if (
        collectionMethod === "send_invoice" &&
        reusableInvoice.status !== "paid" &&
        reusableInvoice.status !== "void" &&
        reusableInvoice.status !== "uncollectible"
      ) {
        try {
          const sentReusableInvoice = await stripeApiCall(
            `invoices/${reusableInvoice.id}/send`,
            {
              method: "POST",
            },
          );
          const sentReusableInvoiceUrl =
            getHostedInvoiceUrl(sentReusableInvoice) || reusableInvoiceUrl;
          if (sentReusableInvoiceUrl !== reusableInvoiceUrl) {
            reusableInvoiceUrl = sentReusableInvoiceUrl;
            await ctx.runMutation(internal.invoices.updateStripeInvoiceData, {
              invoiceId: args.invoiceId,
              stripeInvoiceId: reusableInvoice.id,
              stripeInvoiceUrl: reusableInvoiceUrl,
              status: mapStripeInvoiceStatusToLocalStatus(
                sentReusableInvoice.status,
              ),
            });
          }
          console.log(
            `[payments] createStripeInvoiceAfterDeposit:reusableInvoiceSent invoiceId=${args.invoiceId} stripeInvoiceId=${reusableInvoice.id}`,
          );
        } catch (error) {
          console.error(
            `[payments] createStripeInvoiceAfterDeposit:reusableInvoiceSendFailed invoiceId=${args.invoiceId} stripeInvoiceId=${reusableInvoice.id}`,
            error,
          );
        }
      }

      return {
        stripeInvoiceId: reusableInvoice.id,
        stripeInvoiceUrl: reusableInvoiceUrl,
      };
    }
  } catch (error) {
    console.warn(
      `[payments] createStripeInvoiceAfterDeposit:reusableLookupFailed invoiceId=${args.invoiceId}`,
      error,
    );
  }

  if (!invoice.items || invoice.items.length === 0) {
    throw new Error("Invoice has no line items");
  }

  let createdLineItemCount = 0;
  for (const item of invoice.items) {
    const quantity = Math.max(1, item.quantity || 1);
    const lineTotal =
      item.totalPrice > 0
        ? item.totalPrice
        : item.unitPrice > 0
          ? item.unitPrice * quantity
          : 0;
    const lineAmountInCents = Math.round(lineTotal * 100);

    if (lineAmountInCents <= 0) {
      console.warn(
        `[payments] skipping non-positive invoice item amount invoiceId=${args.invoiceId} service=${item.serviceName}`,
      );
      continue;
    }

    await stripeApiCall("invoiceitems", {
      method: "POST",
      body: new URLSearchParams({
        customer: stripeCustomerId,
        amount: lineAmountInCents.toString(),
        currency: "usd",
        description: formatStripeLineItemDescription(item, quantity),
      }),
    });
    createdLineItemCount += 1;
  }

  if (createdLineItemCount === 0) {
    throw new Error("No valid invoice line items were created in Stripe");
  }

  if (invoice.depositAmount && invoice.depositAmount > 0) {
    const depositAmountInCents = Math.round(invoice.depositAmount * 100);
    await stripeApiCall("invoiceitems", {
      method: "POST",
      body: new URLSearchParams({
        customer: stripeCustomerId,
        amount: `-${depositAmountInCents}`,
        currency: "usd",
        description: `Deposit payment (${invoice.invoiceNumber})`,
      }),
    });
  }

  if (invoice.giftCardApplied && invoice.giftCardApplied > 0) {
    const giftCardAmountInCents = Math.round(invoice.giftCardApplied * 100);
    await stripeApiCall("invoiceitems", {
      method: "POST",
      body: new URLSearchParams({
        customer: stripeCustomerId,
        amount: `-${giftCardAmountInCents}`,
        currency: "usd",
        description: `Gift card credit (${invoice.invoiceNumber})`,
      }),
    });
  }

  const invoiceParams = new URLSearchParams({
    customer: stripeCustomerId,
    collection_method: collectionMethod,
    auto_advance: "true",
    description: `Mobile detailing service - ${appointment.scheduledDate}`,
  });
  if (collectionMethod === "send_invoice") {
    invoiceParams.append("due_date", toStripeDueDateTimestamp(invoice.dueDate));
  }
  if (invoice.couponCode) {
    invoiceParams.append("discounts[0][coupon]", invoice.couponCode);
  }
  appendMetadata(invoiceParams, {
    invoiceId: String(args.invoiceId),
    appointmentId: String(args.appointmentId),
  });

  const stripeInvoice = await stripeApiCall("invoices", {
    method: "POST",
    body: invoiceParams,
  });
  console.log(
    `[payments] createStripeInvoiceAfterDeposit:invoiceCreated invoiceId=${args.invoiceId} stripeInvoiceId=${stripeInvoice.id} collectionMethod=${collectionMethod} dueDate=${invoice.dueDate}`,
  );

  const finalizedInvoice = await stripeApiCall(`invoices/${stripeInvoice.id}/finalize`, {
    method: "POST",
  });

  let processedInvoice = finalizedInvoice;
  const processedStripeInvoiceId =
    processedInvoice.id || finalizedInvoice.id || stripeInvoice.id;

  let stripeInvoiceUrl =
    getHostedInvoiceUrl(processedInvoice) ||
    stripeInvoice.hosted_invoice_url;

  if (!stripeInvoiceUrl) {
    const fetchedInvoice = await getStripeInvoiceById(processedStripeInvoiceId);
    stripeInvoiceUrl = getHostedInvoiceUrl(fetchedInvoice) || undefined;
  }

  if (!stripeInvoiceUrl) {
    throw new Error(
      `Stripe invoice URL missing after invoice creation for ${args.invoiceId}`,
    );
  }

  try {
    await ctx.runMutation(internal.invoices.updateStripeInvoiceData, {
      invoiceId: args.invoiceId,
      stripeInvoiceId: processedStripeInvoiceId,
      stripeInvoiceUrl,
      status: mapStripeInvoiceStatusToLocalStatus(processedInvoice.status),
    });
    console.log(
      `[payments] createStripeInvoiceAfterDeposit:convexPatchSuccess invoiceId=${args.invoiceId} stripeInvoiceId=${processedStripeInvoiceId}`,
    );
  } catch (error) {
    console.error(
      `[payments] createStripeInvoiceAfterDeposit:convexPatchFailed invoiceId=${args.invoiceId}`,
      error,
    );
    throw error;
  }

  if (collectionMethod === "send_invoice") {
    try {
      const sentInvoice = await stripeApiCall(
        `invoices/${processedStripeInvoiceId}/send`,
        {
          method: "POST",
        },
      );
      processedInvoice = sentInvoice;
      const sentInvoiceUrl =
        getHostedInvoiceUrl(sentInvoice) || stripeInvoiceUrl;
      if (sentInvoiceUrl !== stripeInvoiceUrl) {
        stripeInvoiceUrl = sentInvoiceUrl;
        await ctx.runMutation(internal.invoices.updateStripeInvoiceData, {
          invoiceId: args.invoiceId,
          stripeInvoiceId: processedStripeInvoiceId,
          stripeInvoiceUrl,
          status: mapStripeInvoiceStatusToLocalStatus(sentInvoice.status),
        });
      }
      console.log(
        `[payments] createStripeInvoiceAfterDeposit:invoiceSent invoiceId=${args.invoiceId} stripeInvoiceId=${processedStripeInvoiceId}`,
      );
    } catch (error) {
      console.error(
        `[payments] createStripeInvoiceAfterDeposit:sendFailed invoiceId=${args.invoiceId} stripeInvoiceId=${processedStripeInvoiceId}`,
        error,
      );
    }
  }

  return {
    stripeInvoiceId: processedStripeInvoiceId,
    stripeInvoiceUrl,
  };
}

async function runBackfillMissingStripeInvoices(
  ctx: any,
  args: { dryRun?: boolean; limit?: number },
): Promise<BackfillSummary> {
  const dryRun = args.dryRun ?? true;
  const limit = Math.max(1, Math.min(500, Math.floor(args.limit ?? 50)));

  const allInvoices: any[] = await ctx.runQuery(api.invoices.listWithDetails, {});
  const candidateInvoices = allInvoices
    .filter(
      (invoice) =>
        (invoice.paymentOption ?? "deposit") === "deposit" &&
        invoice.depositPaid === true &&
        (invoice.remainingBalance ?? 0) > 0 &&
        (!invoice.stripeInvoiceId ||
          !invoice.stripeInvoiceUrl ||
          invoice.status === "paid"),
    )
    .slice(0, limit);

  const summary: BackfillSummary = {
    scanned: allInvoices.length,
    candidates: candidateInvoices.length,
    patched: 0,
    succeeded: 0,
    failed: 0,
    skipped: 0,
    errors: [],
  };

  if (dryRun) {
    summary.skipped = candidateInvoices.length;
    return summary;
  }

  for (const invoice of candidateInvoices) {
    if (!invoice.appointmentId) {
      summary.failed += 1;
      summary.errors.push(`${invoice._id}: missing appointmentId`);
      continue;
    }

    if (invoice.status === "paid") {
      const hasFalsePaidSignature =
        !!invoice.depositPaymentIntentId &&
        invoice.finalPaymentIntentId === invoice.depositPaymentIntentId;
      const finalPaymentEvidence = await getFinalPaymentEvidence(invoice);
      const shouldRepairPaidState =
        hasFalsePaidSignature || !finalPaymentEvidence.hasValidFinalPaymentEvidence;

      if (shouldRepairPaidState) {
        await ctx.runMutation(internal.invoices.resetFalsePaidStateInternal, {
          invoiceId: invoice._id,
        });
        summary.patched += 1;
      } else {
        summary.skipped += 1;
        continue;
      }
    }

    try {
      await createStripeInvoiceAfterDepositImpl(ctx, {
        invoiceId: invoice._id,
        appointmentId: invoice.appointmentId,
      });
      summary.succeeded += 1;
    } catch (error) {
      summary.failed += 1;
      summary.errors.push(
        `${invoice._id}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return summary;
}

async function requireAdminRole(ctx: any): Promise<void> {
  const role = await ctx.runQuery(api.auth.getUserRole, {});
  if (role?.type !== "admin") {
    throw new Error("Admin access required");
  }
}

async function getUserRecordOrThrow(
  ctx: any,
  userId: Id<"users">,
): Promise<Doc<"users">> {
  const user = await ctx.runQuery(internal.users.getByIdInternal, { userId });
  if (!user) {
    throw new Error("User not found");
  }
  return user;
}

async function ensureStripeCustomerIdForUser(
  ctx: any,
  userId: Id<"users">,
): Promise<string> {
  const user = await getUserRecordOrThrow(ctx, userId);

  let stripeCustomerId = user.stripeCustomerId;
  if (!stripeCustomerId) {
    stripeCustomerId = await ctx.runAction(internal.users.ensureStripeCustomer, {
      userId,
    });
  }

  if (!stripeCustomerId?.trim()) {
    throw new Error("User not found or missing Stripe customer ID");
  }

  return stripeCustomerId;
}

async function requireInvoicePaymentAccess(
  ctx: any,
  invoice: Doc<"invoices">,
  userId: Id<"users">,
): Promise<void> {
  if (invoice.userId === userId) {
    return;
  }

  if (await isAdmin(ctx)) {
    return;
  }

  throw new Error("Access denied");
}

// === Payment Intents (for deposits and final payments) ===

// Create a Payment Intent for deposit or final payment
export const createPaymentIntent = action({
  args: {
    amount: v.number(), // Amount in dollars
    currency: v.string(),
    customerId: v.string(),
    invoiceId: v.id("invoices"),
    paymentType: v.union(v.literal("deposit"), v.literal("final_payment")),
    metadata: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeSecretKey) {
      throw new Error("STRIPE_SECRET_KEY environment variable is not set");
    }

    // Convert amount to cents
    const amountInCents = Math.round(args.amount * 100);

    const paymentIntent = await stripeApiCall("payment_intents", {
      method: "POST",
      body: new URLSearchParams({
        amount: amountInCents.toString(),
        currency: args.currency,
        customer: args.customerId,
        metadata: JSON.stringify({
          invoiceId: args.invoiceId,
          type: args.paymentType,
          ...args.metadata,
        }),
        automatic_payment_methods: JSON.stringify({ enabled: true }),
      }),
    });

    return paymentIntent;
  },
});

// Confirm a Payment Intent (for immediate payment with saved payment method)
export const confirmPaymentIntent = action({
  args: {
    paymentIntentId: v.string(),
    paymentMethodId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeSecretKey) {
      throw new Error("STRIPE_SECRET_KEY environment variable is not set");
    }

    const params: any = {};
    if (args.paymentMethodId) {
      params.payment_method = args.paymentMethodId;
    }

    const paymentIntent = await stripeApiCall(
      `payment_intents/${args.paymentIntentId}/confirm`,
      {
        method: "POST",
        body: new URLSearchParams(params),
      },
    );

    return paymentIntent;
  },
});

// Get Payment Intent status
export const getPaymentIntent = action({
  args: {
    paymentIntentId: v.string(),
  },
  handler: async (ctx, args) => {
    const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeSecretKey) {
      throw new Error("STRIPE_SECRET_KEY environment variable is not set");
    }

    const paymentIntent = await stripeApiCall(
      `payment_intents/${args.paymentIntentId}`,
      {
        method: "GET",
      },
    );

    return paymentIntent;
  },
});

// === Payment Methods ===

// Get payment methods for a user
export const getPaymentMethods = query({
  args: { userId: v.id("users") },
  returns: v.array(
    v.object({
      _id: v.id("paymentMethods"),
      stripePaymentMethodId: v.string(),
      type: v.union(v.literal("card"), v.literal("bank_account")),
      last4: v.string(),
      brand: v.optional(v.string()),
      isDefault: v.boolean(),
      createdAt: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    const authUserId = await getUserIdFromIdentity(ctx);
    if (!authUserId) throw new Error("Not authenticated");

    // Users can only see their own payment methods, admins can see all
    const isAdminUser = await isAdmin(ctx);
    if (!isAdminUser && authUserId !== args.userId) {
      throw new Error("Access denied");
    }

    return await ctx.db
      .query("paymentMethods")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();
  },
});

export const getPaymentMethodByStripeIdForUserInternal = internalQuery({
  args: {
    userId: v.id("users"),
    stripePaymentMethodId: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("paymentMethods")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .filter((q) =>
        q.eq(q.field("stripePaymentMethodId"), args.stripePaymentMethodId),
      )
      .first();
  },
});

export const getDefaultPaymentMethodForUserInternal = internalQuery({
  args: {
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("paymentMethods")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .filter((q) => q.eq(q.field("isDefault"), true))
      .first();
  },
});

export const getPaymentMethodByIdInternal = internalQuery({
  args: {
    paymentMethodId: v.id("paymentMethods"),
  },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.paymentMethodId);
  },
});

export const createPaymentMethodInternal = internalMutation({
  args: {
    userId: v.id("users"),
    stripePaymentMethodId: v.string(),
    type: v.union(v.literal("card"), v.literal("bank_account")),
    last4: v.string(),
    brand: v.optional(v.string()),
    isDefault: v.boolean(),
    createdAt: v.string(),
  },
  returns: v.id("paymentMethods"),
  handler: async (ctx, args) => {
    return await ctx.db.insert("paymentMethods", {
      userId: args.userId,
      stripePaymentMethodId: args.stripePaymentMethodId,
      type: args.type,
      last4: args.last4,
      brand: args.brand,
      isDefault: args.isDefault,
      createdAt: args.createdAt,
    });
  },
});

export const deletePaymentMethodInternal = internalMutation({
  args: {
    paymentMethodId: v.id("paymentMethods"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.delete(args.paymentMethodId);
    return null;
  },
});

// Add a payment method
export const addPaymentMethod = action({
  args: {
    paymentMethodId: v.string(), // Stripe payment method ID
  },
  returns: v.id("paymentMethods"),
  handler: async (ctx, args): Promise<Id<"paymentMethods">> => {
    const userId = await getUserIdFromIdentity(ctx);
    if (!userId) throw new Error("Not authenticated");

    // Get payment method details from Stripe
    const paymentMethod = await stripeApiCall(
      `payment_methods/${args.paymentMethodId}`,
    );

    // Check if this payment method already exists
    const existing = await ctx.runQuery(
      paymentsInternal.getPaymentMethodByStripeIdForUserInternal,
      {
        userId,
        stripePaymentMethodId: args.paymentMethodId,
      },
    );

    if (existing) {
      throw new Error("Payment method already exists");
    }

    // Check if user has any default payment method
    const hasDefault = await ctx.runQuery(
      paymentsInternal.getDefaultPaymentMethodForUserInternal,
      {
        userId,
      },
    );

    const paymentMethodDoc = {
      userId,
      stripePaymentMethodId: args.paymentMethodId,
      type: (paymentMethod.type === "card" ? "card" : "bank_account") as
        | "card"
        | "bank_account",
      last4:
        paymentMethod.type === "card"
          ? paymentMethod.card?.last4 || "****"
          : paymentMethod.us_bank_account?.last4 || "****",
      brand:
        paymentMethod.type === "card" ? paymentMethod.card?.brand : undefined,
      isDefault: !hasDefault, // Make this default if no other default exists
      createdAt: new Date().toISOString(),
    };

    return await ctx.runMutation(
      paymentsInternal.createPaymentMethodInternal,
      paymentMethodDoc,
    );
  },
});

// Set default payment method
export const setDefaultPaymentMethod = mutation({
  args: { paymentMethodId: v.id("paymentMethods") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await getUserIdFromIdentity(ctx);
    if (!userId) throw new Error("Not authenticated");

    // First, unset all default payment methods for this user
    const userPaymentMethods = await ctx.db
      .query("paymentMethods")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();

    for (const pm of userPaymentMethods) {
      if (pm.isDefault) {
        await ctx.db.patch(pm._id, { isDefault: false });
      }
    }

    // Set the new default
    await ctx.db.patch(args.paymentMethodId, { isDefault: true });

    return null;
  },
});

// Delete a payment method
export const deletePaymentMethod = action({
  args: { paymentMethodId: v.id("paymentMethods") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await getUserIdFromIdentity(ctx);
    if (!userId) throw new Error("Not authenticated");

    const paymentMethod = await ctx.runQuery(
      paymentsInternal.getPaymentMethodByIdInternal,
      {
        paymentMethodId: args.paymentMethodId,
      },
    );
    if (!paymentMethod || paymentMethod.userId !== userId) {
      throw new Error("Payment method not found");
    }

    // Detach from Stripe
    await stripeApiCall(
      `payment_methods/${paymentMethod.stripePaymentMethodId}/detach`,
      {
        method: "POST",
      },
    );

    // Delete from database
    await ctx.runMutation(paymentsInternal.deletePaymentMethodInternal, {
      paymentMethodId: args.paymentMethodId,
    });

    return null;
  },
});

// === Stripe Checkout ===

// Create a checkout session for deposit payment
export const createDepositCheckoutSession = action({
  args: {
    appointmentId: v.id("appointments"),
    invoiceId: v.id("invoices"),
    successUrl: v.string(),
    cancelUrl: v.string(),
  },
  returns: v.object({
    sessionId: v.string(),
    url: v.string(),
  }),
  handler: async (
    ctx: any,
    args: any,
  ): Promise<{ sessionId: string; url: string }> => {
    const userId = await getUserIdFromIdentity(ctx);
    if (!userId) throw new Error("Not authenticated");

    // Get invoice and appointment details
    const invoice: any = await ctx.runQuery(api.invoices.getById, {
      invoiceId: args.invoiceId,
    });
    if (!invoice) throw new Error("Invoice not found");
    if (invoice.userId !== userId) throw new Error("Access denied");

    const appointment: any = await ctx.runQuery(api.appointments.getById, {
      appointmentId: args.appointmentId,
    });
    if (!appointment) throw new Error("Appointment not found");
    if (appointment.userId !== userId) throw new Error("Access denied");

    // Ensure Stripe customer exists (create if needed)
    // This handles cases where user was created but Stripe customer wasn't created yet
    const stripeCustomerId = await ensureStripeCustomerIdForUser(ctx, userId);

    if (!invoice.depositAmount || invoice.depositAmount <= 0) {
      throw new Error("No deposit amount found for this invoice");
    }

    // Get deposit settings for price ID
    let depositPriceId: string | undefined;
    try {
      const depositSettings = await ctx.runQuery(api.depositSettings.get, {});
      depositPriceId = depositSettings?.stripePriceId;
    } catch (error) {
      // If we can't get deposit settings, we'll use amount-based checkout
      console.warn("Could not fetch deposit settings for price:", error);
    }

    // Calculate quantity (number of vehicles)
    const vehicleCount = appointment.vehicleIds.length;

    // Create Stripe checkout session for deposit
    if (depositPriceId) {
      try {
        // Use Stripe component when we have a priceId
        const session = await stripeClient.createCheckoutSession(ctx, {
          priceId: depositPriceId,
          customerId: stripeCustomerId,
          mode: "payment",
          successUrl: args.successUrl,
          cancelUrl: args.cancelUrl,
          quantity: vehicleCount,
          metadata: {
            appointmentId: args.appointmentId,
            invoiceId: args.invoiceId,
            type: "deposit",
          },
          paymentIntentMetadata: {
            appointmentId: args.appointmentId,
            invoiceId: args.invoiceId,
            type: "deposit",
          },
        });

        if (!session.url) {
          throw new Error("Failed to create checkout session URL");
        }

        return {
          sessionId: session.sessionId,
          url: session.url,
        };
      } catch (stripeErr) {
        console.warn(
          "Stripe component createCheckoutSession failed in payDeposit, falling back to dynamic price_data:",
          stripeErr,
        );
        const sessionData = new URLSearchParams({
          mode: "payment",
          customer: stripeCustomerId,
          success_url: args.successUrl,
          cancel_url: args.cancelUrl,
          "metadata[appointmentId]": args.appointmentId,
          "metadata[invoiceId]": args.invoiceId,
          "metadata[type]": "deposit",
        });

        const depositAmountInCents = Math.round(invoice.depositAmount * 100);
        sessionData.append("line_items[0][price_data][currency]", "usd");
        sessionData.append(
          "line_items[0][price_data][unit_amount]",
          depositAmountInCents.toString(),
        );
        sessionData.append(
          "line_items[0][price_data][product_data][name]",
          `Deposit (${vehicleCount} vehicle${vehicleCount > 1 ? "s" : ""})`,
        );
        sessionData.append("line_items[0][quantity]", "1");

        const session = await stripeApiCall("checkout/sessions", {
          method: "POST",
          body: sessionData,
        });

        return {
          sessionId: session.id,
          url: session.url,
        };
      }
    } else {
      // Fallback: use manual approach for dynamic amounts (price_data)
      // Component doesn't support price_data, so we use manual API call
      const sessionData = new URLSearchParams({
        mode: "payment",
        customer: stripeCustomerId,
        success_url: args.successUrl,
        cancel_url: args.cancelUrl,
        "metadata[appointmentId]": args.appointmentId,
        "metadata[invoiceId]": args.invoiceId,
        "metadata[type]": "deposit",
      });

      // invoice.depositAmount is already the total (deposit per vehicle × vehicle count)
      const depositAmountInCents = Math.round(invoice.depositAmount * 100);
      sessionData.append("line_items[0][price_data][currency]", "usd");
      sessionData.append(
        "line_items[0][price_data][unit_amount]",
        depositAmountInCents.toString(),
      );
      sessionData.append(
        "line_items[0][price_data][product_data][name]",
        `Deposit (${vehicleCount} vehicle${vehicleCount > 1 ? "s" : ""})`,
      );
      sessionData.append("line_items[0][quantity]", "1");

      const session = await stripeApiCall("checkout/sessions", {
        method: "POST",
        body: sessionData,
      });

      return {
        sessionId: session.id,
        url: session.url,
      };
    }
  },
});

// Note: Remaining balance payments are now handled via Stripe Invoices
// Customers can pay via the hosted invoice URL (stripeInvoiceUrl)
// or the invoice will be automatically charged if they have a card on file

// Create a checkout session for an invoice
export const createCheckoutSession = action({
  args: {
    invoiceId: v.id("invoices"),
    successUrl: v.string(),
    cancelUrl: v.string(),
  },
  returns: v.object({
    sessionId: v.string(),
    url: v.string(),
  }),
  handler: async (
    ctx: any,
    args: any,
  ): Promise<{ sessionId: string; url: string }> => {
    const userId = await getUserIdFromIdentity(ctx);
    if (!userId) throw new Error("Not authenticated");

    // Get invoice details
    const invoice: any = await ctx.runQuery(api.invoices.getById, {
      invoiceId: args.invoiceId,
    });
    if (!invoice) throw new Error("Invoice not found");
    if (invoice.userId !== userId) throw new Error("Access denied");

    const user = await getUserRecordOrThrow(ctx, userId);

    // Create Stripe checkout session
    const sessionData = new URLSearchParams({
      "payment_method_types[0]": "card",
      "line_items[0][price_data][currency]": "usd",
      "line_items[0][price_data][product_data][name]": `Invoice ${invoice.invoiceNumber}`,
      "line_items[0][price_data][product_data][description]":
        "Payment for mobile detailing services",
      "line_items[0][price_data][unit_amount]": Math.round(
        invoice.total * 100,
      ).toString(),
      "line_items[0][quantity]": "1",
      mode: "payment",
      success_url: args.successUrl,
      cancel_url: args.cancelUrl,
      customer_email: user.email ?? "",
      "metadata[invoiceId]": args.invoiceId.toString(),
      "metadata[userId]": userId.toString(),
    });

    const session = await stripeApiCall("checkout/sessions", {
      method: "POST",
      body: sessionData,
    });

    return {
      sessionId: session.id,
      url: session.url,
    };
  },
});

// Create a checkout session for paying the remaining balance after deposit
export const createBalanceCheckoutSession = action({
  args: {
    invoiceId: v.id("invoices"),
    successUrl: v.string(),
    cancelUrl: v.string(),
  },
  returns: v.object({
    sessionId: v.string(),
    url: v.string(),
  }),
  handler: async (
    ctx,
    args,
  ) => {
    const userId = await getUserIdFromIdentity(ctx);
    if (!userId) throw new Error("Not authenticated");

    const invoice: any = await ctx.runQuery(api.invoices.getById, {
      invoiceId: args.invoiceId,
    });
    if (!invoice) throw new Error("Invoice not found");
    if (invoice.userId !== userId) throw new Error("Access denied");

    if (!invoice.depositPaid) {
      throw new Error("Deposit must be paid before paying the remaining balance");
    }

    const remainingBalance = invoice.remainingBalance ?? invoice.total;
    if (remainingBalance <= 0) {
      throw new Error("No remaining balance to pay");
    }

    // If there's a Stripe invoice, try to pay it via the Stripe Invoices API
    if (invoice.stripeInvoiceId) {
      try {
        const stripeInvoice = await stripeApiCall(
          `invoices/${invoice.stripeInvoiceId}`,
          { method: "GET" },
        );

        // If already paid, sync status and return
        if (stripeInvoice.status === "paid") {
          await ctx.runMutation(internal.invoices.updateStatusInternal, {
            invoiceId: args.invoiceId,
            status: "paid",
            paidDate: new Date().toISOString().split("T")[0],
          });
          throw new Error("Invoice is already paid");
        }

        // If the invoice has a hosted URL, redirect there
        const hostedUrl =
          stripeInvoice.hosted_invoice_url ||
          (stripeInvoice.lines?.data?.[0] && stripeInvoice.hosted_invoice_url);
        if (hostedUrl) {
          return { sessionId: stripeInvoice.id, url: hostedUrl };
        }
      } catch (error: unknown) {
        if (error instanceof Error && error.message === "Invoice is already paid") throw error;
        console.warn(
          `[payments] createBalanceCheckout: Stripe invoice lookup failed, falling back to checkout session`,
          error,
        );
      }
    }

    // Fallback: create a Stripe Checkout Session for the remaining balance
    const stripeCustomerId = await ensureStripeCustomerIdForUser(ctx, userId);

    const balanceInCents = Math.round(remainingBalance * 100);

    const sessionData = new URLSearchParams({
      mode: "payment",
      customer: stripeCustomerId,
      success_url: args.successUrl,
      cancel_url: args.cancelUrl,
      "metadata[invoiceId]": args.invoiceId,
      "metadata[type]": "balance",
      "line_items[0][price_data][currency]": "usd",
      "line_items[0][price_data][unit_amount]": balanceInCents.toString(),
      "line_items[0][price_data][product_data][name]":
        `Remaining Balance - Invoice ${invoice.invoiceNumber}`,
      "line_items[0][quantity]": "1",
    });

    // Add payment intent metadata so webhook can match
    sessionData.append("payment_intent_data[metadata][invoiceId]", args.invoiceId);
    sessionData.append("payment_intent_data[metadata][type]", "balance");

    const session = await stripeApiCall("checkout/sessions", {
      method: "POST",
      body: sessionData,
    });

    return {
      sessionId: session.id,
      url: session.url,
    };
  },
});

// === Internal Helper: Create Stripe Invoice After Deposit ===

// Internal action to create Stripe Invoice with all service line items after deposit is paid
export const createStripeInvoiceAfterDeposit = internalAction({
  args: {
    invoiceId: v.id("invoices"),
    appointmentId: v.id("appointments"),
  },
  returns: v.object({
    stripeInvoiceId: v.string(),
    stripeInvoiceUrl: v.string(),
  }),
  handler: async (ctx, args) => {
    try {
      return await createStripeInvoiceAfterDepositImpl(ctx, args);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(
        `[payments] createStripeInvoiceAfterDeposit:failed invoiceId=${args.invoiceId} error=${message}`,
      );
      await ctx.runMutation(internal.invoices.markInvoiceGenerationError, {
        invoiceId: args.invoiceId,
        error: message,
      });
      throw error;
    }
  },
});

export const backfillMissingStripeInvoicesInternal = internalAction({
  args: {
    dryRun: v.optional(v.boolean()),
    limit: v.optional(v.number()),
  },
  returns: backfillSummaryValidator,
  handler: async (ctx, args): Promise<BackfillSummary> => {
    return await runBackfillMissingStripeInvoices(ctx, args);
  },
});

export const backfillMissingStripeInvoices = action({
  args: {
    dryRun: v.optional(v.boolean()),
    limit: v.optional(v.number()),
  },
  returns: backfillSummaryValidator,
  handler: async (ctx, args): Promise<BackfillSummary> => {
    await requireAdminRole(ctx);
    return await runBackfillMissingStripeInvoices(ctx, args);
  },
});

// Backward-compatible alias for clients that still call the "Mutation" endpoint name.
// This is an action because backfill performs external Stripe calls.
export const backfillMissingStripeInvoicesMutation = action({
  args: {
    dryRun: v.optional(v.boolean()),
    limit: v.optional(v.number()),
  },
  returns: backfillSummaryValidator,
  handler: async (ctx, args): Promise<BackfillSummary> => {
    await requireAdminRole(ctx);
    return await runBackfillMissingStripeInvoices(ctx, args);
  },
});

// Debug helper to inspect invoice/appointment pipeline state and Stripe linkage.
export const inspectInvoicePipelineState = action({
  args: {
    invoiceId: v.id("invoices"),
  },
  returns: invoicePipelineStateValidator,
  handler: async (ctx, args): Promise<InvoicePipelineState> => {
    await requireAdminRole(ctx);

    const invoice = await ctx.runQuery(internal.invoices.getByIdInternal, {
      invoiceId: args.invoiceId,
    });
    if (!invoice) {
      throw new Error("Invoice not found");
    }

    const hasFalsePaidSignature =
      invoice.status === "paid" &&
      !!invoice.depositPaymentIntentId &&
      invoice.finalPaymentIntentId === invoice.depositPaymentIntentId;
    const finalPaymentEvidence = await getFinalPaymentEvidence(invoice);

    return {
      invoiceId: invoice._id,
      appointmentId: invoice.appointmentId,
      status: invoice.status,
      depositPaid: invoice.depositPaid ?? false,
      remainingBalance: invoice.remainingBalance,
      stripeInvoiceId: invoice.stripeInvoiceId,
      stripeInvoiceUrl: invoice.stripeInvoiceUrl,
      depositPaymentIntentId: invoice.depositPaymentIntentId,
      finalPaymentIntentId: invoice.finalPaymentIntentId,
      hasFalsePaidSignature,
      hasValidFinalPaymentEvidence:
        finalPaymentEvidence.hasValidFinalPaymentEvidence,
      stripeInvoiceStatus: finalPaymentEvidence.stripeInvoiceStatus,
      stripeInvoiceHostedUrl: finalPaymentEvidence.stripeInvoiceHostedUrl,
    };
  },
});

// Targeted repair endpoint for a single invoice (surgical retries/debugging).
export const repairSingleStripeInvoice = action({
  args: {
    invoiceId: v.id("invoices"),
    dryRun: v.optional(v.boolean()),
  },
  returns: repairSingleInvoiceValidator,
  handler: async (ctx, args): Promise<RepairSingleStripeInvoiceResult> => {
    await requireAdminRole(ctx);

    const dryRun = args.dryRun ?? true;
    const invoice = await ctx.runQuery(internal.invoices.getByIdInternal, {
      invoiceId: args.invoiceId,
    });
    if (!invoice) {
      throw new Error("Invoice not found");
    }

    const result: RepairSingleStripeInvoiceResult = {
      invoiceId: args.invoiceId,
      dryRun,
      eligible: false,
      patched: false,
      succeeded: false,
      skipped: false,
      reason: undefined as string | undefined,
      stripeInvoiceId: undefined as string | undefined,
      stripeInvoiceUrl: undefined as string | undefined,
      errors: [] as string[],
    };

    if (!invoice.appointmentId) {
      result.skipped = true;
      result.reason = "Invoice has no appointmentId";
      return result;
    }

    if (!invoice.depositPaid || (invoice.remainingBalance ?? 0) <= 0) {
      result.skipped = true;
      result.reason =
        "Invoice is not eligible (requires depositPaid=true and remainingBalance>0)";
      return result;
    }
    if ((invoice.paymentOption ?? "deposit") !== "deposit") {
      result.skipped = true;
      result.reason = "Only deposit invoices are eligible for Stripe repair";
      return result;
    }

    result.eligible = true;

    const hasFalsePaidSignature =
      invoice.status === "paid" &&
      !!invoice.depositPaymentIntentId &&
      invoice.finalPaymentIntentId === invoice.depositPaymentIntentId;
    const finalPaymentEvidence = await getFinalPaymentEvidence(invoice);
    const shouldRepairPaidState =
      invoice.status === "paid" &&
      (hasFalsePaidSignature || !finalPaymentEvidence.hasValidFinalPaymentEvidence);

    if (dryRun) {
      if (
        invoice.status === "paid" &&
        !shouldRepairPaidState &&
        invoice.stripeInvoiceId &&
        invoice.stripeInvoiceUrl
      ) {
        result.skipped = true;
        result.reason = "Invoice already has valid final-payment evidence";
      } else {
        result.reason = "Eligible for repair execution";
      }
      return result;
    }

    if (shouldRepairPaidState) {
      await ctx.runMutation(internal.invoices.resetFalsePaidStateInternal, {
        invoiceId: args.invoiceId,
      });
      result.patched = true;
    }

    try {
      const stripeInvoice = await createStripeInvoiceAfterDepositImpl(ctx, {
        invoiceId: args.invoiceId,
        appointmentId: invoice.appointmentId,
      });
      result.succeeded = true;
      result.stripeInvoiceId = stripeInvoice.stripeInvoiceId;
      result.stripeInvoiceUrl = stripeInvoice.stripeInvoiceUrl;
    } catch (error) {
      result.errors.push(error instanceof Error ? error.message : String(error));
    }

    if (!result.succeeded && result.errors.length === 0) {
      result.errors.push("Repair completed without success state");
    }

    return result;
  },
});

export const reissueStripeInvoice = action({
  args: {
    invoiceId: v.id("invoices"),
  },
  returns: v.object({
    stripeInvoiceId: v.string(),
    stripeInvoiceUrl: v.string(),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{ stripeInvoiceId: string; stripeInvoiceUrl: string }> => {
    await requireAdminRole(ctx);

    const invoice: any = await ctx.runQuery(internal.invoices.getByIdInternal, {
      invoiceId: args.invoiceId,
    });
    if (!invoice) {
      throw new Error("Invoice not found");
    }
    if ((invoice.paymentOption ?? "deposit") !== "deposit") {
      throw new Error("Only deposit invoices can be reissued");
    }
    if (!invoice.depositPaid) {
      throw new Error("Deposit has not been paid yet");
    }
    if ((invoice.remainingBalance ?? 0) <= 0) {
      throw new Error("Invoice has no remaining balance to bill");
    }
    if (invoice.status === "paid") {
      throw new Error("Paid invoices cannot be reissued");
    }

    await ctx.runMutation(internal.invoices.clearInvoiceGenerationError, {
      invoiceId: args.invoiceId,
    });

    try {
      return await createStripeInvoiceAfterDepositImpl(ctx, {
        invoiceId: args.invoiceId,
        appointmentId: invoice.appointmentId,
        forceRecreate: !!invoice.stripeInvoiceId,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await ctx.runMutation(internal.invoices.markInvoiceGenerationError, {
        invoiceId: args.invoiceId,
        error: message,
      });
      throw error;
    }
  },
});

export const applyCouponToInvoice = action({
  args: {
    invoiceId: v.id("invoices"),
    couponCode: v.string(),
    discountType: v.optional(v.union(v.literal("percent"), v.literal("amount"))),
    discountValue: v.optional(v.number()),
  },
  returns: v.object({
    success: v.boolean(),
    discountAmount: v.number(),
    newTotal: v.number(),
    newRemainingBalance: v.number(),
    stripeInvoiceId: v.optional(v.string()),
    stripeInvoiceUrl: v.optional(v.string()),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{
    success: boolean;
    discountAmount: number;
    newTotal: number;
    newRemainingBalance: number;
    stripeInvoiceId?: string;
    stripeInvoiceUrl?: string;
  }> => {
    await requireAdminRole(ctx);
    const couponInput = validateCouponInput(args);

    const invoice: any = await ctx.runQuery(internal.invoices.getByIdInternal, {
      invoiceId: args.invoiceId,
    });
    if (!invoice) {
      throw new Error("Invoice not found");
    }
    if (invoice.status === "paid" && (invoice.remainingBalance ?? 0) <= 0) {
      throw new Error("Fully paid invoices cannot be modified");
    }

    // 1. Check if Coupon exists in Stripe. If not, create it from supplied terms.
    let stripeCoupon: any | null = null;
    try {
      stripeCoupon = await stripeApiCall(`coupons/${encodeURIComponent(couponInput.couponCode)}`, {
        method: "GET",
      });
    } catch {
      console.log(`[payments] Coupon ${couponInput.couponCode} not found in Stripe, will attempt to create it.`);
    }

    if (!stripeCoupon) {
      if (!args.discountType || couponInput.discountValue === undefined) {
        throw new Error(
          "Coupon not found in Stripe. Enter a discount type and value, or create the coupon first.",
        );
      }
      const discountValue = couponInput.discountValue;
      const bodyParams = new URLSearchParams({
        id: couponInput.couponCode,
        name: couponInput.couponCode,
        duration: "once",
      });
      if (args.discountType === "percent") {
        bodyParams.append("percent_off", discountValue.toString());
      } else {
        bodyParams.append("amount_off", Math.round(discountValue * 100).toString());
        bodyParams.append("currency", "usd");
      }
      await stripeApiCall("coupons", {
        method: "POST",
        body: bodyParams,
      });
      console.log(`[payments] Successfully created Stripe coupon ${couponInput.couponCode}`);
    }

    // 2. Calculate local discount values
    const effectiveDiscount =
      couponInput.discountValue !== undefined && args.discountType
        ? {
            discountType: args.discountType,
            discountValue: couponInput.discountValue,
          }
        : getDiscountFromStripeCoupon(stripeCoupon);

    let discountAmount = 0;
    if (effectiveDiscount.discountType === "percent") {
      discountAmount = parseFloat((invoice.subtotal * (effectiveDiscount.discountValue / 100)).toFixed(2));
    } else {
      discountAmount = Math.min(effectiveDiscount.discountValue, invoice.subtotal);
    }

    const newTotal = parseFloat((invoice.subtotal + invoice.tax - discountAmount).toFixed(2));
    const newRemainingBalance = Math.max(
      0,
      parseFloat(
        (
          newTotal -
          (invoice.depositAmount || 0) -
          (invoice.giftCardApplied || 0)
        ).toFixed(2),
      ),
    );

    // 3. If there is an existing Stripe invoice, void/retire it first
    if (invoice.stripeInvoiceId) {
      try {
        await retireStripeInvoice(invoice.stripeInvoiceId);
      } catch (err) {
        console.warn(`[payments] Failed to retire Stripe invoice ${invoice.stripeInvoiceId}`, err);
      }
    }

    // 4. Update the local invoice in Convex
    await ctx.runMutation(internal.invoices.updateDiscount, {
      invoiceId: args.invoiceId,
      couponCode: couponInput.couponCode,
      discountAmount,
      total: newTotal,
      remainingBalance: newRemainingBalance,
    });

    // 5. If deposit is paid and it's a deposit invoice, recreate the Stripe invoice immediately
    let stripeInvoiceId: string | undefined;
    let stripeInvoiceUrl: string | undefined;
    if (invoice.depositPaid && (invoice.paymentOption ?? "deposit") === "deposit") {
      try {
        const stripeInvoice = await createStripeInvoiceAfterDepositImpl(ctx, {
          invoiceId: args.invoiceId,
          appointmentId: invoice.appointmentId,
          forceRecreate: true,
        });
        stripeInvoiceId = stripeInvoice.stripeInvoiceId;
        stripeInvoiceUrl = stripeInvoice.stripeInvoiceUrl;
      } catch (error) {
        console.error(`[payments] Failed to automatically recreate Stripe invoice for ${args.invoiceId}`, error);
      }
    }

    return {
      success: true,
      discountAmount,
      newTotal,
      newRemainingBalance,
      stripeInvoiceId,
      stripeInvoiceUrl,
    };
  },
});

export const removeDiscountFromInvoice = action({
  args: {
    invoiceId: v.id("invoices"),
  },
  returns: v.object({
    success: v.boolean(),
  }),
  handler: async (ctx, args): Promise<{ success: boolean }> => {
    await requireAdminRole(ctx);

    const invoice: any = await ctx.runQuery(internal.invoices.getByIdInternal, {
      invoiceId: args.invoiceId,
    });
    if (!invoice) {
      throw new Error("Invoice not found");
    }
    if (invoice.status === "paid" && (invoice.remainingBalance ?? 0) <= 0) {
      throw new Error("Fully paid invoices cannot be modified");
    }

    if (invoice.stripeInvoiceId) {
      try {
        await retireStripeInvoice(invoice.stripeInvoiceId);
      } catch (err) {
        console.warn(`[payments] Failed to retire Stripe invoice ${invoice.stripeInvoiceId}`, err);
      }
    }

    await ctx.runMutation(internal.invoices.removeDiscount, {
      invoiceId: args.invoiceId,
    });

    if (invoice.depositPaid && (invoice.paymentOption ?? "deposit") === "deposit") {
      try {
        await createStripeInvoiceAfterDepositImpl(ctx, {
          invoiceId: args.invoiceId,
          appointmentId: invoice.appointmentId,
          forceRecreate: true,
        });
      } catch (error) {
        console.error(`[payments] Failed to automatically recreate Stripe invoice for ${args.invoiceId}`, error);
      }
    }

    return { success: true };
  },
});

export const applyGiftCardToInvoice = action({
  args: {
    invoiceId: v.id("invoices"),
    code: v.string(),
    pin: v.optional(v.string()),
  },
  returns: v.object({
    success: v.boolean(),
    appliedAmount: v.number(),
    newRemainingBalance: v.number(),
    stripeInvoiceId: v.optional(v.string()),
    stripeInvoiceUrl: v.optional(v.string()),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{
    success: boolean;
    appliedAmount: number;
    newRemainingBalance: number;
    stripeInvoiceId?: string;
    stripeInvoiceUrl?: string;
  }> => {
    await requireAdminRole(ctx);

    const invoice: any = await ctx.runQuery(internal.invoices.getByIdInternal, {
      invoiceId: args.invoiceId,
    });
    if (!invoice) throw new Error("Invoice not found");
    if (invoice.status === "paid" && (invoice.remainingBalance ?? 0) <= 0) {
      throw new Error("Fully paid invoices cannot be modified");
    }
    if (
      (invoice.paymentOption ?? "deposit") === "deposit" &&
      !invoice.depositPaid
    ) {
      throw new Error(
        "The deposit must be paid before applying a gift card to the remaining balance.",
      );
    }

    const amountDue = invoice.remainingBalance ?? invoice.total;
    if (amountDue <= 0) {
      throw new Error("This invoice has no remaining balance");
    }

    const validation = await ctx.runAction(
      internal.giftCards.validateForAdmin,
      {
        code: args.code,
        pin: args.pin,
      },
    );
    const appliedAmount = Math.min(validation.availableBalance, amountDue);
    if (appliedAmount <= 0) {
      throw new Error("This gift card has no available balance");
    }

    const reservationId = await ctx.runMutation(
      internal.giftCards.reserveForOrder,
      {
        giftCardId: validation.giftCardId,
        amount: appliedAmount,
        orderType: "invoice",
        orderId: String(args.invoiceId),
        expiresAt: Date.now() + 60_000,
      },
    );
    const updated = await ctx.runMutation(
      internal.giftCards.captureReservationToInvoice,
      {
        reservationId,
        invoiceId: args.invoiceId,
        note: `Applied to invoice ${invoice.invoiceNumber}`,
      },
    );

    if (invoice.stripeInvoiceId) {
      try {
        await retireStripeInvoice(invoice.stripeInvoiceId);
      } catch (error) {
        console.warn(
          `[payments] Failed to retire Stripe invoice ${invoice.stripeInvoiceId} after gift card`,
          error,
        );
      }
    }

    let stripeInvoiceId: string | undefined;
    let stripeInvoiceUrl: string | undefined;
    if (updated.remainingBalance > 0) {
      try {
        const stripeInvoice = await createStripeInvoiceAfterDepositImpl(ctx, {
          invoiceId: args.invoiceId,
          appointmentId: invoice.appointmentId,
          forceRecreate: true,
        });
        stripeInvoiceId = stripeInvoice.stripeInvoiceId;
        stripeInvoiceUrl = stripeInvoice.stripeInvoiceUrl;
      } catch (error) {
        console.error(
          `[payments] Failed to recreate Stripe invoice after gift card for ${args.invoiceId}`,
          error,
        );
      }
    }

    return {
      success: true,
      appliedAmount,
      newRemainingBalance: updated.remainingBalance,
      stripeInvoiceId,
      stripeInvoiceUrl,
    };
  },
});

type ResolvedStripeCoupon = {
  couponId: string;
  discountType: "percent" | "amount";
  discountValue: number;
};

function assertStripeCouponRedeemable(stripeCoupon: any) {
  if (!stripeCoupon || stripeCoupon.valid === false) {
    throw new ConvexError({
      message: "This promo code is not valid or has expired.",
    });
  }
  if (
    typeof stripeCoupon.redeem_by === "number" &&
    stripeCoupon.redeem_by * 1000 < Date.now()
  ) {
    throw new ConvexError({
      message: "This promo code is not valid or has expired.",
    });
  }
  if (
    typeof stripeCoupon.max_redemptions === "number" &&
    (stripeCoupon.times_redeemed ?? 0) >= stripeCoupon.max_redemptions
  ) {
    throw new ConvexError({
      message: "This promo code has reached its redemption limit.",
    });
  }
}

// Promotion code usage rules: active flag, expiration, redemption cap, and
// minimum order value. Note: first-time-transaction and per-customer
// restrictions cannot be verified before checkout and are not enforced here.
function assertPromotionCodeRedeemable(promo: any, orderTotal?: number) {
  if (!promo || promo.active === false) {
    throw new ConvexError({
      message: "This promo code is not valid or has expired.",
    });
  }
  if (
    typeof promo.expires_at === "number" &&
    promo.expires_at * 1000 < Date.now()
  ) {
    throw new ConvexError({
      message: "This promo code is not valid or has expired.",
    });
  }
  if (
    typeof promo.max_redemptions === "number" &&
    (promo.times_redeemed ?? 0) >= promo.max_redemptions
  ) {
    throw new ConvexError({
      message: "This promo code has reached its redemption limit.",
    });
  }
  const minimumAmount = promo.restrictions?.minimum_amount;
  if (
    typeof minimumAmount === "number" &&
    orderTotal !== undefined &&
    Math.round(orderTotal * 100) < minimumAmount
  ) {
    throw new ConvexError({
      message: `This promo code requires a minimum order of $${(minimumAmount / 100).toFixed(2)}.`,
    });
  }
}

// Resolve a customer-entered code to a Stripe coupon: try customer-facing
// promotion codes first, then fall back to the coupon ID format used by the
// admin coupons dashboard.
async function resolveStripeCouponForCode(
  rawCode: string,
  orderTotal?: number,
): Promise<ResolvedStripeCoupon> {
  const trimmed = rawCode.trim();
  if (!trimmed) {
    throw new ConvexError({ message: "Please enter a promo code." });
  }

  try {
    const promoResponse = await stripeApiCall(
      `promotion_codes?active=true&limit=1&code=${encodeURIComponent(trimmed)}`,
      { method: "GET" },
    );
    const promo = (promoResponse.data || [])[0];
    if (promo?.coupon) {
      assertPromotionCodeRedeemable(promo, orderTotal);
      const couponId =
        typeof promo.coupon === "string" ? promo.coupon : promo.coupon.id;
      const stripeCoupon =
        typeof promo.coupon === "string"
          ? await stripeApiCall(`coupons/${encodeURIComponent(couponId)}`, {
              method: "GET",
            })
          : promo.coupon;
      assertStripeCouponRedeemable(stripeCoupon);
      const discount = getDiscountFromStripeCoupon(stripeCoupon);
      return { couponId, ...discount };
    }
  } catch (error) {
    if (error instanceof ConvexError) {
      throw error;
    }
    // Otherwise fall through to the direct coupon lookup.
  }

  const normalizedCode = normalizeStripeCouponCode(trimmed);
  if (!normalizedCode) {
    throw new ConvexError({ message: "Please enter a promo code." });
  }
  let stripeCoupon: any;
  try {
    stripeCoupon = await stripeApiCall(
      `coupons/${encodeURIComponent(normalizedCode)}`,
      { method: "GET" },
    );
  } catch {
    throw new ConvexError({
      message: "This promo code is not valid or has expired.",
    });
  }
  assertStripeCouponRedeemable(stripeCoupon);
  const discount = getDiscountFromStripeCoupon(stripeCoupon);
  return { couponId: stripeCoupon.id ?? normalizedCode, ...discount };
}

function computeCouponDiscountAmount(
  subtotal: number,
  discountType: "percent" | "amount",
  discountValue: number,
): number {
  if (discountType === "percent") {
    return Math.round(subtotal * (discountValue / 100) * 100) / 100;
  }
  return Math.min(discountValue, subtotal);
}

// Public validation used by the booking checkout UI to preview a promo code.
export const validateBookingPromoCode = action({
  args: {
    code: v.string(),
    orderTotal: v.optional(v.number()),
  },
  returns: v.object({
    code: v.string(),
    discountType: v.union(v.literal("percent"), v.literal("amount")),
    discountValue: v.number(),
    discountAmount: v.number(),
  }),
  handler: async (_ctx, args) => {
    const resolved = await resolveStripeCouponForCode(
      args.code,
      typeof args.orderTotal === "number" && args.orderTotal > 0
        ? args.orderTotal
        : undefined,
    );
    const base =
      typeof args.orderTotal === "number" && args.orderTotal > 0
        ? args.orderTotal
        : 0;
    return {
      code: resolved.couponId,
      discountType: resolved.discountType,
      discountValue: resolved.discountValue,
      discountAmount: computeCouponDiscountAmount(
        base,
        resolved.discountType,
        resolved.discountValue,
      ),
    };
  },
});

// === Legacy Webhook Handler ===
//
// Production Stripe webhooks are handled in convex/http.ts via registerRoutes(...)
// from @convex-dev/stripe. This action is retained for compatibility with older
// tests and manual replay flows only.
export const handleWebhook = action({
  args: {
    body: v.string(),
    signature: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!endpointSecret)
      throw new Error("Stripe webhook secret not configured");

    // Parse the event from the raw body
    let event: any;
    try {
      event = JSON.parse(args.body);
    } catch (err) {
      throw new Error(`Invalid JSON in webhook body: ${err}`);
    }

    // For now, skip signature verification in development
    // In production, you should implement proper webhook signature verification
    // using crypto libraries compatible with Convex runtime

    // Handle the event
    switch (event.type) {
      // Invoice lifecycle events (primary for our invoice-based flow)
      case "invoice.created": {
        const invoice = event.data.object;
        console.log(`Invoice created: ${invoice.id}`);
        // Invoice was created - we already have it in our DB
        break;
      }

      case "invoice.finalized": {
        const invoice = event.data.object;
        console.log(`Invoice finalized: ${invoice.id}`);
        // Invoice is now open and ready for payment
        // Could update status if needed
        break;
      }

      case "invoice.sent": {
        const invoice = event.data.object;
        console.log(`Invoice sent: ${invoice.id}`);
        // Invoice was emailed to customer
        break;
      }

      case "invoice.paid": {
        const stripeInvoice = event.data.object;
        console.log(`Invoice paid: ${stripeInvoice.id}`);

        // Find our invoice by Stripe invoice ID
        const ourInvoice = await ctx.runQuery(
          internal.invoices.getByStripeIdInternal,
          {
            stripeInvoiceId: stripeInvoice.id,
          },
        );

        if (ourInvoice && ourInvoice.status !== "paid") {
          // Update invoice status to paid
          await ctx.runMutation(internal.invoices.updateStatusInternal, {
            invoiceId: ourInvoice._id,
            status: "paid",
            paidDate: new Date().toISOString().split("T")[0],
          });

          // Update user stats when invoice is fully paid
          const appointment = await ctx.runQuery(
            internal.appointments.getByIdInternal,
            {
              appointmentId: ourInvoice.appointmentId,
            },
          );
          if (appointment) {
            const user = await ctx.runQuery(internal.users.getByIdInternal, {
              userId: appointment.userId,
            });
            if (user) {
              await ctx.runMutation(internal.users.updateStats, {
                userId: appointment.userId,
                timesServiced: (user.timesServiced || 0) + 1,
                totalSpent: (user.totalSpent || 0) + ourInvoice.total,
              });
            }
          }
        }
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object;
        console.log(`Invoice payment failed: ${invoice.id}`);

        // Find our invoice by Stripe invoice ID
        const ourInvoice = await ctx.runQuery(
          internal.invoices.getByStripeIdInternal,
          {
            stripeInvoiceId: invoice.id,
          },
        );

        if (ourInvoice) {
          // Could add a payment_failed status or log the failure
          console.log(`Payment failed for our invoice ${ourInvoice._id}`);
        }
        break;
      }

      case "invoice.voided": {
        const invoice = event.data.object;
        console.log(`Invoice voided: ${invoice.id}`);

        // Find our invoice by Stripe invoice ID
        const ourInvoice = await ctx.runQuery(
          internal.invoices.getByStripeIdInternal,
          {
            stripeInvoiceId: invoice.id,
          },
        );

        if (ourInvoice) {
          // Mark as voided/overdue
          await ctx.runMutation(internal.invoices.updateStatusInternal, {
            invoiceId: ourInvoice._id,
            status: "overdue",
          });
        }
        break;
      }

      case "invoice.updated": {
        const invoice = event.data.object;
        console.log(`Invoice updated: ${invoice.id}`);
        // Could sync amount or status changes if needed
        break;
      }

      // Checkout session completed - handle deposit payments
      case "checkout.session.completed": {
        const session = event.data.object;
        const invoiceIdString = session.metadata?.invoiceId;
        const paymentType = session.metadata?.type; // "deposit" or undefined

        if (invoiceIdString && paymentType === "deposit") {
          const invoiceId = invoiceIdString as Id<"invoices">;
          const invoice = await ctx.runQuery(
            internal.invoices.getByIdInternal,
            {
              invoiceId,
            },
          );

          if (invoice && !invoice.depositPaid) {
            const paymentIntentId = session.payment_intent as
              | string
              | undefined;

            // Mark deposit as paid
            await ctx.runMutation(
              internal.invoices.updateDepositStatusInternal,
              {
                invoiceId,
                depositPaid: true,
                depositPaymentIntentId: paymentIntentId,
                status: "draft", // Will be updated to "sent" after Stripe invoice is created
              },
            );

            // Route through appointment status mutation (single source of truth for invoice generation)
            const appointment = await ctx.runQuery(
              internal.appointments.getByIdInternal,
              {
                appointmentId: invoice.appointmentId,
              },
            );
            if (
              appointment &&
              (appointment.status === "pending" ||
                appointment.status === "confirmed")
            ) {
              await ctx.runMutation(
                internal.appointments.updateStatusInternal,
                {
                  appointmentId: invoice.appointmentId,
                  status: "confirmed",
                },
              );
            }
          }
        }
        break;
      }

      case "payment_intent.succeeded": {
        const paymentIntent = event.data.object;
        const invoiceIdString = paymentIntent.metadata?.invoiceId;
        const paymentType = paymentIntent.metadata?.type;

        if (!invoiceIdString) break;

        const invoiceId = invoiceIdString as Id<"invoices">;
        const invoice = await ctx.runQuery(internal.invoices.getByIdInternal, {
          invoiceId,
        });
        if (!invoice) break;

        if (paymentType === "deposit") {
          // Deposit payment succeeded via direct payment intent
          // This is a backup handler in case checkout.session.completed didn't fire
          if (!invoice.depositPaid) {
            await ctx.runMutation(
              internal.invoices.updateDepositStatusInternal,
              {
                invoiceId,
                depositPaid: true,
                depositPaymentIntentId: paymentIntent.id,
                status: "draft",
              },
            );

            // Route through appointment status mutation (single source of truth for invoice generation)
            const appointment = await ctx.runQuery(
              internal.appointments.getByIdInternal,
              {
                appointmentId: invoice.appointmentId,
              },
            );
            if (
              appointment &&
              (appointment.status === "pending" ||
                appointment.status === "confirmed")
            ) {
              await ctx.runMutation(
                internal.appointments.updateStatusInternal,
                {
                  appointmentId: invoice.appointmentId,
                  status: "confirmed",
                },
              );
            }
          }
        } else if (
          paymentType === "final_payment" &&
          invoice.status !== "paid"
        ) {
          // Final payment succeeded (e.g. direct payment intent for remaining balance)
          await ctx.runMutation(internal.invoices.updateFinalPaymentInternal, {
            invoiceId,
            finalPaymentIntentId: paymentIntent.id,
          });
          await ctx.runMutation(internal.invoices.updateStatusInternal, {
            invoiceId,
            status: "paid",
            paidDate: new Date().toISOString().split("T")[0],
          });
          // Update user stats
          const appointment = await ctx.runQuery(
            internal.appointments.getByIdInternal,
            { appointmentId: invoice.appointmentId },
          );
          if (appointment) {
            const user = await ctx.runQuery(internal.users.getByIdInternal, {
              userId: appointment.userId,
            });
            if (user) {
              await ctx.runMutation(internal.users.updateStats, {
                userId: appointment.userId,
                timesServiced: (user.timesServiced || 0) + 1,
                totalSpent: (user.totalSpent || 0) + invoice.total,
              });
            }
          }
        }
        break;
      }

      case "payment_intent.payment_failed": {
        const paymentIntent = event.data.object;
        const invoiceIdString = paymentIntent.metadata?.invoiceId;
        const paymentType = paymentIntent.metadata?.type;

        if (invoiceIdString) {
          const invoiceId = invoiceIdString as Id<"invoices">;
          console.log(
            `Payment failed for invoice ${invoiceId}, type: ${paymentType}`,
          );
          // Could add retry logic or notification here
        }
        break;
      }

      case "payment_intent.canceled": {
        const paymentIntent = event.data.object;
        const invoiceIdString = paymentIntent.metadata?.invoiceId;

        if (invoiceIdString) {
          const invoiceId = invoiceIdString as Id<"invoices">;
          console.log(`Payment canceled for invoice ${invoiceId}`);
        }
        break;
      }

      // Customer events
      case "customer.created": {
        const customer = event.data.object;
        console.log(`Customer created: ${customer.id}`);
        // Could sync customer data if needed
        break;
      }

      default:
        // Avoid noisy test output while still logging unknown events in real environments.
        if (
          process.env.NODE_ENV !== "test" &&
          process.env.CONVEX_TEST !== "true"
        ) {
          console.log(`Unhandled event type ${event.type}`);
        }
    }

    return null;
  },
});

// Sync payment status from Stripe (for fixing missed webhooks)
export const syncPaymentStatus = action({
  args: {
    invoiceId: v.id("invoices"),
  },
  handler: async (ctx, args) => {
    const userId = await getUserIdFromIdentity(ctx);
    if (!userId) throw new Error("Not authenticated");

    const invoice = await ctx.runQuery(internal.invoices.getByIdInternal, {
      invoiceId: args.invoiceId,
    });
    if (!invoice) throw new Error("Invoice not found");
    await requireInvoicePaymentAccess(ctx, invoice, userId);

    const invoiceOwner = await getUserRecordOrThrow(ctx, invoice.userId);
    const stripeCustomerId = invoiceOwner.stripeCustomerId;
    if (!stripeCustomerId?.trim()) {
      throw new Error("User does not have a Stripe customer ID");
    }

    let updated = false;

    // Check deposit payment intent if it exists
    if (invoice.depositPaymentIntentId) {
      try {
        const paymentIntent = await stripeApiCall(
          `payment_intents/${invoice.depositPaymentIntentId}`,
          { method: "GET" },
        );

        if (paymentIntent.status === "succeeded" && !invoice.depositPaid) {
          await ctx.runMutation(internal.invoices.updateDepositStatusInternal, {
            invoiceId: args.invoiceId,
            depositPaid: true,
            depositPaymentIntentId: invoice.depositPaymentIntentId,
          });
          updated = true;
        }
      } catch (error) {
        console.warn(
          `Could not sync deposit payment intent ${invoice.depositPaymentIntentId}:`,
          error,
        );
      }
    } else if (
      !invoice.depositPaid &&
      invoice.depositAmount &&
      invoice.depositAmount > 0
    ) {
      // Try to find payment intent by searching recent payment intents for this customer
      // that match the deposit amount
      try {
        const depositAmountInCents = Math.round(invoice.depositAmount * 100);
        const paymentIntents = await stripeApiCall(
          `payment_intents?customer=${stripeCustomerId}&limit=10`,
          { method: "GET" },
        );

        // Find a succeeded payment intent that matches the deposit amount
        const matchingPaymentIntent = paymentIntents.data?.find(
          (pi: any) =>
            pi.amount === depositAmountInCents &&
            pi.status === "succeeded" &&
            pi.created >= invoice._creationTime / 1000 - 3600, // Within 1 hour of invoice creation
        );

        if (matchingPaymentIntent) {
          await ctx.runMutation(internal.invoices.updateDepositStatusInternal, {
            invoiceId: args.invoiceId,
            depositPaid: true,
            depositPaymentIntentId: matchingPaymentIntent.id,
          });
          updated = true;
        }
      } catch (error) {
        console.warn("Could not search for deposit payment intent:", error);
      }
    }

    // Check final payment intent if it exists.
    // Never treat the deposit payment intent as the final payment intent.
    if (invoice.finalPaymentIntentId) {
      if (
        invoice.depositPaymentIntentId &&
        invoice.finalPaymentIntentId === invoice.depositPaymentIntentId
      ) {
        console.warn(
          `[payments] Skipping final payment sync for ${args.invoiceId} because finalPaymentIntentId matches depositPaymentIntentId`,
        );
      } else {
        try {
          const paymentIntent = await stripeApiCall(
            `payment_intents/${invoice.finalPaymentIntentId}`,
            { method: "GET" },
          );

          if (paymentIntent.status === "succeeded" && invoice.status !== "paid") {
            await ctx.runMutation(internal.invoices.updateStatusInternal, {
              invoiceId: args.invoiceId,
              status: "paid",
              paidDate: new Date().toISOString().split("T")[0],
            });
            updated = true;
          }
        } catch (error) {
          console.warn(
            `Could not sync final payment intent ${invoice.finalPaymentIntentId}:`,
            error,
          );
        }
      }
    } else if (invoice.stripeInvoiceId && invoice.status !== "paid") {
      try {
        const stripeInvoice = await stripeApiCall(
          `invoices/${invoice.stripeInvoiceId}`,
          { method: "GET" },
        );
        if (stripeInvoice.status === "paid") {
          await ctx.runMutation(internal.invoices.updateStatusInternal, {
            invoiceId: args.invoiceId,
            status: "paid",
            paidDate: new Date().toISOString().split("T")[0],
          });
          updated = true;
        }
      } catch (error) {
        console.warn(
          `Could not sync Stripe invoice ${invoice.stripeInvoiceId}:`,
          error,
        );
      }
    }

    return { success: true, updated };
  },
});

// Create a checkout session for booking (guest or auth)
async function ensureStripeCustomerForBookingDraft(
  ctx: any,
  draft: Doc<"bookingDrafts">,
) {
  let user =
    (draft.sourceUserId
      ? await ctx.runQuery(internal.users.getByIdInternal, {
          userId: draft.sourceUserId,
        })
      : null) ?? null;

  if (!user) {
    const existingUserId = await ctx.runQuery(internal.auth.getUserIdByEmail, {
      email: draft.customerEmail,
    });
    if (existingUserId) {
      user = await ctx.runQuery(internal.users.getByIdInternal, {
        userId: existingUserId,
      });
    }
  }

  if (user) {
    let stripeCustomerId = user.stripeCustomerId;
    if (!stripeCustomerId) {
      stripeCustomerId = await ctx.runAction(internal.users.ensureStripeCustomer, {
        userId: user._id,
      });
    }
    if (!stripeCustomerId?.trim()) {
      throw new Error("Could not ensure Stripe customer");
    }

    return { stripeCustomerId, userId: user._id };
  }

  if (draft.stripeCustomerId?.trim()) {
    return { stripeCustomerId: draft.stripeCustomerId, userId: undefined };
  }

  const params = new URLSearchParams();
  params.set("email", draft.customerEmail);
  params.set("name", draft.customerName);
  if (draft.customerPhone?.trim()) {
    params.set("phone", draft.customerPhone);
  }

  const customer = await stripeApiCall("customers", {
    method: "POST",
    body: params,
  });

  if (!customer.id) {
    throw new Error("Failed to create a Stripe customer for this booking");
  }

  return { stripeCustomerId: customer.id as string, userId: undefined };
}

async function createGiftCardCoupon(args: {
  amount: number;
  giftCardId: Id<"giftCards">;
  reservationId: Id<"giftCardRedemptions">;
  name?: string;
  extraMetadata?: Record<string, string>;
}): Promise<string> {
  const amount = roundCurrency(args.amount);
  if (amount <= 0) {
    throw new Error("Gift card coupon amount must be positive");
  }
  const body = new URLSearchParams({
    amount_off: String(Math.round(amount * 100)),
    currency: "usd",
    duration: "once",
    name: (args.name ?? "Gift card").slice(0, 40),
    max_redemptions: "1",
    "metadata[type]": "gift_card",
    "metadata[giftCardId]": String(args.giftCardId),
    "metadata[reservationId]": String(args.reservationId),
  });
  for (const [key, value] of Object.entries(args.extraMetadata ?? {})) {
    body.append(`metadata[${key}]`, value);
  }
  const coupon = await stripeApiCall("coupons", {
    method: "POST",
    body,
  });
  return coupon.id;
}

async function releaseDraftGiftCardReservation(
  ctx: any,
  draft: Doc<"bookingDrafts">,
  reason: string,
): Promise<void> {
  if (!draft.giftCardReservationId) return;
  await ctx.runMutation(internal.giftCards.releaseReservation, {
    reservationId: draft.giftCardReservationId,
    reason,
  });
}

async function prepareGiftCardForDraft(
  ctx: any,
  draft: Doc<"bookingDrafts">,
  giftCardCodeInput: string | undefined,
  giftCardPin: string | undefined,
  amountDueToday: number,
  resolvedCoupon: ResolvedStripeCoupon | null,
): Promise<{
  giftCardId: Id<"giftCards">;
  appliedAmount: number;
  reservationId: Id<"giftCardRedemptions">;
  couponId: string;
} | null> {
  const codeWasProvided = giftCardCodeInput !== undefined;
  if (codeWasProvided && !giftCardCodeInput?.trim()) {
    await releaseDraftGiftCardReservation(
      ctx,
      draft,
      "Gift card removed from booking",
    );
    await ctx.runMutation(internal.bookingDrafts.setGiftCardFieldsInternal, {
      draftId: draft._id,
      giftCardId: undefined,
      giftCardAppliedAmount: undefined,
      giftCardReservationId: undefined,
      giftCardCouponId: undefined,
      giftCardCodeLast4: undefined,
    });
    return null;
  }

  if (
    !codeWasProvided &&
    draft.giftCardReservationId &&
    draft.giftCardId &&
    draft.giftCardAppliedAmount &&
    draft.giftCardCouponId
  ) {
    const reservation = await ctx.runQuery(
      internal.giftCards.getReservationInternal,
      { reservationId: draft.giftCardReservationId },
    );
    if (
      reservation &&
      reservation.status === "pending" &&
      reservation.expiresAt > Date.now()
    ) {
      const card = await ctx.runQuery(internal.giftCards.getByIdInternal, {
        giftCardId: draft.giftCardId,
      });
      if (card) {
        return {
          giftCardId: card._id,
          appliedAmount: draft.giftCardAppliedAmount,
          reservationId: draft.giftCardReservationId,
          couponId: draft.giftCardCouponId,
        };
      }
    }
    await releaseDraftGiftCardReservation(
      ctx,
      draft,
      "Gift card reservation expired",
    );
    await ctx.runMutation(internal.bookingDrafts.setGiftCardFieldsInternal, {
      draftId: draft._id,
      giftCardId: undefined,
      giftCardAppliedAmount: undefined,
      giftCardReservationId: undefined,
      giftCardCouponId: undefined,
      giftCardCodeLast4: undefined,
    });
    if (!codeWasProvided) return null;
  }

  if (!codeWasProvided) return null;

  const validation = await ctx.runAction(api.giftCards.validateForBooking, {
    code: giftCardCodeInput!,
    pin: giftCardPin,
    orderAmount: amountDueToday,
  });
  const card: Doc<"giftCards"> | null = await ctx.runQuery(
    internal.giftCards.getByIdInternal,
    { giftCardId: validation.giftCardId },
  );
  if (!card) throw new Error("Gift card not found");

  const appliedAmount = roundCurrency(
    Math.min(getAvailableGiftCardBalance(card), amountDueToday),
  );
  if (appliedAmount <= 0) {
    throw new ConvexError({
      message: "This gift card has no available balance for this payment.",
    });
  }

  await releaseDraftGiftCardReservation(
    ctx,
    draft,
    "Replaced by a new gift card",
  );
  const reservationId = await ctx.runMutation(
    internal.giftCards.reserveForOrder,
    {
      giftCardId: card._id,
      amount: appliedAmount,
      orderType: "booking",
      orderId: String(draft._id),
      expiresAt: Date.now() + BOOKING_HOLD_DURATION_MS,
    },
  );

  try {
    const promoDiscount =
      draft.paymentOption === "full" && resolvedCoupon
        ? computeCouponDiscountAmount(
            draft.totalPrice,
            resolvedCoupon.discountType,
            resolvedCoupon.discountValue,
          )
        : 0;
    const couponAmount =
      draft.paymentOption === "full"
        ? Math.min(draft.totalPrice, promoDiscount + appliedAmount)
        : appliedAmount;
    const couponId = await createGiftCardCoupon({
      amount: couponAmount,
      giftCardId: card._id,
      reservationId,
      name:
        draft.paymentOption === "full" && promoDiscount > 0
          ? "Promo + gift card"
          : "Gift card",
      extraMetadata: {
        promoDiscount: String(promoDiscount),
        giftCardApplied: String(appliedAmount),
      },
    });

    await ctx.runMutation(internal.giftCards.attachCouponToReservation, {
      reservationId,
      stripeCouponId: couponId,
    });
    await ctx.runMutation(internal.bookingDrafts.setGiftCardFieldsInternal, {
      draftId: draft._id,
      giftCardId: card._id,
      giftCardAppliedAmount: appliedAmount,
      giftCardReservationId: reservationId,
      giftCardCouponId: couponId,
      giftCardCodeLast4: card.codeLast4,
    });

    return {
      giftCardId: card._id,
      appliedAmount,
      reservationId,
      couponId,
    };
  } catch (error) {
    await ctx.runMutation(internal.giftCards.releaseReservation, {
      reservationId,
      reason: "Could not create gift card discount",
    });
    throw error;
  }
}

async function finalizeGiftCardBooking(
  ctx: any,
  converted: {
    appointmentId: Id<"appointments">;
    invoiceId: Id<"invoices">;
    userId: Id<"users">;
    isFullPayment: boolean;
    total: number;
  },
): Promise<void> {
  await ctx.scheduler.runAfter(
    0,
    internal.notifications.queueBookingReceived,
    {
      appointmentId: converted.appointmentId,
      invoiceId: converted.invoiceId,
      transition: "gift_card_checkout",
    },
  );

  if (converted.isFullPayment) {
    const user = await ctx.runQuery(internal.users.getByIdInternal, {
      userId: converted.userId,
    });
    if (user) {
      await ctx.runMutation(internal.users.updateStats, {
        userId: converted.userId,
        timesServiced: (user.timesServiced || 0) + 1,
        totalSpent: (user.totalSpent || 0) + converted.total,
      });
    }
  } else {
    await ctx.scheduler.runAfter(
      0,
      internal.emails.sendAdminDepositPaidNotification,
      {
        appointmentId: converted.appointmentId,
        invoiceId: converted.invoiceId,
      },
    );
  }
}

async function createCheckoutSessionForDraft(
  ctx: any,
  draft: Doc<"bookingDrafts">,
  origin: string,
  couponCodeInput?: string,
  giftCardCodeInput?: string,
  giftCardPin?: string,
): Promise<BookingCheckoutResult> {
  if (draft.status === "converted") {
    throw new Error("This booking has already been completed.");
  }

  const now = Date.now();
  const requestedGiftCardLast4 = giftCardCodeInput
    ? normalizeGiftCardCode(giftCardCodeInput).slice(-4)
    : undefined;
  const giftCardChanged =
    giftCardCodeInput !== undefined &&
    requestedGiftCardLast4 !== draft.giftCardCodeLast4;
  if (
    draft.status === "checkout_open" &&
    draft.holdExpiresAt &&
    draft.holdExpiresAt > now &&
    draft.stripeCheckoutUrl &&
    !giftCardChanged
  ) {
    return {
      sessionId: draft.stripeCheckoutSessionId ?? "",
      url: draft.stripeCheckoutUrl,
      token: draft.resumeToken,
    };
  }

  const schedulingDuration: number = await ctx.runQuery(
    internal.bookingDrafts.getSchedulingDurationInternal,
    {
      draftId: draft._id,
    },
  );
  const slotAvailability = await ctx.runQuery(api.availability.checkAvailability, {
    date: draft.scheduledDate,
    startTime: draft.scheduledTime,
    duration: Math.max(schedulingDuration, BOOKING_BLOCK_MINUTES),
    ignoreBookingDraftId: draft._id,
  });
  if (!slotAvailability.available) {
    throw new ConvexError({
      code: "TIME_SLOT_UNAVAILABLE",
      message: slotAvailability.reason || "Selected time is no longer available.",
    });
  }

  if (draft.stripeCheckoutSessionId) {
    await expireStripeCheckoutSessionIfPossible(draft.stripeCheckoutSessionId);
  }

  // Resolve the promo code (explicit input wins; empty string clears; when the
  // arg is omitted, fall back to whatever is already stored on the draft).
  const rawCouponCode =
    couponCodeInput !== undefined ? couponCodeInput : draft.couponCode;
  let resolvedCoupon: ResolvedStripeCoupon | null = null;
  if (rawCouponCode && rawCouponCode.trim()) {
    resolvedCoupon = await resolveStripeCouponForCode(
      rawCouponCode,
      draft.totalPrice,
    );
  }
  if (
    resolvedCoupon?.couponId !== draft.couponCode ||
    resolvedCoupon?.discountType !== draft.couponDiscountType ||
    resolvedCoupon?.discountValue !== draft.couponDiscountValue
  ) {
    await ctx.runMutation(internal.bookingDrafts.setCouponInternal, {
      draftId: draft._id,
      couponCode: resolvedCoupon?.couponId,
      couponDiscountType: resolvedCoupon?.discountType,
      couponDiscountValue: resolvedCoupon?.discountValue,
    });
  }

  const promoDiscountAmount = resolvedCoupon
    ? computeCouponDiscountAmount(
        draft.totalPrice,
        resolvedCoupon.discountType,
        resolvedCoupon.discountValue,
      )
    : 0;
  const discountedTotal = roundCurrency(
    draft.totalPrice - promoDiscountAmount,
  );
  const amountDueToday =
    draft.paymentOption === "full"
      ? discountedTotal
      : Math.min(draft.depositAmount, discountedTotal);

  const giftCard = await prepareGiftCardForDraft(
    ctx,
    draft,
    giftCardCodeInput,
    giftCardPin,
    amountDueToday,
    resolvedCoupon,
  );

  if (
    (giftCard && giftCard.appliedAmount >= amountDueToday) ||
    (!giftCard && amountDueToday <= 0)
  ) {
    const converted = await ctx.runMutation(
      internal.bookingDrafts.convertSuccessfulCheckout,
      {
        draftId: draft._id,
        giftCardReservationId: giftCard?.reservationId,
      },
    );
    if (!converted) {
      throw new Error("Could not complete this booking");
    }
    await finalizeGiftCardBooking(ctx, converted);
    return {
      sessionId: "",
      url: "",
      token: draft.resumeToken,
      status: "completed",
      appointmentId: converted.appointmentId,
    };
  }

  let stripeCustomerId: string;
  try {
    ({ stripeCustomerId } = await ensureStripeCustomerForBookingDraft(
      ctx,
      draft,
    ));
  } catch (error) {
    if (giftCard) {
      await releaseDraftGiftCardReservation(
        ctx,
        draft,
        "Could not create Stripe customer",
      );
    }
    throw error;
  }
  const successUrl = buildBookingRedirectUrl(
    origin,
    "/booking/success",
    draft.resumeToken,
  );
  const cancelUrl = buildBookingRedirectUrl(
    origin,
    "/booking/cancelled",
    draft.resumeToken,
  );

  const metadata = {
    draftId: String(draft._id),
    resumeToken: draft.resumeToken,
    type: draft.paymentOption === "full" ? "full" : "deposit",
  };

  let depositPriceId: string | undefined;
  let depositPerVehicle = 50;
  try {
    const depositSettings = await ctx.runQuery(api.depositSettings.get, {});
    depositPriceId = depositSettings?.stripePriceId;
    depositPerVehicle = depositSettings?.amountPerVehicle ?? depositPerVehicle;
  } catch (error) {
    console.warn("Could not fetch deposit settings:", error);
  }

  const vehicleCount = draft.vehicleCount;
  const expectedDepositFromPrice = depositPerVehicle * vehicleCount;
  const canUseDepositPriceId =
    depositPriceId &&
    !giftCard?.couponId &&
    Math.round(draft.depositAmount * 100) ===
      Math.round(expectedDepositFromPrice * 100);
  let sessionId = "";
  let url = "";

  try {
  if (draft.paymentOption === "full") {
    const totalAmountInCents = Math.round(draft.totalPrice * 100);
    const sessionData = new URLSearchParams({
      mode: "payment",
      customer: stripeCustomerId,
      success_url: successUrl,
      cancel_url: cancelUrl,
    });
    appendMetadata(sessionData, metadata);
    sessionData.append(
      "payment_intent_data[metadata][draftId]",
      String(draft._id),
    );
    sessionData.append(
      "payment_intent_data[metadata][resumeToken]",
      draft.resumeToken,
    );
    sessionData.append("payment_intent_data[metadata][type]", "full");
    if (draft.subscriptionIntent) {
      sessionData.append("payment_intent_data[setup_future_usage]", "off_session");
    }
    sessionData.append("line_items[0][price_data][currency]", "usd");
    sessionData.append(
      "line_items[0][price_data][unit_amount]",
      totalAmountInCents.toString(),
    );
    const membershipIntent = draft.subscriptionIntent;
    sessionData.append(
      "line_items[0][price_data][product_data][name]",
      membershipIntent
        ? `${membershipIntent.planName} — First Month`
        : `Full Service Payment (${vehicleCount} vehicle${vehicleCount > 1 ? "s" : ""})`,
    );
    if (membershipIntent) {
      const recurringLabel =
        membershipIntent.frequency === "monthly" ? "month" : "2 weeks";
      const oneTimeExtras = Math.max(
        0,
        draft.totalPrice - membershipIntent.firstMonthTotal,
      );
      const descriptionParts = [
        oneTimeExtras > 0
          ? `First month + $${oneTimeExtras.toFixed(2)} one-time add-ons`
          : "First month paid today",
        `then $${membershipIntent.totalPerCycle.toFixed(2)} / ${recurringLabel}`,
      ];
      sessionData.append(
        "line_items[0][price_data][product_data][description]",
        descriptionParts.join(" · "),
      );
    }
    sessionData.append("line_items[0][quantity]", "1");
    const couponIdToApply = giftCard?.couponId ?? resolvedCoupon?.couponId;
    if (couponIdToApply) {
      sessionData.append("discounts[0][coupon]", couponIdToApply);
    }

    const session = await stripeApiCall("checkout/sessions", {
      method: "POST",
      body: sessionData,
    });
    sessionId = session.id;
    url = session.url;
  } else if (canUseDepositPriceId) {
    try {
      const session = await stripeClient.createCheckoutSession(ctx, {
        priceId: depositPriceId!,
        customerId: stripeCustomerId,
        mode: "payment",
        successUrl,
        cancelUrl,
        quantity: vehicleCount,
        metadata,
        paymentIntentMetadata: metadata,
      });
      sessionId = session.sessionId;
      url = session.url || "";
    } catch (stripeErr) {
      console.warn(
        "Stripe checkout with depositPriceId failed, falling back to dynamic price_data:",
        stripeErr,
      );
      const depositAmountInCents = Math.round(amountDueToday * 100);
      const sessionData = new URLSearchParams({
        mode: "payment",
        customer: stripeCustomerId,
        success_url: successUrl,
        cancel_url: cancelUrl,
      });
      appendMetadata(sessionData, metadata);
      sessionData.append(
        "payment_intent_data[metadata][draftId]",
        String(draft._id),
      );
      sessionData.append(
        "payment_intent_data[metadata][resumeToken]",
        draft.resumeToken,
      );
      sessionData.append("payment_intent_data[metadata][type]", "deposit");
      sessionData.append("line_items[0][price_data][currency]", "usd");
      sessionData.append(
        "line_items[0][price_data][unit_amount]",
        depositAmountInCents.toString(),
      );
      sessionData.append(
        "line_items[0][price_data][product_data][name]",
        `Deposit (${vehicleCount} vehicle${vehicleCount > 1 ? "s" : ""})`,
      );
      sessionData.append("line_items[0][quantity]", "1");
      if (giftCard?.couponId) {
        sessionData.append("discounts[0][coupon]", giftCard.couponId);
      }

      const session = await stripeApiCall("checkout/sessions", {
        method: "POST",
        body: sessionData,
      });
      sessionId = session.id;
      url = session.url;
    }
  } else {
    const depositAmountInCents = Math.round(amountDueToday * 100);
    const sessionData = new URLSearchParams({
      mode: "payment",
      customer: stripeCustomerId,
      success_url: successUrl,
      cancel_url: cancelUrl,
    });
    appendMetadata(sessionData, metadata);
    sessionData.append(
      "payment_intent_data[metadata][draftId]",
      String(draft._id),
    );
    sessionData.append(
      "payment_intent_data[metadata][resumeToken]",
      draft.resumeToken,
    );
    sessionData.append("payment_intent_data[metadata][type]", "deposit");
    sessionData.append("line_items[0][price_data][currency]", "usd");
    sessionData.append(
      "line_items[0][price_data][unit_amount]",
      depositAmountInCents.toString(),
    );
    sessionData.append(
      "line_items[0][price_data][product_data][name]",
      `Deposit (${vehicleCount} vehicle${vehicleCount > 1 ? "s" : ""})`,
    );
    sessionData.append("line_items[0][quantity]", "1");
    if (giftCard?.couponId) {
      sessionData.append("discounts[0][coupon]", giftCard.couponId);
    }

    const session = await stripeApiCall("checkout/sessions", {
      method: "POST",
      body: sessionData,
    });
    sessionId = session.id;
    url = session.url;
  }
  } catch (error) {
    if (giftCard) {
      await releaseDraftGiftCardReservation(
        ctx,
        draft,
        "Checkout session creation failed",
      );
    }
    throw error;
  }

  if (!sessionId || !url) {
    if (giftCard) {
      await releaseDraftGiftCardReservation(
        ctx,
        draft,
        "Checkout session creation failed",
      );
    }
    throw new Error("Failed to create checkout session");
  }

  if (giftCard) {
    await ctx.runMutation(internal.giftCards.attachSessionToReservation, {
      reservationId: giftCard.reservationId,
      stripeCheckoutSessionId: sessionId,
    });
  }

  const holdExpiryScheduledId = await ctx.scheduler.runAfter(
    BOOKING_HOLD_DURATION_MS,
    internal.payments.expireBookingDraftCheckout,
    {
      draftId: draft._id,
    },
  );
  const abandonedEmailScheduledId = await ctx.scheduler.runAfter(
    ABANDONED_RECOVERY_DELAY_MS,
    internal.payments.sendAbandonedBookingRecoveryEmail,
    {
      draftId: draft._id,
      stage: "first",
    },
  );
  const abandonedFollowUpScheduledId = await ctx.scheduler.runAfter(
    ABANDONED_FOLLOW_UP_DELAY_MS,
    internal.payments.sendAbandonedBookingRecoveryEmail,
    {
      draftId: draft._id,
      stage: "follow_up",
    },
  );

  await ctx.runMutation(internal.bookingDrafts.markCheckoutOpenInternal, {
    draftId: draft._id,
    stripeCheckoutSessionId: sessionId,
    stripeCheckoutUrl: url,
    stripeCustomerId,
    holdExpiresAt: now + BOOKING_HOLD_DURATION_MS,
    holdExpiryScheduledId,
    abandonedEmailScheduledId,
    abandonedFollowUpScheduledId,
  });

  return {
    sessionId,
    url,
    token: draft.resumeToken,
  };
}

export const createBookingCheckout = action({
  args: {
    draftId: v.id("bookingDrafts"),
    origin: v.string(),
    couponCode: v.optional(v.string()),
    giftCardCode: v.optional(v.string()),
    giftCardPin: v.optional(v.string()),
  },
  returns: v.object({
    sessionId: v.string(),
    url: v.string(),
    token: v.string(),
    status: v.optional(v.union(v.literal("redirect"), v.literal("completed"))),
    appointmentId: v.optional(v.id("appointments")),
  }),
  handler: async (ctx, args): Promise<BookingCheckoutResult> => {
    await assertRateLimit(ctx, "bookingCheckoutByDraft", {
      key: String(args.draftId),
      message: "Checkout is temporarily busy for this booking. Please try again shortly.",
    });

    const draft: Doc<"bookingDrafts"> | null = await ctx.runQuery(
      internal.bookingDrafts.getByIdInternal,
      {
      draftId: args.draftId,
      },
    );
    if (!draft) {
      throw new Error("Booking draft not found");
    }

    const currentUserId = await getUserIdFromIdentity(ctx);
    if (draft.sourceUserId && draft.sourceUserId !== currentUserId) {
      throw new ConvexError("You do not have access to this booking.");
    }

    return await createCheckoutSessionForDraft(
      ctx,
      draft,
      args.origin,
      args.couponCode,
      args.giftCardCode,
      args.giftCardPin,
    );
  },
});

export const confirmBookingCheckout = action({
  args: {
    resumeToken: v.string(),
  },
  returns: v.object({
    success: v.boolean(),
    appointmentId: v.optional(v.id("appointments")),
    status: v.string(),
  }),
  handler: async (ctx, args): Promise<{
    success: boolean;
    appointmentId?: Id<"appointments">;
    status: string;
  }> => {
    const currentUserId = await getUserIdFromIdentity(ctx);
    if (!currentUserId) {
      throw new ConvexError("You must be signed in to confirm this booking.");
    }

    for (let attempt = 0; attempt < 4; attempt += 1) {
      const draft: Doc<"bookingDrafts"> | null = await ctx.runQuery(
        internal.bookingDrafts.getByTokenInternal,
        {
          resumeToken: args.resumeToken,
        },
      );
      if (!draft) {
        throw new Error("Booking draft not found");
      }

      if (draft.sourceUserId !== currentUserId) {
        throw new ConvexError("You do not have access to this booking.");
      }

      if (draft.status === "converted" && draft.convertedAppointmentId) {
        return {
          success: true,
          appointmentId: draft.convertedAppointmentId,
          status: "converted",
        };
      }

      if (draft.stripeCheckoutSessionId) {
        let session: any = null;
        try {
          session = await stripeApiCall(
            `checkout/sessions/${draft.stripeCheckoutSessionId}`,
            { method: "GET" },
          );
        } catch (err) {
          console.error("Error checking Stripe session status:", err);
        }

        // A completed Checkout Session is not sufficient proof of payment for
        // delayed payment methods. Fulfill only after Stripe reports paid.
        if (session?.payment_status === "paid") {
          const converted = await ctx.runMutation(
            internal.bookingDrafts.convertSuccessfulCheckout,
            {
              draftId: draft._id,
              stripeCustomerId:
                typeof session.customer === "string" ? session.customer : undefined,
              paymentIntentId:
                typeof session.payment_intent === "string"
                  ? session.payment_intent
                  : undefined,
            },
          );

          if (converted) {
            return {
              success: true,
              appointmentId: converted.appointmentId,
              status: "converted",
            };
          }
        }
      }

      if (attempt < 3) {
        await delay(750);
      }
    }

    const latestDraft: Doc<"bookingDrafts"> | null = await ctx.runQuery(
      internal.bookingDrafts.getByTokenInternal,
      {
        resumeToken: args.resumeToken,
      },
    );

    return {
      success: false,
      status: latestDraft?.status ?? "draft",
    };
  },
});

export const resumeBookingDraftCheckout = action({
  args: {
    token: v.string(),
    origin: v.string(),
  },
  returns: v.object({
    status: v.union(
      v.literal("redirect"),
      v.literal("requires_new_time"),
      v.literal("converted"),
    ),
    url: v.optional(v.string()),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<ResumeBookingDraftCheckoutResult> => {
    await assertRateLimit(ctx, "bookingCheckoutByDraft", {
      key: normalizeRateLimitKey(args.token),
      message: "Checkout is temporarily busy for this booking. Please try again shortly.",
    });

    const draft: Doc<"bookingDrafts"> | null = await ctx.runQuery(
      internal.bookingDrafts.getByTokenInternal,
      {
        resumeToken: args.token,
      },
    );
    if (!draft) {
      throw new Error("Booking draft not found");
    }

    if (draft.status === "converted") {
      return {
        status: "converted",
        url: buildBookingRedirectUrl(args.origin, "/booking/success", draft.resumeToken),
      };
    }

    const schedulingDuration: number = await ctx.runQuery(
      internal.bookingDrafts.getSchedulingDurationInternal,
      {
        draftId: draft._id,
      },
    );
    const slotAvailability = await ctx.runQuery(api.availability.checkAvailability, {
      date: draft.scheduledDate,
      startTime: draft.scheduledTime,
      duration: Math.max(schedulingDuration, BOOKING_BLOCK_MINUTES),
      ignoreBookingDraftId: draft._id,
    });
    if (!slotAvailability.available) {
      return {
        status: "requires_new_time",
      };
    }

    const checkout = await createCheckoutSessionForDraft(ctx, draft, args.origin);
    if (checkout.status === "completed") {
      return {
        status: "converted",
        url: buildBookingRedirectUrl(
          args.origin,
          "/booking/success",
          draft.resumeToken,
        ),
      };
    }
    return {
      status: "redirect",
      url: checkout.url,
    };
  },
});

export const cancelBookingDraftCheckout = action({
  args: {
    token: v.string(),
  },
  returns: v.object({
    status: v.union(
      v.literal("cancelled"),
      v.literal("converted"),
      v.literal("missing"),
    ),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<CancelBookingDraftCheckoutResult> => {
    const draft: Doc<"bookingDrafts"> | null = await ctx.runQuery(
      internal.bookingDrafts.getByTokenInternal,
      {
        resumeToken: args.token,
      },
    );
    if (!draft) {
      return { status: "missing" };
    }
    if (draft.status === "converted") {
      return { status: "converted" };
    }

    await expireStripeCheckoutSessionIfPossible(draft.stripeCheckoutSessionId);
    await releaseDraftGiftCardReservation(
      ctx,
      draft,
      "Booking checkout cancelled",
    );
    await ctx.runMutation(internal.bookingDrafts.markCancelledInternal, {
      draftId: draft._id,
    });

    return { status: "cancelled" };
  },
});

export const expireBookingDraftCheckout = internalAction({
  args: {
    draftId: v.id("bookingDrafts"),
  },
  handler: async (ctx, args) => {
    const draft = await ctx.runQuery(internal.bookingDrafts.getByIdInternal, {
      draftId: args.draftId,
    });
    if (!draft || draft.status === "converted") {
      return false;
    }
    if (draft.holdExpiresAt && draft.holdExpiresAt > Date.now()) {
      return false;
    }

    await expireStripeCheckoutSessionIfPossible(draft.stripeCheckoutSessionId);
    await ctx.runMutation(internal.bookingDrafts.markExpiredInternal, {
      draftId: draft._id,
    });

    return true;
  },
});

async function getMembershipOfferForDraft(
  ctx: any,
  draft: Doc<"bookingDrafts">,
): Promise<{
  planName: string;
  includedServiceName: string;
  oneTimePrice?: number;
  monthlyPrice: number;
  savingsPerVisit?: number;
  annualSavings?: number;
  kind: "replacement" | "after_detail";
} | null> {
  const services = await ctx.runQuery(api.services.list, {});
  const activePlans = services.filter(
    (service: any) =>
      service.isActive &&
      service.serviceType === "subscription" &&
      (service.includedServiceIds?.length ?? 0) > 0,
  );
  if (activePlans.length === 0) return null;

  const firstVehicle = draft.draftVehicles?.[0];
  const vehicleSize = firstVehicle?.size ?? draft.vehicleSize ?? "medium";
  const vehicleTypeId = firstVehicle?.vehicleTypeId ?? null;
  const vehicleContext = { vehicleSize, vehicleTypeId };

  const replacementPlan = activePlans.find((plan: any) =>
    (plan.includedServiceIds ?? []).some((serviceId: Id<"services">) =>
      draft.serviceIds.includes(serviceId),
    ),
  );
  const plan = replacementPlan ?? activePlans[0];
  const includedServiceId =
    (plan.includedServiceIds ?? []).find((serviceId: Id<"services">) =>
      draft.serviceIds.includes(serviceId),
    ) ?? plan.includedServiceIds?.[0];
  const includedService = services.find(
    (service: any) => service._id === includedServiceId,
  );
  if (!includedService) return null;

  const planPricing = getEffectiveServicePricingForVehicle(
    plan,
    vehicleContext,
  );
  const includedPricing = getEffectiveServicePricingForVehicle(
    includedService,
    vehicleContext,
  );
  const monthlyPrice = planPricing.price;
  if (monthlyPrice <= 0) return null;

  const isReplacement = Boolean(replacementPlan);
  const oneTimePrice = includedPricing.price;
  const savingsPerVisit = isReplacement
    ? Math.max(0, oneTimePrice - monthlyPrice)
    : undefined;

  return {
    planName: plan.name,
    includedServiceName: includedService.name,
    oneTimePrice: isReplacement ? oneTimePrice : undefined,
    monthlyPrice,
    savingsPerVisit,
    annualSavings: savingsPerVisit ? savingsPerVisit * 12 : undefined,
    kind: isReplacement ? "replacement" : "after_detail",
  };
}

export const sendAbandonedBookingRecoveryEmail = internalAction({
  args: {
    draftId: v.id("bookingDrafts"),
    stage: v.union(v.literal("first"), v.literal("follow_up")),
  },
  handler: async (ctx, args) => {
    const draft = await ctx.runQuery(internal.bookingDrafts.getByIdInternal, {
      draftId: args.draftId,
    });
    if (!draft) {
      return false;
    }
    if (
      draft.status === "converted" ||
      draft.status === "cancelled" ||
      draft.status === "completed"
    ) {
      return false;
    }
    if (args.stage === "first") {
      if (draft.status === "draft" || draft.abandonedEmailSentAt) {
        return false;
      }
    } else {
      if (!draft.abandonedEmailSentAt || draft.abandonedFollowUpSentAt) {
        return false;
      }
    }

    const membershipOffer =
      (await getMembershipOfferForDraft(ctx, draft)) ?? undefined;
    await ctx.runAction(internal.emails.sendAbandonedCheckoutRecoveryEmail, {
      customerName: draft.customerName,
      to: draft.customerEmail,
      scheduledDate: draft.scheduledDate,
      scheduledTime: draft.scheduledTime,
      serviceNames: draft.priceSnapshot.map(
        (item: { serviceName: string }) => item.serviceName,
      ),
      resumeToken: draft.resumeToken,
      recoveryStage: args.stage,
      membershipOffer,
    });
    if (args.stage === "first") {
      await ctx.runMutation(
        internal.bookingDrafts.markAbandonedEmailSentInternal,
        {
          draftId: draft._id,
        },
      );
    } else {
      await ctx.runMutation(
        internal.bookingDrafts.markAbandonedFollowUpSentInternal,
        {
          draftId: draft._id,
        },
      );
    }

    return true;
  },
});

export const listStripeCoupons = action({
  args: {},
  returns: v.array(
    v.object({
      id: v.string(),
      name: v.union(v.string(), v.null()),
      percent_off: v.union(v.number(), v.null()),
      amount_off: v.union(v.number(), v.null()),
      currency: v.union(v.string(), v.null()),
      duration: v.string(),
      max_redemptions: v.union(v.number(), v.null()),
      times_redeemed: v.number(),
      valid: v.boolean(),
    })
  ),
  handler: async (ctx): Promise<any[]> => {
    await requireAdminRole(ctx);
    const response = await stripeApiCall("coupons?limit=100", {
      method: "GET",
    });
    
    return (response.data || []).map((coupon: any) => ({
      id: coupon.id,
      name: coupon.name || null,
      percent_off: coupon.percent_off !== undefined ? coupon.percent_off : null,
      amount_off: coupon.amount_off !== undefined ? coupon.amount_off / 100 : null,
      currency: coupon.currency || null,
      duration: coupon.duration,
      max_redemptions: coupon.max_redemptions !== undefined ? coupon.max_redemptions : null,
      times_redeemed: coupon.times_redeemed || 0,
      valid: coupon.valid,
    }));
  },
});

export const createStripeCoupon = action({
  args: {
    couponCode: v.string(),
    discountType: v.union(v.literal("percent"), v.literal("amount")),
    discountValue: v.number(),
    duration: v.union(v.literal("once"), v.literal("forever")),
  },
  returns: v.object({
    success: v.boolean(),
    id: v.string(),
  }),
  handler: async (ctx, args): Promise<{ success: boolean; id: string }> => {
    await requireAdminRole(ctx);
    const couponInput = validateCouponInput(args);
    if (couponInput.discountValue === undefined) {
      throw new Error("Discount value must be greater than zero.");
    }
    const discountValue = couponInput.discountValue;

    const bodyParams = new URLSearchParams({
      id: couponInput.couponCode,
      name: couponInput.couponCode,
      duration: args.duration,
    });

    if (args.discountType === "percent") {
      bodyParams.append("percent_off", discountValue.toString());
    } else {
      bodyParams.append("amount_off", Math.round(discountValue * 100).toString());
      bodyParams.append("currency", "usd");
    }

    const response = await stripeApiCall("coupons", {
      method: "POST",
      body: bodyParams,
    });

    return {
      success: true,
      id: response.id,
    };
  },
});

export const deleteStripeCoupon = action({
  args: {
    couponId: v.string(),
  },
  returns: v.object({
    success: v.boolean(),
  }),
  handler: async (ctx, args): Promise<{ success: boolean }> => {
    await requireAdminRole(ctx);
    await stripeApiCall(`coupons/${encodeURIComponent(args.couponId)}`, {
      method: "DELETE",
    });
    return { success: true };
  },
});
