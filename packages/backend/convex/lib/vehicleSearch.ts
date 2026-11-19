const MULTIWORD_MAKES = [
  "land rover",
  "alfa romeo",
  "aston martin",
  "rolls royce",
  "rolls-royce",
  "mercedes benz",
  "mercedes-benz",
  "am general",
  "western star",
];

export function parseVehicleSearch(query: string) {
  const normalized = query.trim().replace(/\s+/g, " ");
  const year = normalized.match(/\b(19|20)\d{2}\b/)?.[0] ?? "";
  const vehicle = normalized.replace(year, "").trim();
  const lower = vehicle.toLowerCase();
  const prefix = MULTIWORD_MAKES.find(
    (make) => lower === make || lower.startsWith(`${make} `),
  );
  const make = prefix
    ? vehicle.slice(0, prefix.length)
    : (vehicle.split(" ")[0] ?? "");
  return {
    year,
    make: /^(chevy)$/i.test(make) ? "Chevrolet" : make,
    model: vehicle
      .slice(prefix?.length ?? vehicle.split(" ")[0]?.length ?? 0)
      .trim(),
  };
}
