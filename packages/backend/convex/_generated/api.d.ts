/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as analytics from "../analytics.js";
import type * as appointments from "../appointments.js";
import type * as auth from "../auth.js";
import type * as availability from "../availability.js";
import type * as bookingClaims from "../bookingClaims.js";
import type * as bookingDrafts from "../bookingDrafts.js";
import type * as business from "../business.js";
import type * as campaigns from "../campaigns.js";
import type * as chat from "../chat.js";
import type * as crons from "../crons.js";
import type * as debug from "../debug.js";
import type * as depositSettings from "../depositSettings.js";
import type * as devSeeds from "../devSeeds.js";
import type * as emailTemplates from "../emailTemplates.js";
import type * as emails from "../emails.js";
import type * as http from "../http.js";
import type * as invoices from "../invoices.js";
import type * as lib_address from "../lib/address.js";
import type * as lib_booking from "../lib/booking.js";
import type * as lib_coupons from "../lib/coupons.js";
import type * as lib_invoices from "../lib/invoices.js";
import type * as lib_notificationMessages from "../lib/notificationMessages.js";
import type * as lib_notificationSettings from "../lib/notificationSettings.js";
import type * as lib_pricing from "../lib/pricing.js";
import type * as lib_scheduling from "../lib/scheduling.js";
import type * as lib_time from "../lib/time.js";
import type * as lib_travelFees from "../lib/travelFees.js";
import type * as notifications from "../notifications.js";
import type * as payments from "../payments.js";
import type * as petFeeSettings from "../petFeeSettings.js";
import type * as push from "../push.js";
import type * as r2 from "../r2.js";
import type * as rateLimiter from "../rateLimiter.js";
import type * as reviews from "../reviews.js";
import type * as services from "../services.js";
import type * as setupReadiness from "../setupReadiness.js";
import type * as sms from "../sms.js";
import type * as stripeClient from "../stripeClient.js";
import type * as subscriptions from "../subscriptions.js";
import type * as testEmails from "../testEmails.js";
import type * as testFlows from "../testFlows.js";
import type * as testUtils_bookingSetup from "../testUtils/bookingSetup.js";
import type * as travelFeeSettings from "../travelFeeSettings.js";
import type * as travelFees from "../travelFees.js";
import type * as tripLogs from "../tripLogs.js";
import type * as users from "../users.js";
import type * as vehicleTypes from "../vehicleTypes.js";
import type * as vehicles from "../vehicles.js";
import type * as webhookDiagnostics from "../webhookDiagnostics.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  analytics: typeof analytics;
  appointments: typeof appointments;
  auth: typeof auth;
  availability: typeof availability;
  bookingClaims: typeof bookingClaims;
  bookingDrafts: typeof bookingDrafts;
  business: typeof business;
  campaigns: typeof campaigns;
  chat: typeof chat;
  crons: typeof crons;
  debug: typeof debug;
  depositSettings: typeof depositSettings;
  devSeeds: typeof devSeeds;
  emailTemplates: typeof emailTemplates;
  emails: typeof emails;
  http: typeof http;
  invoices: typeof invoices;
  "lib/address": typeof lib_address;
  "lib/booking": typeof lib_booking;
  "lib/coupons": typeof lib_coupons;
  "lib/invoices": typeof lib_invoices;
  "lib/notificationMessages": typeof lib_notificationMessages;
  "lib/notificationSettings": typeof lib_notificationSettings;
  "lib/pricing": typeof lib_pricing;
  "lib/scheduling": typeof lib_scheduling;
  "lib/time": typeof lib_time;
  "lib/travelFees": typeof lib_travelFees;
  notifications: typeof notifications;
  payments: typeof payments;
  petFeeSettings: typeof petFeeSettings;
  push: typeof push;
  r2: typeof r2;
  rateLimiter: typeof rateLimiter;
  reviews: typeof reviews;
  services: typeof services;
  setupReadiness: typeof setupReadiness;
  sms: typeof sms;
  stripeClient: typeof stripeClient;
  subscriptions: typeof subscriptions;
  testEmails: typeof testEmails;
  testFlows: typeof testFlows;
  "testUtils/bookingSetup": typeof testUtils_bookingSetup;
  travelFeeSettings: typeof travelFeeSettings;
  travelFees: typeof travelFees;
  tripLogs: typeof tripLogs;
  users: typeof users;
  vehicleTypes: typeof vehicleTypes;
  vehicles: typeof vehicles;
  webhookDiagnostics: typeof webhookDiagnostics;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  resend: import("@convex-dev/resend/_generated/component.js").ComponentApi<"resend">;
  workflow: import("@convex-dev/workflow/_generated/component.js").ComponentApi<"workflow">;
  notificationsWorkpool: import("@convex-dev/workpool/_generated/component.js").ComponentApi<"notificationsWorkpool">;
  twilio: import("@convex-dev/twilio/_generated/component.js").ComponentApi<"twilio">;
  stripe: import("@convex-dev/stripe/_generated/component.js").ComponentApi<"stripe">;
  r2: import("@convex-dev/r2/_generated/component.js").ComponentApi<"r2">;
  rateLimiter: import("@convex-dev/rate-limiter/_generated/component.js").ComponentApi<"rateLimiter">;
};
