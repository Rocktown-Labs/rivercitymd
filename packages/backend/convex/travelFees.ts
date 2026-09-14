import { ConvexError, v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import {
  calculateTravelBufferMinutesForMiles,
  calculateTravelFeeForMiles,
  calculateHaversineDistance,
  milesFromDistance,
  roundMiles,
  type TravelFeeSettings,
} from "./lib/travelFees";
import { assertRateLimit, normalizeRateLimitKey } from "./rateLimiter";

const addressValidator = v.object({
  street: v.string(),
  city: v.string(),
  state: v.string(),
  zip: v.string(),
  notes: v.optional(v.string()),
  latitude: v.optional(v.number()),
  longitude: v.optional(v.number()),
});

async function geocodeAddress(address: string, radarSecretKey: string) {
  const response = await fetch(
    `https://api.radar.io/v1/geocode/forward?query=${encodeURIComponent(address)}&limit=1&country=US`,
    {
      headers: { Authorization: radarSecretKey },
    },
  );
  if (!response.ok) {
    throw new ConvexError({
      code: "RADAR_GEOCODE_FAILED",
      message: "We could not validate the service address. Please select it again.",
    });
  }
  const payload: any = await response.json();
  const result = payload.addresses?.[0];
  if (!result?.latitude || !result?.longitude) {
    throw new ConvexError({
      code: "RADAR_GEOCODE_EMPTY",
      message: "We could not validate the service address. Please select it again.",
    });
  }
  return {
    latitude: result.latitude as number,
    longitude: result.longitude as number,
  };
}

async function calculateDrivingDistanceMiles(
  originLat: number,
  originLng: number,
  destLat: number,
  destLng: number,
  radarSecretKey?: string,
): Promise<number> {
  if (
    Math.abs(originLat - destLat) < 0.0001 &&
    Math.abs(originLng - destLng) < 0.0001
  ) {
    return 0;
  }

  if (radarSecretKey) {
    try {
      const response = await fetch(
        `https://api.radar.io/v1/route/distance?origin=${originLat},${originLng}&destination=${destLat},${destLng}&modes=car&units=imperial`,
        {
          method: "GET",
          headers: { Authorization: radarSecretKey },
        },
      );
      if (response.ok) {
        const payload: any = await response.json();
        const carRoute = payload.routes?.car;
        const miles = milesFromDistance(carRoute?.distance);
        if (miles > 0) {
          return roundMiles(miles);
        }
      }
    } catch {
      // Fall back to Haversine if Radar route distance is unavailable
    }
  }

  return roundMiles(
    calculateHaversineDistance(originLat, originLng, destLat, destLng),
  );
}

export const autocomplete = action({
  args: {
    query: v.string(),
  },
  handler: async (ctx, args) => {
    if (!args.query || args.query.trim().length < 3) {
      return [];
    }

    const radarSecretKey = process.env.RADAR_SECRET_KEY;
    if (!radarSecretKey) {
      return [];
    }

    try {
      const response = await fetch(
        `https://api.radar.io/v1/search/autocomplete?query=${encodeURIComponent(args.query.trim())}&limit=8&country=US`,
        {
          headers: { Authorization: radarSecretKey },
        },
      );

      if (!response.ok) return [];

      const data: any = await response.json();
      const addresses = data.addresses || [];

      return addresses.map((addr: any) => ({
        addressLabel:
          addr.formattedAddress ||
          addr.addressLabel ||
          [addr.number, addr.street, addr.city, addr.state, addr.postalCode]
            .filter(Boolean)
            .join(", "),
        formattedAddress: addr.formattedAddress || addr.addressLabel || "",
        street: [addr.number, addr.street].filter(Boolean).join(" ") || addr.street || "",
        city: addr.city || "",
        state: addr.state || addr.stateCode || "",
        postalCode: addr.postalCode || "",
        latitude: typeof addr.latitude === "number" ? addr.latitude : undefined,
        longitude: typeof addr.longitude === "number" ? addr.longitude : undefined,
      }));
    } catch {
      return [];
    }
  },
});

export const calculate = action({
  args: {
    address: addressValidator,
  },
  returns: v.object({
    distanceMiles: v.number(),
    fee: v.number(),
    bufferMinutes: v.number(),
  }),
  handler: async (ctx, args) => {
    const addressKey = normalizeRateLimitKey(
      [
        args.address.street,
        args.address.city,
        args.address.state,
        args.address.zip,
        args.address.latitude,
        args.address.longitude,
      ]
        .filter((value) => value !== undefined && value !== "")
        .join("|"),
    );
    await assertRateLimit(ctx, "travelFeeGlobal", {
      message: "Travel fee estimates are temporarily busy. Please try again shortly.",
    });
    await assertRateLimit(ctx, "travelFeeByAddress", {
      key: addressKey,
      message: "Please wait a moment before recalculating this address.",
    });

    const radarSecretKey = process.env.RADAR_SECRET_KEY;

    let lat = args.address.latitude;
    let lng = args.address.longitude;

    if (lat === undefined || lng === undefined) {
      if (!radarSecretKey) {
        throw new ConvexError({
          code: "MISSING_RADAR_SECRET_KEY",
          message: "Travel distance calculation is temporarily unavailable.",
        });
      }

      const destinationAddress = [
        args.address.street,
        args.address.city,
        args.address.state,
        args.address.zip,
      ]
        .filter(Boolean)
        .join(", ");

      const destCoords = await geocodeAddress(destinationAddress, radarSecretKey);
      lat = destCoords.latitude;
      lng = destCoords.longitude;
    }

    const settings: TravelFeeSettings = await ctx.runQuery(
      internal.travelFeeSettings.getInternal,
      {},
    );
    const distanceMiles = await calculateDrivingDistanceMiles(
      settings.originLatitude,
      settings.originLongitude,
      lat,
      lng,
      radarSecretKey,
    );

    return {
      distanceMiles,
      fee: calculateTravelFeeForMiles(distanceMiles, settings),
      bufferMinutes: calculateTravelBufferMinutesForMiles(distanceMiles, settings),
    };
  },
});
