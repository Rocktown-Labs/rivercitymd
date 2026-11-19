import { normalizeVehicleModel } from "./vehicleMatching";

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

// Suggestions only. Classification deliberately keeps its exact/family rules.
// Keep model numbers intact: GS 350 and GS 450 must remain distinct choices.
export function similarVehicleModelScore(query: string, candidate: string) {
  const input = normalizeVehicleModel(query).replaceAll(" ", "");
  const words = normalizeVehicleModel(candidate).split(" ");
  if (input.length < 4 || input.length > 64) return null;
  const limit = input.length >= 7 ? 2 : 1;
  let best: number | null = null;
  let prefix = "";
  for (const word of words) {
    prefix += word;
    if (prefix.length > input.length + limit) break;
    if (Math.abs(prefix.length - input.length) > limit) continue;
    if (
      (input.match(/\d+/g) ?? []).join("|") !==
      (prefix.match(/\d+/g) ?? []).join("|")
    )
      continue;
    const distance = spellingDistance(input, prefix);
    if (distance > 0 && distance <= limit && (best === null || distance < best))
      best = distance;
  }
  return best;
}

function spellingDistance(a: string, b: string) {
  const matrix = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) =>
      i === 0 ? j : j === 0 ? i : 0,
    ),
  );
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + Number(a[i - 1] !== b[j - 1]),
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        matrix[i][j] = Math.min(matrix[i][j], matrix[i - 2][j - 2] + 1);
      }
    }
  }
  return matrix[a.length][b.length];
}
