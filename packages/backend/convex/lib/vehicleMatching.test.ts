import { expect, test } from "vitest";
import { vehicleModelsMatch, normalizeVehicleMake } from "./vehicleMatching";

test("spacing and punctuation do not change a model, but partial words and trim-only names remain unresolved", () => {
  expect(vehicleModelsMatch("crv", "CR-V AWD")).toBe(true);
  expect(vehicleModelsMatch("GX470", "GX 470")).toBe(true);
  expect(vehicleModelsMatch("4run", "4Runner")).toBe(false);
  expect(vehicleModelsMatch("Denali", "Yukon Denali")).toBe(false);
  expect(vehicleModelsMatch("F250", "F-250")).toBe(true);
  expect(normalizeVehicleMake(" Chevy ")).toBe("Chevrolet");
});
