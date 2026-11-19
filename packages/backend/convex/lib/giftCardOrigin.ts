import { ConvexError } from "convex/values";
// Access tokens appear in checkout return URLs. Never send them to an
// arbitrary caller-supplied origin. Development/preview origins are explicit.
export function validateGiftCardOrigin(value: string) {
  const allowed = new Set([
    "https://www.rivercitymd.com",
    "https://rivercitymd.com",
    ...[
      process.env.NEXT_PUBLIC_APP_URL,
      process.env.NEXT_PUBLIC_SITE_URL,
      ...(process.env.GIFT_CARD_ALLOWED_ORIGINS ?? "").split(","),
    ]
      .filter((origin): origin is string => Boolean(origin?.trim()))
      .map((origin) => {
        try {
          return new URL(origin.trim()).origin;
        } catch {
          throw new ConvexError({
            message:
              "Gift card return origins are misconfigured. Contact the administrator.",
          });
        }
      }),
  ]);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ConvexError({ message: "Invalid checkout origin" });
  }
  if (
    !allowed.has(url.origin) ||
    url.username ||
    url.password ||
    (url.protocol !== "https:" &&
      !(
        url.protocol === "http:" &&
        ["localhost", "127.0.0.1"].includes(url.hostname)
      ))
  ) {
    throw new ConvexError({
      message: "Checkout must return to the River City website",
    });
  }
  return url.origin;
}
