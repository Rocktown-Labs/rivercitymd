import { describe, expect, test } from "vitest";
import {
  getEffectiveServicePricingForVehicle,
  hasAnyAvailableVehicleTypePrice,
  isBookableStandardService,
  isServiceAvailableForVehicle,
} from "./pricing";

describe("vehicle-aware service pricing", () => {
  test("uses the exact vehicle type price and duration when available", () => {
    const service = {
      isActive: true,
      duration: 60,
      basePriceSmall: 100,
      basePriceMedium: 125,
      basePriceLarge: 150,
      vehiclePrices: [
        {
          vehicleTypeId: "car",
          price: 110,
          duration: 70,
          isAvailable: true,
        },
        {
          vehicleTypeId: "van",
          price: 180,
          duration: 120,
          isAvailable: true,
        },
      ],
    };

    expect(
      getEffectiveServicePricingForVehicle(service, {
        vehicleSize: "large",
        vehicleTypeId: "van",
      }),
    ).toEqual({ price: 180, duration: 120, isAvailable: true });
    expect(
      isServiceAvailableForVehicle(service, {
        vehicleSize: "large",
        vehicleTypeId: "van",
      }),
    ).toBe(true);
  });

  test("treats a missing exact vehicle type row as unavailable", () => {
    const service = {
      isActive: true,
      duration: 60,
      basePriceSmall: 100,
      basePriceMedium: 125,
      basePriceLarge: 150,
      vehiclePrices: [
        {
          vehicleTypeId: "car",
          price: 110,
          duration: 70,
          isAvailable: true,
        },
      ],
    };

    expect(
      getEffectiveServicePricingForVehicle(service, {
        vehicleSize: "large",
        vehicleTypeId: "van",
      }),
    ).toEqual({ price: 0, duration: 60, isAvailable: false });
    expect(
      isServiceAvailableForVehicle(service, {
        vehicleSize: "large",
        vehicleTypeId: "van",
      }),
    ).toBe(false);
  });

  test("treats rows without price or duration as unavailable", () => {
    const service = {
      isActive: true,
      serviceType: "standard" as const,
      duration: 90,
      vehiclePrices: [
        {
          vehicleTypeId: "car",
          price: 125,
          duration: 0,
          isAvailable: true,
        },
        {
          vehicleTypeId: "truck",
          price: 0,
          duration: 120,
          isAvailable: true,
        },
      ],
    };

    expect(
      getEffectiveServicePricingForVehicle(service, {
        vehicleSize: "medium",
        vehicleTypeId: "car",
      }),
    ).toEqual({ price: 125, duration: 0, isAvailable: false });
    expect(hasAnyAvailableVehicleTypePrice(service.vehiclePrices)).toBe(false);
    expect(isBookableStandardService(service)).toBe(false);
  });

  test("falls back to matching legacy size rows when a vehicle has no type id", () => {
    const service = {
      isActive: true,
      duration: 60,
      vehiclePrices: [
        {
          vehicleTypeId: "car",
          price: 110,
          duration: 70,
          isAvailable: true,
          vehicleType: { legacySize: "small" as const },
        },
        {
          vehicleTypeId: "suv",
          price: 145,
          duration: 95,
          isAvailable: true,
          vehicleType: { legacySize: "medium" as const },
        },
      ],
    };

    expect(
      getEffectiveServicePricingForVehicle(service, {
        vehicleSize: "medium",
      }),
    ).toEqual({ price: 145, duration: 95, isAvailable: true });
  });

  test("falls back to legacy size for a custom vehicle type without an exact row", () => {
    const service = {
      isActive: true,
      duration: 60,
      vehiclePrices: [
        {
          vehicleTypeId: "truck",
          price: 200,
          duration: 90,
          isAvailable: true,
          vehicleType: { legacySize: "large" as const },
        },
        {
          vehicleTypeId: "semi",
          price: 500,
          duration: 240,
          isAvailable: true,
          vehicleType: { legacySize: "large" as const },
        },
      ],
    };

    expect(
      getEffectiveServicePricingForVehicle(service, {
        vehicleSize: "large",
        vehicleTypeId: "freightliner",
      }),
    ).toEqual({ price: 200, duration: 90, isAvailable: true });
    expect(
      getEffectiveServicePricingForVehicle(service, {
        vehicleSize: "large",
        vehicleTypeId: "semi",
      }),
    ).toEqual({ price: 500, duration: 240, isAvailable: true });
  });

  test("falls back to legacy price fields when no vehicle rows exist", () => {
    const service = {
      isActive: true,
      duration: 80,
      basePriceSmall: 100,
      basePriceMedium: 125,
      basePriceLarge: 150,
    };

    expect(
      getEffectiveServicePricingForVehicle(service, {
        vehicleSize: "large",
        vehicleTypeId: "truck",
      }),
    ).toEqual({ price: 150, duration: 80, isAvailable: true });
  });
});
