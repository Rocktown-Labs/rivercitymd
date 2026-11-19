import { normalizeVehicleInput, vehicleModelsMatch } from "./vehicleMatching";

// Manufacturer body-family evidence reconciles EPA fuel-economy size classes
// with the app's body categories. It never selects a trim or invents a year.
// A provider must still confirm that the model family exists for that year.
const EVIDENCE = [
  {
    make: "Mercedes-Benz",
    model: "GLB",
    slug: "suv",
    url: "https://www.mbusa.com/content/dam/mb-nafta/us/brochures/pdf/MY21_GLB_WebPDF_03.25.21.pdf",
  },
  {
    make: "Volvo",
    model: "XC90",
    slug: "suv",
    url: "https://www.volvocars.com/uk/cars/xc90/",
  },
  {
    make: "Chevrolet",
    model: "Colorado",
    slug: "truck",
    url: "https://www.chevrolet.com/trucks/colorado",
  },
  {
    make: "Chevrolet",
    model: "Silverado",
    slug: "truck",
    url: "https://www.chevrolet.com/trucks/silverado/1500",
  },
  {
    make: "GMC",
    model: "Sierra",
    slug: "truck",
    url: "https://www.gmc.com/trucks/sierra/1500",
  },
] as const;

export function getManufacturerCategoryEvidence(
  year: number,
  make: string,
  model: string,
) {
  const input = normalizeVehicleInput(make, model, year);
  return (
    EVIDENCE.find(
      (e) =>
        e.make.toLowerCase() === input.make.toLowerCase() &&
        vehicleModelsMatch(input.model, e.model),
    ) ?? null
  );
}
