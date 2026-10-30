const STRIPE_API_MAX_ATTEMPTS = 3;
const STRIPE_API_RETRY_DELAYS_MS = [250, 750] as const;

export function getStripeSecretKey(): string {
  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeSecretKey) {
    throw new Error(
      "STRIPE_SECRET_KEY environment variable is not set. Please set it in your Convex environment.",
    );
  }
  return stripeSecretKey;
}

export async function stripeApiCall(
  endpoint: string,
  options: RequestInit = {},
) {
  const stripeSecretKey = getStripeSecretKey();
  const url = `https://api.stripe.com/v1/${endpoint}`;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= STRIPE_API_MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          Authorization: `Bearer ${stripeSecretKey}`,
          "Content-Type": "application/x-www-form-urlencoded",
          ...options.headers,
        },
      });

      if (!response.ok) {
        const error = await response.text();
        let stripeMessage = error;
        try {
          const parsed = JSON.parse(error);
          stripeMessage = parsed?.error?.message || error;
        } catch {
          // Keep the raw Stripe body when it is not JSON.
        }
        const shouldRetry = response.status === 429 || response.status >= 500;
        const stripeError = new Error(
          `Stripe API error: ${response.status} ${stripeMessage}`,
        );

        if (!shouldRetry || attempt === STRIPE_API_MAX_ATTEMPTS) {
          throw stripeError;
        }

        lastError = stripeError;
      } else {
        return response.json();
      }
    } catch (error) {
      const stripeError =
        error instanceof Error ? error : new Error(String(error));

      if (
        !isTransientStripeConnectionError(stripeError) ||
        attempt === STRIPE_API_MAX_ATTEMPTS
      ) {
        throw stripeError;
      }

      lastError = stripeError;
    }

    await delay(STRIPE_API_RETRY_DELAYS_MS[attempt - 1] ?? 1_500);
  }

  throw lastError ?? new Error("Stripe API request failed");
}

function isTransientStripeConnectionError(error: Error) {
  const message = error.message.toLowerCase();
  return (
    message.includes("tunnel error") ||
    message.includes("client error (connect)") ||
    message.includes("fetch failed") ||
    message.includes("networkerror") ||
    message.includes("timeout") ||
    message.includes("temporar") ||
    message.includes("econnreset") ||
    message.includes("enotfound")
  );
}

export function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
