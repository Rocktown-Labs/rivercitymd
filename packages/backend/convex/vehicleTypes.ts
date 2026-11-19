import { resolveTrimSearch, trimModelFamily } from "./lib/vehicleTrims";
import {
  normalizeVehicleInput,
  isPickupModel,
  vehicleModelsMatch,
} from "./lib/vehicleMatching";
import { parseVehicleSearch } from "./lib/vehicleSearch";
import { ConvexError, v } from "convex/values";
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
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
    apiAliases: [
      "car",
      "compact",
      "subcompact",
      "midsize",
      "large cars",
      "sedan",
    ],
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
    LIGHT_TRUCK_MODELS.some((candidate) => normalizedModel.includes(candidate))
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
      .sort(
        (a, b) =>
          a.displayOrder - b.displayOrder || a.name.localeCompare(b.name),
      );
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
        .find((vehicleType) => vehicleType.legacySize === args.legacySize) ??
      null
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
        await ctx.db.patch(existing._id, {
          isActive: true,
          updatedAt: Date.now(),
        });
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
        currentTypes.reduce(
          (max, vehicleType) => Math.max(max, vehicleType.displayOrder),
          0,
        ) + 10,
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
    normalized === "passenger car" ||
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

function getGeminiApiKey(): string | undefined {
  return (
    process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY
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

  const model =
    process.env.GEMINI_VEHICLE_CLASSIFIER_MODEL || "gemini-2.5-flash";
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
    slug: [
      "car",
      "truck",
      "suv",
      "van",
      "motorcycle",
      "side-by-side",
      "semi",
    ].includes(parsed?.slug)
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
    signal: AbortSignal.timeout(8000),
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
    matchedTrim?: string;
  }>,
) {
  const seen = new Set<string>();
  return suggestions
    .filter((suggestion) => {
      const key =
        `${suggestion.year}|${suggestion.make}|${suggestion.model}`.toLowerCase();
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
  trim: ReturnType<typeof resolveTrimSearch> = null,
) {
  const suggestions: Array<{
    year: number;
    make: string;
    model: string;
    source: "fuelEconomy";
    matchedTrim?: string;
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
    const seenFamilies = new Set<string>();
    let suggestionLimit = modelQuery ? 6 : 3;
    if (trim) suggestionLimit = 8;
    const matchingModels = models
      .filter((model) => {
        if (trim) {
          const family = trimModelFamily(model.text, trim.families);
          if (!family || seenFamilies.has(family)) return false;
          seenFamilies.add(family);
          return true;
        }
        if (!modelQuery) return true;
        return (
          model.text.toLowerCase().includes(modelQuery) ||
          vehicleModelsMatch(modelQuery, model.text)
        );
      })
      .slice(0, suggestionLimit);

    for (const model of matchingModels) {
      suggestions.push({
        year,
        make: make.text,
        model: model.text,
        source: "fuelEconomy",
        ...(trim ? { matchedTrim: trim.name } : {}),
      });
    }
  }

  return suggestions;
}

export const searchModels = action({
  returns: v.array(
    v.object({
      year: v.number(),
      make: v.string(),
      model: v.string(),
      label: v.string(),
      source: v.union(v.literal("fuelEconomy"), v.literal("vpic")),
    }),
  ),
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
      matchedTrim?: string;
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

    const parsed = parseVehicleSearch(normalizedQuery);
    const lookup = normalizeVehicleInput(parsed.make, parsed.model);
    const trim = resolveTrimSearch(parsed.make, parsed.model);
    const makeQuery = (trim?.make ?? lookup.make).toLowerCase();
    const modelQuery = trim ? "" : lookup.model.toLowerCase();

    const suggestions: Array<{
      year: number;
      make: string;
      model: string;
      source: "fuelEconomy" | "vpic";
      matchedTrim?: string;
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
          searchFuelEconomyModelsForYear(
            searchYear,
            makeQuery,
            modelQuery,
            trim,
          ),
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

    if (suggestions.length < 3 && makeQuery.length >= 2) {
      // Without a year, offer recent model-year candidates, never silently
      // assign a year to the customer's manually entered vehicle.
      const fallbackYears = year
        ? [year]
        : [new Date().getFullYear(), new Date().getFullYear() - 1];
      for (const fallbackYear of fallbackYears) {
        try {
          const vpic = await fetchJson(
            `https://vpic.nhtsa.dot.gov/api/vehicles/GetModelsForMakeYear/make/${encodeURIComponent(makeQuery)}/modelyear/${fallbackYear}?format=json`,
          );
          const seenFamilies = new Set<string>();
          for (const result of vpic?.Results ?? []) {
            const make = String(result.Make_Name ?? makeQuery).trim();
            const model = String(result.Model_Name ?? "").trim();
            if (!make || !model) continue;
            if (trim) {
              const family = trimModelFamily(model, trim.families);
              if (!family || seenFamilies.has(family)) continue;
              seenFamilies.add(family);
            }
            if (
              modelQuery &&
              !model.toLowerCase().includes(modelQuery) &&
              !vehicleModelsMatch(modelQuery, model)
            )
              continue;
            suggestions.push({
              year: fallbackYear,
              make,
              model,
              source: "vpic",
              ...(trim ? { matchedTrim: trim.name } : {}),
            });
          }
        } catch {
          // Empty results are fine for a suggestion endpoint.
        }
      }
    }

    return dedupeVehicleSuggestions(suggestions);
  },
});

export const classify = action({
  returns: v.object({
    vehicleTypeId: v.optional(v.id("vehicleTypes")),
    vehicleTypeName: v.optional(v.string()),
    legacySize: legacySizeValidator,
    source: v.union(
      v.literal("fuelEconomy"),
      v.literal("vpic"),
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
  args: {
    year: v.number(),
    make: v.string(),
    model: v.string(),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
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

    const trimOnly = resolveTrimSearch(args.make, args.model);
    if (trimOnly)
      return {
        legacySize: "medium",
        source: "fallback",
        confidence: "low",
        needsAdminReview: true,
        rawCategory: `${trimOnly.name} is a trim shared by multiple models; choose the actual model`,
      };

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

    const lookup = normalizeVehicleInput(args.make, args.model);
    let canonicalMake = lookup.make;
    let modelCandidates: string[] = [lookup.model];
    try {
      const makes = toMenuItems(
        await fetchJson(
          `https://www.fueleconomy.gov/ws/rest/vehicle/menu/make?year=${args.year}`,
        ),
      );
      canonicalMake =
        makes.find((m) => m.text.toLowerCase() === canonicalMake.toLowerCase())
          ?.value ?? canonicalMake;
      const models = toMenuItems(
        await fetchJson(
          `https://www.fueleconomy.gov/ws/rest/vehicle/menu/model?year=${args.year}&make=${encodeURIComponent(canonicalMake)}`,
        ),
      );
      const matches = models.filter((m) =>
        vehicleModelsMatch(lookup.model, m.text),
      );
      // Consider every plausible variant, even if one model name is exact.
      // A base name can span body styles with different pricing categories.
      modelCandidates = matches.length
        ? matches.map((m) => m.value)
        : [lookup.model];
    } catch {
      /* Other providers and manual category selection remain available. */
    }
    const make = encodeURIComponent(canonicalMake);

    let mapped: {
      slug: string;
      confidence: "high" | "medium" | "low";
    } = { slug: "car", confidence: "low" };
    let source: "fuelEconomy" | "vpic" | "fallback" = "fallback";
    let rawCategory: string | undefined;

    let conflictingCategories = false;
    try {
      if (modelCandidates.length > 12) {
        conflictingCategories = true;
        throw new Error("Too many model variants");
      }
      const optionIds = new Set<string>();
      for (const candidate of modelCandidates) {
        const options = toMenuItems(
          await fetchJson(
            `https://www.fueleconomy.gov/ws/rest/vehicle/menu/options?year=${args.year}&make=${make}&model=${encodeURIComponent(candidate)}`,
          ),
        );
        for (const option of options) optionIds.add(option.value);
      }
      if (optionIds.size > 40) {
        conflictingCategories = true;
        throw new Error("Too many engine/trim variants");
      }
      const categories: string[] = [];
      for (const id of optionIds) {
        const vehicle = await fetchJson(
          `https://www.fueleconomy.gov/ws/rest/vehicle/${encodeURIComponent(id)}`,
        );
        if (!vehicle?.VClass) throw new Error("Vehicle class is unavailable");
        categories.push(vehicle.VClass);
      }
      const mappedCategories = categories.map(mapCategoryToSlug);
      const slugs = new Set(mappedCategories.map((category) => category.slug));
      conflictingCategories = slugs.size > 1;
      if (
        categories.length &&
        !conflictingCategories &&
        mappedCategories.every((c) => c.confidence !== "low")
      ) {
        mapped = mappedCategories[0];
        rawCategory = [...new Set(categories)].join("; ");
        source = "fuelEconomy";
      }
    } catch {
      // Incomplete provider evidence must not turn into a pricing decision.
    }

    if (
      !conflictingCategories &&
      (source === "fallback" || mapped.confidence === "low")
    ) {
      try {
        const vpic = await fetchJson(
          `https://vpic.nhtsa.dot.gov/api/vehicles/GetModelsForMakeYear/make/${make}/modelyear/${args.year}?format=json`,
        );
        const match = (vpic?.Results ?? []).find((result: any) =>
          vehicleModelsMatch(lookup.model, String(result.Model_Name ?? "")),
        );
        rawCategory = match?.VehicleTypeName ?? rawCategory;
        if (match && !match.VehicleTypeName) {
          const typed = await Promise.all(
            ["truck", "passenger car", "motorcycle"].map(async (type) => {
              const result = await fetchJson(
                `https://vpic.nhtsa.dot.gov/api/vehicles/GetModelsForMakeYear/make/${make}/modelyear/${args.year}/vehicletype/${encodeURIComponent(type)}?format=json`,
              );
              return (result?.Results ?? []).filter(
                (row: { Model_Name?: string; VehicleTypeName?: string }) =>
                  vehicleModelsMatch(lookup.model, row.Model_Name ?? ""),
              );
            }),
          );
          const classes = [
            ...new Set<string>(
              typed
                .flat()
                .map((row) => row.VehicleTypeName)
                .filter(Boolean),
            ),
          ];
          if (
            classes.length === 1 &&
            (classes[0].toLowerCase() !== "truck" ||
              isPickupModel(lookup.model))
          )
            rawCategory = classes[0];
        }
        const vpicMapped = mapCategoryToSlug(rawCategory);
        if (vpicMapped.confidence !== "low") {
          mapped = vpicMapped;
          source = "vpic";
        }
      } catch {
        // Keep fallback.
      }
    }

    if (mapped.confidence === "low" && !conflictingCategories) {
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

    const vehicleType = await ctx.runQuery(
      internal.vehicleTypes.getBySlugInternal,
      {
        slug: mapped.slug,
      },
    );
    return {
      vehicleTypeId: mapped.confidence === "low" ? undefined : vehicleType?._id,
      vehicleTypeName:
        mapped.confidence === "low" ? undefined : vehicleType?.name,
      legacySize: vehicleType?.legacySize ?? "medium",
      source,
      confidence: mapped.confidence,
      rawCategory: conflictingCategories
        ? "Conflicting provider categories; manual confirmation required"
        : rawCategory,
      needsAdminReview: mapped.confidence === "low" || !vehicleType,
    };
  },
});
