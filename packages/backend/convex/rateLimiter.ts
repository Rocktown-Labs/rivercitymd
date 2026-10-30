import { ConvexError } from "convex/values";
import { HOUR, MINUTE, RateLimiter } from "@convex-dev/rate-limiter";
import { components } from "./_generated/api";

export const rateLimiter = new RateLimiter(components.rateLimiter, {
  travelFeeGlobal: {
    kind: "token bucket",
    rate: 240,
    period: MINUTE,
    capacity: 120,
    shards: 8,
  },
  travelFeeByAddress: {
    kind: "token bucket",
    rate: 20,
    period: MINUTE,
    capacity: 10,
  },
  vehicleLookupGlobal: {
    kind: "token bucket",
    rate: 120,
    period: MINUTE,
    capacity: 60,
    shards: 6,
  },
  vehicleLookupByQuery: {
    kind: "token bucket",
    rate: 20,
    period: MINUTE,
    capacity: 10,
  },
  bookingDraftByEmail: {
    kind: "token bucket",
    rate: 8,
    period: HOUR,
    capacity: 4,
  },
  bookingCheckoutByDraft: {
    kind: "token bucket",
    rate: 8,
    period: MINUTE,
    capacity: 4,
  },
  bookingClaimByUser: {
    kind: "token bucket",
    rate: 10,
    period: HOUR,
    capacity: 5,
  },
  giftCardPurchaseByEmail: {
    kind: "token bucket",
    rate: 6,
    period: HOUR,
    capacity: 3,
  },
  giftCardPurchaseGlobal: {
    kind: "token bucket",
    rate: 30,
    period: HOUR,
    capacity: 10,
    shards: 4,
  },
  giftCardClaimByUser: {
    kind: "token bucket",
    rate: 10,
    period: HOUR,
    capacity: 5,
  },
  outOfAreaLeadByEmail: {
    kind: "token bucket",
    rate: 4,
    period: HOUR,
    capacity: 2,
  },
  outOfAreaRequestByContact: {
    kind: "token bucket",
    rate: 4,
    period: HOUR,
    capacity: 2,
  },
  beforePhotoUploadGlobal: {
    kind: "token bucket",
    rate: 120,
    period: MINUTE,
    capacity: 60,
    shards: 6,
  },
  reviewSubmitByAppointment: {
    kind: "token bucket",
    rate: 3,
    period: HOUR,
    capacity: 1,
  },
  userProfileByUser: {
    kind: "token bucket",
    rate: 10,
    period: HOUR,
    capacity: 3,
  },
  chatSendByUser: {
    kind: "token bucket",
    rate: 30,
    period: MINUTE,
    capacity: 10,
  },
});

export type RateLimitName = keyof NonNullable<typeof rateLimiter.limits>;

export function normalizeRateLimitKey(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 256);
}

export function contactRateLimitKey(args: {
  email?: string;
  phone?: string;
  fallback?: string;
}) {
  const email = args.email?.trim();
  if (email) return `email:${normalizeRateLimitKey(email)}`;
  const phone = args.phone?.replace(/\D/g, "");
  if (phone) return `phone:${phone.slice(-12)}`;
  return normalizeRateLimitKey(args.fallback || "anonymous");
}

export async function identityRateLimitKey(
  ctx: { auth: { getUserIdentity: () => Promise<{ subject?: string } | null> } },
  fallback: string,
) {
  const identity = await ctx.auth.getUserIdentity();
  return identity?.subject
    ? `user:${identity.subject}`
    : `anon:${normalizeRateLimitKey(fallback)}`;
}

export async function assertRateLimit(
  ctx: Parameters<typeof rateLimiter.limit>[0],
  name: RateLimitName,
  options?: {
    key?: string;
    count?: number;
    message?: string;
  },
) {
  const status = await rateLimiter.limit(ctx, name, {
    key: options?.key,
    count: options?.count,
  });

  if (!status.ok) {
    throw new ConvexError({
      code: "RATE_LIMITED",
      message:
        options?.message ||
        "Too many attempts. Please wait a moment and try again.",
      retryAfter: status.retryAfter,
      limit: name,
    });
  }
}
