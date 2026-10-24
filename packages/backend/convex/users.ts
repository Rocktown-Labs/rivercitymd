import {
  query,
  mutation,
  action,
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { ConvexError, v } from "convex/values";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { getUserIdFromIdentity, requireAdmin, isAdmin } from "./auth";
import { calculateSchedulingDuration, normalizeDateKey } from "./lib/booking";
import {
  getEffectivePetFeePrice,
  getEffectiveServicePrice,
  normalizeServiceType,
  type VehicleSize,
} from "./lib/pricing";
import {
  getInvoiceDueDateFromDateKey,
  REMAINING_BALANCE_DUE_DAYS,
} from "./lib/invoices";
import {
  DEFAULT_USER_NOTIFICATION_PREFERENCES,
  normalizeUserNotificationPreferences,
  userNotificationPreferencesValidator,
} from "./lib/notificationSettings";
import { assertRateLimit } from "./rateLimiter";

const STRIPE_CUSTOMER_SYNC_RETRY_DELAYS_MS = [
  0,
  60_000,
  300_000,
  1_800_000,
  7_200_000,
] as const;
const DEFAULT_STRIPE_BACKFILL_LIMIT = 200;
const MAX_STRIPE_BACKFILL_LIMIT = 1000;
const clerkAccountSyncResultValidator = v.object({
  clerkUserId: v.optional(v.string()),
  invited: v.boolean(),
  linked: v.boolean(),
});

type ClerkAccountSyncResult = {
  clerkUserId?: string;
  invited: boolean;
  linked: boolean;
};

function applyNotificationPreferenceUpdate(
  currentPreferences: Doc<"users">["notificationPreferences"] | undefined,
  nextPreferences:
    | Doc<"users">["notificationPreferences"]
    | ReturnType<typeof normalizeUserNotificationPreferences>
    | undefined,
  source: string,
) {
  const current = normalizeUserNotificationPreferences(currentPreferences);
  const next = normalizeUserNotificationPreferences(
    nextPreferences ?? currentPreferences,
  );
  const now = Date.now();

  if (next.smsNotifications) {
    return {
      ...next,
      operationalSmsConsent: {
        optedIn: true,
        optedInAt: current.operationalSmsConsent.optedInAt ?? now,
        optedOutAt: undefined,
        source,
      },
    };
  }

  return {
    ...next,
    smsNotifications: false,
    operationalSmsConsent: {
      optedIn: false,
      optedInAt: current.operationalSmsConsent.optedInAt,
      optedOutAt: current.operationalSmsConsent.optedIn
        ? now
        : current.operationalSmsConsent.optedOutAt,
      source,
    },
  };
}

function buildDefaultNotificationPreferences(
  source: string,
  smsOptIn = false,
  marketingEmails = false,
) {
  return applyNotificationPreferenceUpdate(
    undefined,
    {
      ...normalizeUserNotificationPreferences(
        DEFAULT_USER_NOTIFICATION_PREFERENCES,
      ),
      smsNotifications: smsOptIn,
      marketingEmails,
    },
    source,
  );
}

function resolvePreferredName(args: {
  onboardingName?: string;
  existingName?: string;
  identityName?: string;
  identityEmail?: string;
}): string {
  const onboardingName = args.onboardingName?.trim();
  if (onboardingName) return onboardingName;

  const existingName = args.existingName?.trim();
  if (existingName) return existingName;

  const identityName = args.identityName?.trim();
  if (identityName) return identityName;

  const identityEmail = args.identityEmail?.trim();
  if (identityEmail) return identityEmail;

  return "User";
}



function shouldScheduleStripeCustomerSync(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY?.trim());
}

function normalizeBackfillLimit(limit?: number): number {
  if (limit === undefined) {
    return DEFAULT_STRIPE_BACKFILL_LIMIT;
  }
  return Math.min(MAX_STRIPE_BACKFILL_LIMIT, Math.max(1, Math.floor(limit)));
}

async function syncClerkAccountForUserEmail(
  ctx: any,
  args: {
    userId: Id<"users">;
    email: string;
    inviteIfMissing: boolean;
  },
): Promise<ClerkAccountSyncResult> {
  const { createClerkClient } = await import("@clerk/backend");
  const clerkClient = createClerkClient({
    secretKey: process.env.CLERK_SECRET_KEY,
    publishableKey: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
  });

  const existingUsers = await clerkClient.users.getUserList({
    emailAddress: [args.email],
    limit: 1,
  });
  const existingClerkUser = Array.isArray((existingUsers as any).data)
    ? (existingUsers as any).data[0]
    : Array.isArray(existingUsers)
      ? (existingUsers as any)[0]
      : undefined;

  if (existingClerkUser?.id) {
    await ctx.runMutation(internal.users.linkClerkUserIdInternal, {
      userId: args.userId,
      clerkUserId: existingClerkUser.id,
    });
    return {
      clerkUserId: existingClerkUser.id,
      invited: false,
      linked: true,
    };
  }

  if (!args.inviteIfMissing) {
    return {
      invited: false,
      linked: false,
    };
  }

  const redirectUrl = `${
    process.env.NEXT_PUBLIC_APP_URL || process.env.CONVEX_SITE_URL
  }/dashboard`;
  await clerkClient.invitations.createInvitation({
    emailAddress: args.email,
    redirectUrl,
    publicMetadata: { convexUserId: args.userId, role: "client" },
    ignoreExisting: true,
  });

  return {
    invited: true,
    linked: false,
  };
}

async function assertBookingSetupReady(ctx: any) {
  const readiness = await ctx.runQuery(internal.setupReadiness.getBookingReadinessInternal, {});
  if (!readiness.isReady) {
    throw new ConvexError({
      code: "BOOKING_SETUP_INCOMPLETE",
      message:
        "Booking is temporarily unavailable while business settings are being completed.",
      blockers: readiness.blockers.map((blocker: any) => blocker.code),
    });
  }
}

function assertBookableServices(
  services: Array<Doc<"services">>,
  selectedServiceIds: Array<Id<"services">>,
  vehicleSize: VehicleSize,
) {
  if (selectedServiceIds.length === 0) {
    throw new ConvexError({
      code: "SERVICE_NOT_BOOKABLE",
      message: "Please select at least one service.",
    });
  }

  if (services.length !== selectedServiceIds.length) {
    throw new ConvexError({
      code: "SERVICE_NOT_BOOKABLE",
      message: "One or more selected services are unavailable.",
    });
  }

  for (const service of services) {
    if (!service.isActive) {
      throw new ConvexError({
        code: "SERVICE_NOT_BOOKABLE",
        message: `Service "${service.name}" is inactive.`,
      });
    }

    const serviceType = normalizeServiceType(service.serviceType);
    if (serviceType !== "standard" && serviceType !== "addon" && serviceType !== "subscription") {
      throw new ConvexError({
        code: "SERVICE_NOT_BOOKABLE",
        message: `Service "${service.name}" is not bookable.`,
      });
    }

    const price = getEffectiveServicePrice(service, vehicleSize);
    if (price <= 0) {
      throw new ConvexError({
        code: "SERVICE_NOT_BOOKABLE",
        message: `Service "${service.name}" is missing valid pricing.`,
      });
    }
  }
}

// Get count of new customers (created in last 30 days, admin only)
export const getNewCustomersCount = query({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    await requireAdmin(ctx);

    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const users = await ctx.db.query("users").collect();

    // Filter for customers (not admins) created in last 30 days
    // Admin status is determined by stored role field
    const newCustomers = users.filter((user) => {
      return user.role !== "admin" && user._creationTime >= thirtyDaysAgo;
    });

    return newCustomers.length;
  },
});

// Get all users (admin only)
export const list = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);

    return await ctx.db.query("users").collect();
  },
});

// Get user by ID
export const getById = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const authUserId = await getUserIdFromIdentity(ctx);
    if (!authUserId) throw new Error("Not authenticated");

    // Users can only see their own data, admins can see all
    const isAdminUser = await isAdmin(ctx);
    if (!isAdminUser && authUserId !== args.userId) {
      throw new Error("Access denied");
    }

    return await ctx.db.get(args.userId);
  },
});

// Get the current user's profile
export const getCurrentUser = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getUserIdFromIdentity(ctx);
    if (!userId) {
      return null;
    }

    return await ctx.db.get(userId);
  },
});

// Internal query to get user by ID (no auth required, for internal actions)
export const getByIdInternal = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args): Promise<Doc<"users"> | null> => {
    return await ctx.db.get(args.userId);
  },
});

// Check if user has completed onboarding (has address and at least one vehicle)
export const hasCompletedOnboarding = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getUserIdFromIdentity(ctx);
    if (!userId) {
      return false;
    }

    const user = await ctx.db.get(userId);
    if (!user) return false;

    // Check if user has address and at least one vehicle
    const hasAddress = !!user.address;
    const vehicles = await ctx.db
      .query("vehicles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const hasVehicles = vehicles.length > 0;

    return hasAddress && hasVehicles;
  },
});

// Get detailed onboarding status (which steps are missing)
export const getOnboardingStatus = query({
  args: {},
  returns: v.object({
    isComplete: v.boolean(),
    missingSteps: v.array(v.string()),
    nextStep: v.number(),
  }),
  handler: async (ctx) => {
    const userId = await getUserIdFromIdentity(ctx);
    if (!userId) {
      return {
        isComplete: false,
        missingSteps: ["personal", "address", "vehicles"],
        nextStep: 1,
      };
    }

    const user = await ctx.db.get(userId);
    if (!user) {
      return {
        isComplete: false,
        missingSteps: ["personal", "address", "vehicles"],
        nextStep: 1,
      };
    }

    const missingSteps: string[] = [];
    let nextStep = 1;

    // Check personal info (name and phone are required)
    const hasPersonal = !!(user.name && user.phone);
    if (!hasPersonal) {
      missingSteps.push("personal");
      nextStep = 1;
    }

    // Check address
    const hasAddress = !!user.address;
    if (!hasAddress) {
      missingSteps.push("address");
      if (nextStep === 1 && hasPersonal) {
        nextStep = 2;
      }
    }

    // Check vehicles
    const vehicles = await ctx.db
      .query("vehicles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const hasVehicles = vehicles.length > 0;
    if (!hasVehicles) {
      missingSteps.push("vehicles");
      if (nextStep === 1 && hasPersonal && hasAddress) {
        nextStep = 3;
      }
    }

    return {
      isComplete: missingSteps.length === 0,
      missingSteps,
      nextStep,
    };
  },
});

// Get user's vehicles
export const getUserVehicles = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getUserIdFromIdentity(ctx);
    if (!userId) {
      return [];
    }

    return await ctx.db
      .query("vehicles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
  },
});

// Create new user (admin only)
export const create = mutation({
  args: {
    name: v.string(),
    email: v.string(),
    phone: v.optional(v.string()),
    role: v.optional(v.union(v.literal("admin"), v.literal("client"))),
    address: v.optional(
      v.object({
        street: v.string(),
        city: v.string(),
        state: v.string(),
        zip: v.string(),
      }),
    ),
    notes: v.optional(v.string()),
    vehicles: v.optional(
      v.array(
        v.object({
          year: v.number(),
          make: v.string(),
          model: v.string(),
          color: v.optional(v.string()),
          size: v.optional(
            v.union(v.literal("small"), v.literal("medium"), v.literal("large")),
          ),
        }),
      ),
    ),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const existingUser = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", args.email))
      .first();

    if (existingUser) {
      throw new Error("User with this email already exists");
    }

    const userId = await ctx.db.insert("users", {
      name: args.name,
      email: args.email,
      phone: args.phone,
      role: args.role || "client",
      address: args.address,
      timesServiced: 0,
      totalSpent: 0,
      status: "active",
      cancellationCount: 0,
      notes: args.notes,
      notificationPreferences: buildDefaultNotificationPreferences(
        "admin_create",
      ),
    });

    if (args.vehicles?.length) {
      for (const vehicle of args.vehicles) {
        await ctx.db.insert("vehicles", {
          userId,
          year: vehicle.year,
          make: vehicle.make,
          model: vehicle.model,
          color: vehicle.color,
          size: vehicle.size,
        });
      }
    }

    if (args.email && (args.role || "client") !== "admin") {
      await ctx.scheduler.runAfter(0, internal.users.sendInvitation, {
        userId,
        email: args.email,
      });
    }

    // Ensure Stripe customer is created for non-admin users
    if ((args.role || "client") !== "admin") {
      await ctx.scheduler.runAfter(0, internal.users.ensureStripeCustomerWithRetry, {
        userId,
        attempt: 0,
      });
    }

    return userId;
  },
});

// Send Clerk invitation to a newly created customer
export const sendInvitation = internalAction({
  args: { userId: v.id("users"), email: v.string() },
  returns: clerkAccountSyncResultValidator,
  handler: async (ctx, args) => {
    const result = await syncClerkAccountForUserEmail(ctx, {
      userId: args.userId,
      email: args.email,
      inviteIfMissing: true,
    });
    if (result.linked) {
      console.log(
        `[users] Linked existing Clerk user ${result.clerkUserId} to ${args.email} for user ${args.userId}`,
      );
    } else if (result.invited) {
      console.log(
        `[users] Invitation sent to ${args.email} for user ${args.userId}`,
      );
    }
    return result;
  },
});

// Create user profile during onboarding
export const createUserProfile = mutation({
  args: {
    name: v.string(),
    phone: v.string(),
    marketingEmails: v.optional(v.boolean()),
    address: v.object({
      street: v.string(),
      city: v.string(),
      state: v.string(),
      zip: v.string(),
    }),
    vehicles: v.array(
      v.object({
        year: v.number(),
        make: v.string(),
        model: v.string(),
        color: v.optional(v.string()),
        size: v.optional(v.union(v.literal("small"), v.literal("medium"), v.literal("large"))),
        vehicleTypeId: v.optional(v.id("vehicleTypes")),
        classification: v.optional(
          v.object({
            source: v.union(
              v.literal("fuelEconomy"),
              v.literal("vpic"),
              v.literal("manual"),
              v.literal("fallback"),
            ),
            confidence: v.union(v.literal("high"), v.literal("medium"), v.literal("low")),
            rawCategory: v.optional(v.string()),
            needsAdminReview: v.boolean(),
          }),
        ),
      }),
    ),
  },
  returns: v.object({
    userId: v.id("users"),
  }),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity || !identity.subject) {
      throw new Error("Not authenticated");
    }

    await assertRateLimit(ctx, "userProfileByUser", {
      key: `user:${identity.subject}`,
      message: "Too many profile setup attempts. Please try again later.",
    });

    // Get Clerk user ID from identity (needed for user creation and updates)
    const clerkUserId = identity.subject;

    // Check if user exists, create if not
    let userId = await getUserIdFromIdentity(ctx);

    if (!userId) {
      // User doesn't exist - create them first

      // Check if user exists by clerkUserId (in case they were created manually)
      // This preserves admin roles if an admin was created in Clerk but not in Convex
      const existingUserByClerkId = await ctx.db
        .query("users")
        .withIndex("by_clerk_user_id", (q) => q.eq("clerkUserId", clerkUserId))
        .first();

      if (existingUserByClerkId) {
        // User exists by clerkUserId - use existing user and preserve their role
        userId = existingUserByClerkId._id;
      } else {
        // User doesn't exist at all - create new user
        // Default to client role (admin must be set manually in Convex dashboard)
        const userRole = "client"; // Always default to client for new users
        const resolvedName = resolvePreferredName({
          onboardingName: args.name,
          identityName: identity.name,
          identityEmail: identity.email,
        });

        // Create new user with role (Stripe customer sync runs after onboarding completion)
        const userData: any = {
          name: resolvedName,
          clerkUserId: clerkUserId,
          role: userRole, // Always "client" for new users
          timesServiced: 0,
          totalSpent: 0,
          status: "active",
          notificationPreferences: buildDefaultNotificationPreferences(
            "onboarding",
            false,
            args.marketingEmails ?? false,
          ),
          // stripeCustomerId will be set by onboarding/payment Stripe sync flows
        };
        if (identity.email) {
          userData.email = identity.email;
        }

        userId = await ctx.db.insert("users", userData);
      }
    }

    // Get existing user to check if onboarding is already complete (idempotent check)
    const existingUser = await ctx.db.get(userId);
    const hasExistingAddress = !!existingUser?.address;
    const existingVehicles = await ctx.db
      .query("vehicles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const hasExistingVehicles = existingVehicles.length > 0;

    // If user already has onboarding data (address and vehicles), don't overwrite
    // This makes the mutation idempotent and prevents data loss
    if (hasExistingAddress && hasExistingVehicles) {
      // Onboarding already complete - preserve existing role, don't overwrite
      // Only update role if it's currently undefined
      if (existingUser.role === undefined) {
        // Default to client if no role set
        await ctx.db.patch(userId, {
          role: "client",
          notificationPreferences:
            existingUser.notificationPreferences ||
            buildDefaultNotificationPreferences("onboarding"),
        });
      }
      if (args.marketingEmails !== undefined) {
        const preferences = normalizeUserNotificationPreferences(
          existingUser.notificationPreferences,
        );
        await ctx.db.patch(userId, {
          notificationPreferences: {
            ...preferences,
            marketingEmails: args.marketingEmails,
          },
        });
      }
      if (!existingUser.stripeCustomerId) {
        await ctx.scheduler.runAfter(
          0,
          internal.users.ensureStripeCustomerWithRetry,
          {
            userId,
            attempt: 0,
          },
        );
      }
      // If role is already set (including "admin"), preserve it
      return { userId };
    }

    // Update user with onboarding data
    // IMPORTANT: Preserve existing admin role, only set if undefined
    const shouldPreserveAdminRole = existingUser?.role === "admin";
    const userRole = shouldPreserveAdminRole
      ? "admin"
      : existingUser?.role || "client";
    const resolvedName = resolvePreferredName({
      onboardingName: args.name,
      existingName: existingUser?.name,
      identityName: identity.name,
      identityEmail: identity.email,
    });

    const nextNotificationPreferences = normalizeUserNotificationPreferences(
      existingUser?.notificationPreferences ??
        buildDefaultNotificationPreferences("onboarding"),
    );
    if (args.marketingEmails !== undefined) {
      nextNotificationPreferences.marketingEmails = args.marketingEmails;
    }

    await ctx.db.patch(userId, {
      name: resolvedName,
      phone: args.phone,
      address: args.address,
      clerkUserId: clerkUserId, // Ensure clerkUserId is set
      role: userRole, // Preserve admin, default to client for new users
      timesServiced: 0,
      totalSpent: 0,
      status: "active",
      notificationPreferences: nextNotificationPreferences,
    });

    // Only create vehicles if they don't already exist (idempotent)
    // Delete existing vehicles first if we're re-running onboarding
    if (hasExistingVehicles) {
      for (const vehicle of existingVehicles) {
        await ctx.db.delete(vehicle._id);
      }
    }

    // Create vehicles
    for (const vehicle of args.vehicles) {
      await ctx.db.insert("vehicles", {
        userId,
        year: vehicle.year,
        make: vehicle.make,
        model: vehicle.model,
        vehicleTypeId: vehicle.vehicleTypeId,
        classification: vehicle.classification,
        color: vehicle.color,
        size: vehicle.size || "medium",
      });
    }

    // Sync Stripe customer as soon as onboarding is complete.
    // Retries are handled internally if Stripe is temporarily unavailable.
    await ctx.scheduler.runAfter(0, internal.users.ensureStripeCustomerWithRetry, {
      userId,
      attempt: 0,
    });

    // Send admin notification email for new customer (after onboarding complete)
    // MOVED: Onboarding notifications and Welcome emails are now handled in the Stripe webhook
    // (`convex/http.ts`) after successful payment to prevent spam.
    /*
    if (!hasExistingAddress || !hasExistingVehicles) {
      if (shouldScheduleNotificationJobs()) {
        await ctx.scheduler.runAfter(
          0,
          internal.notifications.queueNewCustomerOnboarded,
          {
            userId,
          },
        );
      }
      await ctx.scheduler.runAfter(0, internal.emails.sendWelcomeEmail, {
        userId,
      });
    }
    */

    return { userId };
  },
});

// ===== Clerk Webhook Handlers =====
// These mutations are called by the Clerk webhook endpoint to sync user data

// Upsert user from Clerk webhook (user.created or user.updated events)
export const upsertFromClerk = internalMutation({
  args: {
    data: v.any(), // Clerk UserJSON type - validated by webhook signature
  },
  returns: v.union(v.id("users"), v.null()),
  handler: async (ctx, args) => {
    const clerkData = args.data as {
      id: string;
      first_name: string | null;
      last_name: string | null;
      email_addresses: Array<{ email_address: string }>;
      image_url: string | null;
    };

    const clerkUserId = clerkData.id;
    const email = clerkData.email_addresses?.[0]?.email_address || null;
    const name =
      clerkData.first_name || clerkData.last_name
        ? `${clerkData.first_name || ""} ${clerkData.last_name || ""}`.trim()
        : email || "User";

    if (!email) {
      console.warn("Clerk webhook: User has no email, skipping", clerkUserId);
      return null;
    }

    // Check if user exists by clerkUserId
    const existingUserByClerkId = await ctx.db
      .query("users")
      .withIndex("by_clerk_user_id", (q) => q.eq("clerkUserId", clerkUserId))
      .first();

    // Check if user exists by convexUserId from metadata (Guest User linking)
    // The webhook payload data usually has keys in snake_case or whatever Clerk sends.
    // We check public_metadata for the ID we sent during invitation.
    const publicMetadata = (clerkData as any).public_metadata || {};
    const convexUserId = publicMetadata.convexUserId as Id<"users"> | undefined;

    let existingUserByMetadata: Doc<"users"> | null = null;
    if (convexUserId) {
        existingUserByMetadata = await ctx.db.get(convexUserId);
    }

    // Also check by email in case neither ID method worked
    const existingUserByEmail = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", email))
      .first();

    if (existingUserByClerkId || existingUserByMetadata || existingUserByEmail) {
      // User exists - update basic info but preserve ALL existing data
      // Priority: Clerk ID > Metadata ID > Email
      const userId = existingUserByClerkId?._id || existingUserByMetadata?._id || existingUserByEmail!._id;
      const existingUser = await ctx.db.get(userId);

      // Update only basic user data from Clerk (name, email, image, clerkUserId)
      // IMPORTANT: Preserve ALL other fields including role, address, phone, vehicles, etc.
      // Role is manually managed in Convex dashboard - webhook never touches it
      await ctx.db.patch(userId, {
        email: email,
        name: name,
        clerkUserId: clerkUserId, // Ensure clerkUserId is set
        image: clerkData.image_url || existingUser?.image || undefined,
        // DO NOT update: role, address, phone, vehicles, stripeCustomerId, status, etc.
        // These are managed separately and should never be overwritten by webhook
      });

      const role = existingUser?.role || "client";
      if (
        shouldScheduleStripeCustomerSync() &&
        role !== "admin" &&
        !existingUser?.stripeCustomerId
      ) {
        await ctx.scheduler.runAfter(
          0,
          internal.users.ensureStripeCustomerWithRetry,
          {
            userId,
            attempt: 0,
          },
        );
      }

      return userId;
    }

    // New user - create with default values
    // Don't create Stripe customer here; onboarding completion triggers sync and
    // payment flows still have a lazy fallback.
    // Role defaults to "client" - admin role must be set manually in Convex dashboard
    const userId = await ctx.db.insert("users", {
      email: email,
      name: name,
      clerkUserId: clerkUserId,
      image: clerkData.image_url || undefined,
      role: "client", // Default role for new users - admin must be set manually in Convex dashboard
      timesServiced: 0,
      totalSpent: 0,
      status: "active",
      notificationPreferences: buildDefaultNotificationPreferences(
        "clerk_webhook",
      ),
    });

    if (shouldScheduleStripeCustomerSync()) {
      await ctx.scheduler.runAfter(0, internal.users.ensureStripeCustomerWithRetry, {
        userId,
        attempt: 0,
      });
    }

    return userId;
  },
});

// Admin-triggered one-time backfill for active client users missing Stripe IDs.
export const backfillMissingStripeCustomers = mutation({
  args: {
    limit: v.optional(v.number()),
    dryRun: v.optional(v.boolean()),
  },
  returns: v.object({
    scanned: v.number(),
    eligible: v.number(),
    scheduled: v.number(),
    dryRun: v.boolean(),
  }),
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const dryRun = args.dryRun ?? false;
    const limit = normalizeBackfillLimit(args.limit);
    const users = await ctx.db.query("users").collect();

    const eligibleUsers = users.filter(
      (user) =>
        user.role !== "admin" &&
        user.status !== "inactive" &&
        !user.stripeCustomerId,
    );

    if (dryRun) {
      return {
        scanned: users.length,
        eligible: eligibleUsers.length,
        scheduled: 0,
        dryRun: true,
      };
    }

    const usersToSchedule = eligibleUsers.slice(0, limit);
    for (const user of usersToSchedule) {
      await ctx.scheduler.runAfter(0, internal.users.ensureStripeCustomerWithRetry, {
        userId: user._id,
        attempt: 0,
      });
    }

    return {
      scanned: users.length,
      eligible: eligibleUsers.length,
      scheduled: usersToSchedule.length,
      dryRun: false,
    };
  },
});

// Delete user from Clerk webhook (user.deleted event)
export const deleteFromClerk = internalMutation({
  args: {
    clerkUserId: v.string(),
  },
  returns: v.union(v.id("users"), v.null()),
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_clerk_user_id", (q) =>
        q.eq("clerkUserId", args.clerkUserId),
      )
      .first();

    if (!user) {
      console.warn(
        `Clerk webhook: Can't delete user, none found for Clerk ID: ${args.clerkUserId}`,
      );
      return null;
    }

    // Preserve billing and appointment history when Clerk removes auth access.
    await ctx.db.patch(user._id, {
      clerkUserId: undefined,
      status: "inactive",
    });

    return user._id;
  },
});

// Update user
export const update = mutation({
  args: {
    userId: v.id("users"),
    name: v.optional(v.string()),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    role: v.optional(v.union(v.literal("admin"), v.literal("client"))),
    address: v.optional(
      v.object({
        street: v.string(),
        city: v.string(),
        state: v.string(),
        zip: v.string(),
      }),
    ),
    notes: v.optional(v.string()),
    status: v.optional(v.union(v.literal("active"), v.literal("inactive"))),
  },
  handler: async (ctx, args) => {
    const authUserId = await getUserIdFromIdentity(ctx);
    if (!authUserId) throw new Error("Not authenticated");

    const isAdminUser = await isAdmin(ctx);
    const isOwnProfile = authUserId === args.userId;

    // Users can update their own profile, admins can update any profile
    if (!isAdminUser && !isOwnProfile) {
      throw new Error("Access denied");
    }

    const { userId, ...updates } = args;
    const user = await ctx.db.get(userId);
    if (!user) throw new Error("User not found");

    const updateData: any = {};

    if (updates.name !== undefined) updateData.name = updates.name;
    if (updates.email !== undefined) updateData.email = updates.email;
    if (updates.phone !== undefined) updateData.phone = updates.phone;
    if (updates.role !== undefined && isAdminUser)
      updateData.role = updates.role;
    if (updates.address !== undefined) updateData.address = updates.address;
    if (updates.notes !== undefined) updateData.notes = updates.notes;
    if (updates.status !== undefined && isAdminUser)
      updateData.status = updates.status;

    await ctx.db.patch(userId, updateData);
    return userId;
  },
});

// Update user profile (for current user)
export const updateUserProfile = mutation({
  args: {
    name: v.optional(v.string()),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    address: v.optional(
      v.object({
        street: v.string(),
        city: v.string(),
        state: v.string(),
        zip: v.string(),
      }),
    ),
    notificationPreferences: v.optional(userNotificationPreferencesValidator),
  },
  handler: async (ctx, args) => {
    const userId = await getUserIdFromIdentity(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }

    const user = await ctx.db.get(userId);
    if (!user) {
      throw new Error("User not found");
    }

    const updates: any = {};
    if (args.name !== undefined) updates.name = args.name;
    if (args.email !== undefined) updates.email = args.email;
    if (args.phone !== undefined) updates.phone = args.phone;
    if (args.address !== undefined) updates.address = args.address;
    if (args.notificationPreferences !== undefined) {
      updates.notificationPreferences = applyNotificationPreferenceUpdate(
        user.notificationPreferences,
        args.notificationPreferences,
        "profile",
      );
    }

    await ctx.db.patch(userId, updates);
    return { success: true };
  },
});

// Update a vehicle
export const updateVehicle = mutation({
  args: {
    vehicleId: v.id("vehicles"),
    year: v.optional(v.number()),
    make: v.optional(v.string()),
    model: v.optional(v.string()),
    size: v.optional(
      v.union(v.literal("small"), v.literal("medium"), v.literal("large")),
    ),
    color: v.optional(v.string()),
    licensePlate: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getUserIdFromIdentity(ctx);
    if (!userId) throw new Error("Not authenticated");

    const vehicle = await ctx.db.get(args.vehicleId);
    if (!vehicle || vehicle.userId !== userId) {
      throw new Error("Vehicle not found or access denied");
    }

    const updates: any = {};
    if (args.year !== undefined) updates.year = args.year;
    if (args.make !== undefined) updates.make = args.make;
    if (args.model !== undefined) updates.model = args.model;
    if (args.size !== undefined) updates.size = args.size;
    if (args.color !== undefined) updates.color = args.color;
    if (args.licensePlate !== undefined) updates.licensePlate = args.licensePlate;

    await ctx.db.patch(args.vehicleId, updates);
    return args.vehicleId;
  },
});

// Delete a vehicle
export const deleteVehicle = mutation({
  args: {
    vehicleId: v.id("vehicles"),
  },
  handler: async (ctx, args) => {
    const userId = await getUserIdFromIdentity(ctx);
    if (!userId) throw new Error("Not authenticated");

    const vehicle = await ctx.db.get(args.vehicleId);
    if (!vehicle || vehicle.userId !== userId) {
      throw new Error("Vehicle not found or access denied");
    }

    await ctx.db.delete(args.vehicleId);
    return args.vehicleId;
  },
});

// Ensure a guest user exists and is linked to the appointment
export const ensureGuestUser = internalMutation({
  args: {
    appointmentId: v.id("appointments"),
    name: v.string(),
    email: v.string(),
    phone: v.string(),
    smsOptIn: v.optional(v.boolean()),
  },
  returns: v.id("users"),
  handler: async (ctx, args) => {
    const appointment = await ctx.db.get(args.appointmentId);
    if (!appointment) throw new Error("Appointment not found");

    // Check if the appointment's current user exists
    let user = await ctx.db.get(appointment.userId);

    // If user is missing OR (it's a guest user without Clerk ID and we want to ensure details match),
    // we might need to update or switch users.
    
    // Look up by email to see if we should link to an existing user instead
    const existingUserByEmail = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", args.email))
      .first();

    if (existingUserByEmail && existingUserByEmail._id !== appointment.userId) {
      // Only merge if the current appointment owner is a temp guest (no Clerk account).
      // Never reassign an authenticated user's appointment to someone else.
      const currentUser = await ctx.db.get(appointment.userId);
      if (currentUser && !currentUser.clerkUserId) {
        user = existingUserByEmail;
      }
      // Otherwise keep the appointment on the user who created it
    } else if (existingUserByEmail) {
      // Same user — just update basic info if needed
      user = existingUserByEmail;
      const updates: any = {};
      if (user.name !== args.name && (!user.clerkUserId || user.name === user.email)) {
         updates.name = args.name;
      }
      if (user.phone !== args.phone && !user.clerkUserId) {
         updates.phone = args.phone;
      }
      if (args.smsOptIn !== undefined) {
        updates.notificationPreferences = applyNotificationPreferenceUpdate(
          user.notificationPreferences,
          {
            ...normalizeUserNotificationPreferences(user.notificationPreferences),
            smsNotifications: args.smsOptIn,
          },
          "booking",
        );
      }
      if (Object.keys(updates).length > 0) {
        await ctx.db.patch(user._id, updates);
      }
    } else if (!user) {
      // User doesn't exist by ID, and not found by email -> Create new guest user
      const newUserId = await ctx.db.insert("users", {
        name: args.name,
        email: args.email,
        phone: args.phone,
        role: "client",
        timesServiced: 0,
        totalSpent: 0,
        status: "active",
        cancellationCount: 0,
        notificationPreferences: buildDefaultNotificationPreferences(
          "booking",
          args.smsOptIn ?? false,
        ),
      });
      user = (await ctx.db.get(newUserId))!;
    } else {
       // User exists by ID, but email didn't match?
       // This implies the appointment was linked to a user with a DIFFERENT email.
       // For guests, we should probably update the user record to match the form data?
       // But if it's a real user (clerkUserId), we shouldn't overwrite email easily.
       
       if (!user.clerkUserId) {
           // It's a guest/provisional user, safe to update
           await ctx.db.patch(user._id, {
               name: args.name,
               email: args.email,
               phone: args.phone
           });
       }
       // If it IS a Clerk user, we respect the existing record and don't overwrite email/name from a guest checkout form
       // unless we are sure. For now, assume if they are auth'd, they are fine. 
       // If they are NOT auth'd but using a Clerk user's ID... that shouldn't happen in guest flow.
    }

    // Ensure appointment is linked to this user
    if (user && appointment.userId !== user._id) {
      await ctx.db.patch(args.appointmentId, { userId: user._id });
    }

    return user!._id;
  },
});

// Add a vehicle to user's profile
export const addVehicle = mutation({
  args: {
    year: v.number(),
    make: v.string(),
    model: v.string(),
    color: v.string(),
    licensePlate: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getUserIdFromIdentity(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }

    const vehicleId = await ctx.db.insert("vehicles", {
      userId,
      year: args.year,
      make: args.make,
      model: args.model,
      color: args.color,
      licensePlate: args.licensePlate,
      notes: args.notes,
    });

    return vehicleId;
  },
});

// Remove a vehicle
export const removeVehicle = mutation({
  args: {
    vehicleId: v.id("vehicles"),
  },
  handler: async (ctx, args) => {
    const userId = await getUserIdFromIdentity(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }

    const vehicle = await ctx.db.get(args.vehicleId);
    if (!vehicle) {
      throw new Error("Vehicle not found");
    }

    if (vehicle.userId !== userId) {
      const isAdminUser = await isAdmin(ctx);
      if (!isAdminUser) {
        throw new Error("Access denied");
      }
    }

    await ctx.db.delete(args.vehicleId);
    return { success: true };
  },
});

// Delete a user and all their associated data (admin only)
export const deleteUser = mutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    // Delete associated vehicles
    const vehicles = await ctx.db
      .query("vehicles")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();
    for (const vehicle of vehicles) {
      await ctx.db.delete(vehicle._id);
    }

    // Delete associated appointments and their invoices (if not paid)
    const appointments = await ctx.db
      .query("appointments")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();
    for (const appointment of appointments) {
      const invoices = await ctx.db
        .query("invoices")
        .withIndex("by_appointment", (q) =>
          q.eq("appointmentId", appointment._id),
        )
        .collect();
      for (const invoice of invoices.filter((item) => item.status !== "paid")) {
        await ctx.db.delete(invoice._id);
      }
      await ctx.db.delete(appointment._id);
    }

    // Delete the user
    await ctx.db.delete(args.userId);
  },
});

// Get user by ID with full details (appointments, invoices, vehicles) - admin only
export const getByIdWithDetails = query({
  args: { userId: v.id("users") },
  returns: v.union(
    v.object({
      user: v.any(), // Full user document
      appointments: v.array(v.any()),
      invoices: v.array(v.any()),
      vehicles: v.array(v.any()),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const user = await ctx.db.get(args.userId);
    if (!user) return null;

    // Get all appointments for this user
    const appointments = await ctx.db
      .query("appointments")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();

    // Enrich appointments with services and vehicles
    const enrichedAppointments = await Promise.all(
      appointments.map(async (apt) => {
        const services = await Promise.all(
          apt.serviceIds.map((id) => ctx.db.get(id)),
        );
        const vehicles = await Promise.all(
          apt.vehicleIds.map((id) => ctx.db.get(id)),
        );
        return {
          ...apt,
          services: services.filter((s) => s !== null),
          vehicles: vehicles.filter((v) => v !== null),
        };
      }),
    );

    // Get all invoices for this user
    const invoices = await ctx.db
      .query("invoices")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();

    // Get all vehicles for this user
    const vehicles = await ctx.db
      .query("vehicles")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();

    return {
      user,
      appointments: enrichedAppointments,
      invoices,
      vehicles,
    };
  },
});

// Get users with statistics (total bookings, last visit, etc.) - admin only
export const listWithStats = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);

    const users = await ctx.db.query("users").collect();
    // Filter out admin users from customer list
    // Note: This filter uses stored role, but actual admin status comes from Clerk org membership
    const clientUsers = users.filter((user) => user.role !== "admin");

    const usersWithStats = await Promise.all(
      clientUsers.map(async (user) => {
        const appointments = await ctx.db
          .query("appointments")
          .withIndex("by_user", (q) => q.eq("userId", user._id))
          .collect();

        const completedApts = appointments.filter(
          (a) => a.status === "completed",
        );
        const lastVisit = completedApts.sort((a, b) =>
          b.scheduledDate.localeCompare(a.scheduledDate),
        )[0];

        return {
          ...user,
          totalBookings: user.timesServiced || 0,
          totalSpent: user.totalSpent || 0,
          lastVisit: lastVisit?.scheduledDate || null,
          location: user.address
            ? `${user.address.city}, ${user.address.state}`
            : "No address",
        };
      }),
    );

    return usersWithStats.sort((a, b) =>
      (b.name || "").localeCompare(a.name || ""),
    );
  },
});

// Create user account with appointment (for marketing site signups)
// Note: Password should be handled via Convex Auth signup before calling this mutation
// This mutation creates the user in the database and appointment, but auth credentials
// must be created separately using the auth system
export const createUserWithAppointment = mutation({
  args: {
    name: v.string(),
    email: v.string(),
    phone: v.string(),
    address: v.object({
      street: v.string(),
      city: v.string(),
      state: v.string(),
      zip: v.string(),
    }),
    vehicles: v.array(
      v.object({
        year: v.number(),
        make: v.string(),
        model: v.string(),
        size: v.optional(
          v.union(v.literal("small"), v.literal("medium"), v.literal("large")),
        ),
        color: v.optional(v.string()),
        licensePlate: v.optional(v.string()),
        hasPet: v.optional(v.boolean()),
      }),
    ),
    serviceIds: v.array(v.id("services")),
    scheduledDate: v.string(),
    scheduledTime: v.string(),
    locationNotes: v.optional(v.string()),
    smsOptIn: v.optional(v.boolean()),
    paymentOption: v.optional(
      v.union(v.literal("deposit"), v.literal("full"), v.literal("in_person")),
    ),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    userId: Id<"users">;
    appointmentId: Id<"appointments">;
    invoiceId: Id<"invoices">;
  }> => {
    await assertBookingSetupReady(ctx);

    if (args.vehicles.length === 0) {
      throw new ConvexError({
        code: "SERVICE_NOT_BOOKABLE",
        message: "Please add at least one vehicle before booking.",
      });
    }

    const scheduledDateKey = normalizeDateKey(args.scheduledDate);
    const vehicleSize: VehicleSize = args.vehicles[0]?.size ?? "medium";

    // Validate services and slot before creating any records.
    const services = await Promise.all(args.serviceIds.map((id) => ctx.db.get(id)));
    const validServices = services.filter(
      (service): service is Doc<"services"> => service !== null,
    );
    assertBookableServices(validServices, args.serviceIds, vehicleSize);

    const petFeeSettings = await ctx.db.query("petFeeSettings").first();
    const petFeeVehicleCount =
      petFeeSettings?.isActive === false
        ? 0
        : args.vehicles.filter((vehicle) => vehicle.hasPet).length;

    const duration = calculateSchedulingDuration({
      serviceDurations: validServices.map((service) => service.duration || 0),
      petFeeVehicleCount,
      petFeeTimeMinutes: petFeeSettings?.timeAddMinutes,
    });

    const slotAvailability = await ctx.runQuery(api.availability.checkAvailability, {
      date: scheduledDateKey,
      startTime: args.scheduledTime,
      duration,
    });
    if (!slotAvailability.available) {
      throw new ConvexError({
        code: "TIME_SLOT_UNAVAILABLE",
        message: slotAvailability.reason || "Selected time is no longer available.",
      });
    }

    // Check if user already exists (may have been created by auth system)
    let existingUser = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", args.email))
      .first();

    let userId: Id<"users">;
    if (existingUser) {
      // User exists (likely created by auth system), use existing user
      userId = existingUser._id;
      // Update user info if needed (phone, address may not be set by auth)
      const updateData: any = {};
      if (!existingUser.phone) updateData.phone = args.phone;
      if (!existingUser.address) updateData.address = args.address;
      if (!existingUser.name || existingUser.name === existingUser.email) {
        updateData.name = args.name;
      }
      if (args.smsOptIn !== undefined) {
        updateData.notificationPreferences = applyNotificationPreferenceUpdate(
          existingUser.notificationPreferences,
          {
            ...normalizeUserNotificationPreferences(
              existingUser.notificationPreferences,
            ),
            smsNotifications: args.smsOptIn,
          },
          "booking",
        );
      }
      if (Object.keys(updateData).length > 0) {
        await ctx.db.patch(userId, updateData);
      }
    } else {
      // Create the user account (auth may have failed, so create user without password)
      userId = await ctx.db.insert("users", {
        name: args.name,
        email: args.email,
        phone: args.phone,
        address: args.address,
        role: "client",
        timesServiced: 0,
        totalSpent: 0,
        status: "active",
        cancellationCount: 0,
        notificationPreferences: buildDefaultNotificationPreferences(
          "marketing_booking",
          args.smsOptIn ?? false,
        ),
      });
    }

    // Create vehicles
    const vehicleIds: Id<"vehicles">[] = [];
    const petFeeVehicleIds: Id<"vehicles">[] = [];
    for (const vehicle of args.vehicles) {
      const vehicleId = await ctx.db.insert("vehicles", {
        userId,
        year: vehicle.year,
        make: vehicle.make,
        model: vehicle.model,
        size: vehicle.size,
        color: vehicle.color,
        licensePlate: vehicle.licensePlate,
      });
      vehicleIds.push(vehicleId);
      if (vehicle.hasPet) {
        petFeeVehicleIds.push(vehicleId);
      }
    }

    // Calculate total price using size-based pricing
    const serviceTotalPrice =
      validServices.reduce((sum, service) => {
        const price = getEffectiveServicePrice(service, vehicleSize);
        return sum + price;
      }, 0) * vehicleIds.length;

    const petFeeItems = (["small", "medium", "large"] as VehicleSize[])
      .map((size) => {
        const count =
          petFeeSettings?.isActive === false
            ? 0
            : args.vehicles.filter(
                (v) => (v.size ?? "medium") === size && v.hasPet,
              ).length;
        const unitPrice = getEffectivePetFeePrice(petFeeSettings, size);
        return {
          itemType: "pet_fee" as const,
          serviceName: `Pet fee - ${size.charAt(0).toUpperCase() + size.slice(1)} vehicle`,
          quantity: count,
          unitPrice,
          totalPrice: unitPrice * count,
        };
      })
      .filter((item) => item.quantity > 0);

    const petFeeTotalPrice = petFeeItems.reduce(
      (sum, item) => sum + item.totalPrice,
      0,
    );
    const totalPrice = serviceTotalPrice + petFeeTotalPrice;

    // Create appointment
    const appointmentId = await ctx.db.insert("appointments", {
      userId,
      vehicleIds: vehicleIds as any,
      serviceIds: args.serviceIds,
      scheduledDate: scheduledDateKey,
      scheduledTime: args.scheduledTime,
      duration,
      location: {
        street: args.address.street,
        city: args.address.city,
        state: args.address.state,
        zip: args.address.zip,
        notes: args.locationNotes,
      },
      status: "pending",
      totalPrice,
      notes: "Created via marketing site booking",
      createdBy: userId,
      paymentOption: args.paymentOption,
      petFeeVehicleIds,
    });

    // Calculate invoice items
    const serviceItems = validServices.map((service) => {
      const unitPrice = getEffectiveServicePrice(service, vehicleSize);

      return {
        itemType: "service" as const,
        serviceId: service._id,
        serviceName: service.name,
        quantity: vehicleIds.length,
        unitPrice,
        totalPrice: unitPrice * vehicleIds.length,
      };
    });

    const items = [...serviceItems, ...petFeeItems];
    const subtotal = items.reduce((sum, item) => sum + item.totalPrice, 0);
    const tax = 0;
    const total = subtotal + tax;

    // Get deposit amount from settings (default $50 per vehicle)
    const depositSettings = await ctx.runQuery(api.depositSettings.get, {});
    const depositPerVehicle = depositSettings?.amountPerVehicle ?? 50;
    const calculatedDepositAmount = depositPerVehicle * vehicleIds.length;
    // Cap deposit at total to prevent negative remaining balance
    const depositAmount = Math.min(calculatedDepositAmount, total);
    const remainingBalance = Math.max(0, total - depositAmount);

    // Generate invoice number
    const invoiceCount: number = (
      await ctx.runQuery(internal.invoices.getCountInternal, {})
    ).count;
    const invoiceNumber: string = `INV-${String(invoiceCount + 1).padStart(4, "0")}`;

    // Create invoice date
    const dueDate = getInvoiceDueDateFromDateKey(scheduledDateKey);

    // Adjust invoice fields based on payment option
    const paymentOption = args.paymentOption ?? "deposit";
    let invoiceDepositAmount = depositAmount;
    let invoiceDepositPaid = false;
    let invoiceRemainingBalance = remainingBalance;

    if (paymentOption === "full") {
      // Full price checkout — store the total as depositAmount so abandoned checkouts
      // have a retry path (the dashboard shows a pay button when depositAmount > 0).
      // remainingBalance is 0 because the single checkout covers everything.
      invoiceDepositAmount = total;
      invoiceDepositPaid = false;
      invoiceRemainingBalance = 0;
    }
    // "deposit" and "in_person" use the same deposit fields — difference is handled downstream

    // Create invoice in Convex immediately (don't create Stripe invoice yet - wait for deposit)
    const invoiceId: Id<"invoices"> = await ctx.db.insert("invoices", {
      appointmentId,
      userId,
      invoiceNumber,
      items,
      subtotal,
      tax,
      total,
      status: "draft", // Start as draft, will be sent after deposit is paid
      dueDate,
      notes: `Invoice for appointment on ${scheduledDateKey}`,
      depositAmount: invoiceDepositAmount,
      depositPaid: invoiceDepositPaid,
      remainingBalance: invoiceRemainingBalance,
      paymentOption,
      remainingBalanceCollectionMethod:
        paymentOption === "deposit" ? "send_invoice" : undefined,
    });

    // Ensure Stripe customer exists (schedule action to create if needed)
    // This is critical for deposit checkout to work
    await ctx.scheduler.runAfter(0, internal.users.ensureStripeCustomer, {
      userId,
    });

    return { userId, appointmentId, invoiceId };
  },
});

// Update user Stripe customer ID
export const updateStripeCustomerId = mutation({
  args: {
    userId: v.id("users"),
    stripeCustomerId: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.userId, {
      stripeCustomerId: args.stripeCustomerId,
    });
  },
});

export const linkClerkUserIdInternal = internalMutation({
  args: {
    userId: v.id("users"),
    clerkUserId: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.userId, {
      clerkUserId: args.clerkUserId,
    });
    return args.userId;
  },
});

async function ensureStripeCustomerForUser(
  ctx: any,
  userId: Id<"users">,
): Promise<string> {
  const user = await ctx.runQuery(internal.users.getByIdInternal, {
    userId,
  });
  if (!user) throw new Error("User not found");

  // If user already has Stripe customer ID, return it
  if (user.stripeCustomerId) {
    return user.stripeCustomerId;
  }

  // Avoid Stripe network calls in tests to prevent pending fetch warnings
  if (process.env.CONVEX_TEST === "true" || process.env.NODE_ENV === "test") {
    const mockCustomerId = `cus_test_${userId}`;
    await ctx.runMutation(internal.users.updateStripeCustomerIdInternal, {
      userId,
      stripeCustomerId: mockCustomerId,
    });
    return mockCustomerId;
  }

  if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error(
      "STRIPE_SECRET_KEY environment variable is not set; cannot create Stripe customer",
    );
  }

  // Use Stripe component to get or create customer
  // Component's userId should be the auth provider's user ID (Clerk subject)
  // We use clerkUserId if available, otherwise fall back to Convex userId as string
  const { stripeClient } = await import("./stripeClient");
  const authUserId = user.clerkUserId || userId;
  const customer = await stripeClient.getOrCreateCustomer(ctx, {
    userId: authUserId, // Component expects auth provider's user ID (string)
    email: user.email,
    name: user.name,
    // Note: Component doesn't support metadata in getOrCreateCustomer
    // Customer metadata can be updated separately if needed via Stripe API
  });

  // Update user with Stripe customer ID
  await ctx.runMutation(internal.users.updateStripeCustomerIdInternal, {
    userId,
    stripeCustomerId: customer.customerId,
  });

  return customer.customerId;
}

// Internal action to ensure Stripe customer exists (for use by mutations)
// Now uses the @convex-dev/stripe component for customer management
export const ensureStripeCustomer = internalAction({
  args: {
    userId: v.id("users"),
  },
  returns: v.string(), // Returns stripeCustomerId
  handler: async (ctx, args): Promise<string> => {
    return await ensureStripeCustomerForUser(ctx, args.userId);
  },
});

// Wrapper that retries Stripe customer sync with bounded backoff.
// This action intentionally does not throw so caller flows (e.g. onboarding) remain non-blocking.
export const ensureStripeCustomerWithRetry = internalAction({
  args: {
    userId: v.id("users"),
    attempt: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const maxAttempt = STRIPE_CUSTOMER_SYNC_RETRY_DELAYS_MS.length - 1;
    const attempt = Math.min(maxAttempt, Math.max(0, Math.floor(args.attempt ?? 0)));

    try {
      await ensureStripeCustomerForUser(ctx, args.userId);
      return null;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage === "User not found") {
        console.warn(
          `[users.ensureStripeCustomerWithRetry] User not found, skipping retry for ${args.userId}`,
        );
        return null;
      }

      const nextAttempt = attempt + 1;
      if (nextAttempt <= maxAttempt) {
        const retryDelayMs = STRIPE_CUSTOMER_SYNC_RETRY_DELAYS_MS[nextAttempt];
        console.error(
          `[users.ensureStripeCustomerWithRetry] Failed attempt ${attempt + 1}/${STRIPE_CUSTOMER_SYNC_RETRY_DELAYS_MS.length} for ${args.userId}. Retrying in ${retryDelayMs}ms.`,
          error,
        );
        await ctx.runMutation(internal.webhookDiagnostics.record, {
          source: "auth",
          level: "warn",
          eventType: "stripe.customer.sync",
          message: "Stripe customer sync failed and was scheduled for retry",
          userId: args.userId,
          actionResult: "failed",
          details: errorMessage,
        });
        await ctx.scheduler.runAfter(
          retryDelayMs,
          internal.users.ensureStripeCustomerWithRetry,
          {
            userId: args.userId,
            attempt: nextAttempt,
          },
        );
      } else {
        console.error(
          `[users.ensureStripeCustomerWithRetry] Exhausted retries for ${args.userId}.`,
          error,
        );
        await ctx.runMutation(internal.webhookDiagnostics.record, {
          source: "auth",
          level: "error",
          eventType: "stripe.customer.sync",
          message: "Stripe customer sync exhausted all retries",
          userId: args.userId,
          actionResult: "failed",
          details: errorMessage,
        });
      }
      return null;
    }
  },
});

// Internal mutation to update Stripe customer ID (for use by internal actions)
export const updateStripeCustomerIdInternal = internalMutation({
  args: {
    userId: v.id("users"),
    stripeCustomerId: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.userId, {
      stripeCustomerId: args.stripeCustomerId,
    });
  },
});

// Internal mutation to update user stats (only called by system)
export const updateStats = internalMutation({
  args: {
    userId: v.id("users"),
    timesServiced: v.optional(v.number()),
    totalSpent: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const updateData: any = {};
    if (args.timesServiced !== undefined) {
      updateData.timesServiced = args.timesServiced;
    }
    if (args.totalSpent !== undefined) {
      updateData.totalSpent = args.totalSpent;
    }
    await ctx.db.patch(args.userId, updateData);
    return args.userId;
  },
});

// Deprecated: legacy direct Stripe invoice creation action.
// Active production flow creates Convex invoice first and only creates Stripe invoice after deposit is paid.
export const createUserAppointmentInvoice = action({
  args: {
    userId: v.id("users"),
    appointmentId: v.id("appointments"),
    services: v.array(
      v.object({
        _id: v.id("services"),
        stripePriceIds: v.array(v.string()),
        basePriceSmall: v.optional(v.number()),
        basePriceMedium: v.optional(v.number()),
        basePriceLarge: v.optional(v.number()),
        name: v.string(),
      }),
    ),
    vehicles: v.array(
      v.object({
        size: v.optional(
          v.union(v.literal("small"), v.literal("medium"), v.literal("large")),
        ),
      }),
    ),
    totalPrice: v.number(),
    scheduledDate: v.string(),
  },
  returns: v.object({
    stripeInvoiceId: v.string(),
    stripeInvoiceUrl: v.string(),
    invoiceNumber: v.string(),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{
    stripeInvoiceId: string;
    stripeInvoiceUrl: string;
    invoiceNumber: string;
  }> => {
    const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeSecretKey) {
      throw new Error("STRIPE_SECRET_KEY environment variable is not set");
    }

    // Get user data
    const user: Doc<"users"> | null = await ctx.runQuery(internal.users.getByIdInternal, {
      userId: args.userId,
    });
    if (!user) throw new Error("User not found");

    // Note: User stats (timesServiced, totalSpent) should be updated when appointment is completed,
    // not when invoice is created. This is handled in the appointment completion flow.

    // Check if user has Stripe customer ID, create if not
    let stripeCustomerId: string | undefined = user.stripeCustomerId;
    if (!stripeCustomerId) {
      // Create Stripe customer
      const customerResponse = await fetch(
        "https://api.stripe.com/v1/customers",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${stripeSecretKey}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            email: user.email || "",
            name: user.name || "",
            phone: user.phone || "",
            "address[line1]": user.address?.street || "",
            "address[city]": user.address?.city || "",
            "address[state]": user.address?.state || "",
            "address[postal_code]": user.address?.zip || "",
            "address[country]": "US",
          }),
        },
      );

      if (!customerResponse.ok) {
        throw new Error("Failed to create Stripe customer");
      }

      const stripeCustomer: any = await customerResponse.json();
      stripeCustomerId = stripeCustomer.id;

      // Update user with Stripe customer ID
      // stripeCustomerId is guaranteed to be a string here since we just assigned it
      await ctx.runMutation(api.users.updateStripeCustomerId, {
        userId: args.userId,
        stripeCustomerId: stripeCustomerId!,
      });
    }

    // Create invoice items using existing Stripe price IDs from services
    const vehicleSize = args.vehicles[0]?.size || "medium";

    for (const service of args.services) {
      if (!service.stripePriceIds || service.stripePriceIds.length === 0) {
        throw new Error(`Service ${service.name} has no Stripe price IDs`);
      }

      // Find the appropriate price ID based on vehicle size
      let priceIndex = 1; // Default to medium (index 1)
      if (vehicleSize === "small") priceIndex = 0;
      else if (vehicleSize === "large") priceIndex = 2;

      const stripePriceId =
        service.stripePriceIds[priceIndex] ||
        service.stripePriceIds[1] ||
        service.stripePriceIds[0];

      if (!stripePriceId) {
        throw new Error(
          `No Stripe price found for service ${service.name} and size ${vehicleSize}`,
        );
      }

      // Create invoice item
      const invoiceItemResponse = await fetch(
        "https://api.stripe.com/v1/invoiceitems",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${stripeSecretKey}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            customer: stripeCustomerId!,
            price: stripePriceId,
            quantity: args.vehicles.length.toString(),
          }),
        },
      );

      if (!invoiceItemResponse.ok) {
        const errorText = await invoiceItemResponse.text();
        throw new Error(`Failed to create invoice item: ${errorText}`);
      }
    }

    // Create the invoice
    const dueDate = getInvoiceDueDateFromDateKey(args.scheduledDate);

    const invoiceResponse: Response = await fetch(
      "https://api.stripe.com/v1/invoices",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${stripeSecretKey}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          customer: stripeCustomerId!,
          collection_method: "send_invoice",
          days_until_due: String(REMAINING_BALANCE_DUE_DAYS),
          auto_advance: "true",
          description: `Mobile detailing service - ${args.scheduledDate}`,
        }),
      },
    );

    if (!invoiceResponse.ok) {
      const errorText = await invoiceResponse.text();
      throw new Error(`Failed to create Stripe invoice: ${errorText}`);
    }

    const stripeInvoice: any = await invoiceResponse.json();

    // Send the invoice (Stripe will email it automatically)
    const sendResponse: Response = await fetch(
      `https://api.stripe.com/v1/invoices/${stripeInvoice.id}/send`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${stripeSecretKey}`,
        },
      },
    );

    if (!sendResponse.ok) {
      const errorText = await sendResponse.text();
      throw new Error(`Failed to send Stripe invoice: ${errorText}`);
    }

    const sentInvoice: any = await sendResponse.json();

    // Generate invoice number
    const invoiceCount: number = (
      await ctx.runQuery(internal.invoices.getCountInternal, {})
    ).count;
    const invoiceNumber: string = `INV-${String(invoiceCount + 1).padStart(4, "0")}`;

    // Create invoice items for Convex
    const items = args.services.map((service) => {
      // Calculate the correct price based on vehicle size
      let unitPrice = service.basePriceMedium || 0;
      if (vehicleSize === "small") {
        unitPrice = service.basePriceSmall || service.basePriceMedium || 0;
      } else if (vehicleSize === "large") {
        unitPrice = service.basePriceLarge || service.basePriceMedium || 0;
      }

      return {
        serviceId: service._id,
        serviceName: service.name,
        quantity: args.vehicles.length,
        unitPrice,
        totalPrice: unitPrice * args.vehicles.length,
      };
    });

    const subtotal = items.reduce((sum, item) => sum + item.totalPrice, 0);
    const tax = 0;
    const total = subtotal + tax;

    // Get deposit amount from settings (default $50 per vehicle)
    const depositSettings = await ctx.runQuery(api.depositSettings.get, {});
    const depositPerVehicle = depositSettings?.amountPerVehicle ?? 50;
    const calculatedDepositAmount = depositPerVehicle * args.vehicles.length;
    // Cap deposit at total to prevent negative remaining balance
    const depositAmount = Math.min(calculatedDepositAmount, total);
    const remainingBalance = Math.max(0, total - depositAmount);

    // Store invoice in Convex with Stripe data
    await ctx.runMutation(internal.invoices.createInternal, {
      appointmentId: args.appointmentId,
      userId: args.userId,
      invoiceNumber,
      items,
      subtotal,
      tax,
      total,
      status: "draft", // Start as draft, will be sent after deposit is paid
      dueDate,
      stripeInvoiceId: sentInvoice.id,
      stripeInvoiceUrl: sentInvoice.hosted_invoice_url,
      notes: `Invoice for appointment on ${args.scheduledDate}`,
      depositAmount,
      depositPaid: false,
      remainingBalance,
    });

    return {
      stripeInvoiceId: sentInvoice.id,
      stripeInvoiceUrl: sentInvoice.hosted_invoice_url,
      invoiceNumber,
    };
  },
});
