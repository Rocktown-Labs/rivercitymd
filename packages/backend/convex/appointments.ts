import {
  query,
  mutation,
  action,
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { ConvexError, v } from "convex/values";
import { getUserIdFromIdentity, requireAdmin, isAdmin } from "./auth";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  BOOKING_BLOCK_MINUTES,
  calculateSchedulingDuration,
  normalizeDateKey,
} from "./lib/booking";
import {
  getEffectivePetFeePrice,
  getEffectiveServicePrice,
  normalizeServiceType,
  type VehicleSize,
} from "./lib/pricing";
import { calculateTravelBufferMinutesForMiles } from "./lib/travelFees";
import {
  getInvoiceDueDateFromDate,
  getInvoiceDueDateFromDateKey,
  REMAINING_BALANCE_DUE_DAYS,
} from "./lib/invoices";
import { r2 } from "./r2";

interface StripeInvoiceVehicleInput {
  size?: "small" | "medium" | "large";
}

type InvoiceItem = {
  itemType?: "service" | "subscription" | "pet_fee" | "travel_fee";
  serviceId?: Id<"services">;
  vehicleId?: Id<"vehicles">;
  vehicleLabel?: string;
  vehicleTypeId?: Id<"vehicleTypes">;
  serviceName: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
};

type InvoiceAction =
  | "none"
  | "updated_open_invoice"
  | "supplemental_invoice_created"
  | "manual_credit_required";

const workAdjustmentArgs = {
  appointmentId: v.id("appointments"),
  vehicleIds: v.array(v.id("vehicles")),
  serviceIds: v.array(v.id("services")),
  petFeeVehicleIds: v.optional(v.array(v.id("vehicles"))),
  reason: v.string(),
  vehicleServices: v.optional(
    v.array(
      v.object({
        vehicleId: v.id("vehicles"),
        serviceIds: v.array(v.id("services")),
      })
    )
  ),
} as const;

function getVehicleSize(
  vehicles: Array<StripeInvoiceVehicleInput>,
): "small" | "medium" | "large" {
  return vehicles[0]?.size || "medium";
}

function formatVehicleSizeLabel(size: VehicleSize) {
  if (size === "small") return "Small";
  if (size === "large") return "Large";
  return "Medium";
}

async function buildPetFeeItems(
  ctx: any,
  vehicles: Array<{ _id: Id<"vehicles">; size?: VehicleSize }>,
  petFeeVehicleIds: Id<"vehicles">[],
) {
  const petFeeSettings = await ctx.runQuery(internal.petFeeSettings.getInternal, {});
  const petFeeVehicleIdSet = new Set(petFeeVehicleIds);
  const petFeeSizes = vehicles
    .filter((vehicle) => petFeeVehicleIdSet.has(vehicle._id))
    .map((vehicle) => vehicle.size ?? "medium");
  const activePetFeeSizes = petFeeSettings.isActive === false ? [] : petFeeSizes;

  const items = (["small", "medium", "large"] as VehicleSize[])
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

  return {
    items,
    petFeeVehicleCount: activePetFeeSizes.length,
    petFeeTimeMinutes:
      petFeeSettings.isActive === false ? 0 : petFeeSettings.timeAddMinutes,
  };
}

function getTravelFeeLineItem(
  distanceMiles: number | undefined,
  fee: number,
): InvoiceItem | null {
  if (fee <= 0) return null;
  return {
    itemType: "travel_fee",
    serviceName:
      distanceMiles === undefined
        ? "Travel fee"
        : `Travel fee (${distanceMiles.toFixed(1)} miles)`,
    quantity: 1,
    unitPrice: fee,
    totalPrice: fee,
  };
}

function getTravelFeeTotalFromItems(items: InvoiceItem[] | undefined) {
  return (items ?? [])
    .filter((item) => item.itemType === "travel_fee")
    .reduce((sum, item) => sum + item.totalPrice, 0);
}

function getInvoiceTotalAfterDiscount(
  subtotal: number,
  tax: number,
  discountAmount: number | undefined,
) {
  return Math.max(
    0,
    Math.round((subtotal + tax - (discountAmount ?? 0)) * 100) / 100,
  );
}

async function buildStoredTravelFeePricing(
  ctx: any,
  appointment: Pick<Doc<"appointments">, "travelDistanceMiles" | "travelFee">,
) {
  const distanceMiles = appointment.travelDistanceMiles;
  const fee = appointment.travelFee ?? 0;

  const item = getTravelFeeLineItem(distanceMiles, fee);
  if (!item) {
    return { items: [] as InvoiceItem[], travelBufferMinutes: 0 };
  }

  const settings = await ctx.runQuery(internal.travelFeeSettings.getInternal, {});
  return {
    items: [item],
    travelBufferMinutes:
      distanceMiles === undefined
        ? 0
        : calculateTravelBufferMinutesForMiles(distanceMiles, settings),
  };
}

function formatVehicleLabel(vehicle: {
  year?: number;
  make?: string;
  model?: string;
}) {
  return [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" ");
}

async function getMatrixPriceForServiceAndVehicle(
  ctx: any,
  service: Doc<"services">,
  vehicle: Doc<"vehicles">,
) {
  if (!vehicle.vehicleTypeId) {
    const vehicleSize = vehicle.size ?? "medium";
    return {
      unitPrice: getEffectiveServicePrice(service, vehicleSize),
      duration: service.duration || 0,
      vehicleTypeId: undefined,
    };
  }

  const matrixPrice = await ctx.db
    .query("serviceVehiclePrices")
    .withIndex("by_service_and_vehicle_type", (q: any) =>
      q.eq("serviceId", service._id).eq("vehicleTypeId", vehicle.vehicleTypeId),
    )
    .first();

  if (!matrixPrice) {
    const vehicleType = await ctx.db.get(vehicle.vehicleTypeId);
    return {
      unitPrice: getEffectiveServicePrice(
        service,
        vehicleType?.legacySize ?? vehicle.size ?? "medium",
      ),
      duration: service.duration || 0,
      vehicleTypeId: vehicle.vehicleTypeId,
    };
  }

  if (!matrixPrice.isAvailable || matrixPrice.price <= 0) {
    const vehicleType = await ctx.db.get(vehicle.vehicleTypeId);
    throw new ConvexError({
      code: "SERVICE_NOT_BOOKABLE",
      message: `Service "${service.name.trim()}" is not available for ${vehicleType?.name ?? "this vehicle type"}.`,
    });
  }

  return {
    unitPrice: matrixPrice.price,
    duration: matrixPrice.duration || service.duration || 0,
    vehicleTypeId: vehicle.vehicleTypeId,
  };
}

async function buildVehicleServiceItems(
  ctx: any,
  services: Array<Doc<"services">>,
  vehicles: Array<Doc<"vehicles">>,
  vehicleServices?: Array<{ vehicleId: Id<"vehicles">; serviceIds: Id<"services">[] }>,
) {
  const items = [];
  let duration = 0;

  for (const vehicle of vehicles) {
    const vehicleLabel = formatVehicleLabel(vehicle);
    let vehicleServiceList = services;
    if (vehicleServices) {
      const mapping = vehicleServices.find((m) => m.vehicleId === vehicle._id);
      if (mapping && mapping.serviceIds.length > 0) {
        vehicleServiceList = services.filter((s) => mapping.serviceIds.includes(s._id));
      }
    }
    for (const service of vehicleServiceList) {
      const pricing = await getMatrixPriceForServiceAndVehicle(ctx, service, vehicle);
      duration += pricing.duration;
      items.push({
        itemType: "service" as const,
        serviceId: service._id,
        vehicleId: vehicle._id,
        vehicleLabel,
        vehicleTypeId: pricing.vehicleTypeId,
        serviceName: `${service.name} - ${vehicleLabel}`,
        quantity: 1,
        unitPrice: pricing.unitPrice,
        totalPrice: pricing.unitPrice,
      });
    }
  }

  return { items, duration };
}

function buildUpdatedVehicleServices(
  existingVehicleServices: Array<{ vehicleId: Id<"vehicles">; serviceIds: Id<"services">[] }> | undefined,
  newVehicleIds: Id<"vehicles">[],
  newServiceIds: Id<"services">[],
): Array<{ vehicleId: Id<"vehicles">; serviceIds: Id<"services">[] }> {
  if (newVehicleIds.length === 1) {
    return [{ vehicleId: newVehicleIds[0], serviceIds: newServiceIds }];
  }
  const existing = existingVehicleServices ?? [];

  return newVehicleIds.map((vehicleId) => {
    const match = existing.find((m) => m.vehicleId === vehicleId);
    if (!match) {
      return {
        vehicleId,
        serviceIds: newServiceIds,
      };
    }
    const retainedServiceIds = match.serviceIds.filter((id) => newServiceIds.includes(id));
    return {
      vehicleId,
      serviceIds: retainedServiceIds.length > 0 ? retainedServiceIds : newServiceIds,
    };
  });
}

async function buildAdjustmentPricing(
  ctx: any,
  vehicleIds: Id<"vehicles">[],
  serviceIds: Id<"services">[],
  petFeeVehicleIds: Id<"vehicles">[],
  storedTravel?: Pick<Doc<"appointments">, "travelDistanceMiles" | "travelFee">,
  vehicleServices?: Array<{ vehicleId: Id<"vehicles">; serviceIds: Id<"services">[] }>,
) {
  if (vehicleIds.length === 0) {
    throw new ConvexError({
      code: "SERVICE_NOT_BOOKABLE",
      message: "Select at least one vehicle.",
    });
  }
  if (serviceIds.length === 0) {
    throw new ConvexError({
      code: "SERVICE_NOT_BOOKABLE",
      message: "Select at least one service.",
    });
  }

  const vehicles = (
    await Promise.all(vehicleIds.map((id) => ctx.db.get(id)))
  ).filter((vehicle): vehicle is Doc<"vehicles"> => vehicle !== null);
  if (vehicles.length !== vehicleIds.length) {
    throw new Error("One or more vehicles not found");
  }

  const vehicleSize = getVehicleSize(vehicles);
  const services = (
    await Promise.all(serviceIds.map((id) => ctx.db.get(id)))
  ).filter((service): service is Doc<"services"> => service !== null);
  if (services.length !== serviceIds.length) {
    throw new Error("One or more services not found");
  }
  assertBookableServices(services, serviceIds, vehicleSize);

  const selectedVehicleIdSet = new Set(vehicleIds);
  if (petFeeVehicleIds.some((vehicleId) => !selectedVehicleIdSet.has(vehicleId))) {
    throw new ConvexError({
      code: "SERVICE_NOT_BOOKABLE",
      message: "Pet fee vehicles must be included in this appointment.",
    });
  }

  const servicePricing = await buildVehicleServiceItems(
    ctx,
    services,
    vehicles,
    vehicleServices,
  );
  const petFee = await buildPetFeeItems(ctx, vehicles, petFeeVehicleIds);
  const travel = storedTravel
    ? await buildStoredTravelFeePricing(ctx, storedTravel)
    : { items: [] as InvoiceItem[], travelBufferMinutes: 0 };
  const items: InvoiceItem[] = [
    ...servicePricing.items,
    ...petFee.items,
    ...travel.items,
  ];
  const totalPrice = items.reduce((sum, item) => sum + item.totalPrice, 0);
  const duration = calculateSchedulingDuration({
    serviceDurations: [servicePricing.duration],
    petFeeVehicleCount: petFee.petFeeVehicleCount,
    petFeeTimeMinutes: petFee.petFeeTimeMinutes,
    travelBufferMinutes: travel.travelBufferMinutes,
  });

  return { items, totalPrice, duration, vehicles };
}

function shouldScheduleNotificationJobs(): boolean {
  return process.env.CONVEX_TEST !== "true" && process.env.NODE_ENV !== "test";
}

function getScheduleFingerprint(
  scheduledDate: string,
  scheduledTime: string,
): string {
  return `${scheduledDate}|${scheduledTime}`;
}

function getBusinessDateTimeParts(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const partMap = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );

  return {
    date: `${partMap.year}-${partMap.month}-${partMap.day}`,
    time: `${partMap.hour}:${partMap.minute}`,
  };
}

function hasAppointmentStarted(
  scheduledDate: string,
  scheduledTime: string,
  now = new Date(),
): boolean {
  const dateKey = normalizeDateKey(scheduledDate);
  const current = getBusinessDateTimeParts(now);

  return dateKey < current.date || (dateKey === current.date && scheduledTime <= current.time);
}

async function scheduleReminder(
  ctx: any,
  appointmentId: Id<"appointments">,
  scheduledDate: string,
  scheduledTime: string,
): Promise<void> {
  const aptDateTime = new Date(
    `${scheduledDate}T${scheduledTime}:00`,
  );
  const reminderTime = aptDateTime.getTime() - 24 * 60 * 60 * 1000;
  if (reminderTime > Date.now()) {
    const scheduledId = await ctx.scheduler.runAt(
      reminderTime,
      internal.notifications.queueAppointmentReminder,
      {
        appointmentId,
        scheduleFingerprint: getScheduleFingerprint(scheduledDate, scheduledTime),
      },
    );
    await ctx.db.patch(appointmentId, { reminderScheduledId: scheduledId });
  }
}

async function cancelReminder(
  ctx: any,
  appointmentId: Id<"appointments">,
  reminderScheduledId: Id<"_scheduled_functions"> | undefined,
): Promise<void> {
  if (reminderScheduledId) {
    await ctx.scheduler.cancel(reminderScheduledId);
    await ctx.db.patch(appointmentId, { reminderScheduledId: undefined });
  }
}

async function ensureStripeCustomerId(
  ctx: any,
  user: Doc<"users">,
  updateStripeCustomerId: (stripeCustomerId: string) => Promise<void>,
  stripeSecretKey: string,
): Promise<string> {
  if (user.stripeCustomerId) return user.stripeCustomerId;

  if (process.env.CONVEX_TEST === "true" || process.env.NODE_ENV === "test") {
    const mockCustomerId = `cus_test_${user._id}`;
    await updateStripeCustomerId(mockCustomerId);
    return mockCustomerId;
  }

  const customerResponse = await fetch("https://api.stripe.com/v1/customers", {
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
  });

  if (!customerResponse.ok) {
    throw new Error("Failed to create Stripe customer");
  }

  const stripeCustomer = await customerResponse.json();
  await updateStripeCustomerId(stripeCustomer.id);
  return stripeCustomer.id;
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
  vehicleSize: "small" | "medium" | "large",
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
        message: `Service \"${service.name}\" is inactive.`,
      });
    }

    const serviceType = normalizeServiceType(service.serviceType);
    if (serviceType !== "standard" && serviceType !== "addon" && serviceType !== "subscription") {
      throw new ConvexError({
        code: "SERVICE_NOT_BOOKABLE",
        message: `Service \"${service.name}\" is not bookable.`,
      });
    }

    const price = getEffectiveServicePrice(service, vehicleSize);
    if (price <= 0) {
      throw new ConvexError({
        code: "SERVICE_NOT_BOOKABLE",
        message: `Service \"${service.name}\" is missing valid pricing.`,
      });
    }
  }
}

// Get count of pending appointments (admin only)
export const getPendingCount = query({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    await requireAdmin(ctx);

    const appointments = await ctx.db
      .query("appointments")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .collect();

    return appointments.length;
  },
});

export const repairMissingVehicleReferences = mutation({
  args: {
    dryRun: v.optional(v.boolean()),
  },
  returns: v.object({
    scanned: v.number(),
    candidates: v.number(),
    cleanedStaleReferences: v.number(),
    reattachedAppointments: v.number(),
    unresolved: v.number(),
    dryRun: v.boolean(),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{
    scanned: number;
    candidates: number;
    cleanedStaleReferences: number;
    reattachedAppointments: number;
    unresolved: number;
    dryRun: boolean;
  }> => {
    await requireAdmin(ctx);

    const dryRun = args.dryRun ?? true;
    const appointments = await ctx.db.query("appointments").collect();

    let candidates = 0;
    let cleanedStaleReferences = 0;
    let reattachedAppointments = 0;
    let unresolved = 0;

    for (const appointment of appointments) {
      if (appointment.vehicleIds.length === 0) {
        candidates += 1;
        unresolved += 1;
        continue;
      }

      const resolvedVehicles = (
        await Promise.all(appointment.vehicleIds.map((vehicleId) => ctx.db.get(vehicleId)))
      ).filter((vehicle): vehicle is NonNullable<typeof vehicle> => vehicle !== null);

      if (resolvedVehicles.length === appointment.vehicleIds.length) {
        continue;
      }

      candidates += 1;

      if (resolvedVehicles.length > 0) {
        if (!dryRun) {
          await ctx.db.patch(appointment._id, {
            vehicleIds: resolvedVehicles.map((vehicle) => vehicle._id),
          });
        }
        cleanedStaleReferences += 1;
        continue;
      }

      const customerVehicles = await ctx.db
        .query("vehicles")
        .withIndex("by_user", (q) => q.eq("userId", appointment.userId))
        .collect();

      if (customerVehicles.length === 1) {
        if (!dryRun) {
          await ctx.db.patch(appointment._id, {
            vehicleIds: [customerVehicles[0]._id],
          });
        }
        reattachedAppointments += 1;
        continue;
      }

      unresolved += 1;
    }

    return {
      scanned: appointments.length,
      candidates,
      cleanedStaleReferences,
      reattachedAppointments,
      unresolved,
      dryRun,
    };
  },
});

// Get count of confirmed appointments for current user
export const getConfirmedAppointmentsCount = query({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const userId = await getUserIdFromIdentity(ctx);
    if (!userId) return 0;

    const appointments = await ctx.db
      .query("appointments")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .filter((q) => q.eq(q.field("status"), "confirmed"))
      .collect();

    return appointments.length;
  },
});

// Get all appointments
export const list = query({
  args: {
    status: v.optional(
      v.union(
        v.literal("pending"),
        v.literal("confirmed"),
        v.literal("in_progress"),
        v.literal("completed"),
        v.literal("cancelled"),
        v.literal("rescheduled"),
      ),
    ),
    date: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getUserIdFromIdentity(ctx);
    if (!userId) throw new Error("Not authenticated");
    const isAdminUser = await isAdmin(ctx);

    if (isAdminUser) {
      let appointmentsQuery;
      if (args.date) {
        appointmentsQuery = ctx.db
          .query("appointments")
          .withIndex("by_date", (q) => q.eq("scheduledDate", args.date!));
      } else {
        appointmentsQuery = ctx.db.query("appointments");
      }

      if (args.status) {
        return (await appointmentsQuery.collect()).filter(
          (apt) => apt.status === args.status,
        );
      }

      return await appointmentsQuery.collect();
    }

    if (args.date) {
      const byDate = await ctx.db
        .query("appointments")
        .withIndex("by_date", (q) => q.eq("scheduledDate", args.date!))
        .collect();

      const ownByDate = byDate.filter((appointment) => appointment.userId === userId);
      if (args.status) {
        return ownByDate.filter((appointment) => appointment.status === args.status);
      }
      return ownByDate;
    }

    const ownAppointments = await ctx.db
      .query("appointments")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();

    if (args.status) {
      return ownAppointments.filter((appointment) => appointment.status === args.status);
    }

    return ownAppointments;
  },
});

// Get a single appointment by ID
export const getById = query({
  args: { appointmentId: v.id("appointments") },
  handler: async (ctx, args) => {
    const userId = await getUserIdFromIdentity(ctx);
    if (!userId) throw new Error("Not authenticated");

    const appointment = await ctx.db.get(args.appointmentId);
    if (!appointment) {
      return null;
    }

    const isAdminUser = await isAdmin(ctx);
    if (!isAdminUser && appointment.userId !== userId) {
      throw new Error("Access denied");
    }

    return appointment;
  },
});

export const getByIdWithDetails = query({
  args: { appointmentId: v.id("appointments") },
  handler: async (ctx, args) => {
    const userId = await getUserIdFromIdentity(ctx);
    if (!userId) throw new Error("Not authenticated");

    const appointment = await ctx.db.get(args.appointmentId);
    if (!appointment) return null;

    const isAdminUser = await isAdmin(ctx);
    if (!isAdminUser && appointment.userId !== userId) {
      throw new Error("Access denied");
    }

    const user = await ctx.db.get(appointment.userId);
    const services = (
      await Promise.all(appointment.serviceIds.map((id) => ctx.db.get(id)))
    ).filter((s) => s !== null);
    const vehicles = await Promise.all((
      await Promise.all(appointment.vehicleIds.map((id) => ctx.db.get(id)))
    )
      .filter((v) => v !== null)
      .map(async (vehicle) => ({
        ...vehicle,
        vehicleType: vehicle.vehicleTypeId
          ? await ctx.db.get(vehicle.vehicleTypeId)
          : null,
      })));

    const primaryVehicle = vehicles[0] as Doc<"vehicles"> | undefined;
    const servicesWithPricing = await Promise.all(
      services.map(async (s) => {
        if (!primaryVehicle) {
          return {
            ...s,
            effectivePrice: getEffectiveServicePrice(s, "medium"),
            isAvailable: true,
          };
        }

        try {
          const pricing = await getMatrixPriceForServiceAndVehicle(
            ctx,
            s,
            primaryVehicle,
          );

          return {
            ...s,
            effectivePrice: pricing.unitPrice,
            isAvailable: true,
          };
        } catch {
          return {
            ...s,
            effectivePrice: getEffectiveServicePrice(
              s,
              primaryVehicle.size ?? "medium",
            ),
            isAvailable: false,
          };
        }
      }),
    );

    const invoice = await ctx.db
      .query("invoices")
      .withIndex("by_appointment", (q) =>
        q.eq("appointmentId", appointment._id),
      )
      .first();

    const tripLog = await ctx.db
      .query("tripLogs")
      .withIndex("by_appointment", (q) =>
        q.eq("appointmentId", appointment._id),
      )
      .first();

    const beforePhotos = await Promise.all(
      (appointment.beforePhotos ?? []).map(async (photo) => {
        let signedUrl: string | undefined;
        try {
          signedUrl = await r2.getUrl(photo.key, { expiresIn: 60 * 60 * 24 });
        } catch (error) {
          console.warn(
            `[appointments] Failed to sign before photo URL ${photo.key}`,
            error,
          );
        }
        return { ...photo, signedUrl };
      }),
    );

    return {
      ...appointment,
      beforePhotos,
      user,
      services: servicesWithPricing,
      vehicles,
      invoice,
      tripLog,
    };
  },
});

// Internal query to get appointment by ID (no auth required, for internal actions)
export const getByIdInternal = internalQuery({
  args: { appointmentId: v.id("appointments") },
  handler: async (ctx, args): Promise<Doc<"appointments"> | null> => {
    return await ctx.db.get(args.appointmentId);
  },
});

// Get appointments for a specific user
export const getByUser = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const authUserId = await getUserIdFromIdentity(ctx);
    if (!authUserId) throw new Error("Not authenticated");

    // Users can only see their own appointments, admins can see all
    const isAdminUser = await isAdmin(ctx);
    if (!isAdminUser && authUserId !== args.userId) {
      throw new Error("Access denied");
    }

    const appointments = await ctx.db
      .query("appointments")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();
    return appointments;
  },
});

// Create appointment
export const create = mutation({
  args: {
    userId: v.id("users"),
    vehicleIds: v.array(v.id("vehicles")),
    serviceIds: v.array(v.id("services")),
    scheduledDate: v.string(),
    scheduledTime: v.string(),
    street: v.string(),
    city: v.string(),
    state: v.string(),
    zip: v.string(),
    locationNotes: v.optional(v.string()),
    notes: v.optional(v.string()),
    petFeeVehicleIds: v.optional(v.array(v.id("vehicles"))),
    vehicleServices: v.optional(
      v.array(
        v.object({
          vehicleId: v.id("vehicles"),
          serviceIds: v.array(v.id("services")),
        })
      )
    ),
  },
  returns: v.object({
    appointmentId: v.id("appointments"),
    invoiceId: v.id("invoices"),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{
    appointmentId: Id<"appointments">;
    invoiceId: Id<"invoices">;
  }> => {
    const authUserId = await getUserIdFromIdentity(ctx);
    if (!authUserId) throw new Error("Not authenticated");
    await assertBookingSetupReady(ctx);

    const isAdminUser = await isAdmin(ctx);
    if (!isAdminUser && args.userId !== authUserId) {
      throw new Error("Access denied");
    }

    if (args.vehicleIds.length === 0) {
      throw new ConvexError({
        code: "SERVICE_NOT_BOOKABLE",
        message: "Please select at least one vehicle.",
      });
    }

    const scheduledDateKey = normalizeDateKey(args.scheduledDate);

    // Get vehicle sizes to calculate proper pricing
    const vehicles = await Promise.all(
      args.vehicleIds.map((id) => ctx.db.get(id)),
    );
    const validVehicles = vehicles.filter((vehicle) => vehicle !== null);
    if (validVehicles.length !== args.vehicleIds.length) {
      throw new ConvexError({
        code: "SERVICE_NOT_BOOKABLE",
        message: "One or more selected vehicles are unavailable.",
      });
    }
    if (validVehicles.some((vehicle) => vehicle.userId !== args.userId)) {
      throw new Error("Invalid vehicle selection");
    }
    const petFeeVehicleIds = args.petFeeVehicleIds ?? [];
    const selectedVehicleIdSet = new Set(args.vehicleIds);
    if (petFeeVehicleIds.some((vehicleId) => !selectedVehicleIdSet.has(vehicleId))) {
      throw new ConvexError({
        code: "SERVICE_NOT_BOOKABLE",
        message: "Pet fee vehicles must be included in this appointment.",
      });
    }
    const vehicleSize = getVehicleSize(validVehicles);

    const services = await Promise.all(args.serviceIds.map((id) => ctx.db.get(id)));
    const validServices = services.filter(
      (service): service is Doc<"services"> => service !== null,
    );
    assertBookableServices(validServices, args.serviceIds, vehicleSize);

    const vehicleServices = args.vehicleServices ?? buildUpdatedVehicleServices(
      undefined,
      args.vehicleIds,
      args.serviceIds,
    );

    const servicePricing = await buildVehicleServiceItems(
      ctx,
      validServices,
      validVehicles,
      vehicleServices,
    );
    const petFee = await buildPetFeeItems(ctx, validVehicles, petFeeVehicleIds);
    const serviceItems = servicePricing.items;
    const petFeeItems = petFee.items;
    const duration = calculateSchedulingDuration({
      serviceDurations: [servicePricing.duration],
      petFeeVehicleCount: petFee.petFeeVehicleCount,
      petFeeTimeMinutes: petFee.petFeeTimeMinutes,
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

    const items = [...serviceItems, ...petFeeItems];
    const totalPrice = items.reduce((sum, item) => sum + item.totalPrice, 0);

    const appointmentId: Id<"appointments"> = await ctx.db.insert(
      "appointments",
      {
        userId: args.userId,
        vehicleIds: args.vehicleIds,
        serviceIds: args.serviceIds,
        vehicleServices,
        scheduledDate: scheduledDateKey,
        scheduledTime: args.scheduledTime,
        duration,
        location: {
          street: args.street,
          city: args.city,
          state: args.state,
          zip: args.zip,
          notes: args.locationNotes,
        },
        status: "pending",
        totalPrice,
        notes: args.notes,
        createdBy: authUserId,
        petFeeVehicleIds,
      },
    );

    const user = await ctx.db.get(args.userId);
    if (!user) throw new Error("User not found");

    // Note: User stats (timesServiced, totalSpent) should be updated when appointment is completed,
    // not when appointment is created. This is handled in the appointment completion flow.

    const subtotal = items.reduce((sum, item) => sum + item.totalPrice, 0);
    const tax = 0;
    const total = subtotal + tax;

    // Get deposit amount from settings (default $50 per vehicle)
    // Use internal query since this is called from a mutation
    const depositSettings = await ctx.runQuery(
      internal.depositSettings.getInternal,
      {},
    );
    const depositPerVehicle = depositSettings?.amountPerVehicle ?? 50;
    const calculatedDepositAmount = depositPerVehicle * args.vehicleIds.length;
    // Cap deposit at total to prevent negative remaining balance
    const depositAmount = Math.min(calculatedDepositAmount, total);
    const remainingBalance = Math.max(0, total - depositAmount);

    // Generate invoice number
    const invoiceCountResult = await ctx.runQuery(
      internal.invoices.getCountInternal,
      {},
    );
    const invoiceCount: number = invoiceCountResult.count;
    const invoiceNumber: string = `INV-${String(invoiceCount + 1).padStart(4, "0")}`;

    // Create invoice date
    const dueDate = getInvoiceDueDateFromDateKey(scheduledDateKey);

    // Create invoice in Convex immediately (don't create Stripe invoice yet - wait for deposit)
    const invoiceId: Id<"invoices"> = await ctx.db.insert("invoices", {
      appointmentId,
      userId: args.userId,
      invoiceNumber,
      items,
      subtotal,
      tax,
      total,
      status: "draft", // Start as draft, will be sent after deposit is paid
      dueDate,
      notes: `Invoice for appointment on ${scheduledDateKey}`,
      depositAmount,
      depositPaid: false,
      remainingBalance,
      remainingBalanceCollectionMethod: "send_invoice",
    });

    // Ensure Stripe customer exists (schedule action to create if needed)
    // This is critical for deposit checkout to work
    await ctx.scheduler.runAfter(0, internal.users.ensureStripeCustomer, {
      userId: args.userId,
    });

    // Return both appointmentId and invoiceId so frontend can redirect to checkout
    return { appointmentId, invoiceId };
  },
});

// Update appointment
export const update = mutation({
  args: {
    appointmentId: v.id("appointments"),
    userId: v.id("users"),
    vehicleIds: v.array(v.id("vehicles")),
    serviceIds: v.array(v.id("services")),
    scheduledDate: v.string(),
    scheduledTime: v.string(),
    street: v.string(),
    city: v.string(),
    state: v.string(),
    zip: v.string(),
    locationNotes: v.optional(v.string()),
    notes: v.optional(v.string()),
    petFeeVehicleIds: v.optional(v.array(v.id("vehicles"))),
    vehicleServices: v.optional(
      v.array(
        v.object({
          vehicleId: v.id("vehicles"),
          serviceIds: v.array(v.id("services")),
        })
      )
    ),
  },
  handler: async (ctx, args) => {
    const userId = await getUserIdFromIdentity(ctx);
    if (!userId) throw new Error("Not authenticated");

    const { appointmentId, ...updates } = args;
    const existingAppointment = await ctx.db.get(appointmentId);
    if (!existingAppointment) throw new Error("Appointment not found");

    const services = await Promise.all(
      updates.serviceIds.map((id) => ctx.db.get(id)),
    );
    const validServices = services.filter(
      (service): service is Doc<"services"> => service !== null,
    );
    if (validServices.length !== updates.serviceIds.length) {
      throw new Error("One or more services not found");
    }

    // Get vehicle sizes to calculate proper pricing
    const vehicles = await Promise.all(
      updates.vehicleIds.map((id) => ctx.db.get(id)),
    );
    const validVehicles = vehicles.filter(
      (vehicle): vehicle is NonNullable<typeof vehicle> => vehicle !== null,
    );
    if (validVehicles.length !== updates.vehicleIds.length) {
      throw new Error("One or more vehicles not found");
    }
    const petFeeVehicleIds = updates.petFeeVehicleIds ?? existingAppointment.petFeeVehicleIds ?? [];
    const selectedVehicleIdSet = new Set(updates.vehicleIds);
    if (petFeeVehicleIds.some((vehicleId) => !selectedVehicleIdSet.has(vehicleId))) {
      throw new ConvexError({
        code: "SERVICE_NOT_BOOKABLE",
        message: "Pet fee vehicles must be included in this appointment.",
      });
    }

    const vehicleServices = updates.vehicleServices ?? buildUpdatedVehicleServices(
      existingAppointment.vehicleServices,
      updates.vehicleIds,
      updates.serviceIds,
    );

    const servicePricing = await buildVehicleServiceItems(
      ctx,
      validServices,
      validVehicles,
      vehicleServices,
    );
    const serviceItems = servicePricing.items;
    const petFee = await buildPetFeeItems(ctx, validVehicles, petFeeVehicleIds);
    const petFeeItems = petFee.items;
    const travel = await buildStoredTravelFeePricing(ctx, existingAppointment);
    const travelFeeItems = travel.items;
    const items = [...serviceItems, ...petFeeItems, ...travelFeeItems];
    const totalPrice = items.reduce((sum, item) => sum + item.totalPrice, 0);
    const duration = calculateSchedulingDuration({
      serviceDurations: [servicePricing.duration],
      petFeeVehicleCount: petFee.petFeeVehicleCount,
      petFeeTimeMinutes: petFee.petFeeTimeMinutes,
      travelBufferMinutes: travel.travelBufferMinutes,
    });

    const normalizedScheduledDate = normalizeDateKey(updates.scheduledDate);
    const existingScheduledDate = normalizeDateKey(existingAppointment.scheduledDate);
    const scheduleChanged =
      existingScheduledDate !== normalizedScheduledDate ||
      existingAppointment.scheduledTime !== updates.scheduledTime;
    const materialChangeFingerprint = JSON.stringify({
      scheduledDate: normalizedScheduledDate,
      scheduledTime: updates.scheduledTime,
      street: updates.street,
      city: updates.city,
      state: updates.state,
      zip: updates.zip,
      locationNotes: updates.locationNotes || "",
      serviceIds: [...updates.serviceIds].sort(),
      vehicleIds: [...updates.vehicleIds].sort(),
    });
    const previousMaterialFingerprint = JSON.stringify({
      scheduledDate: existingScheduledDate,
      scheduledTime: existingAppointment.scheduledTime,
      street: existingAppointment.location.street,
      city: existingAppointment.location.city,
      state: existingAppointment.location.state,
      zip: existingAppointment.location.zip,
      locationNotes: existingAppointment.location.notes || "",
      serviceIds: [...existingAppointment.serviceIds].sort(),
      vehicleIds: [...existingAppointment.vehicleIds].sort(),
    });
    const materialChanged =
      materialChangeFingerprint !== previousMaterialFingerprint;
    const isActiveWorkOnlyChange =
      !scheduleChanged &&
      ["pending", "confirmed", "in_progress"].includes(existingAppointment.status) &&
      (existingAppointment.status === "in_progress" ||
        hasAppointmentStarted(existingScheduledDate, existingAppointment.scheduledTime));

    if (
      (scheduleChanged || duration !== existingAppointment.duration) &&
      !isActiveWorkOnlyChange
    ) {
      const slotAvailability = await ctx.runQuery(api.availability.checkAvailability, {
        date: normalizedScheduledDate,
        startTime: updates.scheduledTime,
        duration,
        ignoreAppointmentId: appointmentId,
      });
      if (!slotAvailability.available) {
        throw new ConvexError({
          code: "TIME_SLOT_UNAVAILABLE",
          message: slotAvailability.reason || "Selected time is no longer available.",
        });
      }
    }

    await ctx.db.patch(appointmentId, {
      userId: updates.userId,
      vehicleIds: updates.vehicleIds,
      serviceIds: updates.serviceIds,
      vehicleServices,
      scheduledDate: normalizedScheduledDate,
      scheduledTime: updates.scheduledTime,
      duration,
      location: {
        street: updates.street,
        city: updates.city,
        state: updates.state,
        zip: updates.zip,
        notes: updates.locationNotes,
      },
      totalPrice,
      notes: updates.notes,
      petFeeVehicleIds,
    });

    const invoice = await ctx.db
      .query("invoices")
      .withIndex("by_appointment", (q) => q.eq("appointmentId", appointmentId))
      .first();

    if (invoice) {
      const subtotal = items.reduce((sum, item) => sum + item.totalPrice, 0);
      const total = getInvoiceTotalAfterDiscount(
        subtotal,
        invoice.tax,
        invoice.discountAmount,
      );
      const depositAmount = invoice.depositAmount || 0;
      const remainingBalance = Math.max(
        0,
        Math.round((total - depositAmount) * 100) / 100,
      );

      await ctx.db.patch(invoice._id, {
        items,
        subtotal,
        total,
        remainingBalance,
      });
    }

    if (
      shouldScheduleNotificationJobs() &&
      existingAppointment.status === "confirmed" &&
      materialChanged
    ) {
      if (scheduleChanged && existingAppointment.reminderScheduledId) {
        await cancelReminder(
          ctx,
          appointmentId,
          existingAppointment.reminderScheduledId,
        );
      }

      if (scheduleChanged) {
        await scheduleReminder(
          ctx,
          appointmentId,
          normalizedScheduledDate,
          updates.scheduledTime,
        );
      }

      await ctx.scheduler.runAfter(
        0,
        internal.notifications.queueAppointmentLifecycleEvent,
        {
          appointmentId,
          event: "appointment_rescheduled",
          transition: `${existingAppointment.status}->${existingAppointment.status}`,
          dedupeContext: materialChangeFingerprint,
        },
      );
    }

    return appointmentId;
  },
});

export const previewWorkAdjustment = query({
  args: workAdjustmentArgs,
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const appointment = await ctx.db.get(args.appointmentId);
    if (!appointment) throw new Error("Appointment not found");

    const oldPetFeeVehicleIds = appointment.petFeeVehicleIds ?? [];
    const newVehicleServices = args.vehicleServices ?? buildUpdatedVehicleServices(
      appointment.vehicleServices,
      args.vehicleIds,
      args.serviceIds,
    );
    const oldPricing = await buildAdjustmentPricing(
      ctx,
      appointment.vehicleIds,
      appointment.serviceIds,
      oldPetFeeVehicleIds,
      appointment,
      appointment.vehicleServices,
    );
    const newPricing = await buildAdjustmentPricing(
      ctx,
      args.vehicleIds,
      args.serviceIds,
      args.petFeeVehicleIds ?? [],
      appointment,
      newVehicleServices,
    );
    const invoice = await ctx.db
      .query("invoices")
      .withIndex("by_appointment", (q) => q.eq("appointmentId", args.appointmentId))
      .first();

    return {
      oldTotalPrice: appointment.totalPrice,
      newTotalPrice: newPricing.totalPrice,
      priceDelta: newPricing.totalPrice - appointment.totalPrice,
      oldDuration: appointment.duration,
      newDuration: newPricing.duration,
      durationDelta: newPricing.duration - appointment.duration,
      oldItems: oldPricing.items,
      newItems: newPricing.items,
      invoiceStatus: invoice?.status ?? null,
      invoicePaid: invoice?.status === "paid",
    };
  },
});

export const listAdjustments = query({
  args: { appointmentId: v.id("appointments") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    return await ctx.db
      .query("appointmentAdjustments")
      .withIndex("by_appointment", (q) => q.eq("appointmentId", args.appointmentId))
      .order("desc")
      .collect();
  },
});

export const applyWorkAdjustment = mutation({
  args: workAdjustmentArgs,
  returns: v.object({
    adjustmentId: v.id("appointmentAdjustments"),
    invoiceAction: v.union(
      v.literal("none"),
      v.literal("updated_open_invoice"),
      v.literal("supplemental_invoice_created"),
      v.literal("manual_credit_required"),
    ),
    supplementalInvoiceId: v.optional(v.id("invoices")),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{
    adjustmentId: Id<"appointmentAdjustments">;
    invoiceAction:
      | "none"
      | "updated_open_invoice"
      | "supplemental_invoice_created"
      | "manual_credit_required";
    supplementalInvoiceId?: Id<"invoices">;
  }> => {
    await requireAdmin(ctx);
    const actorId = await getUserIdFromIdentity(ctx);
    if (!actorId) throw new Error("Not authenticated");
    const reason = args.reason.trim();
    if (reason.length < 3) {
      throw new Error("A short reason is required for work adjustments.");
    }

    const appointment = await ctx.db.get(args.appointmentId);
    if (!appointment) throw new Error("Appointment not found");
    if (!["pending", "confirmed", "in_progress"].includes(appointment.status)) {
      throw new Error(
        "Only pending, confirmed, or in-progress appointments can be adjusted.",
      );
    }

    const vehicleServices = args.vehicleServices ?? buildUpdatedVehicleServices(
      appointment.vehicleServices,
      args.vehicleIds,
      args.serviceIds,
    );

    const oldPetFeeVehicleIds = appointment.petFeeVehicleIds ?? [];
    const oldPricing = await buildAdjustmentPricing(
      ctx,
      appointment.vehicleIds,
      appointment.serviceIds,
      oldPetFeeVehicleIds,
      appointment,
      appointment.vehicleServices,
    );
    const newPetFeeVehicleIds = args.petFeeVehicleIds ?? [];
    const newPricing = await buildAdjustmentPricing(
      ctx,
      args.vehicleIds,
      args.serviceIds,
      newPetFeeVehicleIds,
      appointment,
      vehicleServices,
    );
    const priceDelta = Math.round((newPricing.totalPrice - appointment.totalPrice) * 100) / 100;
    const durationDelta = newPricing.duration - appointment.duration;

    const isActiveWorkAdjustment =
      ["pending", "confirmed", "in_progress"].includes(appointment.status) &&
      (appointment.status === "in_progress" ||
        hasAppointmentStarted(appointment.scheduledDate, appointment.scheduledTime));

    if (!isActiveWorkAdjustment) {
      const availability = await ctx.runQuery(api.availability.checkAvailability, {
        date: appointment.scheduledDate,
        startTime: appointment.scheduledTime,
        duration: newPricing.duration,
        ignoreAppointmentId: args.appointmentId,
      });
      if (!availability.available) {
        throw new ConvexError({
          code: "TIME_SLOT_UNAVAILABLE",
          message: availability.reason || "Adjusted work no longer fits this time slot.",
        });
      }
    }

    const invoice = await ctx.db
      .query("invoices")
      .withIndex("by_appointment", (q) => q.eq("appointmentId", args.appointmentId))
      .first();
    let invoiceAction:
      | "none"
      | "updated_open_invoice"
      | "supplemental_invoice_created"
      | "manual_credit_required" = "none";
    let supplementalInvoiceId: Id<"invoices"> | undefined;

    if (invoice?.status === "paid") {
      if (priceDelta < 0) {
        throw new Error(
          "This adjustment lowers a paid invoice. Create an explicit refund or credit before changing the work.",
        );
      }
      if (priceDelta > 0) {
        const invoiceCount = (
          await ctx.runQuery(internal.invoices.getCountInternal, {})
        ).count;
        const invoiceNumber = `INV-${String(invoiceCount + 1).padStart(4, "0")}`;
        const dueDate = getInvoiceDueDateFromDate(new Date());
        supplementalInvoiceId = await ctx.db.insert("invoices", {
          appointmentId: args.appointmentId,
          userId: appointment.userId,
          invoiceNumber,
          items: [
            {
              serviceName: `Supplemental work adjustment - ${reason}`,
              quantity: 1,
              unitPrice: priceDelta,
              totalPrice: priceDelta,
            },
          ],
          subtotal: priceDelta,
          tax: 0,
          total: priceDelta,
          status: "draft",
          dueDate,
          notes: `Supplemental invoice for ${invoice.invoiceNumber}: ${reason}`,
          depositAmount: 0,
          depositPaid: true,
          remainingBalance: priceDelta,
          paymentOption: "deposit",
          remainingBalanceCollectionMethod:
            invoice.remainingBalanceCollectionMethod ?? "send_invoice",
        });
        invoiceAction = "supplemental_invoice_created";
        await ctx.scheduler.runAfter(
          0,
          internal.payments.createStripeInvoiceAfterDeposit,
          {
            appointmentId: args.appointmentId,
            invoiceId: supplementalInvoiceId,
          },
        );
      }
    } else if (invoice) {
      const subtotal = newPricing.items.reduce(
        (sum, item) => sum + item.totalPrice,
        0,
      );
      const total = getInvoiceTotalAfterDiscount(
        subtotal,
        invoice.tax,
        invoice.discountAmount,
      );
      const depositAmount = invoice.depositAmount || 0;
      await ctx.db.patch(invoice._id, {
        items: newPricing.items,
        subtotal,
        total,
        remainingBalance: Math.max(
          0,
          Math.round((total - depositAmount) * 100) / 100,
        ),
        stripeInvoiceId: undefined,
        stripeInvoiceUrl: undefined,
        finalPaymentIntentId: undefined,
        status: invoice.depositPaid ? "draft" : invoice.status,
        invoiceGenerationError: undefined,
      });
      invoiceAction = "updated_open_invoice";
      if (invoice.depositPaid && (invoice.paymentOption ?? "deposit") === "deposit") {
        await ctx.scheduler.runAfter(
          0,
          internal.payments.createStripeInvoiceAfterDeposit,
          {
            appointmentId: args.appointmentId,
            invoiceId: invoice._id,
          },
        );
      }
    }

    await ctx.db.patch(args.appointmentId, {
      vehicleIds: args.vehicleIds,
      serviceIds: args.serviceIds,
      vehicleServices,
      petFeeVehicleIds: newPetFeeVehicleIds,
      duration: newPricing.duration,
      totalPrice: newPricing.totalPrice,
    });

    const adjustmentId = await ctx.db.insert("appointmentAdjustments", {
      appointmentId: args.appointmentId,
      actorId,
      reason,
      oldVehicleIds: appointment.vehicleIds,
      newVehicleIds: args.vehicleIds,
      oldServiceIds: appointment.serviceIds,
      newServiceIds: args.serviceIds,
      oldPetFeeVehicleIds,
      newPetFeeVehicleIds,
      oldItems: oldPricing.items,
      newItems: newPricing.items,
      priceDelta,
      durationDelta,
      invoiceAction,
      invoiceId: invoice?._id,
      supplementalInvoiceId,
      createdAt: Date.now(),
    });

    return {
      adjustmentId,
      invoiceAction,
      supplementalInvoiceId,
    };
  },
});

export const updateTravelFee = mutation({
  args: {
    appointmentId: v.id("appointments"),
    travelFee: v.number(),
    travelDistanceMiles: v.optional(v.number()),
  },
  returns: v.object({
    invoiceAction: v.union(
      v.literal("none"),
      v.literal("updated_open_invoice"),
      v.literal("supplemental_invoice_created"),
      v.literal("manual_credit_required"),
    ),
    invoiceId: v.optional(v.id("invoices")),
    supplementalInvoiceId: v.optional(v.id("invoices")),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{
    invoiceAction: InvoiceAction;
    invoiceId?: Id<"invoices">;
    supplementalInvoiceId?: Id<"invoices">;
  }> => {
    await requireAdmin(ctx);

    const fee = Math.round(args.travelFee * 100) / 100;
    if (!Number.isFinite(fee) || fee < 0) {
      throw new ConvexError({
        code: "INVALID_TRAVEL_FEE",
        message: "Travel fee must be zero or greater.",
      });
    }

    const distanceMiles =
      args.travelDistanceMiles === undefined
        ? undefined
        : Math.round(args.travelDistanceMiles * 10) / 10;
    if (
      distanceMiles !== undefined &&
      (!Number.isFinite(distanceMiles) || distanceMiles < 0)
    ) {
      throw new ConvexError({
        code: "INVALID_TRAVEL_DISTANCE",
        message: "Travel distance must be zero or greater.",
      });
    }

    const appointment = await ctx.db.get(args.appointmentId);
    if (!appointment) {
      throw new Error("Appointment not found");
    }
    if (appointment.status === "cancelled") {
      throw new Error("Cancelled appointments cannot be billed.");
    }

    const invoice = await ctx.db
      .query("invoices")
      .withIndex("by_appointment", (q) => q.eq("appointmentId", args.appointmentId))
      .first();

    const invoiceTravelFee = invoice
      ? getTravelFeeTotalFromItems(invoice.items)
      : undefined;
    const existingAppointmentTravelFee =
      appointment.travelFee ?? invoiceTravelFee ?? 0;
    const appointmentPriceDelta = Math.round(
      (fee - existingAppointmentTravelFee) * 100,
    ) / 100;
    const invoicePriceDelta =
      invoiceTravelFee === undefined
        ? 0
        : Math.round((fee - invoiceTravelFee) * 100) / 100;
    const nextTravelItem = getTravelFeeLineItem(distanceMiles, fee);
    const needsTravelBufferSettings =
      distanceMiles !== undefined || appointment.travelDistanceMiles !== undefined;
    const travelFeeSettings = needsTravelBufferSettings
      ? await ctx.runQuery(internal.travelFeeSettings.getInternal, {})
      : undefined;
    const nextTravelBufferMinutes =
      distanceMiles === undefined
        ? 0
        : calculateTravelBufferMinutesForMiles(distanceMiles, travelFeeSettings);
    const previousTravelBufferMinutes =
      appointment.travelDistanceMiles === undefined
        ? 0
        : calculateTravelBufferMinutesForMiles(
            appointment.travelDistanceMiles,
            travelFeeSettings,
          );
    const durationDelta = nextTravelBufferMinutes - previousTravelBufferMinutes;

    await ctx.db.patch(args.appointmentId, {
      totalPrice: Math.max(
        0,
        Math.round((appointment.totalPrice + appointmentPriceDelta) * 100) / 100,
      ),
      duration: Math.max(0, appointment.duration + durationDelta),
      travelDistanceMiles: distanceMiles,
      travelFee: fee > 0 ? fee : undefined,
    });

    if (!invoice) {
      return { invoiceAction: "none" };
    }

    if (invoice.status === "paid") {
      if (appointmentPriceDelta < 0) {
        throw new Error(
          "This lowers a paid invoice. Create an explicit refund or credit before changing the travel fee.",
        );
      }
      if (appointmentPriceDelta === 0) {
        return { invoiceAction: "none", invoiceId: invoice._id };
      }

      const invoiceCount = (
        await ctx.runQuery(internal.invoices.getCountInternal, {})
      ).count;
      const invoiceNumber = `INV-${String(invoiceCount + 1).padStart(4, "0")}`;
      const dueDate = getInvoiceDueDateFromDate(new Date());
      const supplementalInvoiceId = await ctx.db.insert("invoices", {
        appointmentId: args.appointmentId,
        userId: appointment.userId,
        invoiceNumber,
        items: [
          {
            itemType: "travel_fee",
            serviceName:
              distanceMiles === undefined
                ? "Supplemental travel fee"
                : `Supplemental travel fee (${distanceMiles.toFixed(1)} miles)`,
            quantity: 1,
            unitPrice: appointmentPriceDelta,
            totalPrice: appointmentPriceDelta,
          },
        ],
        subtotal: appointmentPriceDelta,
        tax: 0,
        total: appointmentPriceDelta,
        status: "draft",
        dueDate,
        notes: `Supplemental travel fee for ${invoice.invoiceNumber}`,
        depositAmount: 0,
        depositPaid: true,
        remainingBalance: appointmentPriceDelta,
        paymentOption: "deposit",
        remainingBalanceCollectionMethod:
          invoice.remainingBalanceCollectionMethod ?? "send_invoice",
      });

      await ctx.scheduler.runAfter(
        0,
        internal.payments.createStripeInvoiceAfterDeposit,
        {
          appointmentId: args.appointmentId,
          invoiceId: supplementalInvoiceId,
        },
      );

      return {
        invoiceAction: "supplemental_invoice_created",
        invoiceId: invoice._id,
        supplementalInvoiceId,
      };
    }

    const nextItems = [
      ...invoice.items.filter((item) => item.itemType !== "travel_fee"),
      ...(nextTravelItem ? [nextTravelItem] : []),
    ];
    const subtotal = nextItems.reduce((sum, item) => sum + item.totalPrice, 0);
    const total = getInvoiceTotalAfterDiscount(
      subtotal,
      invoice.tax,
      invoice.discountAmount,
    );
    const remainingBalance = Math.max(
      0,
      Math.round((total - (invoice.depositAmount || 0)) * 100) / 100,
    );

    await ctx.db.patch(invoice._id, {
      items: nextItems,
      subtotal,
      total,
      remainingBalance,
      stripeInvoiceId: undefined,
      stripeInvoiceUrl: undefined,
      finalPaymentIntentId: undefined,
      status: invoice.depositPaid ? "draft" : invoice.status,
      invoiceGenerationError: undefined,
    });

    if (invoice.depositPaid && (invoice.paymentOption ?? "deposit") === "deposit") {
      await ctx.scheduler.runAfter(
        0,
        internal.payments.createStripeInvoiceAfterDeposit,
        {
          appointmentId: args.appointmentId,
          invoiceId: invoice._id,
        },
      );
    }

    return {
      invoiceAction: invoicePriceDelta === 0 ? "none" : "updated_open_invoice",
      invoiceId: invoice._id,
    };
  },
});

// Delete an appointment
export const deleteAppointment = mutation({
  args: { appointmentId: v.id("appointments") },
  handler: async (ctx, args) => {
    const userId = await getUserIdFromIdentity(ctx);
    if (!userId) throw new Error("Not authenticated");

    const invoices = await ctx.db
      .query("invoices")
      .withIndex("by_appointment", (q) =>
        q.eq("appointmentId", args.appointmentId),
      )
      .collect();

    for (const invoice of invoices.filter((item) => item.status !== "paid")) {
      await ctx.db.delete(invoice._id);
    }

    await ctx.db.delete(args.appointmentId);
  },
});

// Update appointment status
export const updateStatus = mutation({
  args: {
    appointmentId: v.id("appointments"),
    status: v.union(
      v.literal("pending"),
      v.literal("confirmed"),
      v.literal("in_progress"),
      v.literal("completed"),
      v.literal("cancelled"),
      v.literal("rescheduled"),
    ),
  },
  handler: async (ctx, args) => {
    const userId = await getUserIdFromIdentity(ctx);
    if (!userId) throw new Error("Not authenticated");

    const appointment = await ctx.db.get(args.appointmentId);
    if (!appointment) throw new Error("Appointment not found");

    const user = await ctx.db.get(appointment.userId);
    if (!user) {
      console.warn(
        `[appointments:updateStatus] User ${appointment.userId} not found for appointment ${args.appointmentId}. Proceeding with status update only.`,
      );
    }

    // Only update user stats if user exists
    if (user) {
      if (args.status === "cancelled" && appointment.status !== "cancelled") {
        await ctx.db.patch(user._id, {
          cancellationCount: (user.cancellationCount || 0) + 1,
        });
      } else if (
        args.status !== "cancelled" &&
        appointment.status === "cancelled"
      ) {
        await ctx.db.patch(user._id, {
          cancellationCount: Math.max(0, (user.cancellationCount || 0) - 1),
        });
      }
    }

    const oldStatus = appointment.status;
    await ctx.db.patch(args.appointmentId, { status: args.status });

    if (oldStatus !== args.status) {
      const lifecycleEvent =
        args.status === "confirmed"
          ? "appointment_confirmed"
          : args.status === "cancelled"
            ? "appointment_cancelled"
            : args.status === "rescheduled"
              ? "appointment_rescheduled"
              : args.status === "in_progress"
                ? "appointment_started"
                : args.status === "completed"
                  ? "appointment_completed"
                  : null;

      if (lifecycleEvent && shouldScheduleNotificationJobs()) {
        await ctx.scheduler.runAfter(
          0,
          internal.notifications.queueAppointmentLifecycleEvent,
          {
            appointmentId: args.appointmentId,
            event: lifecycleEvent,
            transition: `${oldStatus}->${args.status}`,
          },
        );
      }
    }

    // Appointment confirmation is the single trigger for post-deposit Stripe invoice generation
    if (args.status === "confirmed") {
      const invoice = await ctx.db
        .query("invoices")
        .withIndex("by_appointment", (q) =>
          q.eq("appointmentId", args.appointmentId),
        )
        .first();

      // Skip Stripe Invoice for "in_person" (balance collected in person) and "full" (already paid)
      const skipStripeInvoice =
        invoice?.paymentOption === "in_person" || invoice?.paymentOption === "full";

      if (invoice && invoice.depositPaid && invoice.status === "draft" && !skipStripeInvoice) {
        console.log(
          `[appointments] scheduling post-deposit invoice generation appointmentId=${args.appointmentId} invoiceId=${invoice._id}`,
        );
        try {
          await ctx.scheduler.runAfter(
            0,
            internal.payments.createStripeInvoiceAfterDeposit,
            {
              appointmentId: args.appointmentId,
              invoiceId: invoice._id,
            },
          );
          console.log(
            `[appointments] post-deposit invoice generation scheduled appointmentId=${args.appointmentId} invoiceId=${invoice._id}`,
          );
        } catch (error) {
          console.error(
            `[appointments] failed to schedule post-deposit invoice generation appointmentId=${args.appointmentId} invoiceId=${invoice._id}`,
            error,
          );
          throw error;
        }
      } else if (skipStripeInvoice && invoice) {
        console.log(
          `[appointments] skipping Stripe invoice for paymentOption=${invoice.paymentOption} appointmentId=${args.appointmentId}`,
        );
      }

      // Schedule 24h reminder email
      if (shouldScheduleNotificationJobs()) {
        await scheduleReminder(
          ctx,
          args.appointmentId,
          appointment.scheduledDate,
          appointment.scheduledTime,
        );
      }
    }

    // Cancel reminder when appointment is cancelled or rescheduled
    if (
      (args.status === "cancelled" || args.status === "rescheduled") &&
      appointment.reminderScheduledId
    ) {
      await cancelReminder(
        ctx,
        args.appointmentId,
        appointment.reminderScheduledId,
      );
    }

    // Schedule final payment charge when status changes to "completed"
    if (args.status === "completed" && oldStatus !== "completed") {
      // Get invoice for this appointment
      const invoice = await ctx.db
        .query("invoices")
        .withIndex("by_appointment", (q) =>
          q.eq("appointmentId", args.appointmentId),
        )
        .first();

      if (
        invoice &&
        invoice.depositPaid &&
        invoice.remainingBalance &&
        invoice.remainingBalance > 0 &&
        invoice.status !== "paid"
      ) {
        // Schedule final payment charge action
        await ctx.scheduler.runAfter(
          0,
          internal.appointments.chargeFinalPayment,
          {
            appointmentId: args.appointmentId,
            invoiceId: invoice._id,
          },
        );
      }

      // Send review request email to customer
      if (shouldScheduleNotificationJobs()) {
        await ctx.scheduler.runAfter(0, internal.notifications.queueReviewRequest, {
          appointmentId: args.appointmentId,
          transition: "completed->review_request",
        });
      }

      if (shouldScheduleNotificationJobs()) {
        await ctx.scheduler.runAfter(
          0,
          (internal as any).tripLogs.ensureDraftForCompletedAppointment,
          {
            appointmentId: args.appointmentId,
          },
        );
      }
    }

    return args.appointmentId;
  },
});

// Internal mutation to update appointment status (for use by webhook handlers)
export const updateStatusInternal = internalMutation({
  args: {
    appointmentId: v.id("appointments"),
    status: v.union(
      v.literal("pending"),
      v.literal("confirmed"),
      v.literal("in_progress"),
      v.literal("completed"),
      v.literal("cancelled"),
      v.literal("rescheduled"),
    ),
  },
  handler: async (ctx, args) => {
    const appointment = await ctx.db.get(args.appointmentId);
    if (!appointment) throw new Error("Appointment not found");

    const user = await ctx.db.get(appointment.userId);
    if (!user) {
         console.warn(
        `[appointments:updateStatusInternal] User ${appointment.userId} not found for appointment ${args.appointmentId}. Proceeding with status update only.`,
      );
    }

    if (user) {
        if (args.status === "cancelled" && appointment.status !== "cancelled") {
        await ctx.db.patch(user._id, {
            cancellationCount: (user.cancellationCount || 0) + 1,
        });
        } else if (
        args.status !== "cancelled" &&
        appointment.status === "cancelled"
        ) {
        await ctx.db.patch(user._id, {
            cancellationCount: Math.max(0, (user.cancellationCount || 0) - 1),
        });
        }
    }

    const oldStatus = appointment.status;
    await ctx.db.patch(args.appointmentId, { status: args.status });

    if (oldStatus !== args.status) {
      const lifecycleEvent =
        args.status === "confirmed"
          ? "appointment_confirmed"
          : args.status === "cancelled"
            ? "appointment_cancelled"
            : args.status === "rescheduled"
              ? "appointment_rescheduled"
              : args.status === "in_progress"
                ? "appointment_started"
                : args.status === "completed"
                  ? "appointment_completed"
                  : null;

      if (lifecycleEvent && shouldScheduleNotificationJobs()) {
        await ctx.scheduler.runAfter(
          0,
          internal.notifications.queueAppointmentLifecycleEvent,
          {
            appointmentId: args.appointmentId,
            event: lifecycleEvent,
            transition: `${oldStatus}->${args.status}`,
          },
        );
      }
    }

    // Appointment confirmation is the single trigger for post-deposit Stripe invoice generation
    if (args.status === "confirmed") {
      const invoice = await ctx.db
        .query("invoices")
        .withIndex("by_appointment", (q) =>
          q.eq("appointmentId", args.appointmentId),
        )
        .first();

      // Skip Stripe Invoice for "in_person" (balance collected in person) and "full" (already paid)
      const skipStripeInvoice =
        invoice?.paymentOption === "in_person" || invoice?.paymentOption === "full";

      if (invoice && invoice.depositPaid && invoice.status === "draft" && !skipStripeInvoice) {
        console.log(
          `[appointments] scheduling post-deposit invoice generation appointmentId=${args.appointmentId} invoiceId=${invoice._id}`,
        );
        try {
          await ctx.scheduler.runAfter(
            0,
            internal.payments.createStripeInvoiceAfterDeposit,
            {
              appointmentId: args.appointmentId,
              invoiceId: invoice._id,
            },
          );
          console.log(
            `[appointments] post-deposit invoice generation scheduled appointmentId=${args.appointmentId} invoiceId=${invoice._id}`,
          );
        } catch (error) {
          console.error(
            `[appointments] failed to schedule post-deposit invoice generation appointmentId=${args.appointmentId} invoiceId=${invoice._id}`,
            error,
          );
          throw error;
        }
      } else if (skipStripeInvoice && invoice) {
        console.log(
          `[appointments] skipping Stripe invoice for paymentOption=${invoice.paymentOption} appointmentId=${args.appointmentId}`,
        );
      }

      // Schedule 24h reminder email
      if (shouldScheduleNotificationJobs()) {
        await scheduleReminder(
          ctx,
          args.appointmentId,
          appointment.scheduledDate,
          appointment.scheduledTime,
        );
      }
    }

    // Cancel reminder when appointment is cancelled or rescheduled
    if (
      (args.status === "cancelled" || args.status === "rescheduled") &&
      appointment.reminderScheduledId
    ) {
      await cancelReminder(
        ctx,
        args.appointmentId,
        appointment.reminderScheduledId,
      );
    }

    // When appointment is completed, send review request email
    if (args.status === "completed" && oldStatus !== "completed") {
      if (shouldScheduleNotificationJobs()) {
        await ctx.scheduler.runAfter(0, internal.notifications.queueReviewRequest, {
          appointmentId: args.appointmentId,
          transition: "completed->review_request",
        });

        await ctx.scheduler.runAfter(
          0,
          (internal as any).tripLogs.ensureDraftForCompletedAppointment,
          {
            appointmentId: args.appointmentId,
          },
        );
      }
    }

    return args.appointmentId;
  },
});

// Reschedule appointment
export const reschedule = mutation({
  args: {
    appointmentId: v.id("appointments"),
    newDate: v.string(),
    newTime: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getUserIdFromIdentity(ctx);
    if (!userId) throw new Error("Not authenticated");

    const appointment = await ctx.db.get(args.appointmentId);
    if (!appointment) throw new Error("Appointment not found");

    const isAdminUser = await isAdmin(ctx);
    if (!isAdminUser && appointment.userId !== userId) {
      throw new Error("Access denied");
    }

    if (
      appointment.status === "cancelled" ||
      appointment.status === "completed" ||
      appointment.status === "in_progress"
    ) {
      throw new Error("This appointment can no longer be rescheduled");
    }

    const normalizedDate = normalizeDateKey(args.newDate);
    const availability = await ctx.runQuery(api.availability.checkAvailability, {
      date: normalizedDate,
      startTime: args.newTime,
      duration: Math.max(appointment.duration || 0, BOOKING_BLOCK_MINUTES),
      ignoreAppointmentId: args.appointmentId,
    });

    if (!availability.available) {
      throw new Error(availability.reason || "Selected time is no longer available");
    }

    await ctx.db.patch(args.appointmentId, {
      scheduledDate: normalizedDate,
      scheduledTime: args.newTime,
    });

    if (shouldScheduleNotificationJobs()) {
      await ctx.scheduler.runAfter(
        0,
        internal.notifications.queueAppointmentLifecycleEvent,
        {
          appointmentId: args.appointmentId,
          event: "appointment_rescheduled",
          transition: `${appointment.status}->${appointment.status}`,
          dedupeContext: getScheduleFingerprint(normalizedDate, args.newTime),
        },
      );

      if (appointment.reminderScheduledId) {
        await cancelReminder(
          ctx,
          args.appointmentId,
          appointment.reminderScheduledId,
        );
      }

      if (appointment.status === "confirmed") {
        await scheduleReminder(
          ctx,
          args.appointmentId,
          normalizedDate,
          args.newTime,
        );
      }
    }

    return args.appointmentId;
  },
});

// Get calendar view
export const getCalendarView = query({
  args: {
    startDate: v.string(),
    endDate: v.string(),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const appointments = await ctx.db.query("appointments").collect();

    return appointments.filter(
      (apt) =>
        apt.scheduledDate >= args.startDate &&
        apt.scheduledDate <= args.endDate &&
        apt.status !== "cancelled",
    );
  },
});

// Get upcoming appointments
export const getUpcoming = query({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("appointments"),
      _creationTime: v.number(),
      userId: v.id("users"),
      userName: v.optional(v.string()), // Customer name
      vehicleIds: v.array(v.id("vehicles")),
      serviceIds: v.array(v.id("services")),
      scheduledDate: v.string(),
      scheduledTime: v.string(),
      status: v.union(
        v.literal("pending"),
        v.literal("confirmed"),
        v.literal("in_progress"),
        v.literal("completed"),
        v.literal("cancelled"),
        v.literal("rescheduled"),
      ),
      totalPrice: v.number(),
      duration: v.number(),
      location: v.object({
        street: v.string(),
        city: v.string(),
        state: v.string(),
        zip: v.string(),
        notes: v.optional(v.string()),
      }),
      notes: v.optional(v.string()),
      createdBy: v.id("users"),
    }),
  ),
  handler: async (ctx) => {
    const userId = await getUserIdFromIdentity(ctx);
    if (!userId) return [];

    const today = new Date();
    const nextWeek = new Date();
    nextWeek.setDate(today.getDate() + 7);

    const todayStr = today.toISOString().split("T")[0];
    const nextWeekStr = nextWeek.toISOString().split("T")[0];

    const isAdminUser = await isAdmin(ctx);

    let appointments;
    if (isAdminUser) {
      // Admins see all upcoming appointments
      appointments = await ctx.db
        .query("appointments")
        .collect();
    } else {
      appointments = await ctx.db
        .query("appointments")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect();
    }

    // Enrich appointments with customer names
    const enrichedAppointments = await Promise.all(
      appointments
        .filter(
          (apt) =>
            apt.scheduledDate >= todayStr &&
            apt.scheduledDate <= nextWeekStr &&
            apt.status !== "cancelled",
        )
        .map(async (apt) => {
          const user = await ctx.db.get(apt.userId);
          return {
            _id: apt._id,
            _creationTime: apt._creationTime,
            userId: apt.userId,
            userName: user?.name || undefined,
            vehicleIds: apt.vehicleIds,
            serviceIds: apt.serviceIds,
            scheduledDate: apt.scheduledDate,
            scheduledTime: apt.scheduledTime,
            status: apt.status,
            totalPrice: apt.totalPrice,
            duration: apt.duration,
            location: apt.location,
            notes: apt.notes,
            createdBy: apt.createdBy,
          };
        }),
    );

    return enrichedAppointments.sort((a, b) => {
      if (a.scheduledDate === b.scheduledDate) {
        return a.scheduledTime.localeCompare(b.scheduledTime);
      }
      return a.scheduledDate.localeCompare(b.scheduledDate);
    });
  },
});

// Get user's appointments separated by upcoming and past
export const getUserAppointments = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getUserIdFromIdentity(ctx);
    if (!userId) return { upcoming: [], past: [] };

    const appointments = await ctx.db
      .query("appointments")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();

    // Join with services and vehicles
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

    // Separate upcoming and past
    const upcoming = enrichedAppointments
      .filter(
        (apt) =>
          apt.status !== "cancelled" &&
          apt.status !== "completed",
      )
      .sort((a, b) => {
        if (a.scheduledDate === b.scheduledDate) {
          return a.scheduledTime.localeCompare(b.scheduledTime);
        }
        return a.scheduledDate.localeCompare(b.scheduledDate);
      });

    const past = enrichedAppointments
      .filter(
        (apt) =>
          apt.status === "completed" ||
          apt.status === "cancelled",
      )
      .sort((a, b) => {
        if (a.scheduledDate === b.scheduledDate) {
          return a.scheduledTime.localeCompare(b.scheduledTime);
        }
        return b.scheduledDate.localeCompare(a.scheduledDate);
      });

    return { upcoming, past };
  },
});

// Action to create Stripe invoice and Convex invoice record for an appointment
// Deprecated: legacy direct Stripe invoice creation path.
// Active production flow is deposit webhook -> updateStatusInternal -> internal.payments.createStripeInvoiceAfterDeposit.
export const createStripeInvoice = action({
  args: {
    appointmentId: v.id("appointments"),
    userId: v.id("users"),
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
    invoiceId: v.optional(v.id("invoices")), // Optional: if provided, update existing invoice instead of creating new one
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeSecretKey) {
      throw new Error("STRIPE_SECRET_KEY environment variable is not set");
    }

    // Get user data
    const user = await ctx.runQuery(api.users.getById, {
      userId: args.userId,
    });
    if (!user) throw new Error("User not found");

    // Update user stats (we'll do this via a mutation call)
    // Note: User stats are updated in the appointment creation

    const stripeCustomerId = await ensureStripeCustomerId(
      ctx,
      user,
      async (customerId) => {
        await ctx.runMutation(api.users.updateStripeCustomerId, {
          userId: args.userId,
          stripeCustomerId: customerId,
        });
      },
      stripeSecretKey,
    );

    // Create invoice items using existing Stripe price IDs from services
    const vehicleSize = getVehicleSize(args.vehicles);

    for (const service of args.services) {
      if (!service.stripePriceIds || service.stripePriceIds.length === 0) {
        throw new Error(`Service ${service.name} has no Stripe price IDs`);
      }

      // Find the appropriate price ID based on vehicle size
      // The stripePriceIds array contains price IDs in order: small, medium, large
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

    const invoiceResponse = await fetch("https://api.stripe.com/v1/invoices", {
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
    });

    if (!invoiceResponse.ok) {
      const errorText = await invoiceResponse.text();
      throw new Error(`Failed to create Stripe invoice: ${errorText}`);
    }

    const stripeInvoice = await invoiceResponse.json();

    // Send the invoice (Stripe will email it automatically)
    const sendResponse = await fetch(
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

    const sentInvoice = await sendResponse.json();

    // If invoiceId is provided, update existing invoice instead of creating new one
    if (args.invoiceId) {
      await ctx.runMutation(internal.invoices.updateStripeInvoiceData, {
        invoiceId: args.invoiceId,
        stripeInvoiceId: sentInvoice.id,
        stripeInvoiceUrl: sentInvoice.hosted_invoice_url,
        status: "sent",
      });
      return null;
    }

    // Otherwise, create a new invoice (for backward compatibility)
    // Generate invoice number
    const invoiceCount = (
      await ctx.runQuery(internal.invoices.getCountInternal, {})
    ).count;
    const invoiceNumber = `INV-${String(invoiceCount + 1).padStart(4, "0")}`;

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

    // Store invoice in Convex with Stripe data
    await ctx.runMutation(internal.invoices.createInternal, {
      appointmentId: args.appointmentId,
      userId: args.userId,
      invoiceNumber,
      items,
      subtotal,
      tax,
      total,
      status: "sent",
      dueDate,
      stripeInvoiceId: sentInvoice.id,
      stripeInvoiceUrl: sentInvoice.hosted_invoice_url,
      notes: `Invoice for appointment on ${args.scheduledDate}`,
    });

    return null;
  },
});

// Deprecated: legacy internal Stripe invoice creation path retained for rollback safety.
// Do not use for new flows; use internal.payments.createStripeInvoiceAfterDeposit instead.
export const createStripeInvoiceInternal = internalAction({
  args: {
    appointmentId: v.id("appointments"),
    userId: v.id("users"),
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
    invoiceId: v.optional(v.id("invoices")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeSecretKey) {
      throw new Error("STRIPE_SECRET_KEY environment variable is not set");
    }

    const user = await ctx.runQuery(internal.users.getByIdInternal, {
      userId: args.userId,
    });
    if (!user) throw new Error("User not found");

    const stripeCustomerId = await ensureStripeCustomerId(
      ctx,
      user,
      async (customerId) => {
        await ctx.runMutation(internal.users.updateStripeCustomerIdInternal, {
          userId: args.userId,
          stripeCustomerId: customerId,
        });
      },
      stripeSecretKey,
    );

    const vehicleSize = getVehicleSize(args.vehicles);

    // Create invoice items using existing Stripe price IDs from services
    for (const service of args.services) {
      if (!service.stripePriceIds || service.stripePriceIds.length === 0) {
        throw new Error(`Service ${service.name} has no Stripe price IDs`);
      }

      let priceIndex = 1;
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

      const invoiceItemResponse = await fetch(
        "https://api.stripe.com/v1/invoiceitems",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${stripeSecretKey}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            customer: stripeCustomerId,
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

    // Create Stripe invoice
    const dueDate = getInvoiceDueDateFromDateKey(args.scheduledDate);

    const invoiceResponse = await fetch("https://api.stripe.com/v1/invoices", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${stripeSecretKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        customer: stripeCustomerId,
        collection_method: "send_invoice",
        days_until_due: String(REMAINING_BALANCE_DUE_DAYS),
        auto_advance: "true",
        description: `Mobile detailing service - ${args.scheduledDate}`,
        metadata: JSON.stringify({
          invoiceId: args.invoiceId,
          appointmentId: args.appointmentId,
        }),
      }),
    });

    if (!invoiceResponse.ok) {
      const errorText = await invoiceResponse.text();
      throw new Error(`Failed to create Stripe invoice: ${errorText}`);
    }

    const invoice = await invoiceResponse.json();

    const sendResponse = await fetch(
      `https://api.stripe.com/v1/invoices/${invoice.id}/send`,
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

    const sentInvoice = await sendResponse.json();

    if (args.invoiceId) {
      await ctx.runMutation(internal.invoices.updateStripeInvoiceData, {
        invoiceId: args.invoiceId,
        stripeInvoiceId: sentInvoice.id,
        stripeInvoiceUrl: sentInvoice.hosted_invoice_url,
        status: "sent",
      });
      return null;
    }

    const invoiceCount = (
      await ctx.runQuery(internal.invoices.getCountInternal, {})
    ).count;
    const invoiceNumber = `INV-${String(invoiceCount + 1).padStart(4, "0")}`;

    const items = args.services.map((service) => {
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

    await ctx.runMutation(internal.invoices.createInternal, {
      appointmentId: args.appointmentId,
      userId: args.userId,
      invoiceNumber,
      items,
      subtotal,
      tax,
      total,
      status: "sent",
      dueDate,
      stripeInvoiceId: sentInvoice.id,
      stripeInvoiceUrl: sentInvoice.hosted_invoice_url,
      notes: `Invoice for appointment on ${args.scheduledDate}`,
    });

    return null;
  },
});

// Get appointments with full details (joined with clients, services, vehicles)
export const listWithDetails = query({
  args: {
    status: v.optional(
      v.union(
        v.literal("pending"),
        v.literal("confirmed"),
        v.literal("in_progress"),
        v.literal("completed"),
        v.literal("cancelled"),
        v.literal("rescheduled"),
      ),
    ),
  },
  handler: async (ctx, args) => {
    const userId = await getUserIdFromIdentity(ctx);
    if (!userId) throw new Error("Not authenticated");
    await requireAdmin(ctx);

    const appointments = await ctx.db.query("appointments").collect();

    // Join with users, services, and vehicles
    const enrichedAppointments = await Promise.all(
      appointments.map(async (apt) => {
        const user = await ctx.db.get(apt.userId);
        const services = await Promise.all(
          apt.serviceIds.map((id) => ctx.db.get(id)),
        );
        const vehicles = await Promise.all(
          apt.vehicleIds.map((id) => ctx.db.get(id)),
        );
        const linkedLog = await ctx.db
          .query("tripLogs")
          .withIndex("by_appointment", (q) => q.eq("appointmentId", apt._id))
          .first();
        const invoice = await ctx.db
          .query("invoices")
          .withIndex("by_appointment", (q) => q.eq("appointmentId", apt._id))
          .first();

        return {
          ...apt,
          user,
          services: services.filter((s) => s !== null),
          vehicles: vehicles.filter((v) => v !== null),
          tripLogStatus: linkedLog
            ? linkedLog.status
            : apt.status === "completed"
              ? "required"
              : null,
          tripLogRequiredReason:
            !linkedLog && apt.status === "completed"
              ? "completed_without_log"
              : undefined,
          tripLogId: linkedLog?._id,
          invoiceTotal: invoice?.total,
        };
      }),
    );

    const filtered = args.status
      ? enrichedAppointments.filter((a) => a.status === args.status)
      : enrichedAppointments;

    return filtered.sort((a, b) => {
      if (a.scheduledDate === b.scheduledDate) {
        return a.scheduledTime.localeCompare(b.scheduledTime);
      }
      return b.scheduledDate.localeCompare(a.scheduledDate);
    });
  },
});

// === Internal Actions for Payment Processing ===

// Charge deposit when appointment is confirmed
export const chargeDeposit = internalAction({
  args: {
    appointmentId: v.id("appointments"),
    invoiceId: v.id("invoices"),
  },
  handler: async (ctx, args): Promise<void> => {
    // Get invoice and appointment (use internal queries that don't require auth)
    const invoice: Doc<"invoices"> | null = await ctx.runQuery(
      internal.invoices.getByIdInternal,
      { invoiceId: args.invoiceId },
    );
    const appointment: Doc<"appointments"> | null = await ctx.runQuery(
      internal.appointments.getByIdInternal,
      { appointmentId: args.appointmentId },
    );

    if (!invoice || !appointment) return;
    if (!invoice.depositAmount || invoice.depositPaid) return;

    // Get user (use internal query since this is an internalAction)
    const user: Doc<"users"> | null = await ctx.runQuery(
      internal.users.getByIdInternal,
      {
        userId: appointment.userId,
      },
    );
    if (!user || !user.stripeCustomerId) {
      console.error("User not found or missing Stripe customer ID");
      return;
    }

    // Create Payment Intent for deposit
    try {
      const paymentIntent: any = await ctx.runAction(
        api.payments.createPaymentIntent,
        {
          amount: invoice.depositAmount,
          currency: "usd",
          customerId: user.stripeCustomerId,
          invoiceId: args.invoiceId,
          paymentType: "deposit",
        },
      );

      // Update invoice with payment intent ID
      await ctx.runMutation(internal.invoices.updateDepositStatusInternal, {
        invoiceId: args.invoiceId,
        depositPaid: false, // Will be updated via webhook when payment succeeds
        depositPaymentIntentId: paymentIntent.id,
        status: "sent",
      });
    } catch (error) {
      console.error("Failed to create deposit payment intent:", error);
      // Don't throw - allow appointment to be confirmed even if payment fails
    }
  },
});

// Generate and send invoice when appointment is confirmed
// Deprecated: legacy wrapper retained for rollback safety.
// Active post-deposit invoice generation is scheduled through internal.payments.createStripeInvoiceAfterDeposit.
export const generateAndSendInvoice = internalAction({
  args: {
    appointmentId: v.id("appointments"),
    invoiceId: v.id("invoices"),
  },
  handler: async (ctx, args): Promise<void> => {
    // Get invoice and appointment
    const invoice: Doc<"invoices"> | null = await ctx.runQuery(
      internal.invoices.getByIdInternal,
      { invoiceId: args.invoiceId },
    );
    const appointment: Doc<"appointments"> | null = await ctx.runQuery(
      internal.appointments.getByIdInternal,
      { appointmentId: args.appointmentId },
    );

    if (!invoice || !appointment) return;

    // Get user
    const user: Doc<"users"> | null = await ctx.runQuery(
      internal.users.getByIdInternal,
      {
        userId: appointment.userId,
      },
    );
    if (!user) {
      console.error("User not found");
      return;
    }

    // Use internal service lookup
    const services = await Promise.all(
      appointment.serviceIds.map((id) =>
        ctx.runQuery(internal.services.getServiceById, { serviceId: id }),
      ),
    );
    const validServices = services.filter((s: any) => s !== null);

    // Get vehicle count from appointment (number of vehicle IDs)
    // The invoice items already have correct pricing per vehicle
    const vehicleCount = appointment.vehicleIds.length;

    // Use medium as default size - invoice items already have correct pricing per vehicle
    const vehicleSize = "medium" as const;

    await ctx.runAction(internal.appointments.createStripeInvoiceInternal, {
      appointmentId: args.appointmentId,
      userId: appointment.userId,
      services: validServices.map((s: any) => ({
        _id: s!._id,
        stripePriceIds: s!.stripePriceIds || [],
        basePriceSmall: s!.basePriceSmall,
        basePriceMedium: s!.basePriceMedium,
        basePriceLarge: s!.basePriceLarge,
        name: s!.name,
      })),
      vehicles: Array(vehicleCount).fill({ size: vehicleSize }),
      totalPrice: invoice.total,
      scheduledDate: appointment.scheduledDate,
      invoiceId: args.invoiceId, // Pass existing invoiceId to update instead of creating new one
    });
  },
});

// Charge final payment when appointment is completed
export const chargeFinalPayment = internalAction({
  args: {
    appointmentId: v.id("appointments"),
    invoiceId: v.id("invoices"),
  },
  handler: async (ctx, args): Promise<void> => {
    // Get invoice and appointment (use internal queries that don't require auth)
    const invoice: Doc<"invoices"> | null = await ctx.runQuery(
      internal.invoices.getByIdInternal,
      { invoiceId: args.invoiceId },
    );
    const appointment: Doc<"appointments"> | null = await ctx.runQuery(
      internal.appointments.getByIdInternal,
      { appointmentId: args.appointmentId },
    );

    if (!invoice || !appointment) return;
    if (!invoice.remainingBalance || invoice.remainingBalance <= 0) return;
    if (!invoice.depositPaid) {
      console.error("Deposit not paid, cannot charge final payment");
      return;
    }

    // Final payment is handled via Stripe Invoice (created after deposit)
    // No need to create Payment Intent - customer can pay via stripeInvoiceUrl
    // or Stripe will automatically charge if customer has card on file
    if (invoice.stripeInvoiceUrl) {
      console.log(
        `Invoice ${invoice.invoiceNumber} ready for payment via Stripe Invoice: ${invoice.stripeInvoiceUrl}`,
      );
      // Stripe handles payment automatically or customer pays via hosted invoice page
      // Payment status will be updated via invoice.paid webhook
    } else {
      console.warn(
        `Invoice ${invoice.invoiceNumber} missing stripeInvoiceUrl - invoice may not be created yet`,
      );
      // Invoice should have been created after deposit was paid
      // This is a fallback case - could retry invoice creation here if needed
    }
  },
});

// Admin-only: retry failed Stripe invoice generation
export const retryInvoiceGeneration = mutation({
  args: {
    invoiceId: v.id("invoices"),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const invoice = await ctx.db.get(args.invoiceId);
    if (!invoice) {
      throw new Error("Invoice not found");
    }

    if (!invoice.depositPaid) {
      throw new Error("Deposit has not been paid yet");
    }

    if (invoice.stripeInvoiceId) {
      throw new Error("Stripe invoice already exists");
    }

    // Clear the error and re-schedule invoice generation
    await ctx.db.patch(args.invoiceId, {
      invoiceGenerationError: undefined,
    });

    await ctx.scheduler.runAfter(
      0,
      internal.payments.createStripeInvoiceAfterDeposit,
      {
        invoiceId: args.invoiceId,
        appointmentId: invoice.appointmentId,
      },
    );

    return { success: true };
  },
});
