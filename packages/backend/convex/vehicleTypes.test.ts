import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { modules, stripeFetchMock } from "./test.setup";

function requestHost(url: string | URL): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

describe("vehicleTypes", () => {
  afterEach(() => {
    vi.stubGlobal("fetch", vi.fn(stripeFetchMock));
    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    delete process.env.GEMINI_VEHICLE_CLASSIFIER_MODEL;
  });

  test("canonicalizes lowercased makes and models for case-sensitive upstream options", async () => {
    const t = convexTest(schema, modules);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        const value = String(url);
        if (value.includes("/menu/make"))
          return Response.json({ menuItem: { text: "Tesla", value: "Tesla" } });
        if (value.includes("/menu/model"))
          return Response.json({
            menuItem: { text: "Model S", value: "Model S" },
          });
        if (value.includes("/menu/options")) {
          expect(value).toContain("make=Tesla&model=Model%20S");
          return Response.json({ menuItem: { value: "12345" } });
        }
        return Response.json({ VClass: "Large Cars" });
      }),
    );
    expect(
      (
        await t.action(api.vehicleTypes.classify, {
          year: 2025,
          make: "tesla",
          model: "model s",
        })
      ).vehicleTypeName,
    ).toBe("Car");
  });

  test("yearless multiword make search uses vPIC when Fuel Economy is unavailable", async () => {
    const t = convexTest(schema, modules);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        const value = String(url);
        if (requestHost(url) === "www.fueleconomy.gov")
          return Response.json({}, { status: 503 });
        expect(value).toContain("make/land%20rover/");
        return Response.json({
          Results: [{ Make_Name: "LAND ROVER", Model_Name: "Range Rover" }],
        });
      }),
    );
    const results = await t.action(api.vehicleTypes.searchModels, {
      query: "land rover range",
    });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]).toMatchObject({
      make: "LAND ROVER",
      model: "Range Rover",
      source: "vpic",
    });
  });

  test("seeds default vehicle types", async () => {
    const t = convexTest(schema, modules);

    const adminId = await t.run(async (ctx) => {
      return await ctx.db.insert("users", {
        name: "Admin",
        email: "admin-vehicle-types@test.com",
        role: "admin",
      });
    });
    const asAdmin = t.withIdentity({
      subject: adminId,
      email: "admin-vehicle-types@test.com",
    });

    await asAdmin.mutation(api.vehicleTypes.ensureDefaults, {});

    const vehicleTypes = await asAdmin.query(api.vehicleTypes.list, {});
    expect(vehicleTypes.map((vehicleType) => vehicleType.name)).toEqual([
      "Car",
      "Truck",
      "SUV",
      "Van",
      "Motorcycle",
      "Semi",
    ]);
  });

  test("classifies heavy truck makes as Semi without external lookups", async () => {
    const t = convexTest(schema, modules);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await t.action(api.vehicleTypes.classify, {
      year: 2018,
      make: "Freightliner",
      model: "Cascadia",
    });

    expect(result.vehicleTypeName).toBe("Semi");
    expect(result.legacySize).toBe("large");
    expect(result.source).toBe("fallback");
    expect(result.confidence).toBe("high");
    expect(result.needsAdminReview).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("does not classify a Freightliner Sprinter as Semi", async () => {
    const t = convexTest(schema, modules);

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        const urlString = String(url);
        if (urlString.includes("/menu/options")) {
          return Response.json({ menuItem: { value: "12345" } });
        }
        if (urlString.includes("/ws/rest/vehicle/12345")) {
          return Response.json({ VClass: "Van" });
        }
        return Response.json({}, { status: 404 });
      }),
    );

    const result = await t.action(api.vehicleTypes.classify, {
      year: 2018,
      make: "Freightliner",
      model: "Sprinter",
    });

    expect(result.vehicleTypeName).toBe("Van");
    expect(result.legacySize).toBe("large");
  });

  test("classifies minivans from FuelEconomy as Van", async () => {
    const t = convexTest(schema, modules);

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        const urlString = String(url);
        const hostname = requestHost(url);
        if (urlString.includes("/menu/options")) {
          return Response.json({ menuItem: { value: "12345" } });
        }
        if (urlString.includes("/ws/rest/vehicle/12345")) {
          return Response.json({ VClass: "Minivan - 2WD" });
        }
        return Response.json({}, { status: 404 });
      }),
    );

    const result = await t.action(api.vehicleTypes.classify, {
      year: 2024,
      make: "Honda",
      model: "Odyssey",
    });

    expect(result.vehicleTypeName).toBe("Van");
    expect(result.legacySize).toBe("large");
    expect(result.source).toBe("fuelEconomy");
    expect(result.confidence).toBe("high");
    expect(result.needsAdminReview).toBe(false);
  });

  test("searches FuelEconomy vehicle models by year and typed make/model", async () => {
    const t = convexTest(schema, modules);

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        const urlString = String(url);
        const hostname = requestHost(url);
        if (urlString.includes("/menu/make")) {
          return Response.json({
            menuItem: [
              { text: "Kia", value: "Kia" },
              { text: "Toyota", value: "Toyota" },
            ],
          });
        }
        if (urlString.includes("/menu/model")) {
          return Response.json({
            menuItem: [
              { text: "Sorento", value: "Sorento" },
              { text: "Sportage", value: "Sportage" },
            ],
          });
        }
        return Response.json({}, { status: 404 });
      }),
    );

    const results = await t.action(api.vehicleTypes.searchModels, {
      query: "2024 kia sor",
    });

    expect(results).toEqual([
      {
        year: 2024,
        make: "Kia",
        model: "Sorento",
        label: "2024 Kia Sorento",
        source: "fuelEconomy",
      },
    ]);
  });

  test("searches recent FuelEconomy model years when the year is omitted", async () => {
    const t = convexTest(schema, modules);
    const newestYear = new Date().getFullYear() + 1;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        const urlString = String(url);
        const hostname = requestHost(url);
        if (urlString.includes("/menu/make")) {
          return Response.json({
            menuItem: [{ text: "Kia", value: "Kia" }],
          });
        }
        if (urlString.includes("/menu/model")) {
          return Response.json({
            menuItem: [{ text: "Sorento AWD", value: "Sorento AWD" }],
          });
        }
        return Response.json({}, { status: 404 });
      }),
    );

    const results = await t.action(api.vehicleTypes.searchModels, {
      query: "Kia Sorento",
    });

    expect(results[0]).toEqual({
      year: newestYear,
      make: "Kia",
      model: "Sorento AWD",
      label: `${newestYear} Kia Sorento AWD`,
      source: "fuelEconomy",
    });
    expect(results).toHaveLength(8);
  });

  test("searches vehicles when only make is specified (year and model omitted)", async () => {
    const t = convexTest(schema, modules);
    const newestYear = new Date().getFullYear() + 1;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        const urlString = String(url);
        const hostname = requestHost(url);
        if (urlString.includes("/menu/make")) {
          return Response.json({
            menuItem: [{ text: "Kia", value: "Kia" }],
          });
        }
        if (urlString.includes("/menu/model")) {
          return Response.json({
            menuItem: [
              { text: "Sorento AWD", value: "Sorento AWD" },
              { text: "Sportage", value: "Sportage" },
            ],
          });
        }
        return Response.json({}, { status: 404 });
      }),
    );

    const results = await t.action(api.vehicleTypes.searchModels, {
      query: "Kia",
    });

    expect(results.length).toBeGreaterThan(0);
    expect(results[0]).toEqual({
      year: newestYear,
      make: "Kia",
      model: "Sorento AWD",
      label: `${newestYear} Kia Sorento AWD`,
      source: "fuelEconomy",
    });
    expect(results[1]).toEqual({
      year: newestYear,
      make: "Kia",
      model: "Sportage",
      label: `${newestYear} Kia Sportage`,
      source: "fuelEconomy",
    });
  });

  test("falls back to vPIC when FuelEconomy lookup fails", async () => {
    const t = convexTest(schema, modules);

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        const urlString = String(url);
        const hostname = requestHost(url);
        if (hostname === "www.fueleconomy.gov") {
          return Response.json({}, { status: 500 });
        }
        if (hostname === "vpic.nhtsa.dot.gov") {
          return Response.json({
            Results: [
              {
                Model_Name: "F-150",
                VehicleTypeName: "Truck",
              },
            ],
          });
        }
        return Response.json({}, { status: 404 });
      }),
    );

    const result = await t.action(api.vehicleTypes.classify, {
      year: 2024,
      make: "Ford",
      model: "F-150",
    });

    expect(result.vehicleTypeName).toBe("Truck");
    expect(result.legacySize).toBe("large");
    expect(result.source).toBe("vpic");
    expect(result.confidence).toBe("high");
    expect(result.needsAdminReview).toBe(false);
  });

  test("matches vPIC models when drivetrain suffixes differ", async () => {
    const t = convexTest(schema, modules);

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        const urlString = String(url);
        const hostname = requestHost(url);
        if (hostname === "www.fueleconomy.gov") {
          return Response.json({}, { status: 500 });
        }
        if (hostname === "vpic.nhtsa.dot.gov") {
          return Response.json({
            Results: [
              {
                Model_Name: "Sorento",
                VehicleTypeName: "Sport Utility Vehicle",
              },
            ],
          });
        }
        return Response.json({}, { status: 404 });
      }),
    );

    const result = await t.action(api.vehicleTypes.classify, {
      year: 2012,
      make: "Kia",
      model: "Sorento AWD",
    });

    expect(result.vehicleTypeName).toBe("SUV");
    expect(result.legacySize).toBe("large");
    expect(result.source).toBe("vpic");
    expect(result.needsAdminReview).toBe(false);
  });

  test("routes Can-Am UTVs to a configured side-by-side vehicle type", async () => {
    const t = convexTest(schema, modules);

    await t.run(async (ctx) => {
      await ctx.db.insert("vehicleTypes", {
        name: "Side-by-side",
        slug: "side-by-side",
        legacySize: "medium",
        apiAliases: ["side-by-side", "utv"],
        isActive: true,
        displayOrder: 90,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        const urlString = String(url);
        const hostname = requestHost(url);
        if (hostname === "www.fueleconomy.gov") {
          return Response.json({}, { status: 500 });
        }
        if (hostname === "vpic.nhtsa.dot.gov") {
          return Response.json({
            Results: [
              {
                Model_Name: "Defender",
                VehicleTypeName: "Utility Terrain Vehicle",
              },
            ],
          });
        }
        return Response.json({}, { status: 404 });
      }),
    );

    const result = await t.action(api.vehicleTypes.classify, {
      year: 2014,
      make: "Can-Am",
      model: "Defender",
    });

    expect(result.vehicleTypeName).toBe("Side-by-side");
    expect(result.legacySize).toBe("medium");
    expect(result.source).toBe("vpic");
    expect(result.confidence).toBe("medium");
    expect(result.needsAdminReview).toBe(false);
  });

  test("uses Gemini Search as a final classifier for oddball manual vehicles", async () => {
    const t = convexTest(schema, modules);
    process.env.GEMINI_API_KEY = "gemini_test_key";
    process.env.GEMINI_VEHICLE_CLASSIFIER_MODEL = "gemini-test-model";

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL, options?: RequestInit) => {
        const urlString = String(url);
        const hostname = requestHost(url);
        if (hostname === "www.fueleconomy.gov") {
          return Response.json({}, { status: 500 });
        }
        if (hostname === "vpic.nhtsa.dot.gov") {
          return Response.json({ Results: [] });
        }
        if (hostname === "generativelanguage.googleapis.com") {
          expect(options?.body?.toString()).toContain("google_search");
          return Response.json({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: JSON.stringify({
                        slug: "motorcycle",
                        confidence: "high",
                        rawCategory: "three-wheeled motorcycle / roadster",
                      }),
                    },
                  ],
                },
              },
            ],
          });
        }
        return Response.json({}, { status: 404 });
      }),
    );

    const result = await t.action(api.vehicleTypes.classify, {
      year: 2024,
      make: "Can-Am",
      model: "Spyder RT",
    });

    expect(result.vehicleTypeName).toBe("Motorcycle");
    expect(result.legacySize).toBe("small");
    expect(result.confidence).toBe("high");
    expect(result.rawCategory).toContain("Gemini Search");
    expect(result.needsAdminReview).toBe(false);
  });

  test("does not assign Car pricing when classification confidence is low", async () => {
    const t = convexTest(schema, modules);

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({}, { status: 404 })),
    );

    const result = await t.action(api.vehicleTypes.classify, {
      year: 2024,
      make: "Unknown",
      model: "Mystery Vehicle",
    });

    expect(result.vehicleTypeId).toBeUndefined();
    expect(result.vehicleTypeName).toBeUndefined();
    expect(result.confidence).toBe("low");
    expect(result.needsAdminReview).toBe(true);
  });
});

test("classifies base CRV input across provider drivetrain variants", async () => {
  const t = convexTest(schema, modules);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL) => {
      const u = String(url);
      if (u.includes("/menu/make"))
        return Response.json({ menuItem: { text: "Honda", value: "Honda" } });
      if (u.includes("/menu/model"))
        return Response.json({
          menuItem: [
            { text: "CR-V AWD", value: "CR-V AWD" },
            { text: "CR-V FWD", value: "CR-V FWD" },
          ],
        });
      if (u.includes("/menu/options"))
        return Response.json({
          menuItem: { value: u.includes("AWD") ? "1" : "2" },
        });
      return Response.json({ VClass: "Small Sport Utility Vehicle 4WD" });
    }),
  );
  const result = await t.action(api.vehicleTypes.classify, {
    year: 2019,
    make: "honda",
    model: "crv",
  });
  expect(result).toMatchObject({
    vehicleTypeName: "SUV",
    source: "fuelEconomy",
    needsAdminReview: false,
  });
});

test("conflicting body categories require review instead of choosing the first trim", async () => {
  const t = convexTest(schema, modules);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL) => {
      const u = String(url);
      if (u.includes("/menu/make"))
        return Response.json({
          menuItem: { text: "Chevrolet", value: "Chevrolet" },
        });
      if (u.includes("/menu/model"))
        return Response.json({
          menuItem: [
            { text: "Colorado 2WD", value: "Colorado 2WD" },
            {
              text: "Colorado Cab Chassis 2WD",
              value: "Colorado Cab Chassis 2WD",
            },
          ],
        });
      if (u.includes("/menu/options"))
        return Response.json({
          menuItem: { value: u.includes("Chassis") ? "2" : "1" },
        });
      return Response.json({
        VClass: u.endsWith("/2")
          ? "Special Purpose Vehicle 2WD"
          : "Small Pickup Trucks 2WD",
      });
    }),
  );
  const result = await t.action(api.vehicleTypes.classify, {
    year: 2016,
    make: "Chevy",
    model: "Colorado",
  });
  expect(result.vehicleTypeId).toBeUndefined();
  expect(result.needsAdminReview).toBe(true);
  expect(result.rawCategory).toContain("Conflicting");
});

test("real vPIC model listings need a typed request for an excluded heavy-duty pickup", async () => {
  const t = convexTest(schema, modules);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL) => {
      const u = String(url);
      if (u.includes("fueleconomy.gov"))
        return Response.json({}, { status: 503 });
      const model = { Make_Name: "FORD", Model_Name: "F-250" };
      if (u.includes("/vehicletype/truck"))
        return Response.json({
          Results: [{ ...model, VehicleTypeName: "Truck" }],
        });
      if (u.includes("/vehicletype/")) return Response.json({ Results: [] });
      return Response.json({ Results: [model] });
    }),
  );
  expect(
    await t.action(api.vehicleTypes.classify, {
      year: 2025,
      make: "FORD",
      model: "F250",
    }),
  ).toMatchObject({
    vehicleTypeName: "Truck",
    source: "vpic",
    confidence: "high",
  });
});

test("full Yukon Denali search returns real base-model candidates rather than requiring exact trim spelling", async () => {
  const t = convexTest(schema, modules);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL) => {
      const u = String(url);
      if (u.includes("/menu/make"))
        return Response.json({ menuItem: { text: "GMC", value: "GMC" } });
      if (u.includes("/menu/model"))
        return Response.json({
          menuItem: [
            { text: "Yukon 4WD", value: "Yukon 4WD" },
            { text: "Yukon 2WD", value: "Yukon 2WD" },
          ],
        });
      return Response.json({ Results: [] });
    }),
  );
  const results = await t.action(api.vehicleTypes.searchModels, {
    query: "2023 gmc yukon denali",
  });
  expect(results.map((r) => r.model)).toContain("Yukon 4WD");
});

test.each([
  "2023 GMC Denali",
  "2023 denali",
  "GMC DENALI",
  "denali",
  "2023 GMC Elevation",
])(
  "trim-only lookup offers real model families without selecting a price: %s",
  async (query) => {
    const t = convexTest(schema, modules);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        const u = String(url);
        if (u.includes("/menu/make"))
          return Response.json({ menuItem: { text: "GMC", value: "GMC" } });
        if (u.includes("/menu/model"))
          return Response.json({
            menuItem: [
              { text: "Sierra 2WD", value: "Sierra 2WD" },
              { text: "Sierra 4WD", value: "Sierra 4WD" },
              {
                text: "Sierra Cab Chassis 2WD",
                value: "Sierra Cab Chassis 2WD",
              },
              { text: "Yukon 2WD", value: "Yukon 2WD" },
              { text: "Terrain AWD", value: "Terrain AWD" },
              { text: "Savana", value: "Savana" },
            ],
          });
        return Response.json({ Results: [] });
      }),
    );
    const results = await t.action(api.vehicleTypes.searchModels, { query });
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((r) => r.make === "GMC" && r.matchedTrim)).toBe(true);
    expect(results.some((r) => r.model === "Savana")).toBe(false);
    if (!query.toLowerCase().includes("elevation"))
      expect(results.map((r) => r.model)).toContain("Yukon 2WD");
    const classified = await t.action(api.vehicleTypes.classify, {
      year: 2023,
      make: "GMC",
      model: query.includes("Elevation") ? "Elevation" : "Denali",
    });
    expect(classified.vehicleTypeId).toBeUndefined();
    expect(classified.needsAdminReview).toBe(true);
  },
);

test("the broad vPIC Truck type does not silently classify a cargo van as a pickup", async () => {
  const t = convexTest(schema, modules);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL) => {
      const u = String(url);
      if (u.includes("fueleconomy.gov"))
        return Response.json({}, { status: 503 });
      const model = { Make_Name: "FORD", Model_Name: "Transit" };
      if (u.includes("/vehicletype/truck"))
        return Response.json({
          Results: [{ ...model, VehicleTypeName: "Truck" }],
        });
      if (u.includes("/vehicletype/")) return Response.json({ Results: [] });
      return Response.json({ Results: [model] });
    }),
  );
  const result = await t.action(api.vehicleTypes.classify, {
    year: 2025,
    make: "Ford",
    model: "Transit",
  });
  expect(result.vehicleTypeId).toBeUndefined();
  expect(result.needsAdminReview).toBe(true);
});

test("an unknown trim on any recognized make recovers to selectable model/body options, including commercial bodies", async () => {
  const t = convexTest(schema, modules);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL) => {
      const u = String(url);
      if (u.includes("/menu/make"))
        return Response.json({
          menuItem: { text: "Chevrolet", value: "Chevrolet" },
        });
      if (u.includes("/menu/model"))
        return Response.json({
          menuItem: [
            { text: "Silverado 2WD", value: "Silverado 2WD" },
            {
              text: "Silverado Cab Chassis 2WD",
              value: "Silverado Cab Chassis 2WD",
            },
          ],
        });
      return Response.json({ Results: [] });
    }),
  );
  const result = await t.action(api.vehicleTypes.searchModels, {
    query: "2024 Chevrolet Custom Fleet Trim",
  });
  expect(result.map((r) => r.model)).toContain("Silverado Cab Chassis 2WD");
  expect(result.every((r) => r.matchedTrim)).toBe(true);
});

test.each([
  ["2024 STX", "Ford", "F-150"],
  ["2024 SR5", "Toyota", "Tundra"],
  ["2024 LTZ", "Chevrolet", "Silverado Cab Chassis 2WD"],
  ["2024 Long Range", "Tesla", "Model 3"],
])("trim-only hints work across makes: %s", async (query, make, model) => {
  const t = convexTest(schema, modules);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL) => {
      const u = String(url);
      if (u.includes("/menu/make"))
        return Response.json({ menuItem: { text: make, value: make } });
      if (u.includes("/menu/model"))
        return Response.json({ menuItem: { text: model, value: model } });
      return Response.json({ Results: [] });
    }),
  );
  expect(
    (await t.action(api.vehicleTypes.searchModels, { query })).map(
      (r) => r.model,
    ),
  ).toContain(model);
});

test("a matching commercial vPIC model outranks broad passenger-model recovery choices", async () => {
  const t = convexTest(schema, modules);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL) => {
      const u = String(url);
      if (u.includes("/menu/make"))
        return Response.json({ menuItem: { text: "Ford", value: "Ford" } });
      if (u.includes("/menu/model"))
        return Response.json({
          menuItem: [
            { text: "Mustang", value: "Mustang" },
            { text: "Escape AWD", value: "Escape AWD" },
            { text: "Explorer AWD", value: "Explorer AWD" },
          ],
        });
      return Response.json({
        Results: [{ Make_Name: "FORD", Model_Name: "F-250" }],
      });
    }),
  );
  const results = await t.action(api.vehicleTypes.searchModels, {
    query: "2025 Ford F250",
  });
  expect(results.map((r) => r.model)).toEqual(["F-250"]);
});
