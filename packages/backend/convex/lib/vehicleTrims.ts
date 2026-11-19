import {
  normalizeVehicleInput,
  normalizeVehicleModel,
} from "./vehicleMatching";

// Search vocabulary from the audited fleet, not pricing/classification rules.
// Hints find public provider model candidates; they do not claim that every
// trim/body combination exists for a requested year. Keep commercial bodies.
const TRIM_HINTS = [
  {
    name: "Denali",
    makes: ["GMC"],
    models: ["Yukon", "Sierra", "Acadia", "Terrain", "Canyon", "Envoy"],
  },
  {
    name: "Denali Ultimate",
    makes: ["GMC"],
    models: ["Yukon", "Sierra", "Acadia", "Terrain"],
  },
  {
    name: "Elevation",
    makes: ["GMC"],
    models: ["Sierra", "Canyon", "Terrain", "Acadia"],
  },
  {
    name: "AT4",
    makes: ["GMC"],
    models: ["Sierra", "Yukon", "Canyon", "Acadia", "Terrain"],
  },
  {
    name: "SLT",
    makes: ["GMC"],
    models: ["Yukon", "Sierra", "Acadia", "Terrain"],
  },
  { name: "STX", makes: ["Ford"], models: ["F-150", "F-250"] },
  { name: "Timberline", makes: ["Ford"], models: ["Explorer", "Expedition"] },
  {
    name: "LTZ",
    makes: ["Chevrolet"],
    models: ["Silverado", "Tahoe", "Suburban"],
  },
  {
    name: "Z71",
    makes: ["Chevrolet"],
    models: ["Silverado", "Tahoe", "Suburban", "Colorado"],
  },
  {
    name: "TrailBoss",
    makes: ["Chevrolet"],
    models: ["Silverado", "Colorado"],
  },
  { name: "Rebel", makes: ["Ram", "Dodge"], models: ["1500", "Ram 1500"] },
  {
    name: "SR5",
    makes: ["Toyota"],
    models: ["Tundra", "Tacoma", "4Runner", "Sequoia"],
  },
  {
    name: "Platinum",
    makes: ["Nissan", "Ford", "Toyota"],
    models: [
      "Armada",
      "F-150",
      "Explorer",
      "Expedition",
      "Titan",
      "Tundra",
      "Sequoia",
      "Highlander",
    ],
  },
  {
    name: "Long Range",
    makes: ["Tesla"],
    models: ["Model 3", "Model Y", "Model S", "Model X", "Cybertruck"],
  },
  {
    name: "SE",
    makes: ["Ford", "Toyota", "Hyundai", "Nissan"],
    models: [
      "Focus",
      "Fusion",
      "Camry",
      "Corolla",
      "Sonata",
      "Elantra",
      "Altima",
    ],
  },
];

export function resolveTrimSearch(make: string, model: string) {
  const normalized = normalizeVehicleInput(make, model);
  const whole = `${make} ${model}`.trim().replace(/\s+/g, " ").toLowerCase();
  const trim = TRIM_HINTS.find((candidate) => {
    const name = candidate.name.toLowerCase();
    return (
      name === whole ||
      (candidate.makes.some(
        (m) => m.toLowerCase() === normalized.make.toLowerCase(),
      ) &&
        name === normalized.model.toLowerCase())
    );
  });
  if (!trim) return null;
  const explicit = trim.makes.find(
    (m) => m.toLowerCase() === normalized.make.toLowerCase(),
  );
  return {
    makes: explicit ? [explicit] : trim.makes,
    name: trim.name,
    families: trim.models,
  };
}

export function trimModelFamily(model: string, families: string[]) {
  const normalized = normalizeVehicleModel(model);
  return families.find(
    (family) =>
      normalized === normalizeVehicleModel(family) ||
      normalized.startsWith(`${normalizeVehicleModel(family)} `),
  );
}

export function trimModelChoiceKey(model: string, families: string[]) {
  const family = trimModelFamily(model, families);
  if (!family) return undefined;
  const body =
    model
      .toLowerCase()
      .match(
        /cab[ -]?chassis|chassis[ -]?cab|\bxl\b|\bev\b|cargo|passenger|convertible|coupe/,
      )?.[0] ?? "standard";
  return `${family}|${body}`;
}
