// Provider menus use canonical spelling and often append drivetrain/trim data.
// Keep matching conservative: punctuation and drive labels may differ, but a
// partial word ("4run") must not silently become a different saved model.
export function normalizeVehicleMake(make: string) {
  const value = make.trim().replace(/\s+/g, " ");
  const aliases: Record<string, string> = {
    chevy: "Chevrolet",
    mercedes: "Mercedes-Benz",
    "mercedes benz": "Mercedes-Benz",
    "range rover": "Land Rover",
  };
  return aliases[value.toLowerCase()] ?? value;
}

export function normalizeVehicleModel(model: string) {
  return model
    .toLowerCase()
    .replace(/\b(awd|4wd|2wd|fwd|rwd|4x4|2x4)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/([a-z])\s+(?=\d)/g, "$1")
    .trim()
    .replace(/\s+/g, " ");
}

export function vehicleModelsMatch(input: string, candidate: string) {
  const a = normalizeVehicleModel(input);
  const b = normalizeVehicleModel(candidate);
  if (!a || !b) return false;
  if (a.replaceAll(" ", "") === b.replaceAll(" ", "")) return true;
  const compactA = a.replaceAll(" ", "");
  const compactB = b.replaceAll(" ", "");
  const familyPrefix = (prefix: string, value: string) => {
    if (!value.startsWith(prefix) || prefix.length === value.length)
      return false;
    const boundary = `${prefix.at(-1)}${value[prefix.length]}`;
    return /^[a-z]\d$|^\d[a-z]$/.test(boundary);
  };
  return (
    a.startsWith(`${b} `) ||
    b.startsWith(`${a} `) ||
    a.endsWith(` ${b}`) ||
    a.includes(` ${b} `) ||
    familyPrefix(compactA, compactB) ||
    familyPrefix(compactB, compactA)
  );
}

export function normalizeVehicleInput(
  make: string,
  model: string,
  year?: number,
) {
  let canonicalMake = normalizeVehicleMake(make);
  let canonicalModel = model.trim();
  if (
    make.trim().toLowerCase() === "range rover" &&
    !/^range rover\b/i.test(canonicalModel)
  ) {
    canonicalModel = `Range Rover ${canonicalModel}`.trim();
  }
  if (canonicalMake.toLowerCase() === "mercedes-benz") {
    canonicalModel = canonicalModel.replace(/^benz\s+/i, "");
  }
  if (
    year &&
    year >= 2011 &&
    canonicalMake.toLowerCase() === "dodge" &&
    /^ram\s+(1500|2500|3500)\b/i.test(canonicalModel)
  ) {
    canonicalMake = "Ram";
    canonicalModel = canonicalModel.replace(/^ram\s+/i, "");
  }
  return { make: canonicalMake, model: canonicalModel };
}

// vPIC's broad "Truck" type also contains cargo vans/chassis. Limit its use
// as pickup pricing evidence to a recognized pickup family; otherwise review.
export function isPickupModel(model: string) {
  return /^(f\s*(150|250|350)|sierra|silverado|canyon|colorado|ranger|maverick|tacoma|tundra|titan|frontier|ridgeline|gladiator|cybertruck|ram\s*(1500|2500|3500))\b/i.test(
    normalizeVehicleModel(model),
  );
}
