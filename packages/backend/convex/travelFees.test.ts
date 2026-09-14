import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import {
  calculateHaversineDistance,
  calculateTravelBufferMinutesForMiles,
  calculateTravelFeeForMiles,
} from "./lib/travelFees";
import schema from "./schema";
import { modules, stripeFetchMock } from "./test.setup";

describe("travelFees", () => {
  afterEach(() => {
    vi.stubGlobal("fetch", vi.fn(stripeFetchMock));
  });

  test("uses tiered fees for estimated travel distance", () => {
    expect(calculateTravelFeeForMiles(14)).toBe(0);
    expect(calculateTravelFeeForMiles(14.1)).toBe(15);
    expect(calculateTravelFeeForMiles(20)).toBe(15);
    expect(calculateTravelFeeForMiles(20.1)).toBe(25);
    expect(calculateTravelFeeForMiles(35)).toBe(25);
    expect(calculateTravelFeeForMiles(35.1)).toBe(50);
    expect(calculateTravelFeeForMiles(50)).toBe(50);
    expect(calculateTravelFeeForMiles(50.1)).toBe(50.2);
    expect(calculateTravelFeeForMiles(100)).toBe(150);
  });

  test("uses configurable travel fee settings", async () => {
    const t = convexTest(schema, modules);
    const adminId = await t.run(async (ctx: any) => {
      return await ctx.db.insert("users", {
        name: "Admin",
        email: "admin-travel-settings@example.com",
        role: "admin",
      });
    });
    const asAdmin = t.withIdentity({
      subject: adminId,
      email: "admin-travel-settings@example.com",
    });

    await asAdmin.mutation(api.travelFeeSettings.upsert, {
      originStreet: "220 N. Tyler St",
      originCity: "Little Rock",
      originState: "AR",
      originZip: "72205",
      originLatitude: 34.752258,
      originLongitude: -92.329768,
      freeRadiusMiles: 20,
      shortRangeMaxMiles: 25,
      midRangeMaxMiles: 30,
      longRangeMaxMiles: 40,
      shortRangeFee: 15,
      midRangeFee: 25,
      longRangeFee: 45,
      perMileRateAfterLongRange: 3,
      shortRangeBufferMinutes: 20,
      midRangeBufferMinutes: 30,
      longRangeBufferMinutes: 75,
      isActive: true,
    });

    const settings = await t.query(api.travelFeeSettings.get, {});
    expect(calculateTravelFeeForMiles(45, settings)).toBe(60);
    expect(calculateTravelFeeForMiles(22, settings)).toBe(15);
    expect(calculateTravelBufferMinutesForMiles(25, settings)).toBe(20);
    expect(calculateTravelBufferMinutesForMiles(45, settings)).toBe(75);
  });

  test("uses a custom configured origin for travel estimates", async () => {
    const t = convexTest(schema, modules);
    const adminId = await t.run(async (ctx: any) => {
      return await ctx.db.insert("users", {
        name: "Admin",
        email: "admin-origin-settings@example.com",
        role: "admin",
      });
    });
    const asAdmin = t.withIdentity({
      subject: adminId,
      email: "admin-origin-settings@example.com",
    });

    await asAdmin.mutation(api.travelFeeSettings.upsert, {
      originStreet: "100 Origin Rd",
      originCity: "Fayetteville",
      originState: "AR",
      originZip: "72701",
      originLatitude: 36.06258,
      originLongitude: -94.15743,
      freeRadiusMiles: 20,
      shortRangeMaxMiles: 25,
      midRangeMaxMiles: 35,
      longRangeMaxMiles: 50,
      shortRangeFee: 15,
      midRangeFee: 25,
      longRangeFee: 50,
      perMileRateAfterLongRange: 2,
      shortRangeBufferMinutes: 15,
      midRangeBufferMinutes: 30,
      longRangeBufferMinutes: 60,
      isActive: true,
    });

    const result = await t.action(api.travelFees.calculate, {
      address: {
        street: "100 Destination Rd",
        city: "Fayetteville",
        state: "AR",
        zip: "72701",
        latitude: 36.16258,
        longitude: -94.15743,
      },
    });

    expect(result.distanceMiles).toBeGreaterThan(6);
    expect(result.distanceMiles).toBeLessThan(8);
    expect(result.fee).toBe(0);
    expect(result.bufferMinutes).toBe(0);
  });

  test("geocodes and stores the admin origin address when settings are saved", async () => {
    const previousKey = process.env.RADAR_SECRET_KEY;
    process.env.RADAR_SECRET_KEY = "test_radar_key";
    const t = convexTest(schema, modules);
    const adminId = await t.run(async (ctx: any) => {
      return await ctx.db.insert("users", {
        name: "Admin",
        email: "admin-geocode-origin@example.com",
        role: "admin",
      });
    });
    const asAdmin = t.withIdentity({
      subject: adminId,
      email: "admin-geocode-origin@example.com",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        if (String(url).includes("/geocode/forward")) {
          return Response.json({
            addresses: [{ latitude: 36.06258, longitude: -94.15743 }],
          });
        }
        return Response.json({}, { status: 404 });
      }),
    );

    await asAdmin.action(api.travelFeeSettings.validateOriginAndUpsert, {
      originStreet: "100 Origin Rd",
      originCity: "Fayetteville",
      originState: "AR",
      originZip: "72701",
      freeRadiusMiles: 20,
      shortRangeMaxMiles: 25,
      midRangeMaxMiles: 35,
      longRangeMaxMiles: 50,
      shortRangeFee: 15,
      midRangeFee: 25,
      longRangeFee: 50,
      perMileRateAfterLongRange: 2,
      shortRangeBufferMinutes: 15,
      midRangeBufferMinutes: 30,
      longRangeBufferMinutes: 60,
      isActive: true,
    });

    process.env.RADAR_SECRET_KEY = previousKey;
    const settings = await t.query(api.travelFeeSettings.get, {});
    expect(settings.originStreet).toBe("100 Origin Rd");
    expect(settings.originLatitude).toBe(36.06258);
    expect(settings.originLongitude).toBe(-94.15743);
  });

  test("updates fee rules without changing the validated origin", async () => {
    const t = convexTest(schema, modules);
    const adminId = await t.run(async (ctx: any) => {
      return await ctx.db.insert("users", {
        name: "Admin",
        email: "admin-update-travel-rules@example.com",
        role: "admin",
      });
    });
    const asAdmin = t.withIdentity({
      subject: adminId,
      email: "admin-update-travel-rules@example.com",
    });

    await asAdmin.mutation(api.travelFeeSettings.upsert, {
      originStreet: "100 Origin Rd",
      originCity: "Fayetteville",
      originState: "AR",
      originZip: "72701",
      originLatitude: 36.06258,
      originLongitude: -94.15743,
      freeRadiusMiles: 20,
      shortRangeMaxMiles: 25,
      midRangeMaxMiles: 35,
      longRangeMaxMiles: 50,
      shortRangeFee: 15,
      midRangeFee: 25,
      longRangeFee: 50,
      perMileRateAfterLongRange: 2,
      shortRangeBufferMinutes: 15,
      midRangeBufferMinutes: 30,
      longRangeBufferMinutes: 60,
      isActive: true,
    });

    await asAdmin.mutation(api.travelFeeSettings.updateRules, {
      freeRadiusMiles: 18,
      shortRangeMaxMiles: 25,
      midRangeMaxMiles: 32,
      longRangeMaxMiles: 52,
      shortRangeFee: 15,
      midRangeFee: 25,
      longRangeFee: 50,
      perMileRateAfterLongRange: 2,
      shortRangeBufferMinutes: 15,
      midRangeBufferMinutes: 30,
      longRangeBufferMinutes: 60,
      isActive: true,
    });

    const settings = await t.query(api.travelFeeSettings.get, {});
    expect(settings.originStreet).toBe("100 Origin Rd");
    expect(settings.originLatitude).toBe(36.06258);
    expect(settings.freeRadiusMiles).toBe(18);
    expect(settings.midRangeFee).toBe(25);
  });

  test("rejects overlapping travel fee tiers", async () => {
    const t = convexTest(schema, modules);
    const adminId = await t.run(async (ctx: any) => {
      return await ctx.db.insert("users", {
        name: "Admin",
        email: "admin-invalid-travel-rules@example.com",
        role: "admin",
      });
    });
    const asAdmin = t.withIdentity({
      subject: adminId,
      email: "admin-invalid-travel-rules@example.com",
    });

    await expect(
      asAdmin.mutation(api.travelFeeSettings.updateRules, {
        freeRadiusMiles: 20,
        shortRangeMaxMiles: 25,
        midRangeMaxMiles: 20,
        longRangeMaxMiles: 50,
        shortRangeFee: 15,
        midRangeFee: 25,
        longRangeFee: 50,
        perMileRateAfterLongRange: 2,
        shortRangeBufferMinutes: 15,
        midRangeBufferMinutes: 30,
        longRangeBufferMinutes: 60,
        isActive: true,
      }),
    ).rejects.toThrow("Tier 2 must end");
  });

  test("uses travel buffers for appointment blocking", () => {
    expect(calculateTravelBufferMinutesForMiles(14)).toBe(0);
    expect(calculateTravelBufferMinutesForMiles(14.1)).toBe(15);
    expect(calculateTravelBufferMinutesForMiles(20)).toBe(15);
    expect(calculateTravelBufferMinutesForMiles(20.1)).toBe(30);
    expect(calculateTravelBufferMinutesForMiles(35)).toBe(30);
    expect(calculateTravelBufferMinutesForMiles(35.1)).toBe(60);
    expect(calculateTravelBufferMinutesForMiles(50)).toBe(60);
    expect(calculateTravelBufferMinutesForMiles(50.1)).toBe(60);
  });

  test("calculates haversine distance in miles", () => {
    const distance = calculateHaversineDistance(
      34.752258,
      -92.329768,
      35.752258,
      -92.329768,
    );

    expect(distance).toBeGreaterThan(68);
    expect(distance).toBeLessThan(70);
  });

  test("uses passed coordinates before geocoding and requests driving distance", async () => {
    const t = convexTest(schema, modules);
    const fetchMock = vi.fn(stripeFetchMock);
    vi.stubGlobal("fetch", fetchMock);

    const result = await t.action(api.travelFees.calculate, {
      address: {
        street: "100 Far Away Rd",
        city: "Somewhere",
        state: "AR",
        zip: "72000",
        latitude: 35.752258,
        longitude: -92.329768,
      },
    });

    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringContaining("/geocode/forward"),
      expect.anything(),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/route/distance"),
      expect.anything(),
    );
    expect(result.distanceMiles).toBeGreaterThan(68);
    expect(result.distanceMiles).toBeLessThan(70);
    expect(result.fee).toBe(calculateTravelFeeForMiles(result.distanceMiles));
  });

  test("calculates driving distance using Radar route distance API", async () => {
    const t = convexTest(schema, modules);
    const fetchMock = vi.fn(async (url: string | URL) => {
      const urlStr = String(url);
      if (urlStr.includes("/route/distance")) {
        return Response.json({
          routes: {
            car: {
              distance: { text: "19.5 mi", value: 103074.15 },
              duration: { text: "24 mins", value: 23.92 },
            },
          },
        });
      }
      return Response.json({}, { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await t.action(api.travelFees.calculate, {
      address: {
        street: "201 Diamond Pointe Dr",
        city: "Maumelle",
        state: "AR",
        zip: "72113",
        latitude: 34.878834,
        longitude: -92.424237,
      },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/route/distance"),
      expect.anything(),
    );
    expect(result.distanceMiles).toBe(19.5);
    expect(result.fee).toBe(15);
    expect(result.bufferMinutes).toBe(15);
  });

  test("falls back to Haversine distance when Radar route distance API fails", async () => {
    const t = convexTest(schema, modules);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        const urlStr = String(url);
        if (urlStr.includes("/route/distance")) {
          return Response.json({ error: "Throttled" }, { status: 429 });
        }
        return Response.json({}, { status: 404 });
      }),
    );

    const result = await t.action(api.travelFees.calculate, {
      address: {
        street: "201 Diamond Pointe Dr",
        city: "Maumelle",
        state: "AR",
        zip: "72113",
        latitude: 34.878834,
        longitude: -92.424237,
      },
    });

    // Falls back to straight-line Haversine (~10.3 miles), which is within the 14-mile free radius
    expect(result.distanceMiles).toBe(10.3);
    expect(result.fee).toBe(0);
    expect(result.bufferMinutes).toBe(0);
  });

  test("falls back to Radar geocoding when coordinates are missing", async () => {
    const previousKey = process.env.RADAR_SECRET_KEY;
    process.env.RADAR_SECRET_KEY = "test_radar_key";
    const t = convexTest(schema, modules);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        if (String(url).includes("/geocode/forward")) {
          return Response.json({
            addresses: [{ latitude: 34.752258, longitude: -92.329768 }],
          });
        }
        return Response.json({}, { status: 404 });
      }),
    );

    const result = await t.action(api.travelFees.calculate, {
      address: {
        street: "220 N Tyler St",
        city: "Little Rock",
        state: "AR",
        zip: "72205",
      },
    });

    process.env.RADAR_SECRET_KEY = previousKey;
    expect(result).toEqual({ distanceMiles: 0, fee: 0, bufferMinutes: 0 });
  });
});
