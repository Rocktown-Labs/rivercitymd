import { ConvexError, v } from "convex/values";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { getUserIdFromIdentity, requireAdmin } from "./auth";
import { assertRateLimit, normalizeRateLimitKey } from "./rateLimiter";
import {
  GIFT_CARD_CLAIM_TTL_MS,
  GIFT_CARD_CURRENCY,
  GIFT_CARD_MAX_AMOUNT,
  GIFT_CARD_MIN_AMOUNT,
  GIFT_CARD_PRESETS,
  GIFT_CARD_PRODUCT_NAME,
  GIFT_CARD_REDEMPTION_TTL_MS,
  GIFT_CARD_TAX_CODE,
  formatGiftCardCodeForDisplay,
  generateGiftCardCode,
  generateGiftCardPin,
  getAvailableGiftCardBalance,
  isValidGiftCardAmount,
  isValidGiftCardPin,
  normalizeGiftCardCode,
  normalizeGiftCardEmail,
  roundCurrency,
} from "./lib/giftCards";
import { stripeApiCall } from "./lib/stripeApi";

const deliveryMethodValidator = v.union(
  v.literal("self"),
  v.literal("email"),
  v.literal("print"),
);
const sourceValidator = v.union(
  v.literal("purchase"),
  v.literal("admin_sale"),
  v.literal("admin_credit"),
);
const paymentMethodValidator = v.union(
  v.literal("stripe"),
  v.literal("cash"),
  v.literal("comp"),
);
const orderTypeValidator = v.union(
  v.literal("booking"),
  v.literal("invoice"),
);

function randomToken(): string {
  return `${crypto.randomUUID().replaceAll("-", "")}${crypto
    .randomUUID()
    .replaceAll("-", "")}`;
}

function maskEmail(email: string | undefined): string | undefined {
  if (!email) return undefined;
  const [local, domain] = email.split("@");
  if (!local || !domain) return email;
  return `${local.slice(0, 1)}${"*".repeat(Math.max(2, local.length - 1))}@${domain}`;
}

function validatePurchaseInput(args: {
  amount: number;
  deliveryMethod: "self" | "email" | "print";
  purchaserName: string;
  purchaserEmail?: string;
  recipientEmail?: string;
  pin?: string;
}) {
  if (!isValidGiftCardAmount(args.amount)) {
    throw new ConvexError({
      message: `Gift cards must be between $${GIFT_CARD_MIN_AMOUNT} and $${GIFT_CARD_MAX_AMOUNT} in $100 increments.`,
    });
  }
  if (!args.purchaserName.trim()) {
    throw new ConvexError({ message: "Enter the purchaser's name." });
  }
  if (args.deliveryMethod === "email") {
    if (!args.recipientEmail?.trim()) {
      throw new ConvexError({
        message: "Enter the recipient's email address.",
      });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(args.recipientEmail.trim())) {
      throw new ConvexError({ message: "Enter a valid recipient email." });
    }
  }
  if (args.purchaserEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(args.purchaserEmail.trim())) {
    throw new ConvexError({ message: "Enter a valid purchaser email." });
  }
  if (args.pin && !isValidGiftCardPin(args.pin)) {
    throw new ConvexError({ message: "The PIN must be exactly 4 digits." });
  }
}

async function getCurrentUser(ctx: any): Promise<Doc<"users"> | null> {
  const userId = await getUserIdFromIdentity(ctx);
  if (!userId) return null;
  return await ctx.runQuery(internal.users.getByIdInternal, { userId });
}

async function createCheckoutSessionForGiftCard(
  ctx: any,
  card: Doc<"giftCards">,
  origin: string,
): Promise<{ sessionId: string; url: string }> {
  const productId: string = await ctx.runAction(
    internal.giftCards.ensureGiftCardProduct,
    {},
  );
  const sessionData = new URLSearchParams({
    mode: "payment",
    success_url: `${origin.replace(/\/$/, "")}/gift-cards/success?token=${encodeURIComponent(card.accessToken)}`,
    cancel_url: `${origin.replace(/\/$/, "")}/gift-cards?canceled=1`,
    "line_items[0][price_data][currency]": GIFT_CARD_CURRENCY,
    "line_items[0][price_data][product]": productId,
    "line_items[0][price_data][unit_amount]": String(
      Math.round(card.amount * 100),
    ),
    "line_items[0][quantity]": "1",
    "metadata[type]": "gift_card",
    "metadata[giftCardId]": String(card._id),
    "payment_intent_data[metadata][type]": "gift_card",
    "payment_intent_data[metadata][giftCardId]": String(card._id),
  });

  if (card.purchaserUserId) {
    const purchaser = await ctx.runQuery(internal.users.getByIdInternal, {
      userId: card.purchaserUserId,
    });
    if (purchaser?.stripeCustomerId) {
      sessionData.append("customer", purchaser.stripeCustomerId);
    } else if (card.purchaserEmail) {
      sessionData.append("customer_email", card.purchaserEmail);
    }
  } else if (card.purchaserEmail) {
    sessionData.append("customer_email", card.purchaserEmail);
  }

  const session = await stripeApiCall("checkout/sessions", {
    method: "POST",
    body: sessionData,
  });

  await ctx.runMutation(internal.giftCards.attachCheckoutSession, {
    giftCardId: card._id,
    stripeCheckoutSessionId: session.id,
  });

  return { sessionId: session.id, url: session.url };
}

export const getConfig = query({
  args: {},
  returns: v.object({
    presets: v.array(v.number()),
    minAmount: v.number(),
    maxAmount: v.number(),
    currency: v.literal("usd"),
    terms: v.array(v.string()),
  }),
  handler: async () => ({
    presets: [...GIFT_CARD_PRESETS],
    minAmount: GIFT_CARD_MIN_AMOUNT,
    maxAmount: GIFT_CARD_MAX_AMOUNT,
    currency: GIFT_CARD_CURRENCY,
    terms: [
      "Gift cards never expire.",
      "Redeemable for services and outstanding invoices only.",
      "No cash value. Remaining balance stays on the card.",
      "Lost codes can be resent to the purchaser or recipient email on file.",
    ],
  }),
});

export const createPurchase = action({
  args: {
    amount: v.number(),
    deliveryMethod: deliveryMethodValidator,
    purchaserName: v.string(),
    purchaserEmail: v.string(),
    recipientName: v.optional(v.string()),
    recipientEmail: v.optional(v.string()),
    message: v.optional(v.string()),
    pin: v.optional(v.string()),
    origin: v.string(),
  },
  returns: v.object({
    giftCardId: v.id("giftCards"),
    url: v.string(),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{ giftCardId: Id<"giftCards">; url: string }> => {
    validatePurchaseInput(args);
    await assertRateLimit(ctx, "giftCardPurchaseGlobal", {
      message: "Gift card checkout is temporarily busy. Please try again shortly.",
    });
    await assertRateLimit(ctx, "giftCardPurchaseByEmail", {
      key: normalizeRateLimitKey(args.purchaserEmail),
      message: "Too many gift card purchases. Please wait and try again.",
    });

    const purchaserUserId = await getUserIdFromIdentity(ctx);
    const created: {
      _id: Id<"giftCards">;
      code: string;
      accessToken: string;
      claimToken?: string;
    } = await ctx.runMutation(internal.giftCards.createGiftCard, {
      amount: args.amount,
      deliveryMethod: args.deliveryMethod,
      source: "purchase",
      paymentMethod: "stripe",
      purchaserUserId: purchaserUserId ?? undefined,
      purchaserName: args.purchaserName.trim(),
      purchaserEmail: normalizeGiftCardEmail(args.purchaserEmail),
      recipientName: args.recipientName?.trim() || undefined,
      recipientEmail: args.recipientEmail
        ? normalizeGiftCardEmail(args.recipientEmail)
        : undefined,
      message: args.message?.trim() || undefined,
      pin: args.pin,
    });
    const card: Doc<"giftCards"> | null = await ctx.runQuery(
      internal.giftCards.getByIdInternal,
      { giftCardId: created._id },
    );
    if (!card) throw new Error("Could not create gift card");

    try {
      const checkout = await createCheckoutSessionForGiftCard(
        ctx,
        card,
        args.origin,
      );
      return { giftCardId: card._id, url: checkout.url };
    } catch (error) {
      await ctx.runMutation(internal.giftCards.voidPendingGiftCard, {
        giftCardId: card._id,
        reason: "Could not start checkout",
      });
      throw error;
    }
  },
});

export const ensureGiftCardProduct = internalAction({
  args: {},
  returns: v.string(),
  handler: async (ctx): Promise<string> => {
    const business = await ctx.runQuery(api.business.get, {});
    if (business?.giftCardProductId) {
      return business.giftCardProductId;
    }

    const product = await stripeApiCall("products", {
      method: "POST",
      body: new URLSearchParams({
        name: GIFT_CARD_PRODUCT_NAME,
        description:
          "Digital gift card for River City Mobile Detailing services.",
        tax_code: GIFT_CARD_TAX_CODE,
        "metadata[type]": "gift_card",
      }),
    });

    await ctx.runMutation(internal.giftCards.setGiftCardProductId, {
      productId: product.id,
    });
    return product.id;
  },
});

export const setGiftCardProductId = internalMutation({
  args: { productId: v.string() },
  handler: async (ctx, args) => {
    const business = await ctx.db.query("businessInfo").first();
    if (!business) throw new Error("Business info not found");
    await ctx.db.patch(business._id, {
      giftCardProductId: args.productId,
    });
  },
});

export const createGiftCard = internalMutation({
  args: {
    amount: v.number(),
    deliveryMethod: deliveryMethodValidator,
    source: sourceValidator,
    paymentMethod: paymentMethodValidator,
    purchaserUserId: v.optional(v.id("users")),
    purchaserName: v.string(),
    purchaserEmail: v.optional(v.string()),
    recipientName: v.optional(v.string()),
    recipientEmail: v.optional(v.string()),
    message: v.optional(v.string()),
    pin: v.optional(v.string()),
    createdByUserId: v.optional(v.id("users")),
    notes: v.optional(v.string()),
  },
  returns: v.object({
    _id: v.id("giftCards"),
    code: v.string(),
    accessToken: v.string(),
    claimToken: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    if (!isValidGiftCardAmount(args.amount)) {
      throw new ConvexError({ message: "Invalid gift card amount." });
    }

    const now = Date.now();
    const code = generateGiftCardCode();
    const accessToken = randomToken();
    const recipientEmail =
      args.deliveryMethod === "self"
        ? args.purchaserEmail
        : args.recipientEmail;
    const recipientName =
      args.deliveryMethod === "self"
        ? args.recipientName ?? args.purchaserName
        : args.recipientName;
    const claimToken =
      args.deliveryMethod === "email" ? randomToken() : undefined;
    const status =
      args.paymentMethod === "stripe" ? "pending_payment" : "active";

    let claimedByUserId = args.purchaserUserId;
    let claimedAt = args.purchaserUserId ? now : undefined;
    if (recipientEmail) {
      const matchingUser = await ctx.db
        .query("users")
        .withIndex("by_email", (q) => q.eq("email", recipientEmail))
        .first();
      if (matchingUser) {
        claimedByUserId = matchingUser._id;
        claimedAt = now;
      }
    }

    const giftCardId = await ctx.db.insert("giftCards", {
      code,
      codeNormalized: normalizeGiftCardCode(code),
      codeLast4: normalizeGiftCardCode(code).slice(-4),
      pin: args.pin?.trim() || undefined,
      status,
      amount: args.amount,
      balance: status === "active" ? args.amount : 0,
      reservedBalance: 0,
      currency: GIFT_CARD_CURRENCY,
      deliveryMethod: args.deliveryMethod,
      source: args.source,
      paymentMethod: args.paymentMethod,
      purchaserUserId: args.purchaserUserId,
      purchaserName: args.purchaserName,
      purchaserEmail: args.purchaserEmail,
      recipientName,
      recipientEmail,
      message: args.message,
      claimedByUserId,
      claimedAt,
      claimToken,
      claimTokenExpiresAt: claimToken ? now + GIFT_CARD_CLAIM_TTL_MS : undefined,
      accessToken,
      issuedAt: status === "active" ? now : undefined,
      createdByUserId: args.createdByUserId,
      notes: args.notes,
      createdAt: now,
      updatedAt: now,
    });

    if (status === "active") {
      await ctx.db.insert("giftCardTransactions", {
        giftCardId,
        type: "issue",
        amount: args.amount,
        balanceBefore: 0,
        balanceAfter: args.amount,
        orderType: "admin",
        userId: claimedByUserId,
        actorUserId: args.createdByUserId,
        note:
          args.source === "admin_credit"
            ? "Admin-issued credit"
            : args.paymentMethod === "cash"
              ? "Cash sale"
              : args.paymentMethod === "comp"
                ? "Complimentary card"
                : "Gift card issued",
        createdAt: now,
      });
    }

    return { _id: giftCardId, code, accessToken, claimToken };
  },
});

export const attachCheckoutSession = internalMutation({
  args: {
    giftCardId: v.id("giftCards"),
    stripeCheckoutSessionId: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.giftCardId, {
      stripeCheckoutSessionId: args.stripeCheckoutSessionId,
      updatedAt: Date.now(),
    });
  },
});

export const voidPendingGiftCard = internalMutation({
  args: {
    giftCardId: v.id("giftCards"),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const card = await ctx.db.get(args.giftCardId);
    if (!card || card.status !== "pending_payment") return;
    await ctx.db.patch(args.giftCardId, {
      status: "voided",
      voidedAt: Date.now(),
      voidReason: args.reason,
      updatedAt: Date.now(),
    });
  },
});

export const activateFromCheckout = internalMutation({
  args: {
    stripeCheckoutSessionId: v.string(),
    stripePaymentIntentId: v.optional(v.string()),
    stripeCustomerId: v.optional(v.string()),
  },
  returns: v.union(v.null(), v.id("giftCards")),
  handler: async (ctx, args) => {
    const card = await ctx.db
      .query("giftCards")
      .withIndex("by_stripe_checkout_session", (q) =>
        q.eq("stripeCheckoutSessionId", args.stripeCheckoutSessionId),
      )
      .first();
    if (!card) return null;
    if (card.status === "active" || card.status === "depleted") {
      return card._id;
    }
    if (card.status === "voided") return null;

    const now = Date.now();
    await ctx.db.patch(card._id, {
      status: "active",
      balance: card.amount,
      reservedBalance: 0,
      issuedAt: now,
      stripePaymentIntentId: args.stripePaymentIntentId,
      stripeCustomerId: args.stripeCustomerId,
      updatedAt: now,
    });
    await ctx.db.insert("giftCardTransactions", {
      giftCardId: card._id,
      type: "issue",
      amount: card.amount,
      balanceBefore: 0,
      balanceAfter: card.amount,
      orderType: "admin",
      userId: card.claimedByUserId,
      stripeCheckoutSessionId: args.stripeCheckoutSessionId,
      stripePaymentIntentId: args.stripePaymentIntentId,
      note: "Gift card purchased",
      createdAt: now,
    });

    await ctx.scheduler.runAfter(
      0,
      internal.giftCards.sendDeliveryEmails,
      { giftCardId: card._id },
    );
    return card._id;
  },
});

export const markCheckoutExpired = internalMutation({
  args: { stripeCheckoutSessionId: v.string() },
  handler: async (ctx, args) => {
    const card = await ctx.db
      .query("giftCards")
      .withIndex("by_stripe_checkout_session", (q) =>
        q.eq("stripeCheckoutSessionId", args.stripeCheckoutSessionId),
      )
      .first();
    if (!card || card.status !== "pending_payment") return;
    await ctx.db.patch(card._id, {
      status: "voided",
      voidedAt: Date.now(),
      voidReason: "Checkout expired",
      updatedAt: Date.now(),
    });
  },
});

export const handlePurchaseRefund = internalMutation({
  args: {
    stripePaymentIntentId: v.string(),
    refundAmount: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const card = await ctx.db
      .query("giftCards")
      .withIndex("by_stripe_payment_intent", (q) =>
        q.eq("stripePaymentIntentId", args.stripePaymentIntentId),
      )
      .first();
    if (!card) return;

    const redemptions = await ctx.db
      .query("giftCardTransactions")
      .withIndex("by_gift_card", (q) => q.eq("giftCardId", card._id))
      .collect();
    const hasRedeemed = redemptions.some((tx) => tx.type === "redeem");

    if (!hasRedeemed && card.balance === card.amount) {
      await ctx.db.patch(card._id, {
        status: "voided",
        balance: 0,
        reservedBalance: 0,
        refundedAt: Date.now(),
        refundAmount: args.refundAmount,
        voidReason: "Purchase refunded",
        updatedAt: Date.now(),
      });
      await ctx.db.insert("giftCardTransactions", {
        giftCardId: card._id,
        type: "refund",
        amount: -card.amount,
        balanceBefore: card.balance,
        balanceAfter: 0,
        note: "Purchase refunded before redemption",
        createdAt: Date.now(),
      });
      return;
    }

    await ctx.db.patch(card._id, {
      refundedAt: Date.now(),
      refundAmount: args.refundAmount,
      notes: [card.notes, "Purchase refunded after partial use — review manually."]
        .filter(Boolean)
        .join("\n"),
      updatedAt: Date.now(),
    });
  },
});

export const getByAccessToken = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const card = await ctx.db
      .query("giftCards")
      .withIndex("by_access_token", (q) => q.eq("accessToken", args.token))
      .first();
    if (!card) return null;
    return serializePublicCard(ctx, card, true);
  },
});

export const getByClaimToken = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const card = await ctx.db
      .query("giftCards")
      .withIndex("by_claim_token", (q) => q.eq("claimToken", args.token))
      .first();
    if (!card) return null;
    const expired =
      Boolean(card.claimTokenExpiresAt) &&
      (card.claimTokenExpiresAt ?? 0) < Date.now();
    const currentUserId = await getUserIdFromIdentity(ctx);
    return {
      _id: card._id,
      status: card.status,
      amount: card.amount,
      balance: getAvailableGiftCardBalance(card),
      purchaserName: card.purchaserName,
      recipientName: card.recipientName,
      recipientEmailMasked: maskEmail(card.recipientEmail),
      message: card.message,
      pinRequired: Boolean(card.pin),
      claimed: Boolean(card.claimedByUserId),
      claimedByCurrentUser: Boolean(
        currentUserId && card.claimedByUserId === currentUserId,
      ),
      canClaim:
        card.status === "active" &&
        !card.claimedByUserId &&
        !expired &&
        card.balance > 0,
      claimExpired: expired,
    };
  },
});

async function serializePublicCard(
  ctx: any,
  card: Doc<"giftCards">,
  includeCode: boolean,
) {
  const claimedUser = card.claimedByUserId
    ? await ctx.db.get(card.claimedByUserId)
    : null;
  return {
    _id: card._id,
    status: card.status,
    amount: card.amount,
    balance: card.balance,
    availableBalance: getAvailableGiftCardBalance(card),
    reservedBalance: card.reservedBalance,
    currency: card.currency,
    deliveryMethod: card.deliveryMethod,
    purchaserName: card.purchaserName,
    purchaserEmailMasked: maskEmail(card.purchaserEmail),
    recipientName: card.recipientName,
    recipientEmailMasked: maskEmail(card.recipientEmail),
    message: card.message,
    code:
      includeCode &&
      (card.status === "active" || card.status === "depleted")
        ? formatGiftCardCodeForDisplay(card.code)
        : null,
    codeLast4: card.codeLast4,
    pinRequired: Boolean(card.pin),
    pin: includeCode ? card.pin : undefined,
    claimed: Boolean(card.claimedByUserId),
    claimedByName: claimedUser?.name ?? claimedUser?.email ?? null,
    claimedAt: card.claimedAt,
    issuedAt: card.issuedAt,
    createdAt: card.createdAt,
    accessToken: card.accessToken,
  };
}

export const claimByToken = mutation({
  args: { token: v.string() },
  returns: v.id("giftCards"),
  handler: async (ctx, args) => {
    const userId = await getUserIdFromIdentity(ctx);
    if (!userId) throw new ConvexError({ message: "Sign in to claim this gift card." });
    const user = await ctx.db.get(userId);
    if (!user) throw new ConvexError({ message: "User not found." });

    const card = await ctx.db
      .query("giftCards")
      .withIndex("by_claim_token", (q) => q.eq("claimToken", args.token))
      .first();
    if (!card) throw new ConvexError({ message: "This claim link is invalid." });
    if (card.status !== "active") {
      throw new ConvexError({ message: "This gift card is not active." });
    }
    if (card.claimedByUserId && card.claimedByUserId !== userId) {
      throw new ConvexError({ message: "This gift card has already been claimed." });
    }
    if (card.claimTokenExpiresAt && card.claimTokenExpiresAt < Date.now()) {
      throw new ConvexError({
        message: "This claim link has expired. Ask the sender to resend it.",
      });
    }
    if (
      card.recipientEmail &&
      normalizeGiftCardEmail(card.recipientEmail) !==
        normalizeGiftCardEmail(user.email)
    ) {
      throw new ConvexError({
        message:
          "This gift card was sent to a different email. Sign in with that email or ask the sender to reassign it.",
      });
    }

    await ctx.db.patch(card._id, {
      claimedByUserId: userId,
      claimedAt: Date.now(),
      claimToken: undefined,
      claimTokenExpiresAt: undefined,
      updatedAt: Date.now(),
    });
    return card._id;
  },
});

export const claimByCode = mutation({
  args: {
    code: v.string(),
    pin: v.optional(v.string()),
  },
  returns: v.id("giftCards"),
  handler: async (ctx, args) => {
    const userId = await getUserIdFromIdentity(ctx);
    if (!userId) throw new ConvexError({ message: "Sign in to claim this gift card." });
    const user = await ctx.db.get(userId);
    if (!user) throw new ConvexError({ message: "User not found." });

    const card = await findGiftCardByCode(ctx, args.code);
    if (!card) throw new ConvexError({ message: "Gift card code not found." });
    if (card.status !== "active") {
      throw new ConvexError({ message: "This gift card is not active." });
    }
    if (card.claimedByUserId && card.claimedByUserId !== userId) {
      throw new ConvexError({ message: "This gift card has already been claimed." });
    }
    if (
      card.recipientEmail &&
      normalizeGiftCardEmail(card.recipientEmail) !==
        normalizeGiftCardEmail(user.email)
    ) {
      throw new ConvexError({
        message:
          "This gift card was sent to a different email. Sign in with that email or ask the sender to reassign it.",
      });
    }
    if (card.pin) {
      if (!args.pin || args.pin.trim() !== card.pin) {
        throw new ConvexError({ message: "That PIN is incorrect." });
      }
    }

    await ctx.db.patch(card._id, {
      claimedByUserId: userId,
      claimedAt: Date.now(),
      claimToken: undefined,
      claimTokenExpiresAt: undefined,
      updatedAt: Date.now(),
    });
    return card._id;
  },
});

export const claimPendingForCurrentUser = mutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const userId = await getUserIdFromIdentity(ctx);
    if (!userId) return 0;
    const user = await ctx.db.get(userId);
    if (!user?.email) return 0;
    const email = normalizeGiftCardEmail(user.email);
    const now = Date.now();

    const byRecipient = await ctx.db
      .query("giftCards")
      .withIndex("by_recipient_email", (q) => q.eq("recipientEmail", email))
      .collect();
    const byPurchaser = await ctx.db
      .query("giftCards")
      .withIndex("by_purchaser_email", (q) => q.eq("purchaserEmail", email))
      .collect();

    let claimed = 0;
    const seen = new Set<Id<"giftCards">>();
    for (const card of [...byRecipient, ...byPurchaser]) {
      if (seen.has(card._id)) continue;
      seen.add(card._id);
      if (
        card.status !== "active" ||
        card.claimedByUserId ||
        (card.deliveryMethod !== "self" && card.deliveryMethod !== "email")
      ) {
        continue;
      }
      if (
        card.deliveryMethod === "email" &&
        normalizeGiftCardEmail(card.recipientEmail) !== email
      ) {
        continue;
      }
      await ctx.db.patch(card._id, {
        claimedByUserId: userId,
        claimedAt: now,
        claimToken: undefined,
        claimTokenExpiresAt: undefined,
        updatedAt: now,
      });
      claimed += 1;
    }
    return claimed;
  },
});

export const getMyGiftCards = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getUserIdFromIdentity(ctx);
    if (!userId) return { owned: [], purchased: [] };
    const user = await ctx.db.get(userId);
    const email = normalizeGiftCardEmail(user?.email);

    const owned = await ctx.db
      .query("giftCards")
      .withIndex("by_claimed_by_user", (q) => q.eq("claimedByUserId", userId))
      .collect();

    const byPurchaserUser = await ctx.db
      .query("giftCards")
      .withIndex("by_purchaser_user", (q) => q.eq("purchaserUserId", userId))
      .collect();
    const byPurchaserEmail = email
      ? await ctx.db
          .query("giftCards")
          .withIndex("by_purchaser_email", (q) => q.eq("purchaserEmail", email))
          .collect()
      : [];

    const ownedIds = new Set(owned.map((card) => card._id));
    const purchasedMap = new Map<Id<"giftCards">, Doc<"giftCards">>();
    for (const card of [...byPurchaserUser, ...byPurchaserEmail]) {
      if (!ownedIds.has(card._id)) purchasedMap.set(card._id, card);
    }

    const serialize = (card: Doc<"giftCards">) => ({
      _id: card._id,
      status: card.status,
      amount: card.amount,
      balance: card.balance,
      availableBalance: getAvailableGiftCardBalance(card),
      codeLast4: card.codeLast4,
      pinRequired: Boolean(card.pin),
      deliveryMethod: card.deliveryMethod,
      purchaserName: card.purchaserName,
      recipientName: card.recipientName,
      recipientEmailMasked: maskEmail(card.recipientEmail),
      message: card.message,
      claimed: Boolean(card.claimedByUserId),
      claimedAt: card.claimedAt,
      issuedAt: card.issuedAt,
      createdAt: card.createdAt,
      accessToken: card.accessToken,
    });

    return {
      owned: owned
        .sort((a, b) => b.createdAt - a.createdAt)
        .map(serialize),
      purchased: [...purchasedMap.values()]
        .sort((a, b) => b.createdAt - a.createdAt)
        .map(serialize),
    };
  },
});

export const getMyGiftCardTransactions = query({
  args: { giftCardId: v.id("giftCards") },
  handler: async (ctx, args) => {
    const userId = await getUserIdFromIdentity(ctx);
    if (!userId) return [];
    const user = await ctx.db.get(userId);
    const card = await ctx.db.get(args.giftCardId);
    if (!card) return [];
    const isOwner = card.claimedByUserId === userId;
    const isPurchaser =
      card.purchaserUserId === userId ||
      (Boolean(user?.email) &&
        normalizeGiftCardEmail(card.purchaserEmail) ===
          normalizeGiftCardEmail(user?.email));
    if (!isOwner && !isPurchaser) return [];

    return await ctx.db
      .query("giftCardTransactions")
      .withIndex("by_gift_card", (q) => q.eq("giftCardId", args.giftCardId))
      .collect()
      .then((rows) => rows.sort((a, b) => b.createdAt - a.createdAt));
  },
});

export const revealGiftCardCode = query({
  args: { giftCardId: v.id("giftCards") },
  returns: v.union(v.null(), v.string()),
  handler: async (ctx, args) => {
    const userId = await getUserIdFromIdentity(ctx);
    if (!userId) return null;
    const user = await ctx.db.get(userId);
    const card = await ctx.db.get(args.giftCardId);
    if (!card) return null;
    const isOwner = card.claimedByUserId === userId;
    const isPurchaser =
      card.purchaserUserId === userId ||
      (Boolean(user?.email) &&
        normalizeGiftCardEmail(card.purchaserEmail) ===
          normalizeGiftCardEmail(user?.email));
    if (!isOwner && !isPurchaser) return null;
    return formatGiftCardCodeForDisplay(card.code);
  },
});

export const validateForBooking = action({
  args: {
    code: v.string(),
    pin: v.optional(v.string()),
    orderAmount: v.optional(v.number()),
  },
  returns: v.object({
    giftCardId: v.id("giftCards"),
    codeLast4: v.string(),
    balance: v.number(),
    appliedAmount: v.number(),
    requiresPin: v.boolean(),
    claimedByCurrentUser: v.boolean(),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{
    giftCardId: Id<"giftCards">;
    codeLast4: string;
    balance: number;
    appliedAmount: number;
    requiresPin: boolean;
    claimedByCurrentUser: boolean;
  }> => {
    const card: Doc<"giftCards"> | null = await ctx.runQuery(
      internal.giftCards.getByCodeInternal,
      {
        code: args.code,
      },
    );
    if (!card) {
      throw new ConvexError({ message: "Gift card code not found." });
    }
    if (card.status !== "active") {
      throw new ConvexError({ message: "This gift card is not active." });
    }
    const available = getAvailableGiftCardBalance(card);
    if (available <= 0) {
      throw new ConvexError({ message: "This gift card has no balance left." });
    }

    const currentUser = await getCurrentUser(ctx);
    const claimedByCurrentUser = Boolean(
      currentUser && card.claimedByUserId === currentUser._id,
    );
    if (card.claimedByUserId && !claimedByCurrentUser) {
      throw new ConvexError({
        message: "This gift card is linked to a different account.",
      });
    }
    if (card.pin && !claimedByCurrentUser) {
      if (!args.pin || args.pin.trim() !== card.pin) {
        throw new ConvexError({ message: "That PIN is incorrect." });
      }
    }

    const appliedAmount = roundCurrency(
      Math.min(available, args.orderAmount ?? available),
    );
    return {
      giftCardId: card._id,
      codeLast4: card.codeLast4,
      balance: available,
      appliedAmount,
      requiresPin: Boolean(card.pin && !claimedByCurrentUser),
      claimedByCurrentUser,
    };
  },
});

export const validateForAdmin = internalAction({
  args: {
    code: v.string(),
    pin: v.optional(v.string()),
  },
  returns: v.object({
    giftCardId: v.id("giftCards"),
    codeLast4: v.string(),
    availableBalance: v.number(),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{
    giftCardId: Id<"giftCards">;
    codeLast4: string;
    availableBalance: number;
  }> => {
    const card: Doc<"giftCards"> | null = await ctx.runQuery(
      internal.giftCards.getByCodeInternal,
      {
        code: args.code,
      },
    );
    if (!card) throw new ConvexError({ message: "Gift card code not found." });
    if (card.status !== "active") {
      throw new ConvexError({ message: "This gift card is not active." });
    }
    const availableBalance = getAvailableGiftCardBalance(card);
    if (availableBalance <= 0) {
      throw new ConvexError({ message: "This gift card has no balance left." });
    }
    if (card.pin && (!args.pin || args.pin.trim() !== card.pin)) {
      throw new ConvexError({ message: "That PIN is incorrect." });
    }
    return {
      giftCardId: card._id,
      codeLast4: card.codeLast4,
      availableBalance,
    };
  },
});

export const getByCodeInternal = internalQuery({
  args: { code: v.string() },
  returns: v.union(v.null(), v.any()),
  handler: async (ctx, args) => {
    return await findGiftCardByCode(ctx, args.code);
  },
});

async function findGiftCardByCode(ctx: any, rawCode: string) {
  const normalized = normalizeGiftCardCode(rawCode);
  if (!normalized) return null;
  return await ctx.db
    .query("giftCards")
    .withIndex("by_code_normalized", (q: any) =>
      q.eq("codeNormalized", normalized),
    )
    .first();
}

export const getByIdInternal = internalQuery({
  args: { giftCardId: v.id("giftCards") },
  returns: v.union(v.null(), v.any()),
  handler: async (ctx, args) => await ctx.db.get(args.giftCardId),
});

export const reserveForOrder = internalMutation({
  args: {
    giftCardId: v.id("giftCards"),
    amount: v.number(),
    orderType: orderTypeValidator,
    orderId: v.string(),
    expiresAt: v.optional(v.number()),
    stripeCheckoutSessionId: v.optional(v.string()),
    stripeCouponId: v.optional(v.string()),
  },
  returns: v.id("giftCardRedemptions"),
  handler: async (ctx, args) => {
    const card = await ctx.db.get(args.giftCardId);
    if (!card) throw new Error("Gift card not found");
    if (card.status !== "active") throw new Error("Gift card is not active");
    const amount = roundCurrency(args.amount);
    if (amount <= 0) throw new Error("Gift card amount must be positive");
    const available = getAvailableGiftCardBalance(card);
    if (amount > available) {
      throw new Error("Gift card does not have enough available balance");
    }

    const now = Date.now();
    await ctx.db.patch(card._id, {
      reservedBalance: roundCurrency(card.reservedBalance + amount),
      updatedAt: now,
    });
    return await ctx.db.insert("giftCardRedemptions", {
      giftCardId: card._id,
      amount,
      status: "pending",
      orderType: args.orderType,
      orderId: args.orderId,
      stripeCheckoutSessionId: args.stripeCheckoutSessionId,
      stripeCouponId: args.stripeCouponId,
      createdAt: now,
      updatedAt: now,
      expiresAt: args.expiresAt ?? now + GIFT_CARD_REDEMPTION_TTL_MS,
    });
  },
});

export const attachCouponToReservation = internalMutation({
  args: {
    reservationId: v.id("giftCardRedemptions"),
    stripeCouponId: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.reservationId, {
      stripeCouponId: args.stripeCouponId,
      updatedAt: Date.now(),
    });
  },
});

export const attachSessionToReservation = internalMutation({
  args: {
    reservationId: v.id("giftCardRedemptions"),
    stripeCheckoutSessionId: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.reservationId, {
      stripeCheckoutSessionId: args.stripeCheckoutSessionId,
      updatedAt: Date.now(),
    });
  },
});

export const captureReservation = internalMutation({
  args: {
    reservationId: v.id("giftCardRedemptions"),
    note: v.optional(v.string()),
  },
  returns: v.object({
    giftCardId: v.id("giftCards"),
    amount: v.number(),
  }),
  handler: async (ctx, args) => {
    const reservation = await ctx.db.get(args.reservationId);
    if (!reservation) throw new Error("Gift card reservation not found");
    if (reservation.status === "captured") {
      return {
        giftCardId: reservation.giftCardId,
        amount: reservation.amount,
      };
    }
    if (reservation.status === "released") {
      throw new Error("Gift card reservation was released");
    }

    const card = await ctx.db.get(reservation.giftCardId);
    if (!card) throw new Error("Gift card not found");
    if (card.balance < reservation.amount) {
      throw new Error("Gift card balance is insufficient");
    }

    const now = Date.now();
    const balanceBefore = card.balance;
    const balanceAfter = roundCurrency(card.balance - reservation.amount);
    const reservedAfter = Math.max(
      0,
      roundCurrency(card.reservedBalance - reservation.amount),
    );
    await ctx.db.patch(card._id, {
      balance: balanceAfter,
      reservedBalance: reservedAfter,
      status: balanceAfter <= 0 ? "depleted" : "active",
      updatedAt: now,
    });
    await ctx.db.patch(reservation._id, {
      status: "captured",
      updatedAt: now,
    });
    await ctx.db.insert("giftCardTransactions", {
      giftCardId: card._id,
      type: "redeem",
      amount: -reservation.amount,
      balanceBefore,
      balanceAfter,
      orderType: reservation.orderType,
      orderId: reservation.orderId,
      userId: card.claimedByUserId,
      note: args.note ?? "Gift card redeemed",
      stripeCouponId: reservation.stripeCouponId,
      stripeCheckoutSessionId: reservation.stripeCheckoutSessionId,
      createdAt: now,
    });
    return { giftCardId: card._id, amount: reservation.amount };
  },
});

export const captureReservationToInvoice = internalMutation({
  args: {
    reservationId: v.id("giftCardRedemptions"),
    invoiceId: v.id("invoices"),
    note: v.optional(v.string()),
  },
  returns: v.object({
    remainingBalance: v.number(),
    status: v.string(),
  }),
  handler: async (ctx, args) => {
    const reservation = await ctx.db.get(args.reservationId);
    if (!reservation || reservation.status !== "pending") {
      throw new Error("Gift card reservation is not pending");
    }
    const card = await ctx.db.get(reservation.giftCardId);
    if (!card) throw new Error("Gift card not found");
    const invoice = await ctx.db.get(args.invoiceId);
    if (!invoice) throw new Error("Invoice not found");
    if (invoice.status === "paid" && (invoice.remainingBalance ?? 0) <= 0) {
      throw new Error("Fully paid invoices cannot be modified");
    }

    const amountDue = invoice.remainingBalance ?? invoice.total;
    if (reservation.amount > amountDue) {
      throw new Error("Gift card reservation exceeds the invoice balance");
    }
    if (card.balance < reservation.amount) {
      throw new Error("Gift card balance is insufficient");
    }

    const now = Date.now();
    const balanceBefore = card.balance;
    const balanceAfter =
      Math.round((card.balance - reservation.amount) * 100) / 100;
    await ctx.db.patch(card._id, {
      balance: balanceAfter,
      reservedBalance: Math.max(
        0,
        Math.round((card.reservedBalance - reservation.amount) * 100) / 100,
      ),
      status: balanceAfter <= 0 ? "depleted" : "active",
      updatedAt: now,
    });
    await ctx.db.patch(reservation._id, {
      status: "captured",
      updatedAt: now,
    });

    const remainingBalance = Math.max(
      0,
      Math.round((amountDue - reservation.amount) * 100) / 100,
    );
    const status = remainingBalance <= 0 ? "paid" : invoice.status;
    await ctx.db.patch(invoice._id, {
      giftCardApplied:
        Math.round(
          ((invoice.giftCardApplied ?? 0) + reservation.amount) * 100,
        ) / 100,
      giftCardIds: [...(invoice.giftCardIds ?? []), card._id],
      remainingBalance,
      status,
      paidDate:
        remainingBalance <= 0
          ? new Date().toISOString().split("T")[0]
          : invoice.paidDate,
      stripeInvoiceId: undefined,
      stripeInvoiceUrl: undefined,
      finalPaymentIntentId: undefined,
    });

    await ctx.db.insert("giftCardTransactions", {
      giftCardId: card._id,
      type: "redeem",
      amount: -reservation.amount,
      balanceBefore,
      balanceAfter,
      orderType: "invoice",
      orderId: String(invoice._id),
      userId: card.claimedByUserId,
      note: args.note ?? "Gift card applied to invoice",
      stripeCouponId: reservation.stripeCouponId,
      stripeCheckoutSessionId: reservation.stripeCheckoutSessionId,
      createdAt: now,
    });

    return { remainingBalance, status };
  },
});

export const releaseReservation = internalMutation({
  args: {
    reservationId: v.id("giftCardRedemptions"),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const reservation = await ctx.db.get(args.reservationId);
    if (!reservation || reservation.status !== "pending") return;
    const card = await ctx.db.get(reservation.giftCardId);
    if (!card) return;
    const now = Date.now();
    await ctx.db.patch(card._id, {
      reservedBalance: Math.max(
        0,
        roundCurrency(card.reservedBalance - reservation.amount),
      ),
      updatedAt: now,
    });
    await ctx.db.patch(reservation._id, {
      status: "released",
      updatedAt: now,
    });
    await ctx.db.insert("giftCardTransactions", {
      giftCardId: card._id,
      type: "release",
      amount: reservation.amount,
      balanceBefore: card.balance,
      balanceAfter: card.balance,
      orderType: reservation.orderType,
      orderId: reservation.orderId,
      note: args.reason ?? "Gift card reservation released",
      createdAt: now,
    });
  },
});

export const getReservationInternal = internalQuery({
  args: { reservationId: v.id("giftCardRedemptions") },
  returns: v.union(v.null(), v.any()),
  handler: async (ctx, args) => await ctx.db.get(args.reservationId),
});

export const sendDeliveryEmails = internalAction({
  args: { giftCardId: v.id("giftCards") },
  handler: async (ctx, args) => {
    const card = await ctx.runQuery(internal.giftCards.getByIdInternal, {
      giftCardId: args.giftCardId,
    });
    if (!card || card.status !== "active") return;

    if (
      card.deliveryMethod === "email" &&
      card.recipientEmail &&
      !card.deliveryEmailSentAt
    ) {
      try {
        await ctx.runAction(internal.emails.sendGiftCardRecipientEmail, {
          giftCardId: args.giftCardId,
        });
        await ctx.runMutation(internal.giftCards.markEmailSent, {
          giftCardId: args.giftCardId,
          kind: "delivery",
        });
      } catch (error) {
        console.error("[giftCards] recipient email failed", error);
      }
    }

    if (card.purchaserEmail && !card.receiptEmailSentAt) {
      try {
        await ctx.runAction(internal.emails.sendGiftCardReceiptEmail, {
          giftCardId: args.giftCardId,
        });
        await ctx.runMutation(internal.giftCards.markEmailSent, {
          giftCardId: args.giftCardId,
          kind: "receipt",
        });
      } catch (error) {
        console.error("[giftCards] receipt email failed", error);
      }
    }

    try {
      await ctx.runAction(internal.emails.sendGiftCardAdminNotification, {
        giftCardId: args.giftCardId,
      });
    } catch (error) {
      console.error("[giftCards] admin notification failed", error);
    }
  },
});

export const markEmailSent = internalMutation({
  args: {
    giftCardId: v.id("giftCards"),
    kind: v.union(v.literal("delivery"), v.literal("receipt")),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    await ctx.db.patch(
      args.giftCardId,
      args.kind === "delivery"
        ? { deliveryEmailSentAt: now, lastSentAt: now, updatedAt: now }
        : { receiptEmailSentAt: now, lastSentAt: now, updatedAt: now },
    );
  },
});

export const resendGiftCardEmail = action({
  args: {
    giftCardId: v.id("giftCards"),
    audience: v.union(v.literal("recipient"), v.literal("purchaser")),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const card = await ctx.runQuery(internal.giftCards.getByIdInternal, {
      giftCardId: args.giftCardId,
    });
    if (!card) throw new Error("Gift card not found");
    if (args.audience === "recipient") {
      if (!card.recipientEmail) {
        throw new Error("This gift card has no recipient email.");
      }
      await ctx.runAction(internal.emails.sendGiftCardRecipientEmail, {
        giftCardId: args.giftCardId,
      });
      await ctx.runMutation(internal.giftCards.markEmailSent, {
        giftCardId: args.giftCardId,
        kind: "delivery",
      });
    } else {
      if (!card.purchaserEmail) {
        throw new Error("This gift card has no purchaser email.");
      }
      await ctx.runAction(internal.emails.sendGiftCardReceiptEmail, {
        giftCardId: args.giftCardId,
      });
      await ctx.runMutation(internal.giftCards.markEmailSent, {
        giftCardId: args.giftCardId,
        kind: "receipt",
      });
    }
    return true;
  },
});

export const listAdmin = query({
  args: {
    status: v.optional(v.string()),
    search: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const cards = await ctx.db.query("giftCards").collect();
    const search = args.search?.trim().toLowerCase();
    const filtered = cards.filter((card) => {
      if (args.status && args.status !== "all" && card.status !== args.status) {
        return false;
      }
      if (!search) return true;
      return [
        card.code,
        card.codeLast4,
        card.purchaserName,
        card.purchaserEmail,
        card.recipientName,
        card.recipientEmail,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(search));
    });

    return await Promise.all(
      filtered
        .sort((a, b) => b.createdAt - a.createdAt)
        .map(async (card) => {
          const claimedUser = card.claimedByUserId
            ? await ctx.db.get(card.claimedByUserId)
            : null;
          return {
            ...card,
            code: undefined,
            accessToken: undefined,
            claimToken: undefined,
            pin: undefined,
            availableBalance: getAvailableGiftCardBalance(card),
            claimedByName: claimedUser?.name ?? claimedUser?.email ?? null,
          };
        }),
    );
  },
});

export const getAdminStats = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const cards = await ctx.db.query("giftCards").collect();
    const now = new Date();
    const monthStart = new Date(
      now.getFullYear(),
      now.getMonth(),
      1,
    ).getTime();

    const activeCards = cards.filter((card) => card.status === "active");
    const outstanding = activeCards.reduce(
      (sum, card) => sum + getAvailableGiftCardBalance(card),
      0,
    );
    const soldThisMonth = cards
      .filter(
        (card) =>
          card.createdAt >= monthStart &&
          card.status !== "pending_payment" &&
          card.status !== "voided" &&
          card.paymentMethod !== "comp",
      )
      .reduce((sum, card) => sum + card.amount, 0);

    const transactions = await ctx.db
      .query("giftCardTransactions")
      .collect();
    const redeemedThisMonth = transactions
      .filter((tx) => tx.type === "redeem" && tx.createdAt >= monthStart)
      .reduce((sum, tx) => sum + Math.abs(tx.amount), 0);

    return {
      outstanding: roundCurrency(outstanding),
      activeCount: activeCards.length,
      soldThisMonth: roundCurrency(soldThisMonth),
      redeemedThisMonth: roundCurrency(redeemedThisMonth),
      totalCards: cards.length,
    };
  },
});

export const getAdminDetail = query({
  args: { giftCardId: v.id("giftCards") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const card = await ctx.db.get(args.giftCardId);
    if (!card) return null;
    const transactions = await ctx.db
      .query("giftCardTransactions")
      .withIndex("by_gift_card", (q) => q.eq("giftCardId", args.giftCardId))
      .collect();
    const redemptions = await ctx.db
      .query("giftCardRedemptions")
      .withIndex("by_gift_card", (q) => q.eq("giftCardId", args.giftCardId))
      .collect();
    const claimedUser = card.claimedByUserId
      ? await ctx.db.get(card.claimedByUserId)
      : null;
    const purchaser = card.purchaserUserId
      ? await ctx.db.get(card.purchaserUserId)
      : null;
    return {
      ...card,
      code: formatGiftCardCodeForDisplay(card.code),
      availableBalance: getAvailableGiftCardBalance(card),
      claimedUser: claimedUser
        ? { _id: claimedUser._id, name: claimedUser.name, email: claimedUser.email }
        : null,
      purchaser: purchaser
        ? { _id: purchaser._id, name: purchaser.name, email: purchaser.email }
        : null,
      transactions: transactions.sort((a, b) => b.createdAt - a.createdAt),
      redemptions: redemptions.sort((a, b) => b.createdAt - a.createdAt),
    };
  },
});

export const createAdminSale = action({
  args: {
    amount: v.number(),
    deliveryMethod: deliveryMethodValidator,
    paymentMethod: paymentMethodValidator,
    purchaserName: v.string(),
    purchaserEmail: v.optional(v.string()),
    recipientName: v.optional(v.string()),
    recipientEmail: v.optional(v.string()),
    message: v.optional(v.string()),
    pin: v.optional(v.string()),
    notes: v.optional(v.string()),
    origin: v.string(),
  },
  returns: v.object({
    giftCardId: v.id("giftCards"),
    status: v.string(),
    url: v.optional(v.string()),
    code: v.optional(v.string()),
    accessToken: v.string(),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{
    giftCardId: Id<"giftCards">;
    status: string;
    url?: string;
    code?: string;
    accessToken: string;
  }> => {
    await requireAdmin(ctx);
    validatePurchaseInput({
      amount: args.amount,
      deliveryMethod: args.deliveryMethod,
      purchaserName: args.purchaserName,
      purchaserEmail: args.purchaserEmail,
      recipientEmail: args.recipientEmail,
      pin: args.pin,
    });
    const adminId = await getUserIdFromIdentity(ctx);

    const created: {
      _id: Id<"giftCards">;
      code: string;
      accessToken: string;
      claimToken?: string;
    } = await ctx.runMutation(internal.giftCards.createGiftCard, {
      amount: args.amount,
      deliveryMethod: args.deliveryMethod,
      source: "admin_sale",
      paymentMethod: args.paymentMethod,
      purchaserName: args.purchaserName.trim(),
      purchaserEmail: args.purchaserEmail
        ? normalizeGiftCardEmail(args.purchaserEmail)
        : undefined,
      recipientName: args.recipientName?.trim() || undefined,
      recipientEmail: args.recipientEmail
        ? normalizeGiftCardEmail(args.recipientEmail)
        : undefined,
      message: args.message?.trim() || undefined,
      pin: args.pin,
      createdByUserId: adminId ?? undefined,
      notes: args.notes?.trim() || undefined,
    });
    const card: Doc<"giftCards"> | null = await ctx.runQuery(
      internal.giftCards.getByIdInternal,
      { giftCardId: created._id },
    );
    if (!card) throw new Error("Could not create gift card");

    if (args.paymentMethod === "stripe") {
      try {
        const checkout = await createCheckoutSessionForGiftCard(
          ctx,
          card,
          args.origin,
        );
        return {
          giftCardId: card._id,
          status: "pending_payment",
          url: checkout.url,
          code: card.code,
          accessToken: card.accessToken,
        };
      } catch (error) {
        await ctx.runMutation(internal.giftCards.voidPendingGiftCard, {
          giftCardId: card._id,
          reason: "Could not start checkout",
        });
        throw error;
      }
    }

    await ctx.scheduler.runAfter(0, internal.giftCards.sendDeliveryEmails, {
      giftCardId: card._id,
    });
    return {
      giftCardId: card._id,
      status: "active",
      code: card.code,
      accessToken: card.accessToken,
    };
  },
});

export const markCashPaid = mutation({
  args: { giftCardId: v.id("giftCards") },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const card = await ctx.db.get(args.giftCardId);
    if (!card) throw new Error("Gift card not found");
    if (card.status !== "pending_payment") return null;
    const now = Date.now();
    await ctx.db.patch(card._id, {
      status: "active",
      balance: card.amount,
      issuedAt: now,
      paymentMethod: "cash",
      updatedAt: now,
    });
    await ctx.db.insert("giftCardTransactions", {
      giftCardId: card._id,
      type: "issue",
      amount: card.amount,
      balanceBefore: 0,
      balanceAfter: card.amount,
      orderType: "admin",
      note: "Cash sale",
      createdAt: now,
    });
    await ctx.scheduler.runAfter(0, internal.giftCards.sendDeliveryEmails, {
      giftCardId: card._id,
    });
    return null;
  },
});

export const voidGiftCard = mutation({
  args: {
    giftCardId: v.id("giftCards"),
    reason: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const adminId = await requireAdmin(ctx).then(() =>
      getUserIdFromIdentity(ctx),
    );
    const card = await ctx.db.get(args.giftCardId);
    if (!card) throw new Error("Gift card not found");
    if (card.status === "voided") return null;

    const now = Date.now();
    const pending = await ctx.db
      .query("giftCardRedemptions")
      .withIndex("by_gift_card", (q) => q.eq("giftCardId", card._id))
      .collect();
    for (const reservation of pending) {
      if (reservation.status === "pending") {
        await ctx.db.patch(reservation._id, {
          status: "released",
          updatedAt: now,
        });
      }
    }

    const balanceBefore = card.balance;
    await ctx.db.patch(card._id, {
      status: "voided",
      balance: 0,
      reservedBalance: 0,
      voidedAt: now,
      voidReason: args.reason,
      updatedAt: now,
    });
    await ctx.db.insert("giftCardTransactions", {
      giftCardId: card._id,
      type: "void",
      amount: -balanceBefore,
      balanceBefore,
      balanceAfter: 0,
      orderType: "admin",
      actorUserId: adminId ?? undefined,
      note: args.reason,
      createdAt: now,
    });
    return null;
  },
});

export const adjustGiftCardBalance = mutation({
  args: {
    giftCardId: v.id("giftCards"),
    amount: v.number(),
    note: v.string(),
  },
  returns: v.number(),
  handler: async (ctx, args) => {
    const adminId = await requireAdmin(ctx).then(() =>
      getUserIdFromIdentity(ctx),
    );
    const card = await ctx.db.get(args.giftCardId);
    if (!card) throw new Error("Gift card not found");
    if (card.status === "voided") throw new Error("Voided cards cannot be adjusted");
    const amount = roundCurrency(args.amount);
    if (amount === 0) return card.balance;
    const balanceAfter = roundCurrency(card.balance + amount);
    if (balanceAfter < 0) throw new Error("Adjustment exceeds the card balance");
    if (balanceAfter < card.reservedBalance) {
      throw new Error(
        "Adjustment would drop the balance below funds reserved for a pending checkout",
      );
    }

    const now = Date.now();
    await ctx.db.patch(card._id, {
      balance: balanceAfter,
      status: balanceAfter <= 0 ? "depleted" : "active",
      updatedAt: now,
    });
    await ctx.db.insert("giftCardTransactions", {
      giftCardId: card._id,
      type: "adjust",
      amount,
      balanceBefore: card.balance,
      balanceAfter,
      orderType: "admin",
      actorUserId: adminId ?? undefined,
      note: args.note,
      createdAt: now,
    });
    return balanceAfter;
  },
});

export const assignGiftCardToCustomer = mutation({
  args: {
    giftCardId: v.id("giftCards"),
    userId: v.id("users"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const card = await ctx.db.get(args.giftCardId);
    if (!card) throw new Error("Gift card not found");
    const user = await ctx.db.get(args.userId);
    if (!user) throw new Error("Customer not found");
    await ctx.db.patch(card._id, {
      claimedByUserId: user._id,
      claimedAt: Date.now(),
      recipientEmail: user.email
        ? normalizeGiftCardEmail(user.email)
        : card.recipientEmail,
      recipientName: user.name ?? card.recipientName,
      claimToken: undefined,
      claimTokenExpiresAt: undefined,
      updatedAt: Date.now(),
    });
    return null;
  },
});
