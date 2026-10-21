import { ConvexError, v } from "convex/values";
import { action, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { requireAdmin } from "./auth";
import type { VehicleSize } from "./lib/pricing";
import { assertRateLimit, normalizeRateLimitKey } from "./rateLimiter";

const legacySizeValidator = v.union(
  v.literal("small"),
  v.literal("medium"),
  v.literal("large"),
);

const DEFAULT_VEHICLE_TYPES = [
  {
    name: "Car",
    slug: "car",
    legacySize: "medium" as VehicleSize,
    displayOrder: 10,
    apiAliases: ["car", "compact", "subcompact", "midsize", "large cars", "sedan"],
  },
  {
    name: "Truck",
    slug: "truck",
    legacySize: "large" as VehicleSize,
    displayOrder: 20,
    apiAliases: ["pickup", "truck"],
  },
  {
    name: "SUV",
    slug: "suv",
    legacySize: "large" as VehicleSize,
    displayOrder: 30,
    apiAliases: ["sport utility", "suv"],
  },
  {
    name: "Van",
    slug: "van",
    legacySize: "large" as VehicleSize,
    displayOrder: 40,
    apiAliases: ["van", "minivan", "special purpose vehicle"],
  },
  {
    name: "Motorcycle",
    slug: "motorcycle",
    legacySize: "small" as VehicleSize,
    displayOrder: 50,
    apiAliases: ["motorcycle", "scooter"],
  },
  {
    name: "Semi",
    slug: "semi",
    legacySize: "large" as VehicleSize,
    displayOrder: 110,
    apiAliases: [
      "semi",
      "semi truck",
      "semi-truck",
      "heavy truck",
      "tractor trailer",
      "freightliner",
      "kenworth",
      "peterbilt",
      "mack",
      "western star",
      "international",
      "hino",
      "scania",
    ],
  },
];

const HEAVY_TRUCK_MAKES = [
  "freightliner",
  "kenworth",
  "peterbilt",
  "mack",
  "western star",
  "international",
  "hino",
  "scania",
] as const;

const LIGHT_TRUCK_MODELS = [
  "sprinter",
  "metris",
  "promaster",
  "pro master",
  "transit",
] as const;

function isHeavyTruckVehicle(make: string, model: string) {
  const normalizedMake = make.trim().toLowerCase();
  const normalizedModel = model.trim().toLowerCase();
  if (
    LIGHT_TRUCK_MODELS.some((candidate) =>
      normalizedModel.includes(candidate),
    )
  ) {
    return false;
  }
  return HEAVY_TRUCK_MAKES.some((candidate) =>
    normalizedMake.includes(candidate),
  );
}

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function inferLegacySize(name: string): VehicleSize {
  const normalized = name.toLowerCase();
  if (normalized.includes("motorcycle") || normalized.includes("bike")) {
    return "small";
  }
  if (
    normalized.includes("truck") ||
    normalized.includes("van") ||
    normalized.includes("suv") ||
    normalized.includes("semi") ||
    normalized.includes("heavy") ||
    normalized.includes("tractor")
  ) {
    return "large";
  }
  return "medium";
}

async function ensureDefaultVehicleTypes(ctx: any) {
  const now = Date.now();
  const ids: Record<string, Id<"vehicleTypes">> = {};

  for (const vehicleType of DEFAULT_VEHICLE_TYPES) {
    const existing = await ctx.db
      .query("vehicleTypes")
      .withIndex("by_slug", (q: any) => q.eq("slug", vehicleType.slug))
      .first();

    if (existing) {
      ids[vehicleType.slug] = existing._id;
      continue;
    }

    ids[vehicleType.slug] = await ctx.db.insert("vehicleTypes", {
      ...vehicleType,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
  }

  return ids;
}

export const ensureDefaults = mutation({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    return await ensureDefaultVehicleTypes(ctx);
  },
});

export const ensureDefaultsInternal = internalMutation({
  args: {},
  handler: async (ctx) => {
    return await ensureDefaultVehicleTypes(ctx);
  },
});

export const list = query({
  args: { includeInactive: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const vehicleTypes = await ctx.db.query("vehicleTypes").collect();
    return vehicleTypes
      .filter((vehicleType) => args.includeInactive || vehicleType.isActive)
      .sort((a, b) => a.displayOrder - b.displayOrder || a.name.localeCompare(b.name));
  },
});

export const getBySlugInternal = internalQuery({
  args: { slug: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("vehicleTypes")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .first();
  },
});

export const getDefaultByLegacySizeInternal = internalQuery({
  args: { legacySize: legacySizeValidator },
  handler: async (ctx, args) => {
    const types = await ctx.db.query("vehicleTypes").collect();
    return (
      types
        .filter((vehicleType) => vehicleType.isActive)
        .find((vehicleType) => vehicleType.legacySize === args.legacySize) ?? null
    );
  },
});

export const create = mutation({
  args: {
    name: v.string(),
    legacySize: v.optional(legacySizeValidator),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const name = args.name.trim();
    const slug = slugify(name);
    if (!name || !slug) {
      throw new ConvexError({
        code: "INVALID_VEHICLE_TYPE",
        message: "Vehicle type name is required.",
      });
    }

    const existing = await ctx.db
      .query("vehicleTypes")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .first();
    if (existing) {
      if (!existing.isActive) {
        await ctx.db.patch(existing._id, { isActive: true, updatedAt: Date.now() });
      }
      return existing._id;
    }

    const currentTypes = await ctx.db.query("vehicleTypes").collect();
    const now = Date.now();
    return await ctx.db.insert("vehicleTypes", {
      name,
      slug,
      legacySize: args.legacySize ?? inferLegacySize(name),
      isActive: true,
      displayOrder:
        currentTypes.reduce((max, vehicleType) => Math.max(max, vehicleType.displayOrder), 0) + 10,
      apiAliases: [name.toLowerCase()],
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const update = mutation({
  args: {
    vehicleTypeId: v.id("vehicleTypes"),
    name: v.string(),
    legacySize: legacySizeValidator,
    isActive: v.boolean(),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const name = args.name.trim();
    if (!name) throw new Error("Vehicle type name is required.");

    await ctx.db.patch(args.vehicleTypeId, {
      name,
      legacySize: args.legacySize,
      isActive: args.isActive,
      updatedAt: Date.now(),
    });
    return args.vehicleTypeId;
  },
});

function mapCategoryToSlug(value: string | undefined): {
  slug: string;
  confidence: "high" | "medium" | "low";
} {
  const normalized = value?.toLowerCase() ?? "";
  if (!normalized) return { slug: "car", confidence: "low" };
  if (
    normalized.includes("recreational vehicle") ||
    normalized.includes("motorhome") ||
    normalized.includes("rv")
  ) {
    return { slug: "van", confidence: "medium" };
  }
  if (
    normalized.includes("atv") ||
    normalized.includes("all-terrain") ||
    normalized.includes("all terrain") ||
    normalized.includes("side-by-side") ||
    normalized.includes("side by side") ||
    normalized.includes("utv") ||
    normalized.includes("utility terrain") ||
    normalized.includes("defender") ||
    normalized.includes("maverick") ||
    normalized.includes("can-am") ||
    normalized.includes("slingshot")
  ) {
    return { slug: "side-by-side", confidence: "medium" };
  }
  if (normalized.includes("spyder") || normalized.includes("ryker")) {
    return { slug: "motorcycle", confidence: "medium" };
  }
  if (normalized.includes("minivan") || normalized.includes("van")) {
    return { slug: "van", confidence: "high" };
  }
  if (
    normalized.includes("semi") ||
    normalized.includes("tractor trailer") ||
    normalized.includes("heavy truck") ||
    normalized.includes("heavy duty truck")
  ) {
    return { slug: "semi", confidence: "high" };
  }
  if (normalized.includes("pickup") || normalized.includes("truck")) {
    return { slug: "truck", confidence: "high" };
  }
  if (normalized.includes("sport utility") || normalized.includes("suv")) {
    return { slug: "suv", confidence: "high" };
  }
  if (normalized.includes("motorcycle") || normalized.includes("scooter")) {
    return { slug: "motorcycle", confidence: "medium" };
  }
  if (
    normalized.includes("compact") ||
    normalized.includes("midsize") ||
    normalized.includes("large cars") ||
    normalized.includes("two seater") ||
    normalized.includes("station wagon")
  ) {
    return { slug: "car", confidence: "high" };
  }
  if (normalized.includes("special purpose")) {
    return { slug: "van", confidence: "medium" };
  }
  return { slug: "car", confidence: "low" };
}

function normalizeModelName(value: string | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/\b(all[-\s]?wheel|four[-\s]?wheel|front[-\s]?wheel|rear[-\s]?wheel)\s+drive\b/g, " ")
    .replace(/\b(awd|4wd|2wd|fwd|rwd|4x4|2x4)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function isModelMatch(inputModel: string, candidateModel: string): boolean {
  const input = normalizeModelName(inputModel);
  const candidate = normalizeModelName(candidateModel);
  if (!input || !candidate) return false;
  return candidate.includes(input) || input.includes(candidate);
}

function getGeminiApiKey(): string | undefined {
  return (
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_GENERATIVE_AI_API_KEY
  )?.trim();
}

async function classifyWithGeminiSearch(args: {
  year: number;
  make: string;
  model: string;
}): Promise<{
  slug: string;
  confidence: "high" | "medium" | "low";
  rawCategory?: string;
} | null> {
  const apiKey = getGeminiApiKey();
  if (!apiKey) return null;

  const model = process.env.GEMINI_VEHICLE_CLASSIFIER_MODEL || "gemini-2.5-flash";
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              {
                text:
                  "Use Google Search if needed. Classify this vehicle for a mobile detailing pricing engine. " +
                  "Return only compact JSON with keys slug, confidence, rawCategory. " +
                  "slug must be one of car, truck, suv, van, motorcycle, side-by-side, semi. " +
                  "Use semi for heavy-duty semi trucks and tractor-trailers such as Freightliner Cascadia, Kenworth T680, and Peterbilt 579. " +
                  "Use side-by-side for ATVs, UTVs, side-by-sides, Can-Am Defender/Maverick, Polaris RZR/Ranger, and similar off-road utility vehicles. " +
                  "Use motorcycle for motorcycles, scooters, trikes, Can-Am Spyder/Ryker, and road-going three-wheel motorcycles. " +
                  "Use van for RVs/motorhomes/campers if no better category exists. " +
                  "Use confidence high only when the category is clear, medium when likely, low when uncertain. " +
                  `Vehicle: ${args.year} ${args.make} ${args.model}`,
              },
            ],
          },
        ],
        tools: [{ google_search: {} }],
        generationConfig: {
          temperature: 0,
          responseMimeType: "application/json",
        },
      }),
    },
  );
  if (!response.ok) {
    throw new Error(`Gemini vehicle classification failed: ${response.status}`);
  }

  const data = await response.json();
  const text = String(
    data?.candidates?.[0]?.content?.parts
      ?.map((part: any) => part?.text ?? "")
      .join("") ?? "",
  ).trim();
  if (!text) return null;

  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    parsed = JSON.parse(jsonMatch[0]);
  }

  const mapped = mapCategoryToSlug(
    `${parsed?.slug ?? ""} ${parsed?.rawCategory ?? ""}`,
  );
  const confidence =
    parsed?.confidence === "high" || parsed?.confidence === "medium"
      ? parsed.confidence
      : mapped.confidence;

  return {
    slug:
      ["car", "truck", "suv", "van", "motorcycle", "side-by-side", "semi"].includes(parsed?.slug)
        ? parsed.slug
        : mapped.slug,
    confidence,
    rawCategory: parsed?.rawCategory
      ? `Gemini Search: ${String(parsed.rawCategory)}`
      : "Gemini Search classification",
  };
}

async function fetchJson(url: string) {
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`Vehicle lookup failed: ${response.status}`);
  }
  return await response.json();
}

function toMenuItems(value: any): Array<{ text: string; value: string }> {
  const menuItem = value?.menuItem;
  const items = Array.isArray(menuItem) ? menuItem : menuItem ? [menuItem] : [];
  return items
    .map((item) => ({
      text: String(item?.text ?? item?.value ?? "").trim(),
      value: String(item?.value ?? item?.text ?? "").trim(),
    }))
    .filter((item) => item.text && item.value);
}

function dedupeVehicleSuggestions(
  suggestions: Array<{
    year: number;
    make: string;
    model: string;
    source: "fuelEconomy" | "vpic";
  }>,
) {
  const seen = new Set<string>();
  return suggestions
    .filter((suggestion) => {
      const key = `${suggestion.year}|${suggestion.make}|${suggestion.model}`.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((suggestion) => ({
      ...suggestion,
      label: `${suggestion.year} ${suggestion.make} ${suggestion.model}`,
    }))
    .slice(0, 8);
}

async function searchFuelEconomyModelsForYear(
  year: number,
  makeQuery: string,
  modelQuery: string,
) {
  const suggestions: Array<{
    year: number;
    make: string;
    model: string;
    source: "fuelEconomy";
  }> = [];
  const makes = toMenuItems(
    await fetchJson(
      `https://www.fueleconomy.gov/ws/rest/vehicle/menu/make?year=${year}`,
    ),
  );
  const matchingMakes = makes
    .filter((make) => make.text.toLowerCase().includes(makeQuery))
    .slice(0, 4);

  for (const make of matchingMakes) {
    const models = toMenuItems(
      await fetchJson(
        `https://www.fueleconomy.gov/ws/rest/vehicle/menu/model?year=${year}&make=${encodeURIComponent(make.value)}`,
      ),
    );
    const matchingModels = models
      .filter((model) => {
        if (!modelQuery) return true;
        return model.text.toLowerCase().includes(modelQuery);
      })
      .slice(0, modelQuery ? 6 : 3);

    for (const model of matchingModels) {
      suggestions.push({
        year,
        make: make.text,
        model: model.text,
        source: "fuelEconomy",
      });
    }
  }

  return suggestions;
}

export const searchModels = action({
  args: {
    query: v.string(),
  },
  handler: async (
    ctx,
    args,
  ): Promise<
    Array<{
      year: number;
      make: string;
      model: string;
      label: string;
      source: "fuelEconomy" | "vpic";
    }>
  > => {
    const normalizedQuery = args.query.trim().replace(/\s+/g, " ");
    await assertRateLimit(ctx, "vehicleLookupGlobal", {
      message: "Vehicle lookup is temporarily busy. Please try again shortly.",
    });
    await assertRateLimit(ctx, "vehicleLookupByQuery", {
      key: normalizeRateLimitKey(normalizedQuery),
      message: "Please wait a moment before searching for that vehicle again.",
    });

    const yearMatch = normalizedQuery.match(/\b(19|20)\d{2}\b/);
    const year = yearMatch ? Number(yearMatch[0]) : undefined;
    const vehicleQuery = normalizedQuery
      .replace(yearMatch?.[0] ?? "", "")
      .trim()
      .replace(/\s+/g, " ");
    if (
      !vehicleQuery ||
      vehicleQuery.length < 2 ||
      (year !== undefined &&
        (year < 1900 || year > new Date().getFullYear() + 1))
    ) {
      return [];
    }

    const [makeQuery = "", ...modelParts] = vehicleQuery.toLowerCase().split(" ");
    const modelQuery = modelParts.join(" ");

    const suggestions: Array<{
      year: number;
      make: string;
      model: string;
      source: "fuelEconomy" | "vpic";
    }> = [];

    try {
      const years = year
        ? [year]
        : Array.from(
            { length: 8 },
            (_, index) => new Date().getFullYear() + 1 - index,
          );
      const results = await Promise.allSettled(
        years.map((searchYear) =>
          searchFuelEconomyModelsForYear(searchYear, makeQuery, modelQuery),
        ),
      );
      for (const result of results) {
        if (result.status === "fulfilled") {
          suggestions.push(...result.value);
        }
      }
    } catch {
      // vPIC is used as a fallback below.
    }

    if (year && suggestions.length < 3 && makeQuery.length >= 2) {
      try {
        const vpic = await fetchJson(
          `https://vpic.nhtsa.dot.gov/api/vehicles/GetModelsForMakeYear/make/${encodeURIComponent(makeQuery)}/modelyear/${year}?format=json`,
        );
        for (const result of vpic?.Results ?? []) {
          const make = String(result.Make_Name ?? makeQuery).trim();
          const model = String(result.Model_Name ?? "").trim();
          if (!make || !model) continue;
          if (modelQuery && !model.toLowerCase().includes(modelQuery)) continue;
          suggestions.push({
            year,
            make,
            model,
            source: "vpic",
          });
        }
      } catch {
        // Empty results are fine for a suggestion endpoint.
      }
    }

    return dedupeVehicleSuggestions(suggestions);
  },
});

export const classify = action({
  args: {
    year: v.number(),
    make: v.string(),
    model: v.string(),
  },
  handler: async (ctx, args): Promise<{
    vehicleTypeId?: Id<"vehicleTypes">;
    vehicleTypeName?: string;
    legacySize: VehicleSize;
    source: "fuelEconomy" | "vpic" | "fallback";
    confidence: "high" | "medium" | "low";
    rawCategory?: string;
    needsAdminReview: boolean;
  }> => {
    await assertRateLimit(ctx, "vehicleLookupGlobal", {
      message: "Vehicle lookup is temporarily busy. Please try again shortly.",
    });
    await assertRateLimit(ctx, "vehicleLookupByQuery", {
      key: normalizeRateLimitKey(`${args.year} ${args.make} ${args.model}`),
      message: "Please wait a moment before classifying that vehicle again.",
    });

    await ctx.runMutation(internal.vehicleTypes.ensureDefaultsInternal, {});

    if (isHeavyTruckVehicle(args.make, args.model)) {
      const semiType = await ctx.runQuery(
        internal.vehicleTypes.getBySlugInternal,
        { slug: "semi" },
      );
      return {
        vehicleTypeId: semiType?._id,
        vehicleTypeName: semiType?.name,
        legacySize: semiType?.legacySize ?? "large",
        source: "fallback",
        confidence: "high",
        rawCategory: `Heavy truck make: ${args.make.trim()}`,
        needsAdminReview: !semiType,
      };
    }

    const make = encodeURIComponent(args.make.trim());
    const model = encodeURIComponent(args.model.trim());
    let mapped: {
      slug: string;
      confidence: "high" | "medium" | "low";
    } = { slug: "car", confidence: "low" };
    let source: "fuelEconomy" | "vpic" | "fallback" = "fallback";
    let rawCategory: string | undefined;

    try {
      const options = await fetchJson(
        `https://www.fueleconomy.gov/ws/rest/vehicle/menu/options?year=${args.year}&make=${make}&model=${model}`,
      );
      const menuItem = Array.isArray(options?.menuItem)
        ? options.menuItem[0]
        : options?.menuItem;
      if (menuItem?.value) {
        const vehicle = await fetchJson(
          `https://www.fueleconomy.gov/ws/rest/vehicle/${encodeURIComponent(menuItem.value)}`,
        );
        rawCategory = vehicle?.VClass;
        mapped = mapCategoryToSlug(rawCategory);
        source = "fuelEconomy";
      }
    } catch {
      // Fall through to vPIC.
    }

    if (source === "fallback" || mapped.confidence === "low") {
      try {
        const vpic = await fetchJson(
          `https://vpic.nhtsa.dot.gov/api/vehicles/GetModelsForMakeYear/make/${make}/modelyear/${args.year}?format=json`,
        );
        const match = (vpic?.Results ?? []).find((result: any) =>
          isModelMatch(args.model, String(result.Model_Name ?? "")),
        );
        rawCategory = match?.VehicleTypeName ?? match?.Model_Name ?? rawCategory;
        const vpicMapped = mapCategoryToSlug(rawCategory);
        if (vpicMapped.confidence !== "low") {
          mapped = vpicMapped;
          source = "vpic";
        }
      } catch {
        // Keep fallback.
      }
    }

    if (mapped.confidence === "low") {
      try {
        const geminiMapped = await classifyWithGeminiSearch(args);
        if (
          geminiMapped &&
          (geminiMapped.confidence === "high" ||
            geminiMapped.confidence === "medium")
        ) {
          mapped = {
            slug: geminiMapped.slug,
            confidence: geminiMapped.confidence,
          };
          source = "fallback";
          rawCategory = geminiMapped.rawCategory ?? rawCategory;
        }
      } catch {
        // Keep low-confidence manual review fallback if Gemini is unavailable.
      }
    }

    const vehicleType = await ctx.runQuery(internal.vehicleTypes.getBySlugInternal, {
      slug: mapped.slug,
    });
    return {
      vehicleTypeId:
        mapped.confidence === "low" ? undefined : vehicleType?._id,
      vehicleTypeName:
        mapped.confidence === "low" ? undefined : vehicleType?.name,
      legacySize: vehicleType?.legacySize ?? "medium",
      source,
      confidence: mapped.confidence,
      rawCategory,
      needsAdminReview: mapped.confidence === "low" || !vehicleType,
    };
  },
});
