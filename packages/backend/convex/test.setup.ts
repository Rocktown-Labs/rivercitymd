// Vitest setup file for Convex tests
// This file configures the test environment globally

import { vi } from "vitest";
import rateLimiterTest from "@convex-dev/rate-limiter/test";

vi.mock("convex-test", async (importOriginal) => {
  const actual = await importOriginal<typeof import("convex-test")>();
  return {
    ...actual,
    convexTest: (...args: Parameters<typeof actual.convexTest>) => {
      const t = actual.convexTest(...args);
      rateLimiterTest.register(t);
      return t;
    },
  };
});

// Set Stripe environment variables globally for all tests
// This ensures scheduled functions have access to the keys
if (typeof process !== "undefined") {
  process.env.STRIPE_SECRET_KEY =
    process.env.STRIPE_SECRET_KEY || "sk_test_mock_key";
  process.env.STRIPE_WEBHOOK_SECRET =
    process.env.STRIPE_WEBHOOK_SECRET || "whsec_test_mock_secret";
  process.env.CONVEX_TEST = process.env.CONVEX_TEST || "true";
  process.env.RADAR_SECRET_KEY =
    process.env.RADAR_SECRET_KEY || "prj_test_radar_secret";
}

// Helper function to create a mock Response with both json() and text() methods
// This ensures full Response compatibility for error handling code that calls response.text()
function createMockResponse(
  data: any,
  options: { ok?: boolean; status?: number } = {},
): Response {
  const { ok = true, status = 200 } = options;
  return {
    ok,
    status,
    json: async () => data,
    text: async () => {
      // For error responses, return JSON stringified error (Stripe format)
      if (!ok) {
        return JSON.stringify({
          error: {
            message: data?.error?.message || "Mock error",
            type: data?.error?.type || "api_error",
          },
        });
      }
      // For success responses, return JSON stringified data
      return JSON.stringify(data);
    },
  } as Response;
}

// Mock fetch globally to intercept Stripe API calls from scheduled functions
// This prevents scheduled functions from making real API calls with invalid keys
const originalFetch = globalThis.fetch;
export async function stripeFetchMock(
  url: string | URL,
  options?: RequestInit,
): Promise<Response> {
  const urlString = typeof url === "string" ? url : url.toString();

  if (urlString.includes("api.radar.io/v1/search/autocomplete")) {
    return createMockResponse({
      addresses: [
        {
          formattedAddress: "123 Main St, Little Rock, AR 72201, USA",
          addressLabel: "123 Main St, Little Rock, AR 72201",
          number: "123",
          street: "Main St",
          city: "Little Rock",
          state: "AR",
          stateCode: "AR",
          postalCode: "72201",
          latitude: 34.75,
          longitude: -92.3,
        },
      ],
    });
  }
  if (urlString.includes("api.radar.io/v1/geocode/forward")) {
    return createMockResponse({
      addresses: [{ latitude: 34.75, longitude: -92.3 }],
    });
  }
  if (urlString.includes("api.radar.io/v1/route/distance")) {
    try {
      const parsedUrl = new URL(urlString);
      const origin = parsedUrl.searchParams.get("origin");
      const destination = parsedUrl.searchParams.get("destination");
      if (origin && destination) {
        const [lat1, lon1] = origin.split(",").map(Number);
        const [lat2, lon2] = destination.split(",").map(Number);
        if (
          Number.isFinite(lat1) &&
          Number.isFinite(lon1) &&
          Number.isFinite(lat2) &&
          Number.isFinite(lon2)
        ) {
          const R = 3958.8;
          const dLat = ((lat2 - lat1) * Math.PI) / 180;
          const dLon = ((lon2 - lon1) * Math.PI) / 180;
          const a =
            Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos((lat1 * Math.PI) / 180) *
              Math.cos((lat2 * Math.PI) / 180) *
              Math.sin(dLon / 2) *
              Math.sin(dLon / 2);
          const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
          const miles = Math.round(R * c * 10) / 10;
          return createMockResponse({
            routes: {
              car: {
                distance: { text: `${miles} mi`, value: miles * 5280 },
                duration: {
                  text: `${Math.round(miles * 1.5)} mins`,
                  value: Math.round(miles * 1.5),
                },
              },
            },
          });
        }
      }
    } catch {
      // Fall through to fallback mock
    }
    return createMockResponse({
      routes: { car: { distance: { text: "10 mi", value: 52800 } } },
    });
  }

  // Intercept Stripe API calls. Parse the hostname rather than matching a
  // substring so test mocks cannot accidentally treat an arbitrary host as Stripe.
  let isStripeUrl = false;
  try {
    isStripeUrl = new URL(urlString).hostname === "api.stripe.com";
  } catch {
    isStripeUrl = false;
  }
  if (isStripeUrl) {
    // Parse the endpoint to return appropriate mock responses
    if (urlString.includes("/customers")) {
      // Create or retrieve customer
      return createMockResponse({
        id: "cus_test_123",
        invoice_settings: { default_payment_method: "pm_test_123" },
      });
    }
    if (urlString.includes("/products")) {
      // Create or retrieve product
      return createMockResponse({ id: "prod_test_123" });
    }
    if (urlString.includes("/checkout/sessions")) {
      // Create checkout session
      return createMockResponse({
        id: "cs_test_123",
        url: "https://checkout.stripe.com/test",
      });
    }
    if (urlString.includes("/payment_intents")) {
      // Create or retrieve payment intent
      return createMockResponse({
        id: "pi_test_123",
        status: "succeeded",
        amount: 1000,
      });
    }
    if (urlString.includes("/payment_methods")) {
      // List or create payment methods
      return createMockResponse({
        data: [
          {
            id: "pm_test_123",
            type: "card",
            card: { last4: "4242", brand: "visa" },
          },
        ],
      });
    }
    if (urlString.includes("/invoices/") && urlString.includes("/send")) {
      return createMockResponse({
        id: "in_test_123",
        hosted_invoice_url: "https://stripe.test/invoices/in_test_123",
        status: "open",
      });
    }
    if (urlString.includes("/invoices/") && urlString.includes("/finalize")) {
      return createMockResponse({ id: "in_test_123", status: "open" });
    }
    if (urlString.includes("/invoices")) {
      // Create or retrieve invoice
      return createMockResponse({
        id: "in_test_123",
        status: "draft",
        hosted_invoice_url: "https://stripe.test/invoices/in_test_123",
      });
    }
    if (urlString.includes("/prices")) {
      // Create or retrieve price
      return createMockResponse({ id: "price_test_123" });
    }
    if (urlString.includes("/invoiceitems")) {
      // Create or retrieve invoice item
      return createMockResponse({ id: "ii_test_123" });
    }
    // Default Stripe response
    return createMockResponse({ id: "stripe_test_123" });
  }

  // For non-Stripe URLs, use original fetch if available, otherwise return a basic response
  if (originalFetch) {
    return originalFetch(url, options);
  }
  // Fallback for environments without fetch
  return createMockResponse(
    { error: "Not mocked" },
    { ok: false, status: 404 },
  );
}

vi.stubGlobal("fetch", vi.fn(stripeFetchMock));

// Extend globalThis to track handled promises
declare global {
  var __handledTestPromises: Promise<any>[] | undefined;
}

// Glob pattern to import all Convex functions for testing.
// Paths are relative to the convex/ directory (this file lives in convex/).
// Vite's import.meta.glob doesn't support bash extended globbing; we match all .ts/.tsx then filter out test files.
const allModules = import.meta.glob("./**/*.{ts,tsx}", {
  eager: false,
}) as Record<string, () => Promise<any>>;

// Filter out test files and test setup files
export const modules: Record<string, () => Promise<any>> = Object.fromEntries(
  Object.entries(allModules).filter(([path]) => {
    // Exclude test files and test setup files
    return (
      !path.includes(".test.") &&
      !path.includes(".test/") &&
      !path.endsWith(".test.ts") &&
      !path.endsWith(".test.tsx") &&
      !path.includes("test.setup")
    );
  }),
) as Record<string, () => Promise<any>>;

// Suppress expected unhandled rejections from scheduled functions in tests
// These occur because convex-test tries to update the _scheduled_functions table
// after the test transaction completes, which is expected behavior
if (typeof process !== "undefined" && process.on) {
  // Suppress Node.js warnings about asynchronously handled promise rejections
  // for expected scheduled function errors
  const originalEmitWarning = process.emitWarning;
  process.emitWarning = function (warning: any, ...args: any[]) {
    const warningName =
      typeof warning === "object" && warning ? warning.name : "";
    const warningCode =
      typeof warning === "object" && warning ? warning.code : "";
    const warningMessage =
      typeof warning === "string"
        ? warning
        : typeof warning?.message === "string"
          ? warning.message
          : "";
    const argMessage = args
      .map((arg) => (typeof arg === "string" ? arg : ""))
      .join(" ");

    // Suppress PromiseRejectionHandledWarning for expected scheduled function errors
    if (
      warningName === "PromiseRejectionHandledWarning" ||
      warningCode === "PromiseRejectionHandledWarning" ||
      warningMessage.includes("Promise rejection was handled asynchronously") ||
      warningName === "TimeoutNegativeWarning" ||
      warningCode === "TimeoutNegativeWarning" ||
      warningMessage.includes("Timeout duration was set to 1.") ||
      argMessage.includes("PromiseRejectionHandledWarning")
    ) {
      return;
    }
    // Call original for all other warnings
    if (originalEmitWarning) {
      return (originalEmitWarning as any).apply(process, [warning, ...args]);
    }
  };

  process.on("unhandledRejection", (reason: any, promise: Promise<any>) => {
    // Only suppress known expected rejections from convex-test / scheduled functions.
    // Re-throw everything else so real bugs are not hidden.
    const errorMessage = reason?.message || String(reason);

    const isKnownScheduledOrStripeTestNoise =
      (errorMessage.includes("Write outside of transaction") &&
        errorMessage.includes("_scheduled_functions")) ||
      errorMessage.includes("STRIPE_SECRET_KEY") ||
      errorMessage.includes("Invalid API Key") ||
      errorMessage.includes("Stripe product creation failed") ||
      errorMessage.includes("Failed to create Stripe customer") ||
      errorMessage.includes("Closing rpc while") ||
      errorMessage.includes("is not registered");

    if (isKnownScheduledOrStripeTestNoise) {
      // Expected in test environment - convex-test updates scheduled function status
      // after test transactions complete, or Stripe key is missing in test env.
      // This is a framework limitation, not a bug.
      // Handle the rejection by attaching a catch handler that we actually track
      // Store the handled promise to prevent garbage collection
      const handledPromise = promise.catch(() => {
        // Silently ignore - this is expected behavior in tests
      });
      // Keep a reference to the handled promise to ensure it's tracked
      // Use a module-level array to maintain references
      if (!global.__handledTestPromises) {
        global.__handledTestPromises = [];
      }
      global.__handledTestPromises.push(handledPromise);
      // Limit array size to prevent memory leaks (keep last 100)
      if (global.__handledTestPromises.length > 100) {
        global.__handledTestPromises.shift();
      }
      return;
    }
    // Unexpected: do not handle so Vitest/Node can report the unhandled rejection
  });
}
