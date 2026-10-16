import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import {
  businessNotificationSettingsValidator,
  notificationEventValidator,
  userNotificationPreferencesValidator,
} from "./lib/notificationSettings";

const tripLogLocationValidator = v.object({
  addressLabel: v.optional(v.string()),
  street: v.optional(v.string()),
  city: v.optional(v.string()),
  state: v.optional(v.string()),
  postalCode: v.optional(v.string()),
  latitude: v.optional(v.number()),
  longitude: v.optional(v.number()),
});

const bookingBeforePhotoValidator = v.object({
  key: v.string(),
  fileName: v.string(),
  contentType: v.string(),
  sizeBytes: v.number(),
  uploadedAt: v.number(),
});

// Customize users table to include role and basic info
const schema = defineSchema({
  users: defineTable({
    name: v.optional(v.string()),
    email: v.optional(v.string()),
    emailVerificationTime: v.optional(v.number()),
    phone: v.optional(v.string()),
    phoneVerificationTime: v.optional(v.number()),
    image: v.optional(v.string()),
    // Clerk integration
    clerkUserId: v.optional(v.string()),
    // Custom fields
    role: v.optional(v.union(v.literal("admin"), v.literal("client"))),
    // Client fields (users are clients)
    address: v.optional(
      v.object({
        street: v.string(),
        city: v.string(),
        state: v.string(),
        zip: v.string(),
      }),
    ),
    timesServiced: v.optional(v.number()),
    totalSpent: v.optional(v.number()),
    status: v.optional(v.union(v.literal("active"), v.literal("inactive"))),
    cancellationCount: v.optional(v.number()),
    notes: v.optional(v.string()),
    // Payment fields
    stripeCustomerId: v.optional(v.string()),
    notificationPreferences: v.optional(userNotificationPreferencesValidator),
  })
    .index("by_email", ["email"])
    .index("by_clerk_user_id", ["clerkUserId"])
    .index("by_role", ["role"]),

  // Business Information
  businessInfo: defineTable({
    name: v.string(),
    owner: v.string(),
    address: v.string(),
    cityStateZip: v.string(),
    country: v.string(),
    logoId: v.optional(v.id("_storage")),
    notificationSettings: v.optional(businessNotificationSettingsValidator),
  }),

  // Vehicle information
  vehicles: defineTable({
    userId: v.id("users"),
    year: v.number(),
    make: v.string(),
    model: v.string(),
    vehicleTypeId: v.optional(v.id("vehicleTypes")),
    vehicleTypeOverrideBy: v.optional(v.id("users")),
    vehicleTypeOverrideAt: v.optional(v.number()),
    classification: v.optional(
      v.object({
        source: v.union(
          v.literal("fuelEconomy"),
          v.literal("vpic"),
          v.literal("manual"),
          v.literal("fallback"),
        ),
        confidence: v.union(
          v.literal("high"),
          v.literal("medium"),
          v.literal("low"),
        ),
        rawCategory: v.optional(v.string()),
        needsAdminReview: v.boolean(),
      }),
    ),
    size: v.optional(
      v.union(v.literal("small"), v.literal("medium"), v.literal("large")),
    ),
    color: v.optional(v.string()),
    licensePlate: v.optional(v.string()),
    notes: v.optional(v.string()),
  }).index("by_user", ["userId"]),

  vehicleTypes: defineTable({
    name: v.string(),
    slug: v.string(),
    legacySize: v.union(
      v.literal("small"),
      v.literal("medium"),
      v.literal("large"),
    ),
    isActive: v.boolean(),
    displayOrder: v.number(),
    apiAliases: v.optional(v.array(v.string())),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_slug", ["slug"])
    .index("by_active", ["isActive"]),

  // Service Categories
  serviceCategories: defineTable({
    name: v.string(),
    slug: v.optional(v.string()),
    type: v.union(
      v.literal("standard"),
      v.literal("subscription"),
      v.literal("addon"),
    ),
    displayOrder: v.optional(v.number()),
  }),

  // Deposit Settings (global deposit product)
  depositSettings: defineTable({
    amountPerVehicle: v.number(), // Deposit amount per vehicle (default $50)
    stripeProductId: v.optional(v.string()), // Stripe product ID for deposit
    stripePriceId: v.optional(v.string()), // Stripe price ID for deposit
    isActive: v.boolean(),
  }),

  // Pet Fee Settings
  petFeeSettings: defineTable({
    basePriceSmall: v.number(),
    basePriceMedium: v.number(),
    basePriceLarge: v.number(),
    timeAddMinutes: v.optional(v.number()),
    isActive: v.boolean(),
  }),

  // Travel Fee Settings
  travelFeeSettings: defineTable({
    originStreet: v.optional(v.string()),
    originCity: v.optional(v.string()),
    originState: v.optional(v.string()),
    originZip: v.optional(v.string()),
    originLatitude: v.optional(v.number()),
    originLongitude: v.optional(v.number()),
    freeRadiusMiles: v.number(),
    shortRangeMaxMiles: v.optional(v.number()),
    midRangeMaxMiles: v.number(),
    longRangeMaxMiles: v.number(),
    shortRangeFee: v.optional(v.number()),
    midRangeFee: v.number(),
    longRangeFee: v.number(),
    perMileRateAfterLongRange: v.number(),
    shortRangeBufferMinutes: v.optional(v.number()),
    midRangeBufferMinutes: v.number(),
    longRangeBufferMinutes: v.number(),
    isActive: v.boolean(),
  }),

  // Services and Subscriptions
  services: defineTable({
    name: v.string(),
    description: v.string(),
    basePrice: v.number(), // deprecated - kept for backwards compatibility
    basePriceSmall: v.optional(v.number()),
    basePriceMedium: v.optional(v.number()),
    basePriceLarge: v.optional(v.number()),
    duration: v.number(), // in minutes
    serviceType: v.optional(
      v.union(
        v.literal("standard"),
        v.literal("subscription"),
        v.literal("addon"),
      ),
    ),
    bookingRole: v.optional(
      v.union(
        v.literal("core"),
        v.literal("upgrade"),
        v.literal("addon"),
      ),
    ),
    isSubscribable: v.optional(v.boolean()),
    subscriptionFrequencies: v.optional(
      v.array(v.union(v.literal("monthly"), v.literal("biweekly"))),
    ),
    disallowWhenPetHair: v.optional(v.boolean()),
    disallowWhenDirtyMud: v.optional(v.boolean()),
    categoryId: v.optional(v.id("serviceCategories")), // legacy field
    includedServiceIds: v.optional(v.array(v.id("services"))),
    isActive: v.boolean(),
    showOnLandingPage: v.optional(v.boolean()),
    // NEW FIELDS:
    features: v.optional(v.array(v.string())), // Service features list
    icon: v.optional(v.string()), // Emoji or icon identifier
    stripeProductId: v.optional(v.string()), // Stripe product ID
    stripePriceIds: v.optional(v.array(v.string())), // Stripe price IDs for different sizes
    stripeRecurringPriceIds: v.optional(v.object({
      monthly: v.optional(v.array(v.string())),
      biweekly: v.optional(v.array(v.string())),
    })),
    // Note: Deposit is now a separate product managed via depositSettings table
  })
    .index("by_service_type", ["serviceType"])
    .index("by_category", ["categoryId"]),

  serviceVehiclePrices: defineTable({
    serviceId: v.id("services"),
    vehicleTypeId: v.id("vehicleTypes"),
    price: v.number(),
    duration: v.number(),
    isAvailable: v.boolean(),
    stripePriceId: v.optional(v.string()),
    stripeRecurringPriceIds: v.optional(
      v.object({
        monthly: v.optional(v.string()),
        biweekly: v.optional(v.string()),
      }),
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_service", ["serviceId"])
    .index("by_vehicle_type", ["vehicleTypeId"])
    .index("by_service_and_vehicle_type", ["serviceId", "vehicleTypeId"]),

  // Appointments/Bookings
  appointments: defineTable({
    userId: v.id("users"),
    vehicleIds: v.array(v.id("vehicles")),
    serviceIds: v.array(v.id("services")),
    vehicleServices: v.optional(
      v.array(
        v.object({
          vehicleId: v.id("vehicles"),
          serviceIds: v.array(v.id("services")),
        })
      )
    ),
    scheduledDate: v.string(), // ISO date string
    scheduledTime: v.string(), // HH:MM format
    duration: v.number(), // total duration in minutes
    location: v.object({
      street: v.string(),
      city: v.string(),
      state: v.string(),
      zip: v.string(),
      notes: v.optional(v.string()),
    }),
    status: v.union(
      v.literal("pending"),
      v.literal("confirmed"),
      v.literal("in_progress"),
      v.literal("completed"),
      v.literal("cancelled"),
      v.literal("rescheduled"),
    ),
    totalPrice: v.number(),
    notes: v.optional(v.string()),
    createdBy: v.id("users"),
    reminderScheduledId: v.optional(v.id("_scheduled_functions")),
    isTest: v.optional(v.boolean()),
    paymentOption: v.optional(
      v.union(
        v.literal("deposit"),
        v.literal("full"),
        v.literal("in_person"),
        v.literal("subscription"),
      ),
    ),
    subscriptionId: v.optional(v.id("subscriptions")),
    petFeeVehicleIds: v.optional(v.array(v.id("vehicles"))),
    travelDistanceMiles: v.optional(v.number()),
    travelFee: v.optional(v.number()),
    beforePhotos: v.optional(
      v.array(
        v.object({
          vehicleId: v.optional(v.id("vehicles")),
          vehicleLabel: v.optional(v.string()),
          key: v.string(),
          fileName: v.string(),
          contentType: v.string(),
          sizeBytes: v.number(),
          uploadedAt: v.number(),
        }),
      ),
    ),
  })
    .index("by_user", ["userId"])
    .index("by_date", ["scheduledDate"])
    .index("by_status", ["status"])
    .index("by_subscription", ["subscriptionId"]),

  appointmentAdjustments: defineTable({
    appointmentId: v.id("appointments"),
    actorId: v.id("users"),
    reason: v.string(),
    oldVehicleIds: v.array(v.id("vehicles")),
    newVehicleIds: v.array(v.id("vehicles")),
    oldServiceIds: v.array(v.id("services")),
    newServiceIds: v.array(v.id("services")),
    oldPetFeeVehicleIds: v.array(v.id("vehicles")),
    newPetFeeVehicleIds: v.array(v.id("vehicles")),
    oldItems: v.array(
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
    newItems: v.array(
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
    priceDelta: v.number(),
    durationDelta: v.number(),
    invoiceAction: v.union(
      v.literal("none"),
      v.literal("updated_open_invoice"),
      v.literal("supplemental_invoice_created"),
      v.literal("manual_credit_required"),
    ),
    invoiceId: v.optional(v.id("invoices")),
    supplementalInvoiceId: v.optional(v.id("invoices")),
    createdAt: v.number(),
  })
    .index("by_appointment", ["appointmentId"])
    .index("by_actor", ["actorId"]),

  bookingDrafts: defineTable({
    sourceUserId: v.optional(v.id("users")),
    customerName: v.string(),
    customerEmail: v.string(),
    customerPhone: v.string(),
    smsOptIn: v.optional(v.boolean()),
    address: v.object({
      street: v.string(),
      city: v.string(),
      state: v.string(),
      zip: v.string(),
      notes: v.optional(v.string()),
      latitude: v.optional(v.number()),
      longitude: v.optional(v.number()),
    }),
    existingVehicleIds: v.array(v.id("vehicles")),
    existingVehicleServices: v.optional(
      v.array(
        v.object({
          vehicleId: v.id("vehicles"),
          serviceIds: v.array(v.id("services")),
        })
      )
    ),
    draftVehicles: v.array(
      v.object({
        year: v.number(),
        make: v.string(),
        model: v.string(),
        size: v.optional(
          v.union(v.literal("small"), v.literal("medium"), v.literal("large")),
        ),
        vehicleTypeId: v.optional(v.id("vehicleTypes")),
        classification: v.optional(
          v.object({
            source: v.union(
              v.literal("fuelEconomy"),
              v.literal("vpic"),
              v.literal("manual"),
              v.literal("fallback"),
            ),
            confidence: v.union(
              v.literal("high"),
              v.literal("medium"),
              v.literal("low"),
            ),
            rawCategory: v.optional(v.string()),
            needsAdminReview: v.boolean(),
          }),
        ),
        color: v.optional(v.string()),
        licensePlate: v.optional(v.string()),
        hasPet: v.optional(v.boolean()),
        hasHeavySoil: v.optional(v.boolean()),
        beforePhotos: v.optional(v.array(bookingBeforePhotoValidator)),
        serviceIds: v.optional(v.array(v.id("services"))),
      }),
    ),
    petFeeExistingVehicleIds: v.optional(v.array(v.id("vehicles"))),
    serviceIds: v.array(v.id("services")),
    scheduledDate: v.string(),
    scheduledTime: v.string(),
    duration: v.number(),
    vehicleCount: v.number(),
    vehicleSize: v.union(
      v.literal("small"),
      v.literal("medium"),
      v.literal("large"),
    ),
    totalPrice: v.number(),
    depositAmount: v.number(),
    remainingBalance: v.number(),
    travelDistanceMiles: v.optional(v.number()),
    travelFee: v.optional(v.number()),
    paymentOption: v.union(
      v.literal("deposit"),
      v.literal("full"),
      v.literal("in_person"),
    ),
    couponCode: v.optional(v.string()),
    couponDiscountType: v.optional(
      v.union(v.literal("percent"), v.literal("amount")),
    ),
    couponDiscountValue: v.optional(v.number()),
    priceSnapshot: v.array(
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
    status: v.union(
      v.literal("draft"),
      v.literal("checkout_open"),
      v.literal("cancelled"),
      v.literal("expired"),
      v.literal("completed"),
      v.literal("converted"),
    ),
    resumeToken: v.string(),
    stripeCheckoutSessionId: v.optional(v.string()),
    stripeCheckoutUrl: v.optional(v.string()),
    stripeCustomerId: v.optional(v.string()),
    holdExpiresAt: v.optional(v.number()),
    holdExpiryScheduledId: v.optional(v.id("_scheduled_functions")),
    abandonedEmailScheduledId: v.optional(v.id("_scheduled_functions")),
    abandonedEmailSentAt: v.optional(v.number()),
    cancelledAt: v.optional(v.number()),
    expiredAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    convertedAt: v.optional(v.number()),
    convertedUserId: v.optional(v.id("users")),
    convertedAppointmentId: v.optional(v.id("appointments")),
    convertedInvoiceId: v.optional(v.id("invoices")),
    claimedAt: v.optional(v.number()),
    claimedByClerkUserId: v.optional(v.string()),
    lastActivityAt: v.number(),
  })
    .index("by_resume_token", ["resumeToken"])
    .index("by_status", ["status"])
    .index("by_checkout_session_id", ["stripeCheckoutSessionId"])
    .index("by_source_user", ["sourceUserId"]),

  // Payment Methods
  paymentMethods: defineTable({
    userId: v.id("users"),
    stripePaymentMethodId: v.string(),
    type: v.union(v.literal("card"), v.literal("bank_account")),
    last4: v.string(),
    brand: v.optional(v.string()), // For cards
    isDefault: v.boolean(),
    createdAt: v.string(),
  }).index("by_user", ["userId"]),

  // Invoices
  invoices: defineTable({
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
    status: v.union(
      v.literal("draft"),
      v.literal("sent"),
      v.literal("paid"),
      v.literal("overdue"),
    ),
    dueDate: v.string(),
    paidDate: v.optional(v.string()),
    stripePaymentIntentId: v.optional(v.string()),
    stripeInvoiceId: v.optional(v.string()),
    stripeInvoiceUrl: v.optional(v.string()),
    paymentMethodId: v.optional(v.id("paymentMethods")),
    notes: v.optional(v.string()),
    invoiceGenerationError: v.optional(v.string()),
    // Deposit fields
    depositAmount: v.optional(v.number()), // $50 × vehicle count
    depositPaid: v.optional(v.boolean()), // true when deposit charged
    depositPaymentIntentId: v.optional(v.string()), // Stripe payment intent ID for deposit
    remainingBalance: v.optional(v.number()), // total - depositAmount
    finalPaymentIntentId: v.optional(v.string()), // Stripe payment intent ID for final payment
    paymentOption: v.optional(
      v.union(
        v.literal("deposit"),
        v.literal("full"),
        v.literal("in_person"),
        v.literal("subscription"),
      ),
    ),
    remainingBalanceCollectionMethod: v.optional(
      v.union(v.literal("send_invoice"), v.literal("charge_automatically")),
    ),
    couponCode: v.optional(v.string()),
    discountAmount: v.optional(v.number()),
  })
    .index("by_user", ["userId"])
    .index("by_appointment", ["appointmentId"])
    .index("by_status", ["status"])
    .index("by_invoice_number", ["invoiceNumber"])
    .index("by_stripe_invoice_id", ["stripeInvoiceId"]),

  // Recurring Subscriptions
  subscriptions: defineTable({
    userId: v.id("users"),
    stripeSubscriptionId: v.optional(v.string()),
    stripeCheckoutSessionId: v.optional(v.string()),
    serviceIds: v.array(v.id("services")),
    vehicleIds: v.array(v.id("vehicles")),
    frequency: v.union(v.literal("biweekly"), v.literal("monthly")),
    preferredDayOfWeek: v.number(), // 0-6
    preferredTime: v.string(), // HH:MM
    location: v.object({
      street: v.string(),
      city: v.string(),
      state: v.string(),
      zip: v.string(),
      notes: v.optional(v.string()),
    }),
    totalPrice: v.number(),
    startDate: v.optional(v.string()),
    status: v.union(
      v.literal("pending_payment"),
      v.literal("active"),
      v.literal("paused"),
      v.literal("cancelled"),
      v.literal("past_due"),
    ),
    nextScheduledDate: v.optional(v.string()),
    lastAppointmentId: v.optional(v.id("appointments")),
    lastRenewalStripeInvoiceId: v.optional(v.string()),
    notes: v.optional(v.string()),
    createdBy: v.id("users"),
    isTest: v.optional(v.boolean()),
  })
    .index("by_user", ["userId"])
    .index("by_status", ["status"])
    .index("by_stripe_subscription_id", ["stripeSubscriptionId"]),

  // Reviews
  reviews: defineTable({
    userId: v.id("users"),
    appointmentId: v.id("appointments"),
    rating: v.number(), // 1-5 stars
    comment: v.optional(v.string()),
    isPublic: v.boolean(),
    reviewDate: v.string(),
  })
    .index("by_user", ["userId"])
    .index("by_appointment", ["appointmentId"]),

  // Chat messages
  chatMessages: defineTable({
    appointmentId: v.optional(v.id("appointments")),
    userId: v.id("users"),
    senderId: v.id("users"),
    senderType: v.union(v.literal("client"), v.literal("admin")),
    message: v.string(),
    messageType: v.union(
      v.literal("text"),
      v.literal("image"),
      v.literal("system"),
    ),
    isRead: v.boolean(),
  })
    .index("by_user", ["userId"])
    .index("by_appointment", ["appointmentId"]),

  // Business availability
  availability: defineTable({
    dayOfWeek: v.number(), // 0-6 (Sunday-Saturday)
    startTime: v.string(), // HH:MM format
    endTime: v.string(), // HH:MM format
    isActive: v.boolean(),
  }),

  // Time off / blocked times
  timeBlocks: defineTable({
    date: v.string(), // ISO date string
    startTime: v.string(),
    endTime: v.string(),
    reason: v.string(),
    type: v.union(
      v.literal("time_off"),
      v.literal("maintenance"),
      v.literal("other"),
    ),
    createdBy: v.id("users"),
  }).index("by_date", ["date"]),

  tripLogs: defineTable({
    source: v.union(v.literal("manual"), v.literal("appointment")),
    appointmentId: v.optional(v.id("appointments")),
    userId: v.optional(v.id("users")),
    requiredForAppointment: v.boolean(),
    status: v.union(v.literal("draft"), v.literal("completed")),
    logDate: v.string(), // ISO date string
    businessPurpose: v.string(),
    start: tripLogLocationValidator,
    stops: v.array(tripLogLocationValidator),
    radarMiles: v.optional(v.number()),
    finalMiles: v.optional(v.number()),
    mileageSource: v.union(
      v.literal("radar"),
      v.literal("manual_override"),
      v.literal("manual"),
    ),
    mileageOverrideReason: v.optional(v.string()),
    routeArtifactKey: v.optional(v.string()),
    routeComputedAt: v.optional(v.number()),
    routeGeoJson: v.optional(
      v.object({
        type: v.literal("LineString"),
        coordinates: v.array(v.array(v.number())),
      }),
    ),
    expenseTotalCents: v.number(),
    createdBy: v.id("users"),
    updatedBy: v.id("users"),
    updatedAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index("by_log_date", ["logDate"])
    .index("by_status", ["status"])
    .index("by_source", ["source"])
    .index("by_appointment", ["appointmentId"])
    .index("by_required_and_status", ["requiredForAppointment", "status"])
    .index("by_date_and_status", ["logDate", "status"]),

  tripLogExpenses: defineTable({
    tripLogId: v.id("tripLogs"),
    incurredDate: v.string(), // ISO date string
    category: v.string(),
    amountCents: v.number(),
    merchant: v.optional(v.string()),
    notes: v.optional(v.string()),
    receipts: v.array(
      v.object({
        key: v.string(),
        fileName: v.string(),
        contentType: v.string(),
        sizeBytes: v.number(),
        uploadedAt: v.number(),
      }),
    ),
  })
    .index("by_trip_log", ["tripLogId"])
    .index("by_incurred_date", ["incurredDate"])
    .index("by_trip_log_and_date", ["tripLogId", "incurredDate"]),

  webhookEvents: defineTable({
    source: v.union(
      v.literal("stripe"),
      v.literal("clerk"),
      v.literal("auth"),
    ),
    level: v.union(
      v.literal("info"),
      v.literal("warn"),
      v.literal("error"),
    ),
    eventType: v.string(),
    eventId: v.optional(v.string()),
    message: v.string(),
    stripeObjectId: v.optional(v.string()),
    checkoutSessionId: v.optional(v.string()),
    invoiceId: v.optional(v.id("invoices")),
    appointmentId: v.optional(v.id("appointments")),
    userId: v.optional(v.id("users")),
    clerkUserId: v.optional(v.string()),
    actionResult: v.optional(
      v.union(
        v.literal("linked"),
        v.literal("invited"),
        v.literal("skipped"),
        v.literal("failed"),
        v.literal("ignored"),
      ),
    ),
    details: v.optional(v.string()),
  })
    .index("by_source", ["source"])
    .index("by_level", ["level"]),

  notificationDispatches: defineTable({
    dedupeKey: v.string(),
    event: notificationEventValidator,
    channel: v.union(v.literal("email"), v.literal("sms")),
    recipientType: v.union(v.literal("admin"), v.literal("customer")),
    recipient: v.string(),
    status: v.union(
      v.literal("queued"),
      v.literal("sent"),
      v.literal("failed"),
      v.literal("canceled"),
    ),
    userId: v.optional(v.id("users")),
    appointmentId: v.optional(v.id("appointments")),
    invoiceId: v.optional(v.id("invoices")),
    reviewId: v.optional(v.id("reviews")),
    subscriptionId: v.optional(v.id("subscriptions")),
    tripLogId: v.optional(v.id("tripLogs")),
    transition: v.optional(v.string()),
    dedupeContext: v.optional(v.string()),
    scheduleFingerprint: v.optional(v.string()),
    checkoutUrl: v.optional(v.string()),
    failureReason: v.optional(v.string()),
    workId: v.optional(v.string()),
    error: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_dedupe_key", ["dedupeKey"]),

  outOfAreaLeads: defineTable({
    email: v.string(),
    address: v.string(),
    latitude: v.optional(v.number()),
    longitude: v.optional(v.number()),
    createdAt: v.number(),
  }),

  outOfAreaRequests: defineTable({
    customerName: v.string(),
    customerEmail: v.string(),
    customerPhone: v.string(),
    smsOptIn: v.optional(v.boolean()),
    address: v.object({
      street: v.string(),
      city: v.string(),
      state: v.string(),
      zip: v.string(),
      notes: v.optional(v.string()),
      latitude: v.optional(v.number()),
      longitude: v.optional(v.number()),
    }),
    scheduledDate: v.optional(v.string()),
    scheduledTime: v.optional(v.string()),
    vehicle: v.optional(
      v.object({
        year: v.optional(v.number()),
        make: v.optional(v.string()),
        model: v.optional(v.string()),
        size: v.optional(
          v.union(v.literal("small"), v.literal("medium"), v.literal("large")),
        ),
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
            confidence: v.union(
              v.literal("high"),
              v.literal("medium"),
              v.literal("low"),
            ),
            rawCategory: v.optional(v.string()),
            needsAdminReview: v.boolean(),
          }),
        ),
        color: v.optional(v.string()),
        licensePlate: v.optional(v.string()),
        hasPet: v.optional(v.boolean()),
        hasHeavySoil: v.optional(v.boolean()),
      }),
    ),
    estimatedDistanceMiles: v.optional(v.number()),
    estimatedTravelFee: v.optional(v.number()),
    status: v.union(
      v.literal("new"),
      v.literal("reviewing"),
      v.literal("contacted"),
      v.literal("approved"),
      v.literal("declined"),
      v.literal("notified"),
    ),
    adminNotes: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_status", ["status"])
    .index("by_created_at", ["createdAt"]),

  bookingClaims: defineTable({
    token: v.string(),
    appointmentId: v.id("appointments"),
    userId: v.id("users"),
    email: v.string(),
    createdAt: v.number(),
    expiresAt: v.number(),
    claimedAt: v.optional(v.number()),
    claimedByUserId: v.optional(v.id("users")),
    claimedByClerkUserId: v.optional(v.string()),
  }).index("by_token", ["token"]),
});

export default schema;
