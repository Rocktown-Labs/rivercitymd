// Search hints, not classification rules. Providers list model families rather
// than marketing trims. Always require the customer to choose a real model.
// Sources: https://www.gmc.com/denali and https://www.gmc.com/suvs/terrain
const GMC_TRIMS = [
  {
    name: "Denali",
    query: /^(denali|denali ultimate)$/i,
    families: ["Yukon", "Sierra", "Acadia", "Terrain", "Canyon", "Envoy"],
  },
  {
    name: "Elevation",
    query: /^elevation$/i,
    families: ["Sierra", "Canyon", "Terrain"],
  },
];

export function resolveTrimSearch(make: string, model: string) {
  const explicitGmc = make.trim().toLowerCase() === "gmc";
  const trim = GMC_TRIMS.find((candidate) =>
    candidate.query.test(
      explicitGmc ? model.trim() : `${make} ${model}`.trim(),
    ),
  );
  if (!trim) return null;
  return { make: "GMC", name: trim.name, families: trim.families };
}

export function trimModelFamily(model: string, families: string[]) {
  const normalized = model.toLowerCase();
  // A trim query must not pick a commercial cab/chassis variant.
  if (normalized.includes("cab chassis")) return undefined;
  return families.find(
    (family) =>
      normalized === family.toLowerCase() ||
      normalized.startsWith(`${family.toLowerCase()} `),
  );
}
