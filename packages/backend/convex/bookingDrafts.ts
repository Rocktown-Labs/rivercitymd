import { ConvexError, v } from "convex/values";
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  getNormalizedIdentityEmail,
  getUserIdFromIdentity,
  requireAdmin,
} from "./auth";
import { calculateSchedulingDuration, normalizeDateKey } from "./lib/booking";
import {
  DEFAULT_USER_NOTIFICATION_PREFERENCES,
  normalizeUserNotificationPreferences,
} from "./lib/notificationSettings";
import { r2 } from "./r2";
import {
  calculateTravelBufferMinutesForMiles,
  calculateTravelFeeForMiles,
  type TravelFeeSettings,
} from "./lib/travelFees";
import { isArkansasState } from "./lib/address";
import {
  getEffectivePetFeePrice,
  getEffectiveServicePrice,
  isServiceAllowedForCondition,
  type VehicleSize,
} from "./lib/pricing";
import { getInvoiceDueDateFromDateKey } from "./lib/invoices";
import { assertRateLimit, contactRateLimitKey } from "./rateLimiter";

const HOLD_DURATION_MS = 15 * 60 * 1000;
const ABANDONED_EMAIL_DELAY_MS = 60 * 60 * 1000;

type DraftPriceItem = {
  itemType: "service" | "subscription" | "pet_fee" | "travel_fee";
  serviceId?: Id<"services">;
  vehicleId?: Id<"vehicles">;
  vehicleLabel?: string;
  vehicleTypeId?: Id<"vehicleTypes">;
  serviceName: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
};

type SubscriptionIntentInput = {
  planServiceId: Id<"services">;
  frequency: "monthly" | "biweekly";
  enrolledVehicleIndexes: number[];
};

type SubscriptionIntent = SubscriptionIntentInput & {
  planName: string;
  petFeeVehicleIndexes: number[];
  basePricePerCycle: number;
  petFeePerCycle: number;
  travelFeePerCycle: number;
  totalPerCycle: number;
  firstMonthTotal: number;
  travelBufferMinutes?: number;
};

type DraftPricingResult = {
  services: Doc<"services">[];
  items: DraftPriceItem[];
  totalPrice: number;
  duration: number;
  depositAmount: number;
  remainingBalance: number;
  travelFee: number;
  subscriptionIntent?: SubscriptionIntent;
};

const addressValidator = v.object({
  street: v.string(),
  city: v.string(),
  state: v.string(),
  zip: v.string(),
  notes: v.optional(v.string()),
  latitude: v.optional(v.number()),
  longitude: v.optional(v.number()),
});

const beforePhotoValidator = v.object({
  key: v.string(),
  fileName: v.string(),
  contentType: v.string(),
  sizeBytes: v.number(),
  uploadedAt: v.number(),
});

const draftVehicleValidator = v.object({
  year: v.number(),
  make: v.string(),
  model: v.string(),
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
  size: v.optional(
    v.union(v.literal("small"), v.literal("medium"), v.literal("large")),
  ),
  color: v.optional(v.string()),
  licensePlate: v.optional(v.string()),
  hasPet: v.optional(v.boolean()),
  hasHeavySoil: v.optional(v.boolean()),
  beforePhotos: v.optional(v.array(beforePhotoValidator)),
  serviceIds: v.optional(v.array(v.id("services"))),
});

const subscriptionIntentInputValidator = v.object({
  planServiceId: v.id("services"),
  frequency: v.union(v.literal("monthly"), v.literal("biweekly")),
  enrolledVehicleIndexes: v.array(v.number()),
});

const outOfAreaRequestVehicleValidator = v.object({
  year: v.optional(v.number()),
  make: v.optional(v.string()),
  model: v.optional(v.string()),
  vehicleTypeId: v.optional(v.id("vehicleTypes")),
  vehicleTypeName: v.optional(v.string()),
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
  size: v.optional(
    v.union(v.literal("small"), v.literal("medium"), v.literal("large")),
  ),
  color: v.optional(v.string()),
  licensePlate: v.optional(v.string()),
  hasPet: v.optional(v.boolean()),
  hasHeavySoil: v.optional(v.boolean()),
});

const bookingPaymentOptionValidator = v.union(
  v.literal("deposit"),
  v.literal("full"),
  v.literal("in_person"),
);

const outOfAreaRequestStatusValidator = v.union(
  v.literal("new"),
  v.literal("reviewing"),
  v.literal("contacted"),
  v.literal("approved"),
  v.literal("declined"),
  v.literal("notified"),
);

type ConvertedDraftResult = {
  appointmentId: Id<"appointments">;
  invoiceId: Id<"invoices">;
  userId: Id<"users">;
  paymentOption: "deposit" | "full" | "in_person";
  isFullPayment: boolean;
  total: number;
};

function normalizeEmail(email: string | null | undefined) {
  return email?.trim().toLowerCase() ?? "";
}

function computeNextSubscriptionDate(
  frequency: "monthly" | "biweekly",
  fromDate: string,
) {
  const from = new Date(`${fromDate}T12:00:00`);
  if (frequency === "monthly") {
    from.setMonth(from.getMonth() + 1);
  } else {
    from.setDate(from.getDate() + 14);
  }
  return from.toISOString().split("T")[0];
}

function createResumeToken() {
  return `${crypto.randomUUID().replaceAll("-", "")}${crypto
    .randomUUID()
    .replaceAll("-", "")}`;
}

function getVehicleSizeForDraft(args: {
  existingVehicles: Array<Doc<"vehicles">>;
  draftVehicles: Array<{
    size?: VehicleSize;
  }>;
}): VehicleSize {
  const sizes = [
    ...args.existingVehicles.map((vehicle) => vehicle.size ?? "medium"),
    ...args.draftVehicles.map((vehicle) => vehicle.size ?? "medium"),
  ];

  if (sizes.includes("large")) {
    return "large";
  }
  if (sizes.includes("medium")) {
    return "medium";
  }
  return "small";
}

function formatVehicleSizeLabel(size: VehicleSize) {
  if (size === "small") return "Small";
  if (size === "large") return "Large";
  return "Medium";
}

function normalizeContentType(contentType: string): string {
  return contentType.toLowerCase().split(";")[0]?.trim() || "";
}

function getFileExtension(fileName: string): string {
  const normalized = fileName.toLowerCase().trim();
  const lastDotIndex = normalized.lastIndexOf(".");
  if (lastDotIndex === -1) return "";
  return normalized.slice(lastDotIndex);
}

function validateBeforePhotoFile(fileName: string, contentType: string) {
  const allowedContentTypes = new Set([
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
    "image/heic",
    "image/heif",
    "application/octet-stream",
  ]);
  const allowedExtensions = new Set([
    ".jpg",
    ".jpeg",
    ".png",
    ".webp",
    ".gif",
    ".heic",
    ".heif",
  ]);
  if (
    !allowedContentTypes.has(normalizeContentType(contentType)) ||
    !allowedExtensions.has(getFileExtension(fileName))
  ) {
    throw new ConvexError({
      code: "INVALID_BEFORE_PHOTO_FILE_TYPE",
      message: "Before photos must be JPG, PNG, WEBP, GIF, HEIC, or HEIF.",
    });
  }
}

function assertBookableServices(
  services: Doc<"services">[],
  requestedServiceIds: Id<"services">[],
  vehicleSize: VehicleSize,
) {
  if (services.length !== requestedServiceIds.length) {
    throw new ConvexError({
      code: "SERVICE_NOT_BOOKABLE",
      message: "One or more selected services are unavailable.",
    });
  }

  for (const service of services) {
    if (!service.isActive) {
      throw new ConvexError({
        code: "SERVICE_NOT_BOOKABLE",
        message: `${service.name} is currently unavailable.`,
      });
    }

    const price = getEffectiveServicePrice(service, vehicleSize);
    if (price <= 0) {
      throw new ConvexError({
        code: "SERVICE_NOT_BOOKABLE",
        message: `${service.name} is not available for the selected vehicle size.`,
      });
    }
  }
}

function buildBookingNotificationPreferences(smsOptIn: boolean, now: number) {
  return normalizeUserNotificationPreferences({
    ...DEFAULT_USER_NOTIFICATION_PREFERENCES,
    smsNotifications: smsOptIn,
    operationalSmsConsent: {
      optedIn: smsOptIn,
      optedInAt: smsOptIn ? now : undefined,
      optedOutAt: smsOptIn ? undefined : now,
      source: "booking_draft",
    },
  });
}

function buildUpdatedNotificationPreferences(
  currentPreferences: Doc<"users">["notificationPreferences"],
  smsOptIn: boolean,
  now: number,
) {
  const current = normalizeUserNotificationPreferences(currentPreferences);
  return normalizeUserNotificationPreferences({
    ...current,
    smsNotifications: smsOptIn,
    operationalSmsConsent: {
      ...current.operationalSmsConsent,
      optedIn: smsOptIn,
      optedInAt: smsOptIn
        ? current.operationalSmsConsent.optedInAt ?? now
        : current.operationalSmsConsent.optedInAt,
      optedOutAt: smsOptIn ? undefined : now,
      source: smsOptIn
        ? current.operationalSmsConsent.source ?? "booking_draft"
        : current.operationalSmsConsent.source,
    },
  });
}

async function cancelScheduledDraftJobs(
  ctx: {
    scheduler: {
      cancel: (scheduledId: Id<"_scheduled_functions">) => Promise<void>;
    };
  },
  draft: {
    holdExpiryScheduledId?: Id<"_scheduled_functions">;
    abandonedEmailScheduledId?: Id<"_scheduled_functions">;
  },
) {
  if (draft.holdExpiryScheduledId) {
    await ctx.scheduler.cancel(draft.holdExpiryScheduledId);
  }
  if (draft.abandonedEmailScheduledId) {
    await ctx.scheduler.cancel(draft.abandonedEmailScheduledId);
  }
}

async function getDraftByToken(
  ctx: { db: any },
  resumeToken: string,
): Promise<Doc<"bookingDrafts"> | null> {
  return await ctx.db
    .query("bookingDrafts")
    .withIndex("by_resume_token", (q: any) => q.eq("resumeToken", resumeToken))
    .first();
}

async function getServicesForDraft(
  ctx: { db: any },
  serviceIds: Id<"services">[],
) {
  const services = await Promise.all(serviceIds.map((serviceId) => ctx.db.get(serviceId)));
  return services.filter(
    (service): service is Doc<"services"> => service !== null,
  );
}

async function getSubscriptionPlanPriceForVehicle(
  ctx: any,
  plan: Doc<"services">,
  vehicle: {
    vehicleTypeId?: Id<"vehicleTypes">;
    size?: VehicleSize;
  },
  fallbackSize: VehicleSize,
) {
  if (vehicle.vehicleTypeId) {
    const row = await ctx.db
      .query("serviceVehiclePrices")
      .withIndex("by_service_and_vehicle_type", (q: any) =>
        q.eq("serviceId", plan._id).eq("vehicleTypeId", vehicle.vehicleTypeId),
      )
      .first();
    if (row?.isAvailable && row.price > 0) {
      return row.price;
    }
    return 0;
  }

  const size = vehicle.size ?? fallbackSize;
  const rows = await ctx.db
    .query("serviceVehiclePrices")
    .withIndex("by_service", (q: any) => q.eq("serviceId", plan._id))
    .collect();
  for (const row of rows) {
    if (!row.isAvailable || row.price <= 0) continue;
    const vehicleType = await ctx.db.get(row.vehicleTypeId);
    if (vehicleType?.legacySize === size) {
      return row.price;
    }
  }
  return getEffectiveServicePrice(plan, size);
}

async function buildDraftPricing(args: {
  ctx: any;
  serviceIds: Id<"services">[];
  vehicleCount: number;
  vehicleSize: VehicleSize;
  existingVehicles: Array<Doc<"vehicles">>;
  draftVehicles: Array<{
    year?: number;
    make?: string;
    model?: string;
    vehicleTypeId?: Id<"vehicleTypes">;
    size?: VehicleSize;
    hasPet?: boolean;
    hasHeavySoil?: boolean;
    serviceIds?: Id<"services">[];
  }>;
  existingVehicleServices?: Array<{ vehicleId: Id<"vehicles">; serviceIds: Id<"services">[] }>;
  petFeeExistingVehicleIds: Id<"vehicles">[];
  travelDistanceMiles?: number;
  subscriptionIntent?: SubscriptionIntentInput;
}): Promise<DraftPricingResult> {
  // Collect all serviceIds across all vehicles
  const allServiceIdsSet = new Set<Id<"services">>();
  args.serviceIds.forEach((id) => allServiceIdsSet.add(id));
  args.draftVehicles.forEach((v) => {
    v.serviceIds?.forEach((id) => allServiceIdsSet.add(id));
  });
  args.existingVehicleServices?.forEach((m) => {
    m.serviceIds.forEach((id) => allServiceIdsSet.add(id));
  });
  const allServiceIds = Array.from(allServiceIdsSet);
  const services = await getServicesForDraft(args.ctx, allServiceIds);

  const bookingVehicles = [
    ...args.existingVehicles.map((vehicle) => ({
      vehicleId: vehicle._id,
      vehicle,
      vehicleLabel: [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" "),
    })),
    ...args.draftVehicles.map((vehicle, index) => ({
      vehicleId: undefined,
      vehicle,
      vehicleLabel:
        [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" ") ||
        `Vehicle ${index + 1}`,
    })),
  ];

  const getVehicleServiceIds = (vehicle: (typeof bookingVehicles)[number]) => {
    if (vehicle.vehicleId) {
      const mapping = args.existingVehicleServices?.find(
        (m) => m.vehicleId === vehicle.vehicleId,
      );
      if (mapping && mapping.serviceIds.length > 0) {
        return mapping.serviceIds;
      }
      return args.serviceIds;
    }
    const draftVehicle = vehicle.vehicle as { serviceIds?: Id<"services">[] };
    if (draftVehicle.serviceIds && draftVehicle.serviceIds.length > 0) {
      return draftVehicle.serviceIds;
    }
    return args.serviceIds;
  };

  let plan: Doc<"services"> | null = null;
  let includedServiceIds: Id<"services">[] = [];
  const enrolledIndexSet = new Set<number>();
  let basePricePerCycle = 0;

  if (args.subscriptionIntent) {
    plan = await args.ctx.db.get(args.subscriptionIntent.planServiceId);
    if (!plan) {
      throw new ConvexError({
        code: "SUBSCRIPTION_PLAN_NOT_FOUND",
        message: "The selected membership plan is no longer available.",
      });
    }
    if (!plan.isActive) {
      throw new ConvexError({
        code: "SUBSCRIPTION_PLAN_NOT_AVAILABLE",
        message: "The selected membership plan is currently unavailable.",
      });
    }
    includedServiceIds = plan.includedServiceIds ?? [];
    if (includedServiceIds.length === 0) {
      throw new ConvexError({
        code: "SUBSCRIPTION_PLAN_NOT_CONFIGURED",
        message: "This membership plan has no included services configured.",
      });
    }

    const requestedIndexes = [...new Set(args.subscriptionIntent.enrolledVehicleIndexes)]
      .sort((a, b) => a - b);
    if (requestedIndexes.length === 0) {
      throw new ConvexError({
        code: "SUBSCRIPTION_VEHICLES_REQUIRED",
        message: "Select at least one vehicle for the membership.",
      });
    }

    for (const vehicleIndex of requestedIndexes) {
      const bookingVehicle = bookingVehicles[vehicleIndex];
      if (!bookingVehicle) {
        throw new ConvexError({
          code: "SUBSCRIPTION_VEHICLE_NOT_FOUND",
          message: "One of the membership vehicles is no longer available.",
        });
      }
      const vehicleServiceIds = getVehicleServiceIds(bookingVehicle);
      const vehicleServices = services.filter((service) =>
        vehicleServiceIds.includes(service._id),
      );
      const missingIncludedService = includedServiceIds.some(
        (serviceId) => !vehicleServiceIds.includes(serviceId),
      );
      if (missingIncludedService) {
        throw new ConvexError({
          code: "SUBSCRIPTION_SERVICE_REQUIRED",
          message: `${plan.name} requires ${includedServiceIds
            .map((id) => services.find((service) => service._id === id)?.name)
            .filter(Boolean)
            .join(", ")} for every enrolled vehicle.`,
        });
      }
      const disallowedService = vehicleServices.find(
        (service) =>
          !includedServiceIds.includes(service._id) &&
          service.serviceType !== "addon" &&
          service.bookingRole !== "addon",
      );
      if (disallowedService) {
        throw new ConvexError({
          code: "SUBSCRIPTION_MIXED_SERVICES",
          message: `${plan.name} can only be combined with add-ons. Remove ${disallowedService.name} or book it separately.`,
        });
      }
      const planPrice = await getSubscriptionPlanPriceForVehicle(
        args.ctx,
        plan,
        bookingVehicle.vehicle,
        args.vehicleSize,
      );
      if (planPrice <= 0) {
        throw new ConvexError({
          code: "SUBSCRIPTION_PLAN_NOT_AVAILABLE",
          message: `${plan.name} is not available for ${bookingVehicle.vehicleLabel}.`,
        });
      }
      enrolledIndexSet.add(vehicleIndex);
      basePricePerCycle += planPrice;
    }
  }

  const items: DraftPriceItem[] = [];
  let duration = 0;
  for (const [vehicleIndex, bookingVehicle] of bookingVehicles.entries()) {
    const { vehicle, vehicleId, vehicleLabel } = bookingVehicle;
    const vehicleServiceIds = getVehicleServiceIds(bookingVehicle);
    const vehicleServices = services.filter((s) => vehicleServiceIds.includes(s._id));
    assertBookableServices(vehicleServices, vehicleServiceIds, vehicle.size ?? args.vehicleSize);
    const vehicleCondition =
      "hasPet" in vehicle || "hasHeavySoil" in vehicle
        ? {
            hasPet: vehicle.hasPet,
            hasHeavySoil: vehicle.hasHeavySoil,
          }
        : {};
    for (const service of vehicleServices) {
      if (!isServiceAllowedForCondition(service, vehicleCondition)) {
        throw new ConvexError({
          code: "SERVICE_NOT_BOOKABLE",
          message: `${service.name} is not recommended for this vehicle condition. Please choose a higher-level service.`,
        });
      }
    }

    for (const service of vehicleServices) {
      let unitPrice = getEffectiveServicePrice(service, vehicle.size ?? args.vehicleSize);
      let serviceDuration = service.duration || 0;
      if (vehicle.vehicleTypeId) {
        const matrixPrice = await args.ctx.db
          .query("serviceVehiclePrices")
          .withIndex("by_service_and_vehicle_type", (q: any) =>
            q.eq("serviceId", service._id).eq("vehicleTypeId", vehicle.vehicleTypeId),
          )
          .first();
        if (matrixPrice) {
          if (!matrixPrice.isAvailable || matrixPrice.price <= 0) {
            const vehicleType = await args.ctx.db.get(vehicle.vehicleTypeId);
            throw new ConvexError({
              code: "SERVICE_NOT_BOOKABLE",
              message: `${service.name} is not available for ${vehicleType?.name ?? "this vehicle type"}.`,
            });
          }
          unitPrice = matrixPrice.price;
          serviceDuration = matrixPrice.duration || serviceDuration;
        }
      }
      duration += serviceDuration;
      if (enrolledIndexSet.has(vehicleIndex) && includedServiceIds.includes(service._id)) {
        continue;
      }
      items.push({
        itemType: "service" as const,
        serviceId: service._id,
        vehicleId,
        vehicleLabel,
        vehicleTypeId: vehicle.vehicleTypeId,
        serviceName: `${service.name} - ${vehicleLabel}`,
        quantity: 1,
        unitPrice,
        totalPrice: unitPrice,
      });
    }
  }

  if (plan && enrolledIndexSet.size > 0) {
    for (const vehicleIndex of [...enrolledIndexSet].sort((a, b) => a - b)) {
      const bookingVehicle = bookingVehicles[vehicleIndex];
      const planPrice = await getSubscriptionPlanPriceForVehicle(
        args.ctx,
        plan,
        bookingVehicle.vehicle,
        args.vehicleSize,
      );
      items.push({
        itemType: "subscription" as const,
        serviceId: plan._id,
        vehicleId: bookingVehicle.vehicleId,
        vehicleLabel: bookingVehicle.vehicleLabel,
        vehicleTypeId: bookingVehicle.vehicle.vehicleTypeId,
        serviceName: `${plan.name} - ${bookingVehicle.vehicleLabel} (first month)`,
        quantity: 1,
        unitPrice: planPrice,
        totalPrice: planPrice,
      });
    }
  }

  const petFeeSettings: {
    basePriceSmall: number;
    basePriceMedium: number;
    basePriceLarge: number;
    timeAddMinutes?: number;
    isActive: boolean;
  } = await args.ctx.runQuery(
    internal.petFeeSettings.getInternal,
    {},
  );
  const petFeeVehicleIdSet = new Set(args.petFeeExistingVehicleIds);
  const petFeeSizes = [
    ...args.existingVehicles
      .filter((vehicle) => petFeeVehicleIdSet.has(vehicle._id))
      .map((vehicle) => vehicle.size ?? "medium"),
    ...args.draftVehicles
      .filter((vehicle) => vehicle.hasPet)
      .map((vehicle) => vehicle.size ?? "medium"),
  ];
  const activePetFeeSizes: VehicleSize[] =
    petFeeSettings.isActive === false ? [] : petFeeSizes;
  const travelFeeSettings: TravelFeeSettings = await args.ctx.runQuery(
    internal.travelFeeSettings.getInternal,
    {},
  );
  const petFeeItems = (["small", "medium", "large"] as VehicleSize[])
    .map((size) => {
      const quantity = activePetFeeSizes.filter((petFeeSize) => petFeeSize === size).length;
      const unitPrice = getEffectivePetFeePrice(petFeeSettings, size);
      return {
        itemType: "pet_fee" as const,
        serviceName: `Pet fee - ${formatVehicleSizeLabel(size)} vehicle`,
        quantity,
        unitPrice,
        totalPrice: unitPrice * quantity,
      };
    })
    .filter((item) => item.quantity > 0 && item.totalPrice > 0);

  const petFeeVehicleIndexes: number[] = [];
  let petFeePerCycle = 0;
  if (plan && enrolledIndexSet.size > 0 && petFeeSettings.isActive !== false) {
    for (const vehicleIndex of enrolledIndexSet) {
      const bookingVehicle = bookingVehicles[vehicleIndex];
      const hasPetFee = bookingVehicle.vehicleId
        ? petFeeVehicleIdSet.has(bookingVehicle.vehicleId)
        : Boolean(
            (bookingVehicle.vehicle as { hasPet?: boolean }).hasPet,
          );
      if (!hasPetFee) continue;
      petFeeVehicleIndexes.push(vehicleIndex);
      petFeePerCycle += getEffectivePetFeePrice(
        petFeeSettings,
        bookingVehicle.vehicle.size ?? args.vehicleSize,
      );
    }
  }

  const travelFee: number =
    args.travelDistanceMiles !== undefined
      ? calculateTravelFeeForMiles(args.travelDistanceMiles, travelFeeSettings)
      : 0;
  const travelBufferMinutes =
    args.travelDistanceMiles !== undefined
      ? calculateTravelBufferMinutesForMiles(
          args.travelDistanceMiles,
          travelFeeSettings,
        )
      : 0;
  const travelFeeItems: DraftPriceItem[] =
    travelFee > 0 && args.travelDistanceMiles !== undefined
      ? [
          {
            itemType: "travel_fee" as const,
            serviceName: `Travel fee (${args.travelDistanceMiles.toFixed(1)} miles)`,
            quantity: 1,
            unitPrice: travelFee,
            totalPrice: travelFee,
          },
        ]
      : [];
  const priceItems = [...items, ...petFeeItems, ...travelFeeItems];

  const totalPrice = priceItems.reduce((sum, item) => sum + item.totalPrice, 0);
  duration = calculateSchedulingDuration({
    serviceDurations: [duration],
    petFeeVehicleCount: activePetFeeSizes.length,
    petFeeTimeMinutes: petFeeSettings.timeAddMinutes,
    travelBufferMinutes,
  });
  const depositSettings = await args.ctx.runQuery(
    internal.depositSettings.getInternal,
    {},
  );
  const depositPerVehicle = depositSettings?.amountPerVehicle ?? 50;
  const travelFeePerCycle = enrolledIndexSet.size > 0 ? travelFee : 0;
  const totalPerCycle = basePricePerCycle + petFeePerCycle + travelFeePerCycle;
  const depositAmount = args.subscriptionIntent
    ? 0
    : Math.min(depositPerVehicle * args.vehicleCount, totalPrice);
  const remainingBalance = args.subscriptionIntent
    ? 0
    : Math.max(0, totalPrice - depositAmount);

  return {
    services,
    items: priceItems,
    totalPrice,
    duration,
    depositAmount,
    remainingBalance,
    travelFee,
    subscriptionIntent:
      plan && enrolledIndexSet.size > 0
        ? {
            planServiceId: plan._id,
            planName: plan.name,
            frequency: args.subscriptionIntent!.frequency,
            enrolledVehicleIndexes: [...enrolledIndexSet].sort((a, b) => a - b),
            petFeeVehicleIndexes,
            basePricePerCycle,
            petFeePerCycle,
            travelFeePerCycle,
            totalPerCycle,
            firstMonthTotal: totalPerCycle,
            travelBufferMinutes,
          }
        : undefined,
  };
}

function buildClaimRedirectPath(onboardingComplete: boolean) {
  return onboardingComplete
    ? "/dashboard/appointments?payment=success"
    : "/onboarding?payment=success";
}

export const createOrUpdateInternal = internalMutation({
  args: {
    resumeToken: v.optional(v.string()),
    name: v.string(),
    email: v.string(),
    phone: v.string(),
    smsOptIn: v.optional(v.boolean()),
    address: addressValidator,
    existingVehicleIds: v.optional(v.array(v.id("vehicles"))),
    existingVehicleServices: v.optional(
      v.array(
        v.object({
          vehicleId: v.id("vehicles"),
          serviceIds: v.array(v.id("services")),
        })
      )
    ),
    vehicles: v.optional(v.array(draftVehicleValidator)),
    petFeeExistingVehicleIds: v.optional(v.array(v.id("vehicles"))),
    serviceIds: v.array(v.id("services")),
    scheduledDate: v.string(),
    scheduledTime: v.string(),
    paymentOption: v.optional(bookingPaymentOptionValidator),
    travelDistanceMiles: v.number(),
    subscriptionIntent: v.optional(subscriptionIntentInputValidator),
  },
  returns: v.object({
    draftId: v.id("bookingDrafts"),
    resumeToken: v.string(),
  }),
  handler: async (ctx, args) => {
    const authUserId = await getUserIdFromIdentity(ctx);
    const now = Date.now();
    const scheduledDate = normalizeDateKey(args.scheduledDate);
    const existingVehicleIds = args.existingVehicleIds ?? [];
    const draftVehicles = args.vehicles ?? [];
    const petFeeExistingVehicleIds = args.petFeeExistingVehicleIds ?? [];

    if (existingVehicleIds.length === 0 && draftVehicles.length === 0) {
      throw new ConvexError({
        code: "SERVICE_NOT_BOOKABLE",
        message: "Please add at least one vehicle before booking.",
      });
    }

    const existingVehicles = await Promise.all(
      existingVehicleIds.map((vehicleId) => ctx.db.get(vehicleId)),
    );
    const validExistingVehicles = existingVehicles.filter(
      (vehicle): vehicle is Doc<"vehicles"> => vehicle !== null,
    );
    if (validExistingVehicles.length !== existingVehicleIds.length) {
      throw new ConvexError({
        code: "SERVICE_NOT_BOOKABLE",
        message: "One or more selected vehicles are unavailable.",
      });
    }

    if (
      authUserId &&
      validExistingVehicles.some((vehicle) => vehicle.userId !== authUserId)
    ) {
      throw new ConvexError({
        code: "SERVICE_NOT_BOOKABLE",
        message: "You can only book using your own saved vehicles.",
      });
    }

    if (!authUserId && existingVehicleIds.length > 0) {
      throw new ConvexError({
        code: "SERVICE_NOT_BOOKABLE",
        message: "Please sign in to reuse a saved vehicle.",
      });
    }

    const existingVehicleIdSet = new Set(existingVehicleIds);
    if (petFeeExistingVehicleIds.some((vehicleId) => !existingVehicleIdSet.has(vehicleId))) {
      throw new ConvexError({
        code: "SERVICE_NOT_BOOKABLE",
        message: "Pet fee vehicles must be included in this booking.",
      });
    }

    const vehicleCount = existingVehicleIds.length + draftVehicles.length;
    const vehicleSize = getVehicleSizeForDraft({
      existingVehicles: validExistingVehicles,
      draftVehicles,
    });

    let existingDraft: Doc<"bookingDrafts"> | null = null;
    if (args.resumeToken) {
      existingDraft = await getDraftByToken(ctx, args.resumeToken);
      if (existingDraft?.status === "converted") {
        throw new ConvexError({
          code: "TIME_SLOT_UNAVAILABLE",
          message: "This booking has already been completed.",
        });
      }
    }

    const pricing = await buildDraftPricing({
      ctx,
      serviceIds: args.serviceIds,
      vehicleCount,
      vehicleSize,
      existingVehicles: validExistingVehicles,
      draftVehicles,
      existingVehicleServices: args.existingVehicleServices,
      petFeeExistingVehicleIds,
      travelDistanceMiles: args.travelDistanceMiles,
      subscriptionIntent: args.subscriptionIntent,
    });

    const paymentOption = pricing.subscriptionIntent
      ? "full"
      : (args.paymentOption ?? "deposit");

    const slotAvailability = await ctx.runQuery(api.availability.checkAvailability, {
      date: scheduledDate,
      startTime: args.scheduledTime,
      duration: pricing.duration,
      ignoreBookingDraftId: existingDraft?._id,
    });
    if (!slotAvailability.available) {
      throw new ConvexError({
        code: "TIME_SLOT_UNAVAILABLE",
        message: slotAvailability.reason || "Selected time is no longer available.",
      });
    }

    if (existingDraft) {
      await cancelScheduledDraftJobs(ctx, existingDraft);
      await ctx.db.patch(existingDraft._id, {
        sourceUserId: authUserId ?? undefined,
        customerName: args.name,
        customerEmail: normalizeEmail(args.email),
        customerPhone: args.phone,
        smsOptIn: args.smsOptIn ?? false,
        address: args.address,
        existingVehicleIds,
        existingVehicleServices: args.existingVehicleServices,
        draftVehicles,
        petFeeExistingVehicleIds,
        serviceIds: args.serviceIds,
        scheduledDate,
        scheduledTime: args.scheduledTime,
        duration: pricing.duration,
        vehicleCount,
        vehicleSize,
        totalPrice: pricing.totalPrice,
        depositAmount:
          paymentOption === "full" ? pricing.totalPrice : pricing.depositAmount,
        remainingBalance:
          paymentOption === "full" ? 0 : pricing.remainingBalance,
        paymentOption,
        priceSnapshot: pricing.items,
        subscriptionIntent: pricing.subscriptionIntent,
        travelDistanceMiles: args.travelDistanceMiles,
        travelFee: pricing.travelFee,
        status: "draft",
        stripeCheckoutSessionId: undefined,
        stripeCheckoutUrl: undefined,
        holdExpiresAt: undefined,
        holdExpiryScheduledId: undefined,
        abandonedEmailScheduledId: undefined,
        cancelledAt: undefined,
        expiredAt: undefined,
        completedAt: undefined,
        convertedAt: undefined,
        lastActivityAt: now,
      });

      return {
        draftId: existingDraft._id,
        resumeToken: existingDraft.resumeToken,
      };
    }

    const resumeToken = args.resumeToken ?? createResumeToken();
    const draftId = await ctx.db.insert("bookingDrafts", {
      sourceUserId: authUserId ?? undefined,
      customerName: args.name,
      customerEmail: normalizeEmail(args.email),
      customerPhone: args.phone,
      smsOptIn: args.smsOptIn ?? false,
      address: args.address,
      existingVehicleIds,
      existingVehicleServices: args.existingVehicleServices,
      draftVehicles,
      petFeeExistingVehicleIds,
      serviceIds: args.serviceIds,
      scheduledDate,
      scheduledTime: args.scheduledTime,
      duration: pricing.duration,
      vehicleCount,
      vehicleSize,
      totalPrice: pricing.totalPrice,
      depositAmount:
        paymentOption === "full" ? pricing.totalPrice : pricing.depositAmount,
      remainingBalance:
        paymentOption === "full" ? 0 : pricing.remainingBalance,
      paymentOption,
      priceSnapshot: pricing.items,
      subscriptionIntent: pricing.subscriptionIntent,
      travelDistanceMiles: args.travelDistanceMiles,
      travelFee: pricing.travelFee,
      status: "draft",
      resumeToken,
      lastActivityAt: now,
    });

    return { draftId, resumeToken };
  },
});

export const createOrUpdate = action({
  args: {
    resumeToken: v.optional(v.string()),
    name: v.string(),
    email: v.string(),
    phone: v.string(),
    smsOptIn: v.optional(v.boolean()),
    address: addressValidator,
    existingVehicleIds: v.optional(v.array(v.id("vehicles"))),
    existingVehicleServices: v.optional(
      v.array(
        v.object({
          vehicleId: v.id("vehicles"),
          serviceIds: v.array(v.id("services")),
        })
      )
    ),
    vehicles: v.optional(v.array(draftVehicleValidator)),
    petFeeExistingVehicleIds: v.optional(v.array(v.id("vehicles"))),
    serviceIds: v.array(v.id("services")),
    scheduledDate: v.string(),
    scheduledTime: v.string(),
    paymentOption: v.optional(bookingPaymentOptionValidator),
    subscriptionIntent: v.optional(subscriptionIntentInputValidator),
  },
  returns: v.object({
    draftId: v.id("bookingDrafts"),
    resumeToken: v.string(),
    travelDistanceMiles: v.number(),
    travelFee: v.number(),
  }),
  handler: async (ctx, args): Promise<{
    draftId: Id<"bookingDrafts">;
    resumeToken: string;
    travelDistanceMiles: number;
    travelFee: number;
  }> => {
    await assertRateLimit(ctx, "bookingDraftByEmail", {
      key: contactRateLimitKey({ email: args.email, phone: args.phone }),
      message: "Too many booking attempts. Please wait a bit and try again.",
    });

    const travel = await ctx.runAction(api.travelFees.calculate, {
      address: args.address,
    });
    const draft = await ctx.runMutation(internal.bookingDrafts.createOrUpdateInternal, {
      ...args,
      travelDistanceMiles: travel.distanceMiles,
    });
    return {
      ...draft,
      travelDistanceMiles: travel.distanceMiles,
      travelFee: travel.fee,
    };
  },
});

export const createBeforePhotoUploadUrl = mutation({
  args: {
    fileName: v.string(),
    contentType: v.string(),
  },
  returns: v.object({
    key: v.string(),
    url: v.string(),
  }),
  handler: async (ctx, args) => {
    await assertRateLimit(ctx, "beforePhotoUploadGlobal", {
      message: "Photo uploads are temporarily busy. Please try again shortly.",
    });

    validateBeforePhotoFile(args.fileName, args.contentType);
    const sanitizedFileName = args.fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
    const key = `booking-before-photos/${Date.now()}-${crypto.randomUUID()}-${sanitizedFileName}`;
    return await r2.generateUploadUrl(key);
  },
});

export const getByIdInternal = internalQuery({
  args: {
    draftId: v.id("bookingDrafts"),
  },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.draftId);
  },
});

export const getByTokenInternal = internalQuery({
  args: {
    resumeToken: v.string(),
  },
  handler: async (ctx, args) => {
    return await getDraftByToken(ctx, args.resumeToken);
  },
});

export const getSchedulingDurationInternal = internalQuery({
  args: {
    draftId: v.id("bookingDrafts"),
  },
  returns: v.number(),
  handler: async (ctx, args) => {
    const draft = await ctx.db.get(args.draftId);
    if (!draft) {
      throw new Error("Booking draft not found");
    }

    const services = await getServicesForDraft(ctx, draft.serviceIds);
    const petFeeSettings = await ctx.db.query("petFeeSettings").first();
    const travelFeeSettings = await ctx.db.query("travelFeeSettings").first();
    const petFeeExistingVehicleIdSet = new Set(draft.petFeeExistingVehicleIds ?? []);
    const existingVehicles = (
      await Promise.all(
        draft.existingVehicleIds.map((vehicleId) => ctx.db.get(vehicleId)),
      )
    ).filter((vehicle): vehicle is Doc<"vehicles"> => vehicle !== null);
    const bookingVehicles = [
      ...existingVehicles.map((vehicle) => ({
        vehicleId: vehicle._id,
        vehicleTypeId: vehicle.vehicleTypeId,
        serviceIds: undefined as Id<"services">[] | undefined,
      })),
      ...draft.draftVehicles.map((vehicle) => ({
        vehicleId: undefined,
        vehicleTypeId: vehicle.vehicleTypeId,
        serviceIds: vehicle.serviceIds,
      })),
    ];
    const serviceDurations = [];
    for (const { vehicleId, vehicleTypeId, serviceIds: draftVehicleServiceIds } of bookingVehicles) {
      let vehicleServiceIds = draft.serviceIds;
      if (vehicleId) {
        const mapping = draft.existingVehicleServices?.find((m) => m.vehicleId === vehicleId);
        if (mapping && mapping.serviceIds.length > 0) {
          vehicleServiceIds = mapping.serviceIds;
        }
      } else if (draftVehicleServiceIds && draftVehicleServiceIds.length > 0) {
        vehicleServiceIds = draftVehicleServiceIds;
      }

      const vehicleServices = services.filter((s) => vehicleServiceIds.includes(s._id));
      for (const service of vehicleServices) {
        let serviceDuration = service.duration || 0;
        if (vehicleTypeId) {
          const matrixPrice = await ctx.db
            .query("serviceVehiclePrices")
            .withIndex("by_service_and_vehicle_type", (q: any) =>
              q
                .eq("serviceId", service._id)
                .eq("vehicleTypeId", vehicleTypeId),
            )
            .first();
          if (matrixPrice?.isAvailable && matrixPrice.price > 0) {
            serviceDuration = matrixPrice.duration || serviceDuration;
          }
        }
        serviceDurations.push(serviceDuration);
      }
    }
    const petFeeVehicleCount =
      petFeeSettings?.isActive === false
        ? 0
        : existingVehicles.filter((vehicle) =>
            petFeeExistingVehicleIdSet.has(vehicle._id),
          ).length + draft.draftVehicles.filter((vehicle) => vehicle.hasPet).length;

    return calculateSchedulingDuration({
      serviceDurations,
      petFeeVehicleCount,
      petFeeTimeMinutes: petFeeSettings?.timeAddMinutes,
      travelBufferMinutes:
        draft.travelDistanceMiles !== undefined
          ? calculateTravelBufferMinutesForMiles(
              draft.travelDistanceMiles,
              travelFeeSettings ?? undefined,
            )
          : 0,
    });
  },
});

export const getByCheckoutSessionIdInternal = internalQuery({
  args: {
    checkoutSessionId: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("bookingDrafts")
      .withIndex("by_checkout_session_id", (q: any) =>
        q.eq("stripeCheckoutSessionId", args.checkoutSessionId),
      )
      .first();
  },
});

export const markCheckoutOpenInternal = internalMutation({
  args: {
    draftId: v.id("bookingDrafts"),
    stripeCheckoutSessionId: v.string(),
    stripeCheckoutUrl: v.string(),
    stripeCustomerId: v.optional(v.string()),
    holdExpiresAt: v.number(),
    holdExpiryScheduledId: v.id("_scheduled_functions"),
    abandonedEmailScheduledId: v.id("_scheduled_functions"),
  },
  handler: async (ctx, args) => {
    const draft = await ctx.db.get(args.draftId);
    if (!draft) {
      throw new Error("Booking draft not found");
    }

    await cancelScheduledDraftJobs(ctx, draft);

    await ctx.db.patch(args.draftId, {
      status: "checkout_open",
      stripeCheckoutSessionId: args.stripeCheckoutSessionId,
      stripeCheckoutUrl: args.stripeCheckoutUrl,
      stripeCustomerId: args.stripeCustomerId,
      holdExpiresAt: args.holdExpiresAt,
      holdExpiryScheduledId: args.holdExpiryScheduledId,
      abandonedEmailScheduledId: args.abandonedEmailScheduledId,
      cancelledAt: undefined,
      expiredAt: undefined,
      completedAt: undefined,
      convertedAt: undefined,
      lastActivityAt: Date.now(),
    });
  },
});

export const setCouponInternal = internalMutation({
  args: {
    draftId: v.id("bookingDrafts"),
    couponCode: v.optional(v.string()),
    couponDiscountType: v.optional(
      v.union(v.literal("percent"), v.literal("amount")),
    ),
    couponDiscountValue: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.draftId, {
      couponCode: args.couponCode,
      couponDiscountType: args.couponDiscountType,
      couponDiscountValue: args.couponDiscountValue,
      lastActivityAt: Date.now(),
    });
  },
});

export const markCancelledInternal = internalMutation({
  args: {
    draftId: v.id("bookingDrafts"),
  },
  returns: v.union(v.null(), v.object({ resumeToken: v.string() })),
  handler: async (ctx, args) => {
    const draft = await ctx.db.get(args.draftId);
    if (!draft) {
      return null;
    }
    if (draft.status === "converted") {
      return { resumeToken: draft.resumeToken };
    }

    await cancelScheduledDraftJobs(ctx, draft);
    await ctx.db.patch(args.draftId, {
      status: "cancelled",
      cancelledAt: Date.now(),
      holdExpiryScheduledId: undefined,
      abandonedEmailScheduledId: undefined,
      holdExpiresAt: undefined,
      lastActivityAt: Date.now(),
    });

    return { resumeToken: draft.resumeToken };
  },
});

export const markExpiredInternal = internalMutation({
  args: {
    draftId: v.id("bookingDrafts"),
  },
  handler: async (ctx, args) => {
    const draft = await ctx.db.get(args.draftId);
    if (!draft || draft.status === "converted") {
      return null;
    }

    await cancelScheduledDraftJobs(ctx, draft);
    await ctx.db.patch(args.draftId, {
      status: "expired",
      expiredAt: Date.now(),
      holdExpiryScheduledId: undefined,
      abandonedEmailScheduledId: undefined,
      holdExpiresAt: undefined,
      lastActivityAt: Date.now(),
    });

    return null;
  },
});

export const markAbandonedEmailSentInternal = internalMutation({
  args: {
    draftId: v.id("bookingDrafts"),
  },
  handler: async (ctx, args) => {
    const draft = await ctx.db.get(args.draftId);
    if (!draft) {
      return null;
    }

    await ctx.db.patch(args.draftId, {
      abandonedEmailSentAt: Date.now(),
      lastActivityAt: Date.now(),
    });

    return null;
  },
});

function getDraftCouponDiscount(draft: Doc<"bookingDrafts">): {
  couponCode?: string;
  discountAmount: number;
  discountedTotal: number;
} {
  const hasCouponSnapshot =
    !!draft.couponCode &&
    !!draft.couponDiscountType &&
    draft.couponDiscountValue != null &&
    draft.couponDiscountValue > 0;
  const discountAmount = hasCouponSnapshot
    ? draft.couponDiscountType === "percent"
      ? Math.round(
          draft.totalPrice * ((draft.couponDiscountValue ?? 0) / 100) * 100,
        ) / 100
      : Math.min(draft.couponDiscountValue ?? 0, draft.totalPrice)
    : 0;
  return {
    couponCode: discountAmount > 0 ? draft.couponCode : undefined,
    discountAmount,
    discountedTotal: Math.max(
      0,
      Math.round((draft.totalPrice - discountAmount) * 100) / 100,
    ),
  };
}

export const convertSuccessfulCheckout = internalMutation({
  args: {
    draftId: v.id("bookingDrafts"),
    stripeCustomerId: v.optional(v.string()),
    paymentIntentId: v.optional(v.string()),
  },
  returns: v.union(
    v.null(),
    v.object({
      appointmentId: v.id("appointments"),
      invoiceId: v.id("invoices"),
      userId: v.id("users"),
      paymentOption: bookingPaymentOptionValidator,
      isFullPayment: v.boolean(),
      total: v.number(),
    }),
  ),
  handler: async (
    ctx,
    args,
  ): Promise<ConvertedDraftResult | null> => {
    const draft = await ctx.db.get(args.draftId);
    if (!draft) {
      return null;
    }

    if (draft.status === "converted" && draft.convertedAppointmentId && draft.convertedInvoiceId && draft.convertedUserId) {
      return {
        appointmentId: draft.convertedAppointmentId,
        invoiceId: draft.convertedInvoiceId,
        userId: draft.convertedUserId,
        paymentOption: draft.paymentOption,
        isFullPayment: draft.paymentOption === "full",
        total: getDraftCouponDiscount(draft).discountedTotal,
      };
    }

    await cancelScheduledDraftJobs(ctx, draft);
    await ctx.db.patch(draft._id, {
      status: "completed",
      completedAt: Date.now(),
      holdExpiryScheduledId: undefined,
      abandonedEmailScheduledId: undefined,
      holdExpiresAt: undefined,
      lastActivityAt: Date.now(),
    });

    let user =
      (draft.sourceUserId ? await ctx.db.get(draft.sourceUserId) : null) ??
      (await ctx.db
        .query("users")
        .withIndex("by_email", (q: any) => q.eq("email", draft.customerEmail))
        .first());

    const now = Date.now();
    if (user) {
      const updates: Record<string, unknown> = {};
      if (!user.name || user.name === user.email) {
        updates.name = draft.customerName;
      }
      if (!user.phone) {
        updates.phone = draft.customerPhone;
      }
      if (!user.address) {
        updates.address = {
          street: draft.address.street,
          city: draft.address.city,
          state: draft.address.state,
          zip: draft.address.zip,
        };
      }
      if (args.stripeCustomerId && !user.stripeCustomerId) {
        updates.stripeCustomerId = args.stripeCustomerId;
      }
      updates.notificationPreferences = buildUpdatedNotificationPreferences(
        user.notificationPreferences,
        draft.smsOptIn ?? false,
        now,
      );
      if (Object.keys(updates).length > 0) {
        await ctx.db.patch(user._id, updates);
        user = {
          ...user,
          ...updates,
        } as Doc<"users">;
      }
    } else {
      const userId = await ctx.db.insert("users", {
        name: draft.customerName,
        email: draft.customerEmail,
        phone: draft.customerPhone,
        address: {
          street: draft.address.street,
          city: draft.address.city,
          state: draft.address.state,
          zip: draft.address.zip,
        },
        role: "client",
        timesServiced: 0,
        totalSpent: 0,
        status: "active",
        cancellationCount: 0,
        stripeCustomerId: args.stripeCustomerId,
        notificationPreferences: buildBookingNotificationPreferences(
          draft.smsOptIn ?? false,
          now,
        ),
      });
      user = await ctx.db.get(userId);
    }

    if (!user) {
      throw new Error("Unable to create booking user");
    }

    const createdVehicleIds: Id<"vehicles">[] = [];
    const createdPetFeeVehicleIds: Id<"vehicles">[] = [];
    const beforePhotos: Array<{
      vehicleId: Id<"vehicles">;
      vehicleLabel: string;
      key: string;
      fileName: string;
      contentType: string;
      sizeBytes: number;
      uploadedAt: number;
    }> = [];
    for (const draftVehicle of draft.draftVehicles) {
      const vehicleId = await ctx.db.insert("vehicles", {
        userId: user._id,
        year: draftVehicle.year,
        make: draftVehicle.make,
        model: draftVehicle.model,
        vehicleTypeId: draftVehicle.vehicleTypeId,
        classification: draftVehicle.classification,
        size: draftVehicle.size,
        color: draftVehicle.color,
        licensePlate: draftVehicle.licensePlate,
      });
      createdVehicleIds.push(vehicleId);
      const vehicleLabel = `${draftVehicle.year} ${draftVehicle.make} ${draftVehicle.model}`;
      for (const photo of draftVehicle.beforePhotos ?? []) {
        beforePhotos.push({
          vehicleId,
          vehicleLabel,
          ...photo,
        });
      }
      if (draftVehicle.hasPet) {
        createdPetFeeVehicleIds.push(vehicleId);
      }
    }

    const existingVehicles = await Promise.all(
      draft.existingVehicleIds.map((vehicleId) => ctx.db.get(vehicleId)),
    );
    const validExistingVehicleIds = existingVehicles
      .filter(
        (vehicle): vehicle is NonNullable<typeof vehicle> =>
          vehicle !== null && vehicle.userId === user._id,
      )
      .map((vehicle) => vehicle._id);

    if (validExistingVehicleIds.length !== draft.existingVehicleIds.length) {
      throw new Error(
        "One or more selected vehicles are no longer available. Please contact support so we can finalize this booking.",
      );
    }

    const vehicleIds = [...validExistingVehicleIds, ...createdVehicleIds] as Id<"vehicles">[];
    if (vehicleIds.length === 0) {
      throw new Error("Bookings require at least one vehicle.");
    }
    const validExistingPetFeeVehicleIds = validExistingVehicleIds.filter((vehicleId) =>
      (draft.petFeeExistingVehicleIds ?? []).includes(vehicleId),
    );
    const petFeeVehicleIds = [
      ...validExistingPetFeeVehicleIds,
      ...createdPetFeeVehicleIds,
    ];

    const vehicleServices: Array<{ vehicleId: Id<"vehicles">; serviceIds: Id<"services">[] }> = [];
    for (const vehicleId of validExistingVehicleIds) {
      const mapping = draft.existingVehicleServices?.find((m) => m.vehicleId === vehicleId);
      const serviceIds = mapping && mapping.serviceIds.length > 0
        ? mapping.serviceIds
        : draft.serviceIds;
      vehicleServices.push({ vehicleId, serviceIds });
    }
    draft.draftVehicles.forEach((draftVehicle, idx) => {
      const vehicleId = createdVehicleIds[idx];
      const serviceIds = draftVehicle.serviceIds && draftVehicle.serviceIds.length > 0
        ? draftVehicle.serviceIds
        : draft.serviceIds;
      vehicleServices.push({ vehicleId, serviceIds });
    });

    let notes = "Created via checkout conversion";
    if (!isArkansasState(draft.address.state)) {
      notes = `⚠️ OUT-OF-STATE BOOKING: Requires manual admin review. ${notes}`;
    }

    const appointmentId = await ctx.db.insert("appointments", {
      userId: user._id,
      vehicleIds,
      serviceIds: draft.serviceIds,
      vehicleServices,
      scheduledDate: draft.scheduledDate,
      scheduledTime: draft.scheduledTime,
      duration: draft.duration,
      location: {
        street: draft.address.street,
        city: draft.address.city,
        state: draft.address.state,
        zip: draft.address.zip,
        notes: draft.address.notes,
      },
      status: "pending",
      totalPrice: draft.totalPrice,
      notes,
      createdBy: user._id,
      paymentOption: draft.paymentOption,
      petFeeVehicleIds,
      beforePhotos: beforePhotos.length > 0 ? beforePhotos : undefined,
      travelDistanceMiles: draft.travelDistanceMiles,
      travelFee: draft.travelFee,
    });

    const invoiceCountResult: { count: number } = await ctx.runQuery(
      internal.invoices.getCountInternal,
      {},
    );
    const invoiceNumber: string = `INV-${String(invoiceCountResult.count + 1).padStart(4, "0")}`;
    const dueDate = getInvoiceDueDateFromDateKey(draft.scheduledDate);
    const today = new Date().toISOString().split("T")[0];
    const isFullPayment = draft.paymentOption === "full";

    const couponDiscount = getDraftCouponDiscount(draft);
    const discountAmount = couponDiscount.discountAmount;
    const discountedTotal = couponDiscount.discountedTotal;

    const invoiceId: Id<"invoices"> = await ctx.db.insert("invoices", {
      appointmentId,
      userId: user._id,
      invoiceNumber,
      items: draft.priceSnapshot,
      subtotal: draft.totalPrice,
      tax: 0,
      total: discountedTotal,
      status: isFullPayment ? "paid" : "draft",
      dueDate,
      paidDate: isFullPayment ? today : undefined,
      notes: `Invoice for appointment on ${draft.scheduledDate}`,
      depositAmount: isFullPayment ? discountedTotal : draft.depositAmount,
      depositPaid: true,
      depositPaymentIntentId: args.paymentIntentId,
      remainingBalance: isFullPayment
        ? 0
        : Math.max(0, Math.round((discountedTotal - draft.depositAmount) * 100) / 100),
      paymentOption: draft.paymentOption,
      remainingBalanceCollectionMethod:
        draft.paymentOption === "deposit" ? "send_invoice" : undefined,
      couponCode: discountAmount > 0 ? draft.couponCode : undefined,
      discountAmount: discountAmount > 0 ? discountAmount : undefined,
    });

    let convertedSubscriptionId: Id<"subscriptions"> | undefined;
    if (draft.subscriptionIntent) {
      const intent = draft.subscriptionIntent;
      const enrolledVehicleIds = intent.enrolledVehicleIndexes.map(
        (index) => vehicleIds[index],
      );
      if (
        enrolledVehicleIds.length !== intent.enrolledVehicleIndexes.length ||
        enrolledVehicleIds.some((vehicleId) => !vehicleId)
      ) {
        throw new Error(
          "One or more membership vehicles are no longer available. Please contact support so we can finalize this booking.",
        );
      }
      const petFeeVehicleIdsForSubscription = intent.petFeeVehicleIndexes
        .map((index) => vehicleIds[index])
        .filter((vehicleId): vehicleId is Id<"vehicles"> => Boolean(vehicleId));
      const plan = await ctx.db.get(intent.planServiceId);
      if (!plan) {
        throw new Error("The selected membership plan is no longer available.");
      }
      const includedServiceIds = plan.includedServiceIds ?? [];
      if (includedServiceIds.length === 0) {
        throw new Error("The selected membership plan has no included services.");
      }
      const nextScheduledDate = computeNextSubscriptionDate(
        intent.frequency,
        draft.scheduledDate,
      );
      convertedSubscriptionId = await ctx.db.insert("subscriptions", {
        userId: user._id,
        serviceIds: includedServiceIds,
        vehicleIds: enrolledVehicleIds as Id<"vehicles">[],
        frequency: intent.frequency,
        preferredDayOfWeek: new Date(`${draft.scheduledDate}T12:00:00`).getDay(),
        preferredTime: draft.scheduledTime,
        location: {
          street: draft.address.street,
          city: draft.address.city,
          state: draft.address.state,
          zip: draft.address.zip,
          notes: draft.address.notes,
        },
        totalPrice: intent.totalPerCycle,
        planServiceId: intent.planServiceId,
        basePricePerCycle: intent.basePricePerCycle,
        petFeePerCycle: intent.petFeePerCycle,
        travelFeePerCycle: intent.travelFeePerCycle,
        petFeeVehicleIds: petFeeVehicleIdsForSubscription,
        travelBufferMinutes: intent.travelBufferMinutes,
        startDate: draft.scheduledDate,
        status: "active",
        nextScheduledDate,
        lastAppointmentId: appointmentId,
        createdBy: user._id,
        notes: "Created from booking membership",
      });

      await ctx.scheduler.runAfter(
        0,
        internal.subscriptions.createStripeSubscriptionFromBooking,
        { subscriptionId: convertedSubscriptionId },
      );
      await ctx.scheduler.runAfter(
        0,
        internal.subscriptions.createNextAppointment,
        {
          subscriptionId: convertedSubscriptionId,
          mode: "preschedule",
        },
      );
    }

    await ctx.db.patch(draft._id, {
      sourceUserId: user._id,
      status: "converted",
      convertedAt: Date.now(),
      convertedUserId: user._id,
      convertedAppointmentId: appointmentId,
      convertedInvoiceId: invoiceId,
      convertedSubscriptionId,
      stripeCustomerId: args.stripeCustomerId ?? draft.stripeCustomerId,
      lastActivityAt: Date.now(),
    });

    return {
      appointmentId,
      invoiceId,
      userId: user._id,
      paymentOption: draft.paymentOption,
      isFullPayment,
      total: discountedTotal,
    };
  },
});

export const getPublicContext = query({
  args: {
    token: v.string(),
  },
  handler: async (ctx, args) => {
    const draft = await getDraftByToken(ctx, args.token);
    if (!draft) {
      return null;
    }

    const services = await getServicesForDraft(ctx, draft.serviceIds);

    return {
      token: draft.resumeToken,
      status: draft.status,
      email: draft.customerEmail,
      name: draft.customerName,
      phone: draft.customerPhone,
      smsOptIn: draft.smsOptIn ?? false,
      scheduledDate: draft.scheduledDate,
      scheduledTime: draft.scheduledTime,
      serviceIds: draft.serviceIds,
      serviceNames: services.map((service) => service.name),
      address: draft.address,
      vehicles: draft.draftVehicles.map((vehicle) => ({
        year: String(vehicle.year),
        make: vehicle.make,
        model: vehicle.model,
        color: vehicle.color,
        licensePlate: vehicle.licensePlate,
        vehicleTypeId: vehicle.vehicleTypeId,
        classification: vehicle.classification,
        size: vehicle.size,
        hasPet: vehicle.hasPet ?? false,
        hasHeavySoil: vehicle.hasHeavySoil ?? false,
        beforePhotos: vehicle.beforePhotos ?? [],
      })),
      existingVehicleIds: draft.existingVehicleIds,
      petFeeExistingVehicleIds: draft.petFeeExistingVehicleIds ?? [],
      paymentOption: draft.paymentOption,
      travelDistanceMiles: draft.travelDistanceMiles,
      travelFee: draft.travelFee,
      convertedAppointmentId: draft.convertedAppointmentId,
      convertedInvoiceId: draft.convertedInvoiceId,
      convertedUserId: draft.convertedUserId,
      convertedSubscriptionId: draft.convertedSubscriptionId,
      subscription: draft.subscriptionIntent
        ? {
            planName: draft.subscriptionIntent.planName,
            frequency: draft.subscriptionIntent.frequency,
            totalPerCycle: draft.subscriptionIntent.totalPerCycle,
            firstMonthTotal: draft.subscriptionIntent.firstMonthTotal,
            nextChargeDate: computeNextSubscriptionDate(
              draft.subscriptionIntent.frequency,
              draft.scheduledDate,
            ),
            active: Boolean(draft.convertedSubscriptionId),
          }
        : null,
      abandonedEmailSentAt: draft.abandonedEmailSentAt,
      cancelledAt: draft.cancelledAt,
      expiredAt: draft.expiredAt,
    };
  },
});

export const claimConvertedDraft = mutation({
  args: {
    token: v.string(),
  },
  returns: v.object({
    redirectPath: v.string(),
  }),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity?.subject) {
      throw new ConvexError("You need to sign in before claiming this booking.");
    }

    const draft = await getDraftByToken(ctx, args.token);
    if (!draft || !draft.convertedUserId) {
      throw new ConvexError(
        "We’re still finalizing this booking. Please refresh in a moment.",
      );
    }

    const currentUserId = await getUserIdFromIdentity(ctx);
    const normalizedDraftEmail = normalizeEmail(draft.customerEmail);
    const normalizedIdentityEmail = normalizeEmail(
      getNormalizedIdentityEmail(identity),
    );

    if (
      draft.claimedAt &&
      draft.claimedByClerkUserId &&
      draft.claimedByClerkUserId !== identity.subject
    ) {
      throw new ConvexError("This booking has already been claimed.");
    }

    if (currentUserId && currentUserId !== draft.convertedUserId) {
      throw new ConvexError(
        "This signed-in account is already linked to a different customer record. Please sign in with the booking email instead.",
      );
    }

    if (!currentUserId && normalizedIdentityEmail !== normalizedDraftEmail) {
      throw new ConvexError(
        `This booking was created with ${draft.customerEmail}. Sign in or create an account with that email to attach it.`,
      );
    }

    const bookingUser = await ctx.db.get(draft.convertedUserId);
    if (!bookingUser) {
      throw new ConvexError("We couldn't find the booking attached to this link.");
    }

    if (
      bookingUser.clerkUserId &&
      bookingUser.clerkUserId !== identity.subject &&
      currentUserId !== bookingUser._id
    ) {
      throw new ConvexError(
        "This booking is already linked to another account. Please contact support if that looks wrong.",
      );
    }

    if (!bookingUser.clerkUserId) {
      await ctx.db.patch(bookingUser._id, {
        clerkUserId: identity.subject,
      });
    }

    if (!draft.claimedAt) {
      await ctx.db.patch(draft._id, {
        claimedAt: Date.now(),
        claimedByClerkUserId: identity.subject,
        lastActivityAt: Date.now(),
      });
    }

    const vehicles = await ctx.db
      .query("vehicles")
      .withIndex("by_user", (q: any) => q.eq("userId", bookingUser._id))
      .collect();

    const onboardingComplete = Boolean(
      bookingUser.name &&
        bookingUser.phone &&
        bookingUser.address &&
        vehicles.length > 0,
    );

    return {
      redirectPath: buildClaimRedirectPath(onboardingComplete),
    };
  },
});

export const listAbandonedForAdmin = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);

    const drafts = await ctx.db.query("bookingDrafts").collect();
    return await Promise.all(
      drafts
      .filter((draft) => {
        if (draft.status === "draft") {
          return false;
        }
        if (draft.status === "converted") {
          return Boolean(draft.abandonedEmailSentAt);
        }
        return true;
      })
      .sort((a, b) => b.lastActivityAt - a.lastActivityAt)
      .slice(0, 100)
      .map(async (draft) => {
        const services = await getServicesForDraft(ctx, draft.serviceIds);
        return {
        _id: draft._id,
        email: draft.customerEmail,
        name: draft.customerName,
        phone: draft.customerPhone,
        scheduledDate: draft.scheduledDate,
        scheduledTime: draft.scheduledTime,
        status: draft.status,
        paymentOption: draft.paymentOption,
        totalPrice: draft.totalPrice,
        serviceNames: services.map((service) => service.name),
        resumeToken: draft.resumeToken,
        abandonedEmailSentAt: draft.abandonedEmailSentAt,
        holdExpiresAt: draft.holdExpiresAt,
        lastActivityAt: draft.lastActivityAt,
        recovered: draft.status === "converted",
        };
      }),
    );
  },
});

export const repairLegacyPendingBookings = mutation({
  args: {
    dryRun: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const dryRun = args.dryRun ?? true;
    const appointments = await ctx.db.query("appointments").collect();
    const invoices = await ctx.db.query("invoices").collect();
    const invoiceByAppointment = new Map(
      invoices.map((invoice) => [invoice.appointmentId, invoice]),
    );

    const candidates = appointments.filter((appointment) => {
      const invoice = invoiceByAppointment.get(appointment._id);
      return (
        appointment.status === "pending" &&
        appointment.notes === "Created via marketing site booking" &&
        !!invoice &&
        !invoice.depositPaid &&
        invoice.status === "draft" &&
        !invoice.paidDate &&
        !invoice.stripePaymentIntentId &&
        !invoice.depositPaymentIntentId &&
        !invoice.finalPaymentIntentId &&
        !invoice.stripeInvoiceId
      );
    });

    const summary = {
      scanned: appointments.length,
      candidates: candidates.length,
      removedAppointments: 0,
      removedInvoices: 0,
      removedVehicles: 0,
      dryRun,
    };

    if (dryRun) {
      return summary;
    }

    for (const appointment of candidates) {
      const invoice = invoiceByAppointment.get(appointment._id);
      if (appointment.reminderScheduledId) {
        await ctx.scheduler.cancel(appointment.reminderScheduledId);
      }
      if (invoice) {
        await ctx.db.delete(invoice._id);
        summary.removedInvoices += 1;
      }
      await ctx.db.delete(appointment._id);
      summary.removedAppointments += 1;

      for (const vehicleId of appointment.vehicleIds) {
        const vehicle = await ctx.db.get(vehicleId);
        if (!vehicle) {
          continue;
        }
        const otherAppointments = (await ctx.db.query("appointments").collect()).filter(
          (otherAppointment) =>
            otherAppointment._id !== appointment._id &&
            otherAppointment.vehicleIds.includes(vehicleId),
        );
        if (otherAppointments.length > 0) {
          continue;
        }
        const siblingVehicles = await ctx.db
          .query("vehicles")
          .withIndex("by_user", (q: any) => q.eq("userId", vehicle.userId))
          .collect();
        const duplicate = siblingVehicles.find(
          (candidate) =>
            candidate._id !== vehicle._id &&
            candidate.year === vehicle.year &&
            candidate.make === vehicle.make &&
            candidate.model === vehicle.model &&
            (candidate.color ?? "") === (vehicle.color ?? "") &&
            (candidate.licensePlate ?? "") === (vehicle.licensePlate ?? ""),
        );
        if (duplicate) {
          await ctx.db.delete(vehicle._id);
          summary.removedVehicles += 1;
        }
      }
    }

    return summary;
  },
});

export const getSchedulerDefaults = query({
  args: {},
  handler: async () => {
    return {
      holdDurationMs: HOLD_DURATION_MS,
      abandonedEmailDelayMs: ABANDONED_EMAIL_DELAY_MS,
    };
  },
});

export const saveOutOfAreaLead = mutation({
  args: {
    email: v.string(),
    address: v.string(),
    latitude: v.optional(v.number()),
    longitude: v.optional(v.number()),
  },
  returns: v.id("outOfAreaLeads"),
  handler: async (ctx, args) => {
    await assertRateLimit(ctx, "outOfAreaLeadByEmail", {
      key: contactRateLimitKey({ email: args.email }),
      message: "We received several requests for this email. Please try again later.",
    });

    return await ctx.db.insert("outOfAreaLeads", {
      email: args.email,
      address: args.address,
      latitude: args.latitude,
      longitude: args.longitude,
      createdAt: Date.now(),
    });
  },
});

export const saveOutOfAreaRequest = mutation({
  args: {
    name: v.string(),
    email: v.string(),
    phone: v.string(),
    smsOptIn: v.optional(v.boolean()),
    address: addressValidator,
    scheduledDate: v.optional(v.string()),
    scheduledTime: v.optional(v.string()),
    vehicle: v.optional(outOfAreaRequestVehicleValidator),
    estimatedDistanceMiles: v.optional(v.number()),
    estimatedTravelFee: v.optional(v.number()),
  },
  returns: v.id("outOfAreaRequests"),
  handler: async (ctx, args) => {
    await assertRateLimit(ctx, "outOfAreaRequestByContact", {
      key: contactRateLimitKey({ email: args.email, phone: args.phone }),
      message: "We received several review requests from this contact. Please try again later.",
    });

    const now = Date.now();
    const requestId = await ctx.db.insert("outOfAreaRequests", {
      customerName: args.name.trim(),
      customerEmail: normalizeEmail(args.email),
      customerPhone: args.phone.trim(),
      smsOptIn: args.smsOptIn,
      address: args.address,
      scheduledDate: args.scheduledDate,
      scheduledTime: args.scheduledTime,
      vehicle: args.vehicle,
      estimatedDistanceMiles: args.estimatedDistanceMiles,
      estimatedTravelFee: args.estimatedTravelFee,
      status: "new",
      createdAt: now,
      updatedAt: now,
    });

    await ctx.scheduler.runAfter(
      0,
      internal.emails.sendAdminOutOfAreaRequestNotification,
      { requestId },
    );

    return requestId;
  },
});

export const listOutOfAreaRequestsForAdmin = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);

    const requests = await ctx.db.query("outOfAreaRequests").collect();
    return requests.sort((a, b) => b.createdAt - a.createdAt);
  },
});

export const getOutOfAreaRequestCount = query({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    await requireAdmin(ctx);

    const requests = await ctx.db
      .query("outOfAreaRequests")
      .withIndex("by_status", (q) => q.eq("status", "new"))
      .collect();
    return requests.length;
  },
});

export const updateOutOfAreaRequestStatus = mutation({
  args: {
    requestId: v.id("outOfAreaRequests"),
    status: outOfAreaRequestStatusValidator,
    adminNotes: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    await ctx.db.patch(args.requestId, {
      status: args.status,
      adminNotes: args.adminNotes,
      updatedAt: Date.now(),
    });

    return null;
  },
});

export const getOutOfAreaRequestInternal = internalQuery({
  args: {
    requestId: v.id("outOfAreaRequests"),
  },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.requestId);
  },
});
